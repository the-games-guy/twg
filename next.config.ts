import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOT "standalone" — the Dockerfile runs `next start` against a full
  // `npm ci` install, which "standalone" output doesn't support (it expects
  // `node .next/standalone/server.js` instead, and warns at runtime if
  // started this way). Adopting standalone properly means a multi-stage
  // Dockerfile copying `.next/standalone`, `.next/static`, and `public/` —
  // a real image-size win, just not implemented yet.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
