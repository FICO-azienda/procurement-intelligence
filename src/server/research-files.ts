/**
 * Research files kept on this computer (.data/research): what a research
 * session found, saved so that the next one continues from it instead of
 * starting again. They are read from here and loaded with the same check and
 * the same confirmation as a file chosen by hand — nothing is loaded by itself.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const dir = () => process.env.RESEARCH_DIR ?? path.join(process.cwd(), ".data", "research");
const SAFE = /^[\w.-]+\.json$/;

export interface ResearchFileInfo {
  name: string;
  /** ISO date the file was last written. */
  modified: string;
}

export async function listResearchFiles(): Promise<ResearchFileInfo[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const files = await Promise.all(names.filter((n) => SAFE.test(n)).map(async (name) => ({ name, modified: (await stat(path.join(dir(), name))).mtime.toISOString() })));
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

/** The content of one of them. Null: not a file of that folder. */
export async function readResearchFile(name: string): Promise<string | null> {
  if (!SAFE.test(name)) return null;
  try {
    return await readFile(path.join(dir(), name), "utf8");
  } catch {
    return null;
  }
}
