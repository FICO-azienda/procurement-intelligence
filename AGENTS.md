<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes

Procurement Intelligence prototype for manufacturing SMEs. See README.md (Italian) for setup and architecture.

- All business numbers are computed in `src/lib/analytics.ts` (pure functions, tested). Never store derived values (current price, price history, spend) in the database.
- All writes go through `src/app/actions.ts` (or an importer with preview → approval). Validation schemas live in `src/lib/validation.ts`.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`; migrations in `drizzle/` apply on startup.
- UI copy is English; numbers/dates use Italian formatting via `src/lib/format.ts`.
- Compare/alternatives must never rank or call a supplier "cheaper" until landed cost exists.
- Verify with `npm test`, `npm run typecheck`, `npm run lint`.
- Imports never write facts directly: file → import_items → user review/approval (`src/server/imports.ts`). Unit/currency/number/date parsing lives only in `src/lib/import/normalize/`; never guess an ambiguous value — flag it for review.
- Import scenarios: `test-data/` (regenerate with `npx tsx scripts/make-test-data.ts`); end-to-end tests in `src/server/imports.test.ts` run on in-memory PGlite.
- Price intelligence lives in `src/lib/intel/` (pure, tested): thresholds only in `config.ts`, explanations in `explain.ts`. Demo data is a test fixture — never shape logic around it; add generic cases to `src/lib/intel/fixtures.ts` tests instead.
- Savings vocabulary is strict: "price difference" (nominal) vs "potential saving" (estimate, price only) — never "saving realised", never "best supplier". No saving for non-comparable offers.
- Opportunities are computed by the engine; the `opportunities` table stores only the user's status/note/snapshot.
- The Overview page (`/overview`) renders `src/lib/intel/decision.ts` (summary engine: status, alternatives, next actions, plain-language text, priority). It selects and words what `analyze()` computed — no new price/saving formulas there, and no status or sentence worked out inside a React component.
- Landed cost, external benchmarks and supplier quality data do not exist yet: never show them as numbers (`estimatedTrueCost` stays null, market reference is `internal_quotes` or `not_available`).
