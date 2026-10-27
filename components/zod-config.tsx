"use client";

import { z } from "zod";

// zod probes for eval support (`new Function("")`) to speed up parsing. Our
// Content-Security-Policy forbids eval, so the probe shows up as a CSP
// violation in the browser. Tell zod not to try (DECISIONS "Nonce-based CSP").
z.config({ jitless: true });

/** Loads the zod setting into the browser bundle before any form validates. */
export function ZodConfig() {
  return null;
}
