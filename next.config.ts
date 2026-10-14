import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set only by the GitHub Pages workflow, which serves the demo under /<repo>.
  ...(process.env.NEXT_BASE_PATH ? { basePath: process.env.NEXT_BASE_PATH } : {}),
  // Plain links and fetches (exports, the search box) need it too: `<Link>` is the only one that adds it by itself.
  env: { NEXT_PUBLIC_BASE_PATH: process.env.NEXT_BASE_PATH ?? "" },
  // Embedded Postgres ships WASM + data files; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // Uploaded files go through a Server Action (20 MB per file, a few per batch).
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
