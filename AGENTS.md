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
