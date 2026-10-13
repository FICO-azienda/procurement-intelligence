import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // A test that uploads a file writes it to a folder of its own — never among the company's documents.
    env: { FILE_STORAGE_DIR: path.join(os.tmpdir(), "procurement-intelligence-test-files") },
  },
});
