"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { ESIGN_CONSENT, ESIGN_CONSENT_CHANGE_ORDER } from "@/lib/estimating/engine";
import { acceptProposal, declineProposal, ProposalError } from "@/lib/estimating/proposal";
import { isProposalToken } from "@/lib/estimating/tokens";
import { logError } from "@/lib/log";
import { consumeProposalLimit, PROPOSAL_LIMITS } from "./limits";

/**
 * The customer's two actions on the proposal page (SPEC §7.5). No login: the
 * link token is the credential. Validated with zod, rate limited per address
 * and per link, and recorded by the database (signature, audit, events).
 */

export type PublicResult = { ok: true } | { ok: false; message: string };

const MAX_SIGNATURE_BYTES = 300_000;

const acceptSchema = z.object({
  token: z.string().refine(isProposalToken, "This link isn't valid."),
  kind: z.enum(["estimate", "change_order"]),
  optionId: z.uuid().optional(),
  addOnIds: z.array(z.uuid()).max(50).default([]),
  signerName: z
    .string()
    .trim()
    .min(2, "Type your full name.")
    .max(120, "Keep your name under 120 characters."),
  signerEmail: z
    .union([z.email("Check the email address."), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  signaturePng: z
    .string()
    .startsWith("data:image/png;base64,", "Draw your signature.")
    .max(MAX_SIGNATURE_BYTES, "That signature is too large. Clear it and sign again.")
    .refine((v) => v.length > 200, "Draw your signature."),
  agreed: z.literal(true, { message: "Tick the box to accept." }),
});

async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
}

export async function acceptAndSign(raw: z.input<typeof acceptSchema>): Promise<PublicResult> {
  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const input = parsed.data;
  try {
    const service = await createSupabaseServiceClient();
    const meta = await requestMeta();
    if (
      !(await consumeProposalLimit(
        service,
        `accept:ip:${meta.ip ?? "unknown"}`,
        PROPOSAL_LIMITS.acceptPerIp,
      )) ||
      !(await consumeProposalLimit(
        service,
        `accept:link:${input.token.slice(0, 16)}`,
        PROPOSAL_LIMITS.acceptPerLink,
      ))
    ) {
      return { ok: false, message: "Too many tries. Please wait a few minutes and try again." };
    }
    if (input.kind === "estimate" && !input.optionId) {
      return { ok: false, message: "Pick one of the options first." };
    }
    await acceptProposal(service, {
      token: input.token,
      optionId: input.optionId ?? "",
      addOnIds: input.addOnIds,
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      signaturePng: input.signaturePng,
      consent: input.kind === "estimate" ? ESIGN_CONSENT : ESIGN_CONSENT_CHANGE_ORDER,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath(`/p/${input.token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ProposalError) return { ok: false, message: e.message };
    logError("proposal.accept", e);
    return { ok: false, message: "Something went wrong. Please try again, or call us." };
  }
}

const declineSchema = z.object({
  token: z.string().refine(isProposalToken, "This link isn't valid."),
  reason: z
    .string()
    .trim()
    .max(1000, "Keep it under 1,000 characters.")
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function declineEstimate(raw: z.input<typeof declineSchema>): Promise<PublicResult> {
  const parsed = declineSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  try {
    const service = await createSupabaseServiceClient();
    const meta = await requestMeta();
    if (
      !(await consumeProposalLimit(
        service,
        `decline:ip:${meta.ip ?? "unknown"}`,
        PROPOSAL_LIMITS.acceptPerIp,
      ))
    ) {
      return { ok: false, message: "Too many tries. Please wait a few minutes and try again." };
    }
    await declineProposal(service, parsed.data.token, parsed.data.reason);
    revalidatePath(`/p/${parsed.data.token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ProposalError) return { ok: false, message: e.message };
    logError("proposal.decline", e);
    return { ok: false, message: "Something went wrong. Please try again, or call us." };
  }
}
