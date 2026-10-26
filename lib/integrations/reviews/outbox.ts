import { notConnected } from "@/lib/integrations/core";
import { type ReviewsProvider } from "@/lib/integrations/reviews/types";

/** Default reviews provider: not connected, no outbox writes. */
export function createOutboxReviewsProvider(): ReviewsProvider {
  return {
    provider: "outbox",
    async listReviews() {
      return notConnected("Review tracking is not connected.");
    },
    async getReviewLink() {
      return notConnected("No review link yet; the owners add it when Reviews is connected.");
    },
  };
}
