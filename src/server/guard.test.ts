/**
 * Who may do what in the buyer's workspace: the rule itself, sessions that end
 * or expire on real in-memory Postgres, and a check that no action and no data
 * route of the code base is left without the guard. Mock people only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { PERMISSIONS } from "@/lib/orders/types";
import { endSession, hashPassword, principalOf, startSession } from "./auth";
import { NOT_ALLOWED, SIGNED_OUT, decide } from "./guard";

const fresh = async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
};

describe("the rule", () => {
  const admin = { side: "buyer" as const, permissions: [...PERMISSIONS.buyer] };
  const viewer = { side: "buyer" as const, permissions: [] };
  it("lets nobody in without a session, and no supplier into the buyer's workspace", () => {
    expect(decide(null, null)).toBe(SIGNED_OUT);
    expect(decide({ side: "supplier", permissions: [...PERMISSIONS.supplier] }, null)).toBe(SIGNED_OUT);
  });
  it("lets any person of the buyer read, and only the permission named write", () => {
    expect(decide(viewer, null)).toBeNull();
    for (const p of PERMISSIONS.buyer) {
      expect(decide(viewer, p)).toBe(NOT_ALLOWED);
      expect(decide(admin, p)).toBeNull();
    }
    expect(decide({ side: "buyer", permissions: ["data.edit"] }, "data.export")).toBe(NOT_ALLOWED);
  });
});

describe("a session", () => {
  it("is nobody once it is ended or expired, and a member without a permission keeps reading only", async () => {
    const db = await fresh();
    const [org] = await db.insert(schema.organizations).values({ kind: "buyer", isWorkspace: true, name: "Mock Buyer S.r.l." }).returning();
    const [boss] = await db.insert(schema.users).values({ name: "Mock Admin", email: "admin@example.com", passwordHash: await hashPassword("mock-password-1") }).returning();
    const [clerk] = await db.insert(schema.users).values({ name: "Mock Viewer", email: "viewer@example.com", passwordHash: await hashPassword("mock-password-2") }).returning();
    await db.insert(schema.orgMembers).values([{ orgId: org.id, userId: boss.id, role: "admin" }, { orgId: org.id, userId: clerk.id, role: "member", permissions: [] }]);

    const a = await startSession(db, boss.id, org.id);
    const asAdmin = await principalOf(db, a.token, "buyer");
    expect(decide(asAdmin, "data.export")).toBeNull();
    await endSession(db, a.token);
    // The same cookie after signing out: nothing.
    expect(decide(await principalOf(db, a.token, "buyer"), null)).toBe(SIGNED_OUT);

    const v = await startSession(db, clerk.id, org.id);
    const asViewer = await principalOf(db, v.token, "buyer");
    expect(decide(asViewer, null)).toBeNull();
    expect(decide(asViewer, "data.export")).toBe(NOT_ALLOWED);
    expect(decide(asViewer, "data.edit")).toBe(NOT_ALLOWED);

    // Expired: nothing, whatever the cookie says.
    await db.update(schema.authSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.authSessions.userId, clerk.id));
    expect(decide(await principalOf(db, v.token, "buyer"), null)).toBe(SIGNED_OUT);
  }, 60_000);
});

// ---- Every way in is guarded ----
const ROOT = path.join(process.cwd(), "src", "app");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
const files = walk(ROOT);

describe("every way into the workspace's data", () => {
  it("every server action checks who is asking before it does anything", () => {
    const actionFiles = files.filter((f) => /actions\.ts$/.test(f) && readFileSync(f, "utf8").startsWith('"use server"'));
    expect(actionFiles.length).toBeGreaterThanOrEqual(3);
    const unguarded: string[] = [];
    for (const f of actionFiles) {
      const src = readFileSync(f, "utf8");
      // The order actions go through run(), which reads the session and lets the order service check each permission.
      if (/order-actions\.ts$/.test(f)) {
        expect(src).toContain("workspacePrincipal()");
        continue;
      }
      for (const m of src.matchAll(/^export async function (\w+)[^]*?\{\n([^]*?)\n/gm)) if (!/refuse\(/.test(src.slice(m.index!, m.index! + m[0].length + 200))) unguarded.push(`${path.basename(f)}: ${m[1]}`);
    }
    expect(unguarded).toEqual([]);
  });

  it("every route that answers with data asks for the session", () => {
    const routes = files.filter((f) => f.endsWith("route.ts") && !f.includes(`${path.sep}(outside)${path.sep}`));
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(routes.filter((f) => !readFileSync(f, "utf8").includes("routeAccess(")).map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
