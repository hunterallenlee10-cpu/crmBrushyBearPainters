// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { getArray, getNumber, getRecord, getString, requestJson } from "@/lib/integrations/http";
import {
  type ListReviewsInput,
  type ListReviewsResult,
  type Review,
  type ReviewLinkResult,
  type ReviewsProvider,
} from "@/lib/integrations/reviews/types";

export type GoogleBusinessProfileConfig = {
  /** OAuth access token (business.manage scope). */
  accessToken: string;
  /** Numeric account id (GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID). */
  accountId: string;
  /** Numeric location id. */
  locationId: string;
  /** Google Place id for the public "write a review" link. */
  placeId?: string;
  pageSize?: number;
};

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export class GoogleBusinessProfileReviewsProvider implements ReviewsProvider {
  readonly provider = "google_business_profile";
  private readonly fetch: typeof fetch;
  private readonly config: GoogleBusinessProfileConfig;

  constructor(options: { fetch: typeof fetch; config: GoogleBusinessProfileConfig }) {
    const { accessToken, accountId, locationId } = options.config;
    if (!accessToken || !accountId || !locationId) {
      throw new Error("Google Business Profile needs accessToken, accountId and locationId.");
    }
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async listReviews(input: ListReviewsInput = {}): Promise<ListReviewsResult> {
    const params = new URLSearchParams({ pageSize: String(this.config.pageSize ?? 50) });
    if (input.pageToken) params.set("pageToken", input.pageToken);
    const url =
      `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(this.config.accountId)}` +
      `/locations/${encodeURIComponent(this.config.locationId)}/reviews?${params.toString()}`;
    const res = await requestJson(this.fetch, url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.config.accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return { connected: true, reviews: [], error: res.error };

    const reviews: Review[] = [];
    for (const r of getArray(res.data, "reviews")) {
      const externalId = getString(r, "reviewId");
      if (!externalId) continue;
      const comment = getString(r, "comment");
      const createdAt = getString(r, "createTime");
      const replyComment = getString(getRecord(r, "reviewReply"), "comment");
      reviews.push({
        externalId,
        reviewerName: getString(getRecord(r, "reviewer"), "displayName") ?? "Google user",
        starRating: STARS[getString(r, "starRating") ?? ""] ?? null,
        ...(comment ? { comment } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(replyComment ? { replyComment } : {}),
      });
    }
    const averageRating = getNumber(res.data, "averageRating");
    const totalReviewCount = getNumber(res.data, "totalReviewCount");
    const nextPageToken = getString(res.data, "nextPageToken");
    return {
      connected: true,
      reviews,
      ...(averageRating !== undefined ? { averageRating } : {}),
      ...(totalReviewCount !== undefined ? { totalReviewCount } : {}),
      ...(nextPageToken ? { nextPageToken } : {}),
    };
  }

  async getReviewLink(): Promise<ReviewLinkResult> {
    if (!this.config.placeId) {
      return { connected: false, reason: "No Google Place id configured for the review link." };
    }
    const params = new URLSearchParams({ placeid: this.config.placeId });
    return {
      connected: true,
      url: `https://search.google.com/local/writereview?${params.toString()}`,
    };
  }
}
