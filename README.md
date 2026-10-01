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
  app/…/page.tsx      Pagine: Today, Products, Suppliers, Purchases, Compare, Opportunities, Overview, Import
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

## Price intelligence (Fase 3)

Risponde a "stiamo pagando bene?" usando solo i dati interni (acquisti, fatture, preventivi). Nessun benchmark esterno.

**Motore separato dalla UI**: `src/lib/intel/` — funzioni pure, testate, con tutte le soglie in `config.ts`.

| Modulo | Cosa calcola |
|---|---|
| `config.ts` | Tutte le soglie (avvisi +5/+10/+20%, età preventivi 30/90 giorni, Pareto 80%, outlier ±50%…) — da calibrare sui dati reali |
| `price-metrics.ts` | Prezzo attuale e precedente, variazioni 3M/6M/12M/totale, media semplice e ponderata, min/max, trend, timeline, distribuzione, outlier |
| `comparison.ts` | Confronto fornitori sulla stessa base (unità, EUR), età del preventivo, differenze di specifiche, **comparabilità** |
| `opportunities.ts` | Saving potenziale, **confidenza** a regole, informazioni mancanti, i 5 tipi di opportunità |
| `portfolio.ts` | Spesa per fornitore/categoria, Pareto, concentrazione fornitori, avvisi, variazione prezzi fornitore ponderata sulla spesa |
| `quality.ts` | Qualità dei dati di un prodotto |
| `summary.ts` | Riepiloghi in linguaggio naturale da regole/template (nessun LLM) |
| `explain.ts` | La spiegazione mostrata accanto a ogni cifra (generata dalle soglie) |
| `filters.ts`, `csv.ts` | Filtri rapidi/ordinamenti e export CSV |
| `engine.ts` | `analyze()`: un passaggio sul dataset → tutto ciò che le pagine mostrano |

### Vocabolario (tenuto rigoroso)

- **Price difference** — differenza nominale tra due prezzi.
- **Potential saving** — (prezzo attuale − prezzo alternativo) × quantità degli ultimi 12 mesi. Solo prezzi: prima di trasporto, dazi, qualità, scorte e condizioni commerciali.
- **Verified saving** — non calcolato: arriverà con la conferma dell'utente e il landed cost.

Nessun saving viene generato se l'offerta non è comparabile (valuta senza cambio, unità non convertibile, o decisione dell'utente).

### Regole principali

| Concetto | Regola |
|---|---|
| Comparable | Stesso prodotto, stessa unità (o convertibile esattamente), valuta convertibile con un cambio registrato |
| Partially comparable | Specifiche diverse, oppure MOQ > 1,5 × ordine tipico |
| Not comparable | Cambio sconosciuto, unità non convertibile, nessun prezzo, o deciso dall'utente |
| Confidenza alta | Tutti i controlli ok: unità, valuta, specifiche non in conflitto, offerta ≤ 90 giorni, MOQ entro l'ordine tipico, dati propri sufficienti |
| Confidenza media | Almeno un'attenzione: valuta convertita, specifiche diverse, MOQ ignoto o sopra l'ordine tipico, pochi dati |
| Confidenza bassa | Offerta > 90 giorni o scaduta, MOQ sopra il volume annuo, prezzo attuale segnalato come anomalo |
| Saving che rappresenta un prodotto | Il più affidabile, poi il più grande; mai uno rifiutato/chiuso |
| Totale in dashboard | Un'alternativa per prodotto, solo confidenza alta o media, opportunità ancora aperte |
| Alta spesa | Prodotti che compongono il primo 80% della spesa annua |
| Outlier | Prezzo a più del 50% dalla mediana con almeno 4 acquisti: segnalato, mai rimosso da solo (Price is correct / Exclude from analysis / Correct value) |

### Database (migrazione 0002)

- `opportunities` — solo la decisione dell'utente (stato, nota, fotografia dei numeri). Le opportunità restano calcolate dal motore.
- `products.specs`, `supplier_products.specs` — specifiche strutturate (nome: valore) per il confronto.
- `supplier_products.comparability_override` / `comparability_note` — giudizio dell'utente sulla comparabilità di un'offerta.
- `purchases.price_review` — `confirmed` / `excluded` per i prezzi anomali.

### Assunzioni da calibrare con i dati reali

I dati demo sono solo fixture di test: il motore è testato su dataset generici (`src/lib/intel/fixtures.ts`), inclusi storici incompleti, un solo acquisto, nessuna alternativa, più fornitori, unità e valute diverse, dati anomali.

- "Annuale" = ultimi 12 mesi (non anno solare); YTD mostrato a parte.
- Prezzo attuale = ultimo prezzo pagato al fornitore attuale.
- Storico più corto della finestra (es. 12M con 9 mesi di dati): si confronta con il primo prezzo disponibile e lo si dichiara ("start of history").
- Specifiche non inserite non abbassano la confidenza ma compaiono tra le informazioni mancanti (`requireSpecsForHighConfidence`).
- Acquisti in valuta estera senza cambio: esclusi da prezzi e totali EUR, mai convertiti 1:1.
- Scala: una lettura per tabella + calcolo indicizzato in memoria (10.000 acquisti, 1.000 prodotti, 500 fornitori in meno di mezzo secondo, vedi test "scale"). Aggregazioni SQL solo quando servirà.

