import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embedded Postgres ships WASM + data files; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // Uploaded files go through a Server Action (20 MB per file, a few per batch).
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
