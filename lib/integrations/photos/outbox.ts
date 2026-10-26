import { type IntegrationContext, notConnected, recordSimulated } from "@/lib/integrations/core";
import {
  type CreatePhotoProjectInput,
  type PhotoSyncProvider,
  formatAddress,
} from "@/lib/integrations/photos/types";

/** Default photo-sync provider: listing is not connected; project creation is recorded. */
export function createOutboxPhotoSyncProvider(ctx: IntegrationContext): PhotoSyncProvider {
  return {
    provider: "outbox",
    async listPhotos() {
      return notConnected("Photo sync is not connected; upload photos in the app.");
    },
    async createProject(input: CreatePhotoProjectInput) {
      return recordSimulated(ctx, {
        domain: "photos",
        provider: "outbox",
        operation: "photos.create_project",
        subject: input.name,
        renderedBody: `${input.name}\n${formatAddress(input.address)}`,
        payload: { ...input },
        related: input.related ?? null,
      });
    },
  };
}
