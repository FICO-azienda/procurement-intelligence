import { en, type Msg, type T } from "./i18n";

export const SOURCE_LABEL: Record<string, Msg> = {
  manual: "Manual",
  csv: "CSV import",
  excel: "Excel import",
  invoice: "Invoice",
  quote: "Quote",
  email: "Email",
  erp: "ERP",
  demo: "Demo data",
};

/** Human name of a record's origin (purchases.source / quotes.source). */
export function sourceLabel(source: string, t: T = en) {
  return source in SOURCE_LABEL ? t(SOURCE_LABEL[source]) : source;
}
