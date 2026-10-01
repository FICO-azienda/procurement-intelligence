/**
 * Storage for original uploaded files (invoices, quotes, spreadsheets).
 *
 * - Default: local folder (.data/files, or FILE_STORAGE_DIR).
 * - Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
 *   (bucket SUPABASE_STORAGE_BUCKET, default "imports"; create it private).
 *
 * Keys look like: imports/{company}/{year}/{hash8}-{filename}
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMPANY_ID } from "./config";

export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Removes every stored import file (used by "Clear all data"). */
  clear(): Promise<void>;
}

export function storageKey(filename: string, sha256: string, date = new Date()) {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-120);
  return `imports/${COMPANY_ID}/${date.getFullYear()}/${sha256.slice(0, 8)}-${safe}`;
}

function localStorage(): FileStorage {
  const root = process.env.FILE_STORAGE_DIR ?? path.join(process.cwd(), ".data", "files");
  const full = (key: string) => {
    const p = path.join(/*turbopackIgnore: true*/ root, key);
    if (!p.startsWith(root)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(key, bytes) {
      await mkdir(path.dirname(full(key)), { recursive: true });
      await writeFile(full(key), bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(full(key)));
      } catch {
        return null;
      }
    },
    async clear() {
      await rm(path.join(/*turbopackIgnore: true*/ root, "imports"), { recursive: true, force: true });
    },
  };
}

function supabaseStorage(url: string, serviceKey: string): FileStorage {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "imports";
  const base = `${url.replace(/\/$/, "")}/storage/v1/object`;
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  return {
    async put(key, bytes, contentType) {
      const res = await fetch(`${base}/${bucket}/${key}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
        body: Buffer.from(bytes),
      });
      if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
    },
    async get(key) {
      const res = await fetch(`${base}/${bucket}/${key}`, { headers });
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async clear() {
      // Files stay in the bucket; delete them from the Supabase dashboard if needed.
    },
  };
}

export function getStorage(): FileStorage {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? supabaseStorage(url, key) : localStorage();
}
