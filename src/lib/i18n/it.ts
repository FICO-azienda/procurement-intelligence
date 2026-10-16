/**
 * The Italian dictionary: English text (as written in the code) → Italian.
 * Split in parts only to keep the files readable; a text used in several
 * places is translated once (`it.test.ts` checks that two parts never
 * disagree, and that every placeholder survives the translation).
 */
import { safety } from "./it/safety";
import { setup } from "./it/setup";
import { pending } from "./it/pending";
import { companies } from "./it/companies";
import { catalog } from "./it/catalog";
import { categories } from "./it/categories";
import { dataset } from "./it/dataset";
import { engine } from "./it/engine";
import { imports } from "./it/imports";
import { mapper } from "./it/mapper";
import { markets } from "./it/markets";
import { replies } from "./it/replies";
import { offers } from "./it/offers";
import { orders } from "./it/orders";
import { identity } from "./it/identity";
import { negotiation } from "./it/negotiation";
import { portfolio } from "./it/portfolio";
import { research } from "./it/research";
import { rfq } from "./it/rfq";
import { sourcing } from "./it/sourcing";
import { suppliers } from "./it/suppliers";
import { ui } from "./it/ui";

export const PARTS = { engine, imports, ui, catalog, safety, mapper, sourcing, research, dataset, negotiation, suppliers, portfolio, identity, rfq, categories, markets, replies, offers, orders, setup, pending, companies };

export const it = { ...engine, ...imports, ...ui, ...catalog, ...safety, ...mapper, ...sourcing, ...research, ...dataset, ...negotiation, ...suppliers, ...portfolio, ...identity, ...rfq, ...categories, ...markets, ...replies, ...offers, ...orders, ...setup, ...pending, ...companies };
