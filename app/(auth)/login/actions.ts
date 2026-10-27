"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { loginRedirectPath } from "@/lib/auth/paths";
import { logError } from "@/lib/log";

const schema = z.object({
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  next: z.string().max(500).optional(),
});

export type MagicLinkState = { status: "idle" | "sent" | "error"; message?: string };

/**
 * Sends a sign-in link. Invite-only (SPEC §4.3): never creates accounts, and the
 * reply is the same whether or not the email belongs to a team member.
 */
export async function requestMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Sign-in isn't configured on this server yet." };
  }

  const next = loginRedirectPath(parsed.data.next) ?? "/";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${serverEnv().APP_URL}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    if (error.status === 429) {
      return {
        status: "error",
        message: "Too many sign-in requests. Wait a minute and try again.",
      };
    }
    // Unknown emails land here too ("Signups not allowed"); don't reveal which.
    if (!/signups not allowed|user not found/i.test(error.message))
      logError("auth.magic_link", error);
  }
  return {
    status: "sent",
    message:
      "If that email belongs to a Brushy Bear team member, a sign-in link is on its way. It expires in an hour.",
  };
}

const passwordSchema = z.object({
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password.").max(200),
  next: z.string().max(500).optional(),
});

export type PasswordState = { status: "idle" | "error"; message?: string };

/**
 * Email + password sign-in (owner request 2026-10-27; DECISIONS "Password sign-in").
 * Invite-only still holds: Supabase sign-ups are off, so only existing accounts can
 * sign in. Two-step sign-in is still enforced afterwards by the middleware (/mfa).
 */
export async function signInWithPassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const parsed = passwordSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check your details." };
  }
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Sign-in isn't configured on this server yet." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.status === 429) {
      return { status: "error", message: "Too many attempts. Wait a minute and try again." };
    }
    if (!/invalid login credentials/i.test(error.message)) logError("auth.password", error);
    // Same answer for an unknown email and a wrong password.
    return { status: "error", message: "That email and password don't match." };
  }
  redirect(loginRedirectPath(parsed.data.next) ?? "/");
}
