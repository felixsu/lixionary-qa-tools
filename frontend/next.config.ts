import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tell Next.js dev server which hosts may connect for HMR / dev resources.
  // Without this, Next 16 blocks cross-origin WebSocket upgrades to /_next/webpack-hmr.
  allowedDevOrigins: [
    "lixionary-qa-tools.qa.tech.nv",
    "api-lixionary-qa-tools.qa.tech.nv",
    "127.0.0.1",
    "localhost",
  ],
  output: "export",
  images: {
    unoptimized: true, // Required for static export
  },
};

export default nextConfig;

