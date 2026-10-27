/**
 * Session cookie options for every Supabase client (SPEC §13.1 "secure
 * cookies"): Secure in production (HTTPS only), SameSite=Lax (sent on normal
 * navigation, not on cross-site posts), whole-site path. The browser client
 * must read the session cookie, so it can't be HttpOnly (Supabase design);
 * the access token is short-lived and refreshed by the middleware.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
