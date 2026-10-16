/** Product and workspace names shown in the UI. Change freely. */
export const APP_NAME = "Procurement Intelligence";
/** Short wordmark for the sidebar. */
export const APP_SHORT_NAME = "Procurement";
/**
 * Workspace id. Used in file storage paths (imports/{COMPANY_ID}/…); a file
 * already stored keeps the path written on its document.
 */
export const COMPANY_ID = process.env.COMPANY_ID ?? "workspace";
/**
 * More of our own names and VAT numbers, beyond the ones written in Settings:
 * on invoices and quotes these belong to the customer (us), so they are never
 * taken as the supplier. No company is named in the code: each installation
 * says who it is on its first start.
 */
export const OWN_COMPANY_NAMES = (process.env.COMPANY_ALIASES?.split(",") ?? []).map((s) => s.trim()).filter(Boolean);
export const OWN_VAT_NUMBERS = (process.env.COMPANY_VAT ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const BASE_CURRENCY = "EUR";
/** Where "today" is decided (dates on purchases, the start of the 12-month window). */
export const TIME_ZONE = process.env.TIME_ZONE ?? "Europe/Rome";
