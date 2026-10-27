import { CONTAINERS, CONTAINER_GALLONS, type Container } from "./constants";

/**
 * Rounds a paint need up to the containers a product is sold in (SPEC §7.4
 * "round to quarts/gallons/5-gal per product"). Pure and deterministic:
 *
 * 1. Round the need up to the smallest container the product comes in.
 * 2. Fill with the largest containers first.
 * 3. Upsize when it's sensible: 3 or more quarts become a gallon, and 4 or
 *    more gallons become a 5-gallon pail (when those sizes are offered).
 */

export const QUARTS_TO_GALLON = 3;
export const GALLONS_TO_PAIL = 4;

export type ContainerBreakdown = Record<Container, number>;

export type ContainerResult = {
  /** Gallons bought (sum of containers). */
  gallons: number;
  containers: ContainerBreakdown;
};

const EPS = 1e-9;

export function emptyBreakdown(): ContainerBreakdown {
  return { quart: 0, gallon: 0, five_gallon: 0 };
}

export function roundToContainers(
  gallonsNeeded: number,
  available: readonly Container[],
): ContainerResult {
  const offered = new Set(available.length ? available : (["gallon"] as Container[]));
  const out = emptyBreakdown();
  if (!Number.isFinite(gallonsNeeded) || gallonsNeeded <= EPS)
    return { gallons: 0, containers: out };

  const unit = Math.min(...[...offered].map((c) => CONTAINER_GALLONS[c]));
  const units = Math.ceil(gallonsNeeded / unit - EPS);
  let remaining = units * unit;

  if (offered.has("five_gallon")) {
    out.five_gallon = Math.floor(remaining / 5 + EPS);
    remaining = Math.max(0, remaining - out.five_gallon * 5);
  }
  if (offered.has("gallon")) {
    out.gallon = Math.floor(remaining + EPS);
    remaining = Math.max(0, remaining - out.gallon);
  }
  if (offered.has("quart")) {
    out.quart = Math.round(remaining / 0.25);
    remaining = 0;
  }

  if (offered.has("gallon") && out.quart >= QUARTS_TO_GALLON) {
    out.gallon += 1;
    out.quart = 0;
  }
  if (offered.has("five_gallon")) {
    const loose = out.gallon + out.quart * 0.25;
    if (loose >= GALLONS_TO_PAIL - EPS) {
      out.five_gallon += 1;
      out.gallon = 0;
      out.quart = 0;
    }
  }
  return { gallons: containerGallons(out), containers: out };
}

export function containerGallons(c: ContainerBreakdown): number {
  return Math.round((c.five_gallon * 5 + c.gallon + c.quart * 0.25) * 100) / 100;
}

/** "2 × 5-gallon, 1 gallon, 2 quarts" */
export function describeContainers(c: ContainerBreakdown): string {
  const parts: string[] = [];
  if (c.five_gallon) parts.push(`${c.five_gallon} × 5-gallon`);
  if (c.gallon) parts.push(`${c.gallon} gallon${c.gallon === 1 ? "" : "s"}`);
  if (c.quart) parts.push(`${c.quart} quart${c.quart === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "None";
}

export function isContainer(v: string): v is Container {
  return (CONTAINERS as readonly string[]).includes(v);
}
