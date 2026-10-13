/**
 * An import checked against what is already on file: the same invoice under
 * another file name, the same line with other figures, a line the first
 * reading did not have, a file that is not a table, a file set aside.
 * On real in-memory Postgres, with mock companies and products only.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { Issue } from "@/lib/import/types";
import { acknowledge, approveSession, createAllNew, createUpload, decideDuplicate, discardSession, getSession, getSessionItems, inbox } from "./imports";

const bytes = (rows: string[]) => new TextEncoder().encode(rows.join("\n"));
const HEAD = "Data;Fornitore;Partita IVA;Descrizione;Quantità;UM;Prezzo;Fattura;Riga";
const codes = (i: { issues: unknown }) => (i.issues as Issue[]).map((x) => x.code);

let db: DB;
const purchases = async () => (await db.select().from(schema.purchases)).length;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // The first reading of invoice MOCK-1: two lines.
  const { sessionId } = await createUpload(db, { name: "mock-fatture.csv", bytes: bytes([HEAD, "01/09/2026;Mock Cere Spa;IT00000000019;Paraffina mock 52/54;1000;kg;1,50;MOCK-1;1", "01/09/2026;Mock Cere Spa;IT00000000019;Stoppino mock 30 mm;500;pz;0,02;MOCK-1;2"]) }, "auto", { autoMap: true });
  await createAllNew(db, sessionId, "supplier");
  await createAllNew(db, sessionId, "product");
  await acknowledge(db, { sessionId });
  expect((await approveSession(db, sessionId)).imported).toBe(2);
}, 120_000);

describe("the same invoice, arriving again under another file name", () => {
  let sessionId: string;
  beforeAll(async () => {
    ({ sessionId } = await createUpload(
      db,
      {
        name: "esportazione-diversa.csv",
        bytes: bytes([
          HEAD,
          "01/09/2026;Mock Cere Spa;IT00000000019;Paraffina mock 52/54;1000;kg;1,50;MOCK-1;1", // on file, as written
          "01/09/2026;Mock Cere Spa;IT00000000019;Stoppino mock 30 mm;500;pz;0,025;MOCK-1;2", // on file, with another price
          "01/09/2026;Mock Cere Spa;IT00000000019;Paraffina mock 52/54;200;kg;1,48;MOCK-1;3", // a line the first reading did not have
          "05/09/2026;Mock Cere Spa;IT00000000019;Paraffina mock 52/54;1000;kg;1,55;MOCK-2;1", // a new invoice: nothing to say
        ]),
      },
      "auto",
      { autoMap: true },
    ));
  }, 60_000);

  it("recognises each line for what it is: on file, on file with other figures, not among the lines on file, new", async () => {
    const items = await getSessionItems(db, sessionId);
    expect(items.map((i) => [i.line, i.status, codes(i).filter((c) => ["duplicate", "conflict", "invoice_on_file"].includes(c))])).toEqual([
      [2, "attention", ["duplicate"]],
      [3, "attention", ["conflict"]],
      [4, "attention", ["invoice_on_file"]],
      [5, "ready", []],
    ]);
    const conflict = (items[1].issues as Issue[]).find((x) => x.code === "conflict")!;
    expect(conflict.severity).toBe("blocking");
    expect(conflict.message).toContain("500 × 0,02");
    expect(conflict.message).toContain("500 × 0,025");
  });

  it("accepting the flagged lines in bulk never takes in a line of an invoice already on file", async () => {
    const before = await purchases();
    await acknowledge(db, { sessionId });
    const items = await getSessionItems(db, sessionId);
    expect(items.map((i) => i.status)).toEqual(["attention", "attention", "attention", "ready"]);
    // Only the line of the new invoice is written.
    const res = await approveSession(db, sessionId);
    expect(res.imported).toBe(1);
    expect(await purchases()).toBe(before + 1);
  });

  it("takes one in only on the user's own word, line by line", async () => {
    const before = await purchases();
    const items = await getSessionItems(db, sessionId);
    await decideDuplicate(db, { itemId: items[2].id }, "import");
    expect((await getSessionItems(db, sessionId))[2].status).toBe("ready");
    await decideDuplicate(db, { itemId: items[1].id }, "skip");
    await decideDuplicate(db, { itemId: items[0].id }, "skip");
    expect((await approveSession(db, sessionId)).imported).toBe(1);
    expect(await purchases()).toBe(before + 1);
    expect((await getSession(db, sessionId))!.status).toBe("completed");
  });
});

describe("a file that is not a table of purchases", () => {
  it("is refused with the reason, not left waiting for columns it does not have", async () => {
    const { sessionId } = await createUpload(db, { name: "LEGGIMI.txt", bytes: bytes(["Questi file contengono le fatture del periodo,", "incluse le righe informative."]) }, "auto", { autoMap: true });
    const s = (await getSession(db, sessionId))!;
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toContain("does not look like a table");
    expect((await inbox(db)).files.map((f) => f.session.id)).not.toContain(sessionId);
  });
});

describe("setting a file aside", () => {
  it("imports nothing, keeps its lines as skipped, and takes it off the files waiting", async () => {
    const before = await purchases();
    const { sessionId } = await createUpload(db, { name: "da-scartare.csv", bytes: bytes([HEAD, "09/09/2026;Mock Cere Spa;IT00000000019;Paraffina mock 52/54;10;kg;1,50;MOCK-9;1"]) }, "auto", { autoMap: true });
    expect((await inbox(db)).files.map((f) => f.session.id)).toContain(sessionId);
    expect(await discardSession(db, sessionId)).toEqual({});
    const s = (await getSession(db, sessionId))!;
    expect([s.status, s.recordsImported, s.errorMessage]).toEqual(["completed", 0, "Set aside: nothing of this file was imported."]);
    expect((await getSessionItems(db, sessionId)).map((i) => i.status)).toEqual(["skipped"]);
    expect((await inbox(db)).files.map((f) => f.session.id)).not.toContain(sessionId);
    expect(await purchases()).toBe(before);
    // The file itself stays in the archive.
    expect(s.documentId).not.toBeNull();
  });

  it("is refused once something of the file was imported", async () => {
    const [done] = (await db.select().from(schema.importSessions)).filter((s) => s.recordsImported > 0);
    expect((await discardSession(db, done.id)).error).toContain("already imported");
  });
});
