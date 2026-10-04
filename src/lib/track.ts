/**
 * Product instrumentation, ready for an analytics service that is not there
 * yet. Call `track` where a flow starts or ends; today the events are only
 * kept in memory (window.__ux) so they can be inspected while testing.
 *
 * Measures we want from these events: time to first import, time to first
 * insight, clicks to add a purchase, review time, abandoned forms, most used
 * sections.
 */
export type UxEvent =
  | "command_opened"
  | "search_result_opened"
  | "add_opened"
  | "purchase_saved"
  | "quote_saved"
  | "product_saved"
  | "supplier_saved"
  | "created_inline"
  | "quick_add_read"
  | "paste_started"
  | "upload_started"
  | "upload_finished"
  | "form_abandoned"
  | "language_changed";

export function track(event: UxEvent, props: Record<string, string | number | boolean | null> = {}) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __ux?: { event: UxEvent; at: number; props: typeof props }[] };
  (w.__ux ??= []).push({ event, at: Date.now(), props });
}
