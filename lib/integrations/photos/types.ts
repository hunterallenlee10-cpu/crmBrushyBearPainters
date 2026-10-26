import { type NotConnected, type RelatedRecord, type SendStatus } from "@/lib/integrations/core";

export type ListPhotosInput = {
  projectExternalId: string;
  /** ISO 8601; only photos captured at/after this instant. */
  since?: string;
};

export type SyncedPhoto = {
  externalId: string;
  url: string;
  thumbnailUrl?: string;
  /** ISO 8601 (UTC). */
  takenAt?: string;
  caption?: string;
  lat?: number;
  lng?: number;
};

export type ListPhotosResult =
  NotConnected | { connected: true; photos: SyncedPhoto[]; error?: string };

export type PhotoProjectAddress = {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
};

export type CreatePhotoProjectInput = {
  name: string;
  address: PhotoProjectAddress;
  related?: RelatedRecord | null;
};

export type CreatePhotoProjectResult = {
  status: SendStatus;
  externalId?: string;
  outboxId?: string;
  error?: string;
};

export interface PhotoSyncProvider {
  readonly provider: string;
  listPhotos(input: ListPhotosInput): Promise<ListPhotosResult>;
  createProject(input: CreatePhotoProjectInput): Promise<CreatePhotoProjectResult>;
}

export function formatAddress(a: PhotoProjectAddress): string {
  const street = [a.street1, a.street2].filter(Boolean).join(", ");
  return `${street}, ${a.city}, ${a.state} ${a.postalCode}`;
}
