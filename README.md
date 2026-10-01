# Procurement Intelligence — prototipo

> "Dimmi cosa compri e quanto lo paghi. Ti aiutiamo a capire se stai comprando bene."

Prototipo funzionante per PMI manifatturiere: cosa si compra, da chi, a che prezzo, come cambiano i prezzi. Dati demo di un produttore di candele (ott 2025 → set 2026), pronti da sostituire con dati reali.

## Avvio

```bash
npm install
npm run dev
```

Apri http://localhost:3100. Al primo avvio viene creato un database locale (`.data/pglite`) con i dati demo.

| Comando | Cosa fa |
|---|---|
| `npm run dev` | App in sviluppo su porta 3100 |
| `npm test` | Test dei calcoli e del parsing (vitest) |
| `npm run typecheck` / `npm run lint` | Controlli |
| `npm run build && npm start` | Versione di produzione |
| `npm run db:reset` | Cancella tutto e ricarica i dati demo (a server fermo) |
| `npm run db:clear` | Cancella tutto (a server fermo) |
| `npm run db:generate` | Genera una nuova migrazione dopo aver modificato lo schema |

## Sabato: passare ai dati reali

1. **Import → Data → Clear all data.** Svuota database e file salvati (resta vuoto anche dopo il riavvio).
2. **Import → carica i file** (anche più file insieme, trascinandoli):
   - **CSV / Excel** (`.csv`, `.xlsx`, `.xls`, `.ods`) esportati dal gestionale → schermata **Map your columns** con proposta automatica (intestazioni italiane o inglesi), correggibile.
   - **Fatture PDF** e **preventivi PDF** digitali (non scansioni) → lettura automatica di fornitore, P.IVA, numero, data, righe, quantità, prezzi, pagamento, trasporto (fatture) o MOQ, lead time, Incoterm, validità (preventivi).
3. **Revisione.** Per ogni file: *We found 42 purchases. 3 need your attention.*
   - fornitori e prodotti riconosciuti, suggeriti (con % di confidenza → **Confirm / Choose another / Create new**) o sconosciuti (**Create**);
   - righe con problemi (valuta mancante, unità sconosciuta, numero ambiguo, duplicato, aumento prezzo > 5%) da correggere o confermare (**Looks right**);
   - clic su una riga per correggere i valori: il valore originale del file resta visibile ("In file: …").
4. **Import N purchases.** Le righe pronte entrano nel database; quelle dubbie restano in **Review** (sidebar) senza bloccare il resto.
5. Dashboard, storico prezzi, variazioni e fornitori si aggiornano da soli. Ogni acquisto ha **View source** verso il documento originale.

Ogni conferma insegna qualcosa: "ABC S.r.l." o "PARAFFIN WAX 58/60" confermati una volta vengono riconosciuti automaticamente la volta dopo (alias).

**File di prova** in `test-data/` (scenari A–G + preventivo PDF), rigenerabili con `npx tsx scripts/make-test-data.ts`. Funzionano sui dati demo.

Per tornare alla demo: **Import → Data → Reload demo data**.

## Pipeline di import (Fase 2)

```
File ─▶ Estrazione ─▶ Normalizzazione ─▶ Matching ─▶ Revisione ─▶ Approvazione ─▶ Database ─▶ Dashboard
        CSV/Excel/PDF   unità, valute,     fornitori,   problemi e    solo righe
                        numeri, date        prodotti     anomalie      "ready"
```

Regola: *se è noto → si salva; se è dedotto con alta confidenza → si suggerisce; se è incerto → revisione; se è sconosciuto → vuoto.* Nessun dato inventato, nessun errore silenzioso.

