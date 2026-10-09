/**
 * The Italian dictionary: English text (as written in the code) → Italian.
 * Split in parts only to keep the files readable; a text used in several
 * places is translated once (`it.test.ts` checks that two parts never
 * disagree, and that every placeholder survives the translation).
 */
import { catalog } from "./it/catalog";
import { dataset } from "./it/dataset";
import { engine } from "./it/engine";
import { imports } from "./it/imports";
import { mapper } from "./it/mapper";
import { identity } from "./it/identity";
import { negotiation } from "./it/negotiation";
import { portfolio } from "./it/portfolio";
import { research } from "./it/research";
import { rfq } from "./it/rfq";
import { sourcing } from "./it/sourcing";
import { suppliers } from "./it/suppliers";
import { ui } from "./it/ui";

export const PARTS = { engine, imports, ui, catalog, mapper, sourcing, research, dataset, negotiation, suppliers, portfolio, identity, rfq };

export const it = { ...engine, ...imports, ...ui, ...catalog, ...mapper, ...sourcing, ...research, ...dataset, ...negotiation, ...suppliers, ...portfolio, ...identity, ...rfq };
