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

1. **Import → Data → Clear all data.** Svuota il database (resta vuoto anche dopo il riavvio).
2. **Import → Purchases from CSV.** Esporta le righe acquisto dal gestionale/contabilità in CSV (da Excel: *File → Salva con nome → CSV*). Scarica il template per vedere le colonne. Funzionano:
   - separatore `,` o `;`, numeri `1,58` o `1.58`, `20.000`, date `15/09/2026` o `2026-09-15`;
   - intestazioni in italiano (`data, fornitore, codice, descrizione, um, quantità, prezzo, valuta, cambio, trasporto, fattura`) o inglese;
   - fornitori e prodotti mancanti vengono creati; prima di salvare vedi l'anteprima riga per riga con gli errori.
3. **Completa a mano** dove serve: categoria e specifiche dei prodotti, termini di pagamento e lead time dei fornitori, offerte (Add quote) per MOQ e alternative.
4. Tutto — spesa annua, variazioni, stati, fornitori — si ricalcola da solo.

Per tornare alla demo: **Import → Data → Reload demo data**.

## Architettura

```
src/
  db/schema.ts        Modello dati (Drizzle, PostgreSQL) — unica fonte di verità
  db/index.ts         Connessione: PGlite locale oppure DATABASE_URL (Supabase)
  db/seed.ts          Dati demo + clearAll
  lib/analytics.ts    TUTTI i calcoli, funzioni pure (testate in analytics.test.ts)
  lib/data.ts         Lettura dal DB → dati tipizzati per analytics
  lib/validation.ts   Schemi zod condivisi da form e import
  lib/import/         Import CSV (anteprima → approvazione → scrittura)
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
| Document AI (fatture, preventivi, listini) | Nuovo importer in `lib/import/` che produce le stesse righe dell'import CSV → stessa anteprima con approvazione → `source = invoice` |
| Email intelligence | Proposte di modifica approvate dall'utente, poi scritte con le funzioni di `app/actions.ts` (`source = email`) |
| True landed cost | Funzione pura in `lib/analytics.ts` sopra `quotes` (Incoterm, valuta, MOQ, pagamento sono già salvati) + tabelle per dazi/trasporto |
| Market intelligence | Tabella `market_prices` (serie esterne), confrontata con lo storico acquisti |
| RFQ engine | Tabelle `rfqs` / `rfq_recipients`; le risposte diventano `quotes` |
| AI analysis | Le funzioni di `lib/analytics.ts` diventano gli strumenti dell'AI ("quanto abbiamo speso in vetro?") |
| Qualità, inventario | Tabelle proprie legate a `products`/`suppliers` |

## Note

- Nessuna autenticazione: è un prototipo locale, non esporlo su internet così com'è.
- Il database locale supporta un solo processo alla volta: ferma `npm run dev` prima di usare `db:reset` / `db:clear` (oppure usa i pulsanti in Import).
- Un prodotto ha una sola unità di misura; le conversioni (es. kg ↔ t) non sono ancora gestite.
