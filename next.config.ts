import type { NextConfig } from "next";

/**
 * Baseline security headers. A strict nonce-based CSP lands in the Phase 10
 * hardening pass (SPEC §13.1); these are safe defaults for every phase.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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
  // pdfkit loads its built-in fonts with a computed require(), which file tracing
  // can't see; without this, PDF routes and the worker fail on Vercel.
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**/*"],
  },
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
    return [
      // Everything except the document preview route: never framed.
      {
        source: "/((?!api/files/).*)",
        headers: [...securityHeaders, { key: "X-Frame-Options", value: "DENY" }],
      },
      // Document previews may be framed by our own pages only.
      {
        source: "/api/files/:path*",
        headers: [
          ...securityHeaders,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
