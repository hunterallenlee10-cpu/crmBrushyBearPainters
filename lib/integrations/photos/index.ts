import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import {
  type CompanyCamConfig,
  CompanyCamPhotoProvider,
} from "@/lib/integrations/photos/companycam";
import { createOutboxPhotoSyncProvider } from "@/lib/integrations/photos/outbox";
import { type PhotoSyncProvider } from "@/lib/integrations/photos/types";

export * from "@/lib/integrations/photos/types";
export { createOutboxPhotoSyncProvider } from "@/lib/integrations/photos/outbox";
export {
  CompanyCamPhotoProvider,
  type CompanyCamConfig,
} from "@/lib/integrations/photos/companycam";

export type PhotosCredentials = { companycam?: CompanyCamConfig };
export type PhotosProviderOptions = ProviderFactoryOptions<PhotosCredentials>;

/** Photo-sync provider. Outbox unless the three-condition gate allows CompanyCam. */
export function getPhotoSyncProvider(
  ctx: IntegrationContext,
  options: PhotosProviderOptions = {},
): PhotoSyncProvider {
  const choice = resolveDomainProvider("photos", options);
  if (!choice.real) return createOutboxPhotoSyncProvider(ctx);
  if (choice.provider !== "companycam") {
    throw new Error(`No photo-sync adapter for "${choice.provider}".`);
  }
  return new CompanyCamPhotoProvider(
    requireRealDeps(choice.provider, options.fetch, options.credentials?.companycam),
  );
}
