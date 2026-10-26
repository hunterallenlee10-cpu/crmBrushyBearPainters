import { type NotConnected } from "@/lib/integrations/core";

/**
 * Review tracking. Review *requests* go out through the SMS/email providers;
 * this interface only reads reviews and builds the "leave a review" link.
 */

export type Review = {
  externalId: string;
  reviewerName: string;
  /** 1–5, or null if the provider gave no rating. */
  starRating: number | null;
  comment?: string;
  /** ISO 8601 (UTC). */
  createdAt?: string;
  replyComment?: string;
};

export type ListReviewsInput = { pageToken?: string };

export type ListReviewsResult =
  | NotConnected
  | {
      connected: true;
      reviews: Review[];
      averageRating?: number;
      totalReviewCount?: number;
      nextPageToken?: string;
      error?: string;
    };

export type ReviewLinkResult = NotConnected | { connected: true; url: string };

export interface ReviewsProvider {
  readonly provider: string;
  listReviews(input?: ListReviewsInput): Promise<ListReviewsResult>;
  getReviewLink(): Promise<ReviewLinkResult>;
}
