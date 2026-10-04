/** Italian: product normalisation — clean names, kinds of spend, grouping, the review of exceptions. */
export const catalog = {
  // ---- import/fields.ts, rows.ts, units.ts
  Discount: "Sconto",
  "Document type": "Tipo di documento",
  "Invoice line number": "Numero di riga in fattura",
  "Barcode (EAN)": "Codice a barre (EAN)",
  hectolitres: "ettolitri",
  "cubic metres": "metri cubi",
  bottles: "bottiglie",
  hours: "ore",
  "No quantity in the file: read as one item at the line total": "Nel file non c'è la quantità: letta come una voce all'importo di riga",
  "Credit note: it corrects an earlier invoice and is not a purchase": "Nota di credito: corregge una fattura precedente e non è un acquisto",
  "Line with no amount: nothing was bought": "Riga senza importo: non è stato comprato nulla",

  // ---- catalog/kinds.ts
  "Direct material": "Materiale diretto",
  Packaging: "Imballaggio",
  Component: "Componente",
  Logistics: "Logistica",
  Service: "Servizio",
  "Indirect purchase": "Acquisto indiretto",
  "Energy / utility": "Energia / utenze",
  Equipment: "Attrezzatura",
  Other: "Altro",
  "To classify": "Da classificare",
  "Direct materials": "Materiali diretti",
  Components: "Componenti",
  "Transport and logistics": "Trasporti e logistica",
  Services: "Servizi",
  "Indirect purchases": "Acquisti indiretti",
  "Energy and utilities": "Energia e utenze",
  "Equipment and spare parts": "Attrezzature e ricambi",
  "Fees, taxes and other charges": "Contributi, imposte e altri addebiti",

  // ---- catalog/propose.ts
  "Same kind of spend from the same supplier": "Stesso tipo di spesa dallo stesso fornitore",
  "Same code of ours on the supplier's invoice": "Stesso nostro codice sulla fattura del fornitore",
  "Same barcode": "Stesso codice a barre",
  "Same supplier code, same sizes": "Stesso codice fornitore, stesse misure",
  "Same supplier code, but the sizes written are different": "Stesso codice fornitore, ma le misure scritte sono diverse",
  "Same description from two suppliers": "Stessa descrizione da due fornitori",
  "Almost the same description: one word is written differently": "Descrizione quasi uguale: una parola è scritta in modo diverso",
  "Same words, unit and price: only one number is different": "Stesse parole, unità e prezzo: cambia solo un numero",
  "Similar descriptions": "Descrizioni simili",
  "Nothing in these lines says what they are": "Niente in queste righe dice che cosa sono",

  // ---- import/match
  "Same kind of spend from this supplier": "Stesso tipo di spesa da questo fornitore",

  // ---- server/catalog.ts
  "This question is no longer open.": "Questa domanda non è più aperta.",

  // ---- components/import/analysis.tsx
  "Choose what they are…": "Scegli che cosa sono…",
  "Confirm all": "Conferma tutti",
  Confirm: "Conferma",
  "Confirming…": "Conferma in corso…",
  "Hide details": "Nascondi dettagli",
  "See details": "Vedi dettagli",
  "Keep separate": "Mantieni separati",
  Merge: "Unisci",
  "Name if merged": "Nome se li unisci",
  "Nothing in these lines says what they are. Materials, components and packaging enter the product catalogue, one product per description; anything else is kept as spend from this supplier.": "Niente in queste righe dice che cosa sono. Materiali, componenti e imballaggi entrano nel catalogo prodotti, un prodotto per descrizione; tutto il resto resta come spesa di questo fornitore.",
  "Reason:": "Motivo:",
  "Show {n} more": "Mostra altri {n}",
  Split: "Separa",
  "Suggestion:": "Suggerimento:",
  "The same product written in different ways is put together; transport, services and utilities are kept as spend, not as products. Every description stays linked to its product, as written.": "Lo stesso prodotto scritto in modi diversi viene raggruppato; trasporti, servizi e utenze restano come spesa, non come prodotti. Ogni descrizione rimane collegata al suo prodotto, così com'è scritta.",
  "They may be the same product": "Potrebbero essere lo stesso prodotto",
  "We analysed {n} description": "Abbiamo analizzato {n} descrizione",
  "We analysed {n} descriptions": "Abbiamo analizzato {n} descrizioni",
  "What are these?": "Che cosa sono?",
  "What it is": "Che cos'è",
  "Written on the invoices as": "Scritto in fattura come",
  "distinct products identified": "prodotti distinti identificati",
  "items of services and other spend classified": "voci di servizi e altre spese classificate",
  "keep them separate": "mantienili separati",
  "merge them": "uniscili",
  "largest spend first": "prima la spesa maggiore",
  "need your check": "richiedono il tuo controllo",
  "put together automatically": "raggruppate automaticamente",
  "ready to import as soon as you confirm": "pronte da importare appena confermi",
  "{n} case to check": "{n} caso da controllare",
  "{n} cases to check": "{n} casi da controllare",
  "{n} description": "{n} descrizione",
  "{n} descriptions": "{n} descrizioni",
  "{n} high-confidence group": "{n} raggruppamento ad alta affidabilità",
  "{n} high-confidence groups": "{n} raggruppamenti ad alta affidabilità",
  "{n} invoice line": "{n} riga di fattura",
  "{n} invoice lines": "{n} righe di fattura",

  // ---- app/import/[id]/page.tsx
  "{n} set aside": "{n} messe da parte",
  "Set aside because they are not purchases:": "Messe da parte perché non sono acquisti:",
  "They are listed under Skipped, and can be brought back.": "Le trovi sotto Saltate e le puoi rimettere in gioco.",

  // ---- app/review/page.tsx
  "{n} product description is new": "{n} descrizione di prodotto è nuova",
  "{n} product descriptions are new": "{n} descrizioni di prodotto sono nuove",
  "We put together the ones that are the same product and classified services and other spend. Confirm them all at once, and decide only the doubtful cases.": "Abbiamo raggruppato quelle che sono lo stesso prodotto e classificato servizi e altre spese. Confermale tutte insieme e decidi solo i casi dubbi.",
  "Open the analysis": "Apri l'analisi",

  // ---- app/products/page.tsx
  "Other company spend": "Altre spese aziendali",
  "{n} item": "{n} voce",
  "{n} items": "{n} voci",
  "in 12 months": "in 12 mesi",
  "Transport, services, utilities and office purchases count in the company's spend, but are not compared and negotiated as products: one item per supplier and kind, with every invoice line behind it.": "Trasporti, servizi, utenze e acquisti per l'ufficio contano nella spesa dell'azienda, ma non si confrontano e non si negoziano come prodotti: una voce per fornitore e tipo, con tutte le righe di fattura dietro.",
  Item: "Voce",
  "Invoice lines": "Righe di fattura",
  "Total company spend in 12 months:": "Spesa totale dell'azienda in 12 mesi:",
  "products in the catalogue": "prodotti a catalogo",
  "other spend": "altre spese",

  // ---- app/products/[id]/page.tsx
  "Showing the latest {shown} of {total} lines. All of them are under Purchases.": "Mostriamo le ultime {shown} righe su {total}. Le trovi tutte in Acquisti.",
  "Written on the invoice as": "Scritto in fattura come",
  "invoice lines": "righe di fattura",
  "spent in total": "spesi in totale",
  "{~kind}: it counts in the company's spend, but is not compared and negotiated as a product. If it is a material, a component or packaging, change what it is above and it moves to the catalogue.": "{~kind}: conta nella spesa dell'azienda, ma non si confronta e non si negozia come un prodotto. Se è un materiale, un componente o un imballaggio, cambia qui sopra che cos'è e passa al catalogo.",

  // ---- app/suppliers/[id]/page.tsx
  "Not products to compare: counted in the spend with this supplier": "Non sono prodotti da confrontare: contano nella spesa con questo fornitore",

  // ---- electronic invoices in the UI
  "Electronic invoice: every value comes from the file's own fields.": "Fattura elettronica: ogni valore viene dai campi del file.",
  "E-invoice · XML": "Fattura elettronica · XML",
  "Signed file": "File firmato",

  // ---- components/import/mapping-form.tsx
  "We would now read {n} column differently": "Oggi leggeremmo {n} colonna in modo diverso",
  "We would now read {n} columns differently": "Oggi leggeremmo {n} colonne in modo diverso",
  "Use the suggested columns": "Usa le colonne suggerite",

  // ---- app/page.tsx
  "on catalogue products · {total} with all other spend": "sui prodotti a catalogo · {total} con tutte le altre spese",
  "{n} item of other spend": "{n} voce di altre spese",
  "{n} items of other spend": "{n} voci di altre spese",
};
