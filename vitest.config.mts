import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// A test that uploads a file writes it to a folder of its own — never among the company's documents.
const env = { FILE_STORAGE_DIR: path.join(os.tmpdir(), "procurement-intelligence-test-files") };
const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      // Many tests migrate and fill a real (in-memory) Postgres: with the whole suite side by side they need more than 5 s.
      { resolve: { alias }, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.scale.test.ts"], env, testTimeout: 30_000, hookTimeout: 60_000 } },
      // Timings: run alone, after every other test, so that they measure the work and not the machine's other tests.
      { resolve: { alias }, test: { name: "scale", include: ["src/**/*.scale.test.ts"], env, sequence: { groupOrder: 1 } } },
    ],
  },
});
