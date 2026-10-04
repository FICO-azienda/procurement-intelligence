/**
 * What kind of document a line comes from, as files write it: the codes of
 * Italian electronic invoices ("TD04") or plain words ("Credit note").
 */

/** A credit note corrects an earlier invoice: its lines are not purchases. */
export function isCreditNote(type: string | null | undefined): boolean {
  const s = (type ?? "").trim();
  return /^TD0?[48]$/i.test(s) || /\b(credit\s*note|credit\s*memo|nota\s+(di\s+)?credito|nota\s+(di\s+)?accredito|storno)\b/i.test(s);
}
