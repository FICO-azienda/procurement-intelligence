/**
 * A mock file of replies for the tests: invented companies, invented prices.
 * It has what real files have — a company that stated prices in two
 * currencies, one that needs something more, one that said no and whose
 * columns slid by one, a line with no currency, a line for nobody.
 */
type Row = Record<string, unknown>;

export const MOCK_REPLIES: { metadata: Row; suppliers: Row[]; quotations: Row[]; excluded: string[] } = {
  metadata: { snapshot_date: "2026-03-10", source: "mock mailbox" },
  suppliers: [
    {
      supplier_id: "MOCK-WAX-1",
      name: "Mock Wax Kimya A.Ş.",
      category: "Waxes",
      status: "PREZZO RICEVUTO · NON FINALIZZATO",
      supplier_type: "Declared manufacturer",
      country: "Turkey",
      email: "sales@mockwax.example",
      website: "https://www.mockwax.example",
      contact: "Ada Mock",
      phone: "+90 500 000 00 01",
      address: "1 Mock Street, Istanbul",
      products: "Paraffin grades A and B",
      offer_summary: "Two prices, 20 t each",
      moq: "20.000 kg per grade",
      payment_terms: "100% in advance",
      lead_time_shipping: "CFR Mockport",
      samples: "",
      missing_data: "Data sheets; delivered price",
      next_action: "Ask for one grade only",
      priority: "Urgente",
      source_email_url: "https://mail.example/thread/1",
      notes: "P.IVA riportata TR1234567890. Proforma headed with a wrong name.",
      import_status: "Candidate — price not orderable",
      attachments: "proforma.pdf",
      verified_at: "2026-03-10",
      reply_group: "PREZZO RICEVUTO",
      quote_validated: false,
    },
    {
      supplier_id: "MOCK-WICK-1",
      name: "Mock Wicks GmbH",
      categories: ["Wicks", "Wooden wicks"],
      status: "RICHIEDE SPECIFICHE",
      country: "Germany",
      email: "info@mockwicks.example",
      website: "https://mockwicks.example",
      products: "Cotton and wooden wicks",
      offer_summary: "No price until sizes are chosen",
      next_action: "Send two references with diameters",
      priority: "Alta",
      source_email_url: "https://mail.example/thread/2",
      notes: "",
      verified_at: "2026-03-09",
      reply_group: "DA APPROFONDIRE",
    },
    {
      supplier_id: "MOCK-OUT-1",
      name: "Mock Hobby Shop",
      category: "Wicks",
      status: "RIFIUTO COMMERCIALE",
      supplier_type: "Retailer",
      country: "France",
      email: "hello@mockhobby.example",
      products: "Retail accessories",
      offer_summary: "No business price list",
      next_action: "Do not ask again.",
      priority: "Leave out of industrial requests.",
      source_email_url: "Escluso",
      notes: "https://mail.example/thread/3",
      import_status: "Ticket 42.",
      attachments: "EXCLUDED — retail",
      verified_at: "2026-03-10",
      reply_group: "RISPOSTA NEGATIVA",
      is_suitable_for_import_as_candidate: true,
    },
    { supplier_id: "MOCK-ODD-1", name: "Mock Unreadable Ltd", category: "Waxes", status: "???", country: "India" },
  ],
  quotations: [
    { supplier_id: "MOCK-WAX-1", product: "MOCK A", grade: "MOCK A", category: "Paraffin", price_per_kg: 1.5, currency: "EUR", quantity_kg: 20000, incoterm: "CFR", destination: "Mockport", melting_point: "58–60°C", oil_content: "0,5%", packaging: "Slabs", payment: "100% in advance", validity: "15/03/2026", technical_status: "To approve; another grade", source: "https://mail.example/thread/1" },
    { supplier_id: "MOCK-WAX-1", product: "MOCK B", grade: "MOCK B", category: "Paraffin", price_per_kg: 1.25, currency: "USD", quantity_kg: 20000, incoterm: "FOB", destination: "Mockharbour", payment: "100% in advance", validity: "7 gg da 10/03/2026", source: "https://mail.example/thread/1" },
    { supplier_id: "MOCK-WAX-1", product: "MOCK B", grade: "MOCK B", category: "Paraffin", price_per_kg: 1.25, currency: "USD", quantity_kg: 20000, incoterm: "FOB", destination: "Mockharbour" },
    { supplier_id: "MOCK-WAX-1", product: "MOCK C", price_per_kg: 1.1, quantity_kg: 20000, incoterm: "FOB" },
    { supplier_id: "MOCK-NOBODY", product: "MOCK D", price_per_kg: 1.3, currency: "EUR" },
  ],
  excluded: ["MOCK-OUT-1"],
};

export const mockFile = (change: (file: typeof MOCK_REPLIES) => void = () => {}) => {
  const copy = JSON.parse(JSON.stringify(MOCK_REPLIES)) as typeof MOCK_REPLIES;
  change(copy);
  return JSON.stringify(copy);
};
