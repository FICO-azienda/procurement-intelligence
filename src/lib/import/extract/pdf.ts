/**
 * PDF → text lines, rebuilt from the positions of text fragments so that
 * table rows stay on one line. Scanned PDFs (images, no text layer) are
 * reported as such — OCR is a later step.
 */
import { getDocumentProxy } from "unpdf";
import { ImportError } from "./tabular";

export interface PdfLine {
  page: number;
  /** Top-down order within the document. */
  index: number;
  text: string;
  /** Fragments separated by wide gaps (table columns). */
  cells: string[];
}

interface Fragment {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

export async function readPdfLines(bytes: Uint8Array): Promise<{ lines: PdfLine[]; pageCount: number }> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/password/i.test(msg)) throw new ImportError("This PDF is password-protected. Remove the password and upload it again.");
    throw new ImportError("We couldn't open this PDF. It may be damaged.");
  }

  const lines: PdfLine[] = [];
  let index = 0;
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const frags: Fragment[] = [];
    for (const item of content.items as { str?: string; transform?: number[]; width?: number }[]) {
      if (!item.str || !item.transform || !item.str.trim()) continue;
      frags.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? item.str.length * 5,
        size: Math.abs(item.transform[0]) || 10,
      });
    }
    // Group fragments whose baselines are within ~a third of the font size.
    frags.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Fragment[][] = [];
    for (const f of frags) {
      const row = rows.find((r) => Math.abs(r[0].y - f.y) <= Math.max(2, f.size * 0.35));
      if (row) row.push(f);
      else rows.push([f]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let current = "";
      let lastEnd: number | null = null;
      for (const f of row) {
        const gap = lastEnd == null ? 0 : f.x - lastEnd;
        if (lastEnd != null && gap > f.size * 1.2) {
          cells.push(current.trim());
          current = f.str;
        } else {
          current += (lastEnd != null && gap > f.size * 0.15 && !current.endsWith(" ") ? " " : "") + f.str;
        }
        lastEnd = f.x + f.width;
      }
      if (current.trim()) cells.push(current.trim());
      const text = cells.join("  ").replace(/\s+$/, "");
      if (text) lines.push({ page: pageNo, index: index++, text, cells });
    }
  }
  if (lines.length === 0 || lines.map((l) => l.text).join("").replace(/\s/g, "").length < 20) {
    throw new ImportError(
      "This PDF has no readable text — it is probably a scanned image. Automatic reading of scans (OCR) is coming later; for now enter these lines manually or upload the supplier's digital PDF.",
    );
  }
  return { lines, pageCount: pdf.numPages };
}
