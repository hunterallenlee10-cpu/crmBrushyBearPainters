import type { NextConfig } from "next";

/**
 * Baseline security headers. A strict nonce-based CSP lands in the Phase 10
 * hardening pass (SPEC §13.1); these are safe defaults for every phase.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev-only badge sits on top of the Help button (bottom-left).
  devIndicators: false,
  reactStrictMode: true,
  // PDFs are rendered on the server with @react-pdf/renderer (Node APIs, not bundled).
  serverExternalPackages: ["@react-pdf/renderer"],
  // Test sign-in locks and helper worktrees must not trigger dev rebuilds.
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/tests/e2e/.auth/**",
          "**/.claude/worktrees/**",
        ],
      };
    }
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