| Modulo | File |
|---|---|
| Lettura CSV/Excel (codifica Windows-1252, riga di intestazione, fogli) | `lib/import/extract/tabular.ts` |
| Righe → dati normalizzati + problemi di lettura | `lib/import/extract/rows.ts` |
| PDF → righe di testo (scansioni riconosciute) | `lib/import/extract/pdf.ts` |
| Fatture e preventivi: campi e righe articolo (verificate con quantità × prezzo = importo) | `lib/import/extract/document.ts` |
| Campi standard e proposta di mappatura colonne | `lib/import/fields.ts` |
| Unità (kg/KG/chilogrammi, pz/pezzi, t/tonnellate…) con conversioni esatte | `lib/import/normalize/units.ts` |
| Valute (€ $ £ EUR USD…), mai convertite senza cambio | `lib/import/normalize/currency.ts` |
| Numeri 1.234,50 / 1,234.50: stile rilevato per colonna, ambiguità → revisione | `lib/import/normalize/numbers.ts` |
| Date (gg/mm, mm/gg rilevato dalla colonna, seriali Excel) | `lib/import/normalize/dates.ts` |
| Matching fornitori (P.IVA, alias, forma societaria) e prodotti (SKU, codice fornitore, alias, nome, fuzzy; i numeri devono coincidere: 300 ml ≠ 500 ml) | `lib/import/match/` |
| Valutazione righe: obbligatori, unità, duplicati, anomalie → ready/attention | `lib/import/evaluate.ts` |
| Regole anomalie configurabili (+5% review, +10% alta priorità, mediana ±20%, quantità ×3…) | `lib/anomalies.ts` |
| Servizi DB: upload, mappatura, risoluzioni, apprendimento alias, approvazione, riepilogo | `server/imports.ts` |
| File originali: cartella locale o Supabase Storage (`imports/{company}/{anno}/…`) | `lib/storage.ts` |

### Nuove tabelle

