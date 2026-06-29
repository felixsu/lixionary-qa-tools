import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tell Next.js dev server which hosts may connect for HMR / dev resources.
  // Without this, Next 16 blocks cross-origin WebSocket upgrades to /_next/webpack-hmr.
  // We list both the public hostname and the docker-bridge name (in case the
  // browser ever resolves it that way) plus 127.0.0.1 + localhost for safety.
  allowedDevOrigins: [
    "lixionary-qa-tools.qa.tech.nv",
    "api-lixionary-qa-tools.qa.tech.nv",
    "127.0.0.1",
    "localhost",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
