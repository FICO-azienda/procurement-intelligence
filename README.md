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

> I nomi di pulsanti e pagine qui sotto sono quelli inglesi. Con l'app in italiano: Import → **Importa**, Demo data → **Dati demo**, Clear all data → **Cancella tutti i dati**, Review → **Revisione**, Paste from Excel → **Incolla da Excel**, Reload demo data → **Ricarica i dati demo**.

1. **Import → Demo data → Clear all data.** Svuota database e file salvati. Finché ci sono dati demo, in alto resta la fascia "Demo mode".
2. **Import → trascina i file** nell'unica area di caricamento (anche molti insieme: PDF, Excel, CSV, oppure uno **zip** che li contiene). Non serve dire che cosa sono:
   - **CSV / Excel** con intestazioni note (italiane o inglesi) → le colonne vengono riconosciute da sole e si arriva subito al risultato ("Change columns" per correggere). Se un'intestazione non è chiara, o non ci sono intestazioni, compare la schermata delle colonne con una proposta da controllare.
   - **PDF** digitali (non scansioni) → letti come fattura o preventivo in base a ciò che dichiarano ("It is a quote / It is an invoice" per rileggerli nell'altro modo).
   - **Incolla da Excel** (pulsante accanto, o `+ Add → Paste from Excel`): copia le righe, incolla, controlla le colonne.
   - **Fatture elettroniche XML** (anche firmate `.xml.p7m`) → lette dai campi del file: fornitore, partita IVA, numero, data, righe, quantità, prezzi. Note di credito, fatture semplificate e fatture emesse dalla tua azienda non vengono importate, con il motivo.
   - **Zip** → viene aperto e ogni file al suo interno è letto come se fosse stato trascinato da solo, cartelle comprese. I file che l'import non legge (una foto, le ricevute XML dello SdI, un file protetto da password) restano fuori e vengono elencati con il motivo.
3. **Risultato.** *83 lines found in 12 files · 76 ready · 5 need review · 2 duplicates*, con due pulsanti: **Review 5 issues** e **Import 76 ready lines**. Le righe corrette non vanno guardate una per una.
4. **Review**: una domanda per scheda, in linguaggio semplice — *We are not sure about this product. The file says "PAR WAX 58-60". We think it is Paraffina 58/60.* → **Yes, match / Choose another / Create new**. Al primo import, dove quasi tutti i nomi sono nuovi: **Create all N as written** crea fornitori e prodotti in un colpo (i prodotti prendono l'unità dal file).
5. Alla fine dell'import la pagina mostra subito **What your data already says** (i prezzi che si sono mossi), e la home si aggiorna da sola. Ogni acquisto ha **View source** verso il documento originale.

Ogni risposta viene ricordata: "ABC S.r.l." o "PARAFFIN WAX 58/60" confermati una volta vengono riconosciuti da soli la volta dopo.

**File di prova** in `test-data/` (scenari A–I + preventivo PDF; H è uno zip con fattura PDF, preventivo, Excel, fattura XML e due file che restano fuori; I è una fattura elettronica, semplice e firmata), rigenerabili con `npx tsx scripts/make-test-data.ts`. Funzionano sui dati demo.

Per tornare alla demo: **Import → Your data → Reload demo data**.

## Facilità d'uso (fase UX)

Principio: *prima il semplice, il dettaglio a richiesta*. La complessità resta nel software.

**Navigazione** — Overview (home) · Products · Suppliers · Compare · Import (con il contatore delle domande aperte) · Opportunities. Sotto *More*: Purchases, Reports (la revisione completa stampabile) e Settings. In alto, ovunque: la ricerca globale e un solo pulsante **+ Add**.

| Cosa | Dove | Note |
|---|---|---|
| Home in 10 secondi | `app/page.tsx` | 4 numeri, *Top 3 things to do* (con l'impatto in €), *Recent changes*. A dati vuoti: "Start by adding your purchasing data", niente zeri |
| Revisione completa stampabile | `app/report/page.tsx` | La vecchia Overview lunga: executive summary, una scheda per prodotto, spesa per fornitore/categoria, funnel |
| Ricerca globale e comandi (Ctrl/Cmd+K) | `components/shell/command.tsx`, `lib/search.ts`, `app/search/route.ts` | "paraffina" → prodotto, preventivi, acquisti, opportunità. A campo vuoto: azioni e visti di recente |
| Un solo punto per aggiungere | `components/shell/add-menu.tsx`, `components/entry/` | Purchase, Quote, Product, Supplier, Quick add, Paste from Excel, Import files. Un solo pannello laterale per tutti i form |
| Form che si compilano da soli | `components/entry/forms.tsx`, `lib/entry.ts` | Acquisto: 5 campi (fornitore, prodotto, quantità, prezzo, data). Unità dal prodotto, valuta dal fornitore, fornitore abituale dal prodotto. Sotto, calcolati: totale, prezzo precedente, variazione, impatto annuo. Il resto in *More details* |
| Creazione al volo | `Combo` in `components/form-kit.tsx`, `quickCreate*` in `app/actions.ts` | Fornitore o prodotto non trovato → *Create "XYZ"* dentro il form, senza uscirne |
| Quick add a parole | `lib/quick-add.ts` (+ test) | "Comprati 2000 kg di paraffina da ABC a 1,58€/kg il 28 settembre" → form precompilato da controllare. A regole, senza LLM; non salva mai da solo |
| Codice prodotto facoltativo | `lib/sku.ts` | Se manca lo SKU viene generato dal nome |
| Prodotto: prima la risposta | `app/products/[id]/page.tsx` | Stato, cifra in gioco, spiegazione, alternative, cosa controllare; poi grafico. Metriche, storico, fonti e specifiche in sezioni chiuse |
| Compare tipo "confronto voli" | `components/intel/supplier-comparison.tsx`, `compareColumns()` | Una colonna per fornitore, le stesse poche righe. Etichette fattuali (*Lowest quoted price*, *Shortest lead time*, *Lowest minimum order*, *Most recent quote*): mai "best" o "winner" |
| Un solo stato, 4 valori | `DecisionStatusPill` | Action · Review · Data needed · Good, ovunque |
| Tabelle leggibili | — | Poche colonne; quelle mostrate dipendono dallo spazio reale (container queries), senza scroll orizzontale |
| Errori comprensibili | `failed()` in `app/actions.ts` | Mai messaggi del database; una valuta estera senza cambio non viene più salvata a 1:1 |
| Tastiera | `components/form-kit.tsx` | Invio = campo successivo, Ctrl/Cmd+Invio = salva, Ctrl/Cmd+K = ricerca |
| Misure d'uso (predisposte) | `lib/track.ts` | Eventi in memoria (`window.__ux`), pronti per un servizio di analytics |

**Allineamento al mockup** (seconda passata): barra laterale scura e pulsanti primari blu; home con quattro riquadri con icona, *Top 3 things to do* (prodotto, cosa fare, impatto, percentuale, pulsante contestuale), *Recent changes*, e a destra *Data status* (quanti prodotti hanno qualcosa con cui essere confrontati: un rapporto vero, non un punteggio) e *Recent activity*; campanella con le sole notifiche su cui agire; riquadro azienda → **Settings** (`app/settings`, tabella `settings`, migrazione 0003: nome azienda, paese, partita IVA, il tuo nome — "Clear all data" non le tocca); pannello acquisto con le schede *Manual / In words / Paste from Excel* e il riepilogo a fianco; frase "a parole" anche nella pagina Import; Review una domanda alla volta con il blocco "N lines ready"; Compare come tabella con un fornitore per colonna; pagina prodotto con "In plain words", "Next steps" e la tabella "Prices and suppliers".

**Volutamente diverso dal mockup**: "Estimated total cost", "Market average" e "Quality" restano *Not estimated yet / Not available / Not tracked yet* (quei dati non esistono); niente Markets né Cost Simulator nel menu; nella review la confidenza è a parole, non in percentuale; niente selettore del periodo né variazione % della spesa (servirebbero 24 mesi di storico e una nuova metrica).

**Non fatto** (dichiarato, non nascosto): la valuta base resta EUR (il motore calcola solo in EUR), viste salvate personalizzate (ci sono 4 viste pronte), suggerimenti "prima volta", export PDF dedicato (c'è la stampa del browser). Cost Simulator, Markets e una pagina Quotes non esistono nel progetto.

## Lingua: inglese e italiano

L'interfaccia è in due lingue. Si sceglie dal pulsante **EN / IT** nella barra in alto (su ogni pagina) oppure da **Impostazioni → Lingua**; la scelta è salvata con i dati dell'azienda (`settings.language`, migrazione 0004) e "Clear all data" non la tocca. Un'installazione nuova parte in inglese.

Che cosa cambia lingua: menu, pagine, moduli, messaggi di errore, notifiche, ricerca, intestazioni dei CSV esportati, e anche le **frasi scritte dai motori** (stato del prodotto, "In parole semplici", prossime azioni e i loro "Perché?", sintesi iniziale, motivi delle opportunità, qualità dei dati, spiegazioni dei calcoli) e i **problemi trovati leggendo i file** (anche quelli di import già fatti: sono salvati con il loro modello e i valori, quindi si rileggono nella lingua di chi guarda).

Che cosa **non** cambia: i numeri e le date restano in formato italiano (1.234,56 · 15/09/2026) in entrambe le lingue; i dati restano come sono stati scritti (nomi di prodotti e fornitori, note, categorie). I paesi più comuni sono mostrati nella lingua scelta ("Italy" → "Italia") e, soprattutto, sono riconosciuti come lo stesso paese comunque siano scritti: due fornitori in "Italy" e "Italia" non vengono scambiati per un'importazione.

Come è fatto (`src/lib/i18n/`):

| File | Cosa contiene |
|---|---|
| `index.ts` | Il traduttore. Il testo inglese scritto nel codice è la chiave: `t("Add purchase")`. Segnaposto `{nome}`, plurali con `t.n(n, uno, molti)`, `"Open|status"` quando una parola inglese ha due significati. In italiano sistema anche l'articolo davanti ai numeri ("l'8%", "dell'11,3%", "lo 0,5%") |
| `it/engine.ts`, `it/imports.ts`, `it/ui.ts` | Il dizionario italiano (circa 1.500 voci: 1.517 oggi). **Un testo che manca qui non compila**: il tipo `Msg` è l'elenco delle chiavi |
| `client.tsx` | `useT()` per i componenti nel browser, `<Tx>` per i componenti condivisi |
| `rich.tsx` | Frasi con un elemento dentro (un numero in grassetto), tradotte intere perché l'ordine delle parole cambia |
| `i18n.test.ts` | Controlla che ogni segnaposto sopravviva alla traduzione, che lo stesso testo non sia tradotto in due modi, che i motori in italiano non lascino frasi in inglese e che **i numeri siano identici nelle due lingue** |

Sul server il traduttore si ottiene con `getT()` (`lib/data.ts`); i motori puri lo ricevono come argomento e, senza, scrivono in inglese (è quello che leggono i test esistenti, rimasti invariati).

Per aggiungere un testo: scriverlo in inglese dentro `t("…")` e aggiungere la riga italiana nel dizionario; finché manca, `npm run typecheck` segnala il punto esatto. Per aggiungere una terza lingua: un nuovo dizionario con le stesse chiavi e una voce in `LOCALES`.

Il vocabolario resta rigoroso anche in italiano: *differenza di prezzo* (nominale), *risparmio potenziale* (stima, solo prezzo), mai "risparmio realizzato", mai "miglior fornitore".

## Mercato e fornitori alternativi (Sourcing)

Per i prodotti che fanno la maggior parte della spesa (`/sourcing`, voce **Mercato**) l'app risponde a: quanto pago, a chi, cosa dicono le evidenze, chi altro potrebbe fornirmelo, cosa faccio adesso.

- **Nessun "prezzo di mercato" inventato.** Ogni prezzo porta la sua etichetta — Pagato, Preventivo, Benchmark, Dati doganali, Fattore di costo, Indicativo, Stima — e la sua fonte. Un intervallo compare solo se in archivio ci sono evidenze confrontabili (preventivi recenti, benchmark del prodotto); con una sola osservazione o con evidenze indirette si vede la posizione, non una cifra.
- **Scarto teorico, non risparmio.** "Il tuo prezzo è dal 4% al 9% sopra l'intervallo" e "€16.000–€33.000 l'anno" sono un'opportunità teorica, solo prezzo, finché un preventivo confrontabile non la conferma.
- **Fornitori candidati con fonte, non fornitori.** Un candidato arriva dalla ricerca (solo se la sua pagina dichiara il prodotto), da una ricerca fatta fuori dall'app e caricata con le sue fonti, o lo aggiungi tu indicando dove l'hai trovato. Stati: Trovato, Da valutare, Validato, Contattato, Richiesta inviata, Preventivo ricevuto, Scartato, Convertito in fornitore. Diventa un fornitore in anagrafica solo con **Converti in fornitore**. Sono raggruppati per area (il tuo paese, UE, Europa vicina e Mediterraneo, Asia, altri) e mostrati per rilevanza, non per prezzo.
- **Richieste di offerta pronte da copiare**, in italiano o in inglese, per uno o più fornitori insieme: chiedono prezzo, ordine minimo, tempi, pagamento, resa, validità e scheda tecnica; non citano il prezzo né il fornitore attuali. Da qui non parte nessuna email.
- **Un benchmark non è un mercato.** Un "intervallo di mercato" esiste solo con più osservazioni confrontabili (o un preventivo vero e confrontabile). Con un solo riferimento esterno si vede il riferimento, quanto ne dista il tuo prezzo e la frase "Nessun intervallo di mercato affidabile": niente posizione, niente cifra.
- Il costo reale (trasporto, dazi, cambi, pagamenti) non è calcolato.

## Ricerca approfondita (Deep Research)

Sui prodotti prioritari il pulsante **Ricerca approfondita** (pagina prodotto e pagina Mercato) avvia una ricerca che salva tutto con la sua fonte e non tocca mai acquisti, prezzi pagati o fornitori (`src/server/research.ts`, regole in `src/lib/research/`).

1. **Capisce che prodotto è** (`strategy.ts`): materia prima, prodotto standard, componente su misura, prodotto a marchio proprio, servizio. Da qui decide cosa ha senso cercare: benchmark e dati doganali per una materia prima, solo fornitori e preventivi per un pezzo su misura. Lo puoi cambiare a mano.
2. **Cerca possibili fornitori** con un motore di ricerca, se configurato; marketplace, elenchi e social vengono scartati (`leads.ts`).
3. **Apre il sito ufficiale** di ogni candidato e legge cosa dichiara (`inspect.ts`): se la pagina nomina il prodotto ma non la specifica ("52/54"), il candidato è "possibile, specifica da confermare"; se non nomina il prodotto, non diventa un candidato. Prezzo, ordine minimo, tempi e certificazioni non pubblicati restano "non disponibile pubblicamente".
4. **Raccoglie le evidenze di prezzo**: i riferimenti in altra valuta vengono convertiti al cambio BCE della loro data; per i prodotti comprati a peso con un codice doganale arrivano i valori medi d'importazione Eurostat, sempre come "Dati doganali", mai come prezzo di mercato.
5. **Conclude** in 5-7 righe e indica il prossimo passo. "Nessun benchmark affidabile trovato" è un risultato valido.

Ogni ricerca è una riga di storico (`research_runs`) con le sue evidenze (`research_evidence`: fonte, pagina, data di lettura, estratto, affidabilità). Non viene rifatta da sola: c'è "Aggiorna la ricerca".

**Fonti** (`src/lib/sourcing/providers.ts` le interfacce, `src/server/providers/` gli adattatori):

| Fonte | Cosa dà | Come si attiva |
|---|---|---|
| Siti dei fornitori | cosa dichiara la loro pagina | sempre attiva, gratuita |
| BCE | cambi di riferimento | sempre attiva, gratuita |
| Eurostat Comext | valori medi d'importazione per codice doganale | sempre attiva, gratuita |
| Brave Search / Tavily / SerpAPI | ricerca web di nuovi fornitori | `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY` o `SERPAPI_API_KEY` nell'ambiente del server |
| TARIC, PricePedia, Volza, Trademo, Freightos | dazi, benchmark, dati doganali, trasporti | posto previsto, adattatore non ancora scritto |

Senza una chiave di ricerca web l'app non cerca nuovi fornitori e lo dice ("non configurata"): controlla i candidati già in archivio e propone le ricerche da fare a mano. Nessuna chiave è mai nel codice. `RESEARCH_OFFLINE=1` spegne tutte le fonti.

**Costi sotto controllo** (`budget.ts`): al massimo 5 ricerche e 8 pagine per prodotto (`RESEARCH_MAX_SEARCHES`, `RESEARCH_MAX_PAGES`), limite di spesa giornaliero facoltativo (`RESEARCH_DAILY_LIMIT_EUR`), costo stimato solo se il prezzo per ricerca è dichiarato (`WEB_SEARCH_COST_PER_QUERY_EUR`). Ogni risposta esterna resta in cache (`research_cache`: 30 giorni ricerche, pagine e dati doganali, 1 giorno i cambi) e ogni chiamata è contata (`research_usage`). "Ricerca sui prodotti prioritari" mostra prima prodotti, ricerche stimate, fonti e costo, poi procede un prodotto alla volta: salva dopo ognuno e continua se uno fallisce.

## Dai candidati alla richiesta di offerta

Una ricerca può trovare molte aziende; nessuno deve leggerle tutte o scrivere a tutte. L'app le filtra da sola (`src/lib/sourcing/screening.ts`) e ne propone poche.

- **Imbuto**: ogni candidato è *non adatto*, *bassa priorità*, *trovato*, *plausibile* o *corrispondenza forte*, con il motivo. Prima la compatibilità tecnica (cosa dichiara il suo sito), poi il tipo di azienda, la distanza, la qualità della fonte. Un prezzo basso non fa salire chi non fornisce il prodotto: resta un "segnale di mercato". Niente viene cancellato, e il tuo giudizio (validato, scartato, "prodotto diverso") vince sempre sulle regole.
- **Shortlist**: al massimo 3 fornitori per prodotto (5 se i forti sono almeno 7). La pagina del prodotto mostra "5 trovate → 4 plausibili → 4 forti → 3 consigliati" e un solo pulsante: preparare la richiesta per quei 3. Gli altri sono sotto "Vedi tutti".
- **Primo giro**: il flusso si concentra sui 5 prodotti che pesano di più (`SOURCING_CONFIG.focusProducts`); anche la profondità della ricerca è proporzionale alla spesa (`limitsFor`).
- **Richieste per fornitore**: chi può coprire più prodotti riceve una sola richiesta con più righe (pagina Mercato, "Richieste per fornitore"). Le richieste sono brevi, non citano prezzo né fornitore attuali, e chiedono prezzo e scaglioni, minimo, tempi, resa, pagamento, validità, scheda tecnica, certificazioni e campioni.
- **Niente parte da sola**: copi o scarichi il testo, lo mandi tu, poi premi "Ho inviato". L'app ricorda chi è stato contattato, quando e per cosa (`rfq_requests`): a chi è stato scritto da meno di 30 giorni propone di estendere la richiesta, e dopo 10 giorni senza risposta propone un sollecito — da inviare sempre tu.
- **La risposta diventa un preventivo**: incolli l'email, l'app legge prezzo, valuta, unità, minimo, tempi, resa, pagamento e validità (`reply.ts`), tu controlli e salvi. Ciò che si può leggere in due modi ("1.420 €/t", più prezzi) resta vuoto, con le parole trovate. Salvando, il candidato entra tra i fornitori con quel preventivo.
- **Offerte a confronto**: prezzo nominale, minimo, tempi, pagamento e corrispondenza tecnica accanto a ciò che paghi oggi. Il "preventivo nominale più basso" compare solo con almeno due offerte confrontabili; il "costo reale stimato più basso" resta non disponibile finché il costo reale non viene calcolato.

## Chiudere il ciclo: richiesta → preventivo → costo reale → opportunità

- **Scheda del prodotto per la richiesta** (`rfq-spec.ts`): nome sui documenti e codice del fornitore attuale restano interni; a un altro fornitore vanno il *nome neutro*, la *specifica tecnica*, l'*applicazione* e la *scheda tecnica* allegata (`product_documents`). Stato: **Pronta**, **Pronta in parte**, **Non pronta**, con l'elenco esatto di ciò che manca. Se il prodotto è noto solo con un codice del fornitore ("WAX SER 14581"), la richiesta non si può preparare finché non lo descrivi tu: niente viene inventato.
- **Intervallo dei preventivi**: zero preventivi → non disponibile; uno → "1 preventivo ricevuto", dati insufficienti; due o più confrontabili → intervallo, posizione e scarto teorico. Benchmark e dati doganali restano visibili a parte, ognuno con la sua distanza dal tuo prezzo, e non entrano mai in una media con i preventivi.
- **Costo reale** (`true-cost.ts`): prezzo quotato + trasporto + dazio + altri costi d'importazione, al cambio dichiarato, + effetto dell'ordine minimo sulle scorte ± effetto dei termini di pagamento. Ogni voce dice da dove viene (preventivo, inserita da te, stima, inclusa nel prezzo, non si applica). Una voce necessaria che manca — il trasporto su un prezzo franco fabbrica, il dazio da fuori area doganale — rende il costo reale **incompleto**: nessun totale. Senza resa (Incoterm) compare "Resa non nota" e l'affidabilità scende. I tassi (costo del denaro, costo delle scorte) si impostano in Impostazioni; finché non lo fai valgono le ipotesi di partenza, dichiarate.
- **Confronto**: fornitore attuale accanto a ogni preventivo, voce per voce (pagina del prodotto e pagina Confronto). "Preventivo più basso" e "Costo reale stimato più basso" sono indicati separatamente. Il riferimento attuale è il prezzo di fattura, e lo dice.
- **Tre parole distinte**: *opportunità teorica* (da un benchmark o da prezzi nominali), *opportunità da validare* (preventivo vero e costo reale completo, ma con qualcosa da confermare), *opportunità validata* (anche la specifica confermata da te). *Risparmio* è solo quello che dimostra una fattura: l'app non lo calcola.
- **Risposte dei fornitori**: "1.420 €/t" e "1,420 €/t" vengono letti come 1.420 la tonnellata solo quando il prezzo che paghi oggi rende assurda l'altra lettura; altrimenti restano da scrivere a mano. Il trasporto dichiarato per unità viene letto a parte; in una risposta su più prodotti ogni prezzo va alla riga che nomina il suo prodotto, e quelli che non si capisce di chi siano non vengono assegnati.
- **Pilota** (pagina Mercato): i pochi prodotti del primo test reale — li aggiungi e togli tu — con richiesta pronta, fornitori da contattare, richieste inviate, risposte, preventivi confrontabili, miglior costo reale e opportunità.
- **Cambio dei benchmark**: un riferimento che è la media di un mese viene convertito al cambio medio BCE di quel mese, non a quello di un giorno.

**Ricerca fatta fuori dall'app**: dalla pagina Mercato si carica un file JSON (formato in `src/lib/research/file.ts`) con fornitori e riferimenti di prezzo, ognuno con la sua pagina. Prima un'anteprima, poi la conferma: entrano come candidati "trovati" e riferimenti da verificare.

## Mappatura prodotti (Product Mapper)

Dopo l'importazione i prodotti hanno il nome scritto in fattura ("ART. LC TR. Contenitori per ceri", "TL 10 15 A 1 0 P 30 CC 12 …"). La **Mappatura prodotti** (`/products/review`) li mette in ordine senza farli controllare uno per uno:

- **nome leggibile** — il codice articolo va dopo il nome, il nome del fornitore esce, le abbreviazioni si scrivono per esteso, le misure ripetute si tolgono. La descrizione originale resta collegata al prodotto come alias;
- **categoria › sottocategoria** — dalla tassonomia in `src/lib/catalog/taxonomy.ts` (cere e paraffine, stoppini, contenitori, imballaggio, etichette, prodotti finiti…); è testo, l'azienda può scrivere le sue;
- **famiglia e variante** — "Trecciolino" → TG 1204, TG 1206, ST 18/08: ogni variante resta un prodotto con i suoi acquisti e prezzi;
- **possibili doppioni** — stesso codice a barre, stesso codice articolo e stesse misure, oppure solo la nota di confezionamento diversa. Una misura diversa non è mai un doppione. Si uniscono solo se lo dici tu; "Mantieni separati" viene ricordato;
- **affidabilità** — alta (lo dice il nome: si conferma in blocco), media (letto dal contesto del fornitore: lo vedi prima di confermare), bassa (non si capisce: te lo chiede, una domanda per fornitore). I casi sono in ordine di spesa.

È un motore a regole, senza modello linguistico: quello che le regole non sanno dire viene chiesto, non indovinato. Prezzi, quantità, fornitori e date non vengono mai toccati.

Nella pagina **Prodotti**: vista Priorità (spesa alta, aumenti, fornitore unico, opportunità), indicatore 80/20, ricerca che capisce "prodotti SER", "sopra 10k", "unico fornitore", "stoppini". Gli stati sono: Azione, Da rivedere, Da classificare, Manca il prezzo, Storico da aggiornare, Serve un'alternativa, Pronto, A posto.

## Normalizzazione dei prodotti (catalogo e altre spese)

Una fattura contiene di tutto: materiali, componenti, imballaggi, ma anche trasporti, servizi, utenze, cancelleria. Tutto conta nella **spesa dell'azienda**; solo una parte è **catalogo**, cioè prodotti da confrontare e negoziare. L'import non chiede più una decisione per ogni descrizione: analizza quelle sconosciute tutte insieme e chiede solo i casi dubbi.

| Cosa | Dove | Note |
|---|---|---|
| Tipi di spesa | `lib/catalog/kinds.ts` | Materiale diretto, imballaggio, componente (catalogo) · logistica, servizio, acquisto indiretto, energia/utenze, attrezzatura, altro · da classificare. `products.kind`, modificabile dalla pagina del prodotto |
| Nomi puliti | `lib/catalog/clean.ts` | `** TRECCIOLINO ST 18/08` → `Trecciolino ST 18/08`. Codici, misure e sigle non si toccano |
| Specifiche numeriche | `lib/catalog/specs.ts` | 52/54 = 52-54; 1204 ≠ 1206. Un numero diverso è un prodotto diverso |
| Classificazione a regole | `lib/catalog/classify.ts` | Parole per tipo (italiano e inglese), in ordine di fiducia; poi che cosa vende il fornitore. Se niente lo dice, resta "da classificare": non si inventa |
| Proposta | `lib/catalog/propose.ts` | Stesso testo, o stesso codice fornitore con stesse misure → un prodotto (alta affidabilità). Stesso codice ma misure diverse, stessa descrizione da due fornitori, un solo numero che cambia → domanda. Spese non di catalogo → una voce per fornitore e tipo |
| Conferma e domande | `server/catalog.ts`, `components/import/analysis.tsx` | "Conferma tutti", poi una scheda per ogni caso dubbio, dalla spesa maggiore. Niente viene creato finché non confermi |
| Alias | tabella `product_aliases` | Ogni descrizione resta com'è scritta, con fornitore, codice fornitore, EAN, affidabilità, conferma e import d'origine. Al prossimo import viene riconosciuta da sola |
| Spesa totale | `lib/catalog/spend.ts` | Catalogo + altre spese. La Price Intelligence (`getIntel()`) lavora solo sul catalogo; i fornitori contano tutta la spesa |

Righe che non sono acquisti (note di credito, righe a importo zero) vengono **messe da parte** da sole, con il motivo, e si possono rimettere in gioco. Le righe pronte si importano subito anche se restano casi da decidere. Due righe uguali della stessa fattura sono due acquisti, distinti dal numero di riga (`purchases.invoice_line`); la stessa riga caricata due volte è un doppione.

Non c'è un modello linguistico dietro: tutto è a regole, quindi gratuito e ripetibile anche su migliaia di righe. Il punto in cui innestarne uno è `classify()`, per le sole righe che le regole lasciano "da classificare".

## Pipeline di import (Fase 2)

```
File ─▶ Estrazione ─▶ Normalizzazione ─▶ Matching ─▶ Revisione ─▶ Approvazione ─▶ Database ─▶ Dashboard
        CSV/Excel/PDF   unità, valute,     fornitori,   problemi e    solo righe
                        numeri, date        prodotti     anomalie      "ready"
```

Regola: *se è noto → si salva; se è dedotto con alta confidenza → si suggerisce; se è incerto → revisione; se è sconosciuto → vuoto.* Nessun dato inventato, nessun errore silenzioso.

| Modulo | File |
|---|---|
| Zip: aperto nel browser, un file alla volta; nomi con accenti, zip nello zip, file protetti o danneggiati segnalati | `lib/import/archive.ts`, `lib/import/files.ts` |
| Fatture elettroniche (FatturaPA): campi, sconti di riga, trasporto, tipi di documento | `lib/import/extract/einvoice.ts` |
| File firmati `.p7m`: il documento dentro la busta (la firma non viene verificata) | `lib/import/extract/p7m.ts` |
| Codici con il tipo (`AswArtFor:…`, `EAN:…`): di chi è ogni codice | `lib/import/normalize/codes.ts` |
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
  lib/i18n/           Le due lingue: traduttore, dizionario italiano, test
  lib/import/         Pipeline di import (estrazione, normalizzazione, matching, valutazione)
  lib/anomalies.ts    Regole su prezzi e quantità dei nuovi acquisti
  server/imports.ts   Servizi DB dell'import (usati da server actions e test)
  app/actions.ts      Tutte le scritture (Server Actions)
  app/…/page.tsx      Pagine: Overview (home), Products, Suppliers, Compare, Opportunities, Import, Review, Purchases, Report
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

## Summary engine: la sintesi per il titolare

Home (`/`) e revisione completa (`/report`) leggono lo stesso motore: prodotto per prodotto, cosa paghi, a chi, come si è mosso il prezzo, con cosa si può confrontare, quali alternative esistono, quanto c'è in gioco, cosa manca e cosa controllare per primo. In linguaggio semplice; i termini tecnici stanno nei tooltip.

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

## Dati prodotto (Procurement Product Dataset)

Per i prodotti prioritari (il Pareto esistente) l'app costruisce una scheda standard — identità, tecnica, acquisti, condizioni commerciali, qualità — con tutto ciò che è già nel database: fatture, preventivi, anagrafiche, documenti, descrizione per le richieste d'offerta. Ogni campo è **confermato** (documento, persona, o semplice aritmetica sulle fatture), **stimato** (inferenza del software, con il metodo: mediana per l'ordine tipico, volume annualizzato da uno storico più corto di un anno) o **mancante**: nulla viene inventato. La pagina prodotto mostra la completezza per area, cosa manca e a chi chiederlo (in azienda o al fornitore attuale), e un modulo breve per completare o confermare le stime; `/products/data` mostra i prodotti prioritari e il giro di completamento dei Top 5. I valori scritti finiscono dove il resto dell'app li legge (richieste d'offerta, ricerca, costo reale); `product_data_fields` conserva chi li ha scritti, quando, e la stima che hanno sostituito. L'export CSV è una copia per la revisione offline: la fonte resta il database.

## Demo su GitHub Pages

Ogni push su `main` lancia `.github/workflows/pages.yml`: l'app parte con i dati demo, `scripts/snapshot.mjs` salva ogni pagina come HTML statico e il risultato viene pubblicato su https://fico-azienda.github.io/procurement-intelligence/. È una demo in sola lettura: import, moduli, salvataggi e download richiedono il server e lì non funzionano.
