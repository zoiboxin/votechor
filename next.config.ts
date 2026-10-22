import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // QA escape hatch: a second dev instance (server.js on another port) can use
  // its own build dir instead of clashing with the main dev server's lock.
  // Unset in every real deployment → '.next'.
  distDir: process.env.VC_DIST_DIR || ".next",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
