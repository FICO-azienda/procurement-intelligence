/** Human name of a record's origin (purchases.source / quotes.source). */
export function sourceLabel(source: string) {
  return (
    {
      manual: "Manual",
      csv: "CSV import",
      excel: "Excel import",
      invoice: "Invoice",
      quote: "Quote",
      email: "Email",
      erp: "ERP",
      demo: "Demo data",
    } as Record<string, string>
  )[source] ?? source;
}
