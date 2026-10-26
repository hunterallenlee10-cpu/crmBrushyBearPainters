import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  GoogleBusinessProfileReviewsProvider,
  getReviewsProvider,
} from "@/lib/integrations/reviews";
import { createFakeFetch } from "@/lib/integrations/testing";

const config = {
  accessToken: "gbp-token",
  accountId: "111",
  locationId: "222",
  placeId: "ChIJsample",
};

describe("outbox reviews provider", () => {
  it("is not connected and writes nothing", async () => {
    const sink = createMemoryOutboxSink();
    const reviews = getReviewsProvider({ orgId: "o", sink });
    expect(reviews.provider).toBe("outbox");
    expect(await reviews.listReviews()).toMatchObject({ connected: false });
    expect(await reviews.getReviewLink()).toMatchObject({ connected: false });
    expect(sink.entries).toHaveLength(0);
  });
});

describe("GoogleBusinessProfileReviewsProvider (disabled stub)", () => {
  it("lists reviews with a well-formed request", async () => {
    const fetch = createFakeFetch({
      json: {
        reviews: [
          {
            name: "accounts/111/locations/222/reviews/r1",
            reviewId: "r1",
            reviewer: { displayName: "Sample Reviewer" },
            starRating: "FIVE",
            comment: "Great crew, clean job site.",
            createTime: "2026-10-20T18:00:00Z",
            reviewReply: { comment: "Thank you!" },
          },
          { reviewId: "r2", reviewer: {}, starRating: "STAR_RATING_UNSPECIFIED" },
        ],
        averageRating: 4.5,
        totalReviewCount: 2,
        nextPageToken: "next-1",
      },
    });
    const gbp = new GoogleBusinessProfileReviewsProvider({ fetch, config });
    const result = await gbp.listReviews({ pageToken: "p0" });
    expect(result).toEqual({
      connected: true,
      reviews: [
        {
          externalId: "r1",
          reviewerName: "Sample Reviewer",
          starRating: 5,
          comment: "Great crew, clean job site.",
          createdAt: "2026-10-20T18:00:00Z",
          replyComment: "Thank you!",
        },
        { externalId: "r2", reviewerName: "Google user", starRating: null },
      ],
      averageRating: 4.5,
      totalReviewCount: 2,
      nextPageToken: "next-1",
    });
    const req = fetch.requests[0];
    expect(req?.method).toBe("GET");
    expect(req?.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/222/reviews?pageSize=50&pageToken=p0",
    );
    expect(req?.headers.get("authorization")).toBe("Bearer gbp-token");
  });

  it("builds the write-review link without calling the network", async () => {
    const fetch = createFakeFetch({});
    const gbp = new GoogleBusinessProfileReviewsProvider({ fetch, config });
    expect(await gbp.getReviewLink()).toEqual({
      connected: true,
      url: "https://search.google.com/local/writereview?placeid=ChIJsample",
    });
    expect(fetch.requests).toHaveLength(0);
    const noPlace = new GoogleBusinessProfileReviewsProvider({
      fetch,
      config: { ...config, placeId: undefined },
    });
    expect(await noPlace.getReviewLink()).toMatchObject({ connected: false });
  });

  it("maps errors", async () => {
    const fetch = createFakeFetch({
      status: 403,
      json: {
        error: {
          code: 403,
          message: "The caller does not have permission",
          status: "PERMISSION_DENIED",
        },
      },
    });
    expect(await new GoogleBusinessProfileReviewsProvider({ fetch, config }).listReviews()).toEqual(
      {
        connected: true,
        reviews: [],
        error: "HTTP 403: The caller does not have permission",
      },
    );
  });
});

describe("getReviewsProvider", () => {
  it("only returns Google Business Profile when fully allowed", () => {
    const opts = {
      envProvider: "google_business_profile",
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { google_business_profile: config },
    };
    expect(getReviewsProvider(null, opts).provider).toBe("outbox");
    expect(getReviewsProvider(null, { ...opts, locked: false })).toBeInstanceOf(
      GoogleBusinessProfileReviewsProvider,
    );
  });
});
