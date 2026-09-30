import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embedded Postgres ships WASM + data files; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // CSV imports are sent to a Server Action; a year of purchases fits easily.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