- `documents` — file originale (hash SHA-256 → stesso file = stesso documento, duplicati riconosciuti).
- `import_sessions` — un upload: stato (`uploaded → processing → needs_review → completed / failed`), contatori, mappatura, riepilogo.
- `import_items` — una riga estratta: `raw` (come nel file) → `extracted` (normalizzato) → `data` (corretto dall'utente), confidenza, suggerimenti di matching, problemi.
- `product_aliases`, `supplier_aliases` — ciò che il sistema ha imparato dalle conferme.
- `supplier_products` — codice e nome dell'articolo presso ogni fornitore, MOQ, lead time (i prezzi restano calcolati da acquisti e offerte).
- `purchases` / `quotes` ora hanno `import_item_id` (→ sessione → documento: "View source"), descrizione originale; `fx_rate` può essere vuoto (valuta estera senza cambio: esclusa dai totali EUR, mai convertita 1:1). `suppliers` ha la P.IVA.

### Limiti noti

- PDF: funziona con PDF digitali con testo; le scansioni vengono riconosciute e segnalate (OCR in una fase successiva). Layout di fattura molto particolari possono richiedere correzioni in revisione.
- Supabase Storage: codice pronto (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket `imports`) ma non ancora provato su un progetto reale.
- Un codice fornitore per coppia fornitore/prodotto.

## Architettura

```
src/
  db/schema.ts        Modello dati (Drizzle, PostgreSQL) — unica fonte di verità
  db/index.ts         Connessione: PGlite locale oppure DATABASE_URL (Supabase)
  db/seed.ts          Dati demo + clearAll
  lib/analytics.ts    TUTTI i calcoli, funzioni pure (testate in analytics.test.ts)
  lib/data.ts         Lettura dal DB → dati tipizzati per analytics
  lib/validation.ts   Schemi zod condivisi da form e import
  lib/import/         Pipeline di import (estrazione, normalizzazione, matching, valutazione)
  lib/anomalies.ts    Regole su prezzi e quantità dei nuovi acquisti
  server/imports.ts   Servizi DB dell'import (usati da server actions e test)
  app/actions.ts      Tutte le scritture (Server Actions)
  app/…/page.tsx      Pagine: Today, Products, Suppliers, Purchases, Compare, Import
  components/         UI (tabelle, dialog, grafico, filtri)
drizzle/              Migrazioni SQL (valide anche su Supabase)
```

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind 4 · Drizzle ORM · PostgreSQL (PGlite in locale) · Recharts · zod.

**Perché PGlite:** è PostgreSQL vero, in un file, senza account né costi. Lo schema e le migrazioni sono gli stessi di Supabase. Per passare a Supabase: crea il progetto, imposta `DATABASE_URL` in `.env.local` (connection string del pooler) e riavvia — le migrazioni vengono applicate da sole. *Il percorso Supabase è scritto ma non ancora provato contro un database reale.*

### Modello dati

- **suppliers** — anagrafica, valuta, termini di pagamento (giorni; 0 = anticipato), lead time tipico.
- **products** — SKU unico, nome, categoria, unità di misura, specifiche, `current_supplier_id`.
- **purchases** — il fatto base: data, prodotto, fornitore, quantità, prezzo unitario, valuta + `fx_rate` verso EUR, trasporto, altri costi, totale, riferimento fattura, `source`.
- **quotes** — offerte e listini: prezzo, valuta, MOQ, lead time, pagamento, Incoterm, validità, `source`.
- `source` ∈ `manual | csv | invoice | email | erp | demo` — ogni dato sa da dove viene.

**Storico prezzi: calcolato, non salvato.** Lo storico è derivato da `purchases` (prezzi pagati) e `quotes` (prezzi offerti). Una sola fonte di verità: se modifichi o cancelli un acquisto, grafico, variazioni e stati si aggiornano senza tabelle da sincronizzare. I prezzi di mercato esterni (commodity, PricePedia) avranno una tabella propria, perché sono un dato diverso.

### Calcoli (in `lib/analytics.ts`)

| Numero | Definizione |
|---|---|
| Prezzo attuale | Ultimo prezzo pagato al fornitore attuale (in EUR) |
| Variazione 12M | Prezzo attuale vs prezzo pagato ~12 mesi prima (ultimo acquisto prima dell'inizio finestra, altrimenti il più vecchio) |
| Spesa annua | Somma degli acquisti degli ultimi 12 mesi (trasporto e altri costi inclusi) |
| Spesa ai prezzi di oggi | Quantità annua × prezzo attuale |
| Costo degli aumenti | Quantità annua × (prezzo attuale − prezzo 12 mesi fa) |
| Stato | `Price increase` se > +5% · `Review` se nessun acquisto o ultimo acquisto > 6 mesi · altrimenti `Stable` |

Soglie modificabili in `RULES` (`lib/analytics.ts`).

## Dove si innesta il futuro

| Modulo | Punto di aggancio |
|---|---|
| Document AI (OCR, layout complessi) | Sostituisce un "finder" alla volta in `lib/import/extract/document.ts`; il resto della pipeline (revisione, approvazione) non cambia |
| Email intelligence | Allegati e testo delle email → stessa pipeline (`import_sessions` con `source = email`) → Review |
| True landed cost | Funzione pura in `lib/analytics.ts` sopra `quotes` (Incoterm, valuta, MOQ, pagamento sono già salvati) + tabelle per dazi/trasporto |
| Market intelligence | Tabella `market_prices` (serie esterne), confrontata con lo storico acquisti |
| RFQ engine | Tabelle `rfqs` / `rfq_recipients`; le risposte diventano `quotes` |
| AI analysis | Le funzioni di `lib/analytics.ts` diventano gli strumenti dell'AI ("quanto abbiamo speso in vetro?") |
| Qualità, inventario | Tabelle proprie legate a `products`/`suppliers` |

## Note

- Nessuna autenticazione: è un prototipo locale, non esporlo su internet così com'è.
- Il database locale supporta un solo processo alla volta: ferma `npm run dev` prima di usare `db:reset` / `db:clear` (oppure usa i pulsanti in Import).
- Un prodotto ha una sola unità di misura; le conversioni (es. kg ↔ t) non sono ancora gestite.
