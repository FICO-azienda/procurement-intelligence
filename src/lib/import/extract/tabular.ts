/**
 * Reads CSV and Excel files into a plain table: header row + data rows.
 * Handles Italian Excel exports (";" separator, Windows-1252 accents) and
 * sheets with a title block above the real header.
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { FIELDS } from "../fields";
import { normalizeKey } from "../normalize/text";

export type Cell = string | number | boolean | Date | null;

export interface Table {
  sheetName: string | null;
  headers: string[];
  rows: Cell[][];
  /** 0-based row index of the header in the original sheet. */
  headerRowIndex: number;
}

export class ImportError extends Error {}

export const SPREADSHEET_TYPES = ["csv", "xlsx", "xls", "ods"] as const;

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    // Excel on Windows saves CSV as Windows-1252 ("Quantità" would be garbled as UTF-8).
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function readCsv(bytes: Uint8Array): Cell[][] {
  const text = decodeText(bytes);
  if (!text.trim()) throw new ImportError("The file is empty.");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const fatal = parsed.errors.find((e) => e.type === "Delimiter" && parsed.data.length === 0);
  if (fatal) throw new ImportError("We couldn't read this CSV file. Check that it is a comma- or semicolon-separated file.");
  return parsed.data;
}

function readWorkbook(bytes: Uint8Array): { sheetName: string; rows: Cell[][] } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "array", cellDates: true, dense: true });
  } catch {
    throw new ImportError("We couldn't open this spreadsheet. It may be damaged or password-protected.");
  }
  // Use the sheet with the most filled rows (exports often have a cover sheet).
  let best: { sheetName: string; rows: Cell[][] } | null = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    const filled = rows.filter((r) => r.some((c) => c !== null && c !== "")).length;
    if (!best || filled > best.rows.length) best = { sheetName: name, rows: rows.filter((r) => r.some((c) => c !== null && c !== "")) };
  }
  if (!best || best.rows.length === 0) throw new ImportError("The spreadsheet is empty.");
  return best;
}

const ALL_SYNONYMS = new Set(FIELDS.flatMap((f) => f.synonyms));

/** The header is the row (within the first 15) that looks most like column names. */
function findHeaderRow(rows: Cell[][]): number {
  let bestIdx = 0;
  let bestScore = -1;
  rows.slice(0, 15).forEach((row, i) => {
    const texts = row.filter((c): c is string => typeof c === "string" && c.trim() !== "");
    const known = texts.filter((t) => ALL_SYNONYMS.has(normalizeKey(t))).length;
    const score = known * 3 + texts.length - row.filter((c) => typeof c === "number").length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return bestIdx;
}

export function readTable(bytes: Uint8Array, fileType: string): Table {
  if (bytes.length === 0) throw new ImportError("The file is empty.");
  let sheetName: string | null = null;
  let rows: Cell[][];
  if (fileType === "csv") {
    rows = readCsv(bytes);
  } else {
    const wb = readWorkbook(bytes);
    sheetName = wb.sheetName;
    rows = wb.rows;
  }
  if (rows.length < 2) throw new ImportError("The file has no data rows under the header.");

  const headerRowIndex = findHeaderRow(rows);
  const width = Math.max(...rows.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const raw = rows[headerRowIndex][i];
    let h = raw == null || String(raw).trim() === "" ? `Column ${i + 1}` : String(raw).trim();
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n > 1) h = `${h} (${n})`;
    return h;
  });
  const dataRows = rows
    .slice(headerRowIndex + 1)
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? null : r[i])))
    .filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));
  if (dataRows.length === 0) throw new ImportError("The file has no data rows under the header.");
  return { sheetName, headers, rows: dataRows, headerRowIndex };
}

/** Cell as the user would read it in the file. */
export function cellText(c: Cell): string {
  if (c == null) return "";
  if (c instanceof Date) {
    return `${String(c.getDate()).padStart(2, "0")}/${String(c.getMonth() + 1).padStart(2, "0")}/${c.getFullYear()}`;
  }
  // Numeric cells shown the Italian way, as Excel would display them here.
  if (typeof c === "number") return c.toLocaleString("it-IT", { useGrouping: false, maximumFractionDigits: 10 });
  return String(c).trim();
}