## Overview: la sintesi per il titolare

Pagina `/overview` ("Purchasing overview"): prodotto per prodotto, cosa paghi, a chi, come si è mosso il prezzo, con cosa si può confrontare, quali alternative esistono, quanto c'è in gioco, cosa manca e cosa controllare per primo. In linguaggio semplice; i termini tecnici stanno nei tooltip.

**Summary Engine** — `src/lib/intel/decision.ts`, puro e testato (`decision.test.ts`). Non ricalcola nulla: seleziona, ordina e mette in parole ciò che `analyze()` ha già prodotto. I componenti React si limitano a mostrare.

- `purchasingOverview(intel)` → tutta la pagina (totali, executive summary, top opportunità, cosa è cambiato, rischi di fornitura, concentrazione, "cosa controllo per primo", prodotti in ordine di priorità).
- `productDecision()` / `decisionFor(intel, productId)` → la scheda di un prodotto (`ProductDecision`).
- `filterDecisions()` → filtri (stato, fornitore, categoria, testo) e ordinamenti.

| Concetto | Regola |
|---|---|
| **Action** | Saving potenziale ad alta confidenza, almeno `overview.minMaterialSaving` (250 €/anno) |
| **Review** | Saving a confidenza media/bassa, aumento prezzo oltre soglia, o prezzo attuale segnalato come possibile errore |
| **Data needed** | Nessun prezzo, ultimo acquisto oltre 6 mesi, nessun preventivo comparabile, o solo preventivi vecchi |
| **Good** | Nessuno dei casi sopra: c'è un confronto recente e il prezzo regge |
| Rischio fornitura | Separato dal costo: `high` = fornitore unico su un prodotto ad alta spesa |
| Ordine della pagina | 1) Action per € · 2) fornitore unico ad alta spesa · 3) Review · 4) Data needed · 5) Good. Punteggio interno, mai mostrato |
| Ordine delle alternative | Quella scelta dal motore, poi comparabilità, confidenza, prezzo. Mai solo il prezzo quotato; se la quota più bassa non è prima, la scheda spiega perché |
| "Compared with" | Oggi solo `Quotes on file` (range dei preventivi interni comparabili) o `Not available`. I tipi market / trade / cost driver esistono nel modello ma non sono alimentati |
| Validated | Opportunità che l'utente ha segnato come *validated* nella pagina Opportunities |

**Cosa la pagina NON mostra, perché non esiste ancora nel software:** costo reale (landed cost: trasporto, dazi, cambio, scorte, qualità), benchmark di mercato esterni, puntualità e difettosità dei fornitori, saving realizzato. Ogni alternativa riporta "True cost: not estimated yet"; il campo `estimatedTrueCost` è già nel modello e, quando verrà calcolato, entra nell'ordinamento senza cambiare la pagina.

Simple / Detail view (`?view=detail`), stampa o PDF dal pulsante Print (la pagina ha uno stile per la carta). Con molti prodotti vengono mostrate le prime 24 schede, poi "Show all".

## Dove si innesta il futuro

| Modulo | Punto di aggancio |
|---|---|
| Document AI (OCR, layout complessi) | Sostituisce un "finder" alla volta in `lib/import/extract/document.ts`; il resto della pipeline (revisione, approvazione) non cambia |
| Email intelligence | Allegati e testo delle email → stessa pipeline (`import_sessions` con `source = email`) → Review |
| True landed cost (Fase 4) | Estende `ComparisonRow` e `Opportunity` in `lib/intel/` (prezzo → + trasporto, dazi, FX, scorte, qualità); la lista "missing information" di ogni opportunità indica già cosa manca. Nella Overview riempie `estimatedTrueCost` di ogni alternativa |
| Benchmark esterni | Alimentano `MarketReference` (`direct_market`, `market_range`, `trade`, `cost_driver`) in `lib/intel/decision.ts`, accanto a `internal_quotes` |
| Market intelligence | Tabella `market_prices` (serie esterne), confrontata con lo storico acquisti |
| RFQ engine | Tabelle `rfqs` / `rfq_recipients`; le risposte diventano `quotes` |
| AI analysis | `analyze()` e le funzioni di `lib/intel/` diventano gli strumenti dell'AI ("quanto abbiamo speso in vetro?") |
| Qualità, inventario | Tabelle proprie legate a `products`/`suppliers` |

## Note

- Nessuna autenticazione: è un prototipo locale, non esporlo su internet così com'è.
- Il database locale supporta un solo processo alla volta: ferma `npm run dev` prima di usare `db:reset` / `db:clear` (oppure usa i pulsanti in Import).
- Un prodotto ha una sola unità di misura; le conversioni (es. kg ↔ t) non sono ancora gestite.
