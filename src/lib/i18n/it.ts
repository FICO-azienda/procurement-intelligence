/**
 * The Italian dictionary: English text (as written in the code) → Italian.
 * Split in parts only to keep the files readable; a text used in several
 * places is translated once (`it.test.ts` checks that two parts never
 * disagree, and that every placeholder survives the translation).
 */
import { catalog } from "./it/catalog";
import { engine } from "./it/engine";
import { imports } from "./it/imports";
import { mapper } from "./it/mapper";
import { research } from "./it/research";
import { sourcing } from "./it/sourcing";
import { ui } from "./it/ui";

export const PARTS = { engine, imports, ui, catalog, mapper, sourcing, research };

export const it = { ...engine, ...imports, ...ui, ...catalog, ...mapper, ...sourcing, ...research };
