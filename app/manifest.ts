import type { MetadataRoute } from "next";

/** Installable app (SPEC §2 PWA). Icons are the placeholder brand marks in public/brand. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Brushy Bear CRM",
    short_name: "Brushy Bear",
    description: "Internal operating system for Brushy Bear Painters.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F4EDE1",
    theme_color: "#1F4D3A",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
