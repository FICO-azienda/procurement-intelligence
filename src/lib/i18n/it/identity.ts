/** Product identity: who sold it and how it calls it, kept apart from what the product is; the cleanup; merges that can be taken back. */
export const identity = {
  // ---- The cleanup page
  "Product cleanup": "Pulizia prodotti",
  "An invoice says who sold it and how the seller calls it; what the product is has to be read out of it. We read it for every product: you confirm what is sure, look at what is in doubt, and say what nothing on file can tell.": "Una fattura dice chi ha venduto e come il venditore chiama la merce; cosa sia il prodotto va letto da lì. Lo abbiamo letto per ogni prodotto: tu confermi ciò che è sicuro, guardi ciò che è in dubbio, e dici ciò che nulla in archivio può dire.",
  "Confirmed|cleanup": "Confermato",
  "Auto-confident": "Sicuro",
  "Needs classification": "Da identificare",
  "How we read your {n} largest products": "Come abbiamo letto i tuoi {n} prodotti più grandi",
  "{confident} safe to confirm together · {review} to look at · {unclassified} we cannot tell what they are · {done} confirmed already": "{confident} sicuri, da confermare insieme · {review} da guardare · {unclassified} di cui non sappiamo dire cosa siano · {done} già confermati",
  "The rest of the catalogue": "Il resto del catalogo",
  "{n} more product, read the same way": "{n} altro prodotto, letto allo stesso modo",
  "{n} more products, read the same way": "altri {n} prodotti, letti allo stesso modo",
  "On the invoices": "Sulle fatture",
  "Product, as we read it": "Prodotto, come lo abbiamo letto",
  "Family and category": "Famiglia e categoria",
  "Supplier's own codes": "Codici del fornitore",
  "written {n} other way": "scritto in {n} altro modo",
  "written {n} other ways": "scritto in altri {n} modi",
  "Not named yet: it is not known what it is": "Non ancora nominato: non si sa cosa sia",
  "“{words}” is the supplier, not the product": "“{words}” è il fornitore, non il prodotto",
  "No category yet": "Ancora nessuna categoria",
  "confidence: {level}": "affidabilità: {level}",

  // ---- What the reading says
  "The words say it is {what}, not which one. {codes}: how {supplier} calls it, not what it is made of. It keeps its name until a data sheet or your answer says what it is.": "Le parole dicono che è {what}, non quale. {codes}: è come lo chiama {supplier}, non di cosa è fatto. Tiene il suo nome finché una scheda tecnica o una tua risposta non dice cos'è.",
  "Only the article code of {supplier} ({code}) tells it apart from the others: the code stays in the name until a size or a specification is on file.": "Solo il codice articolo di {supplier} ({code}) lo distingue dagli altri: il codice resta nel nome finché non c'è in archivio una misura o una specifica.",

  // ---- The question
  "Needs technical identification": "Serve l'identificazione tecnica",
  "Do you know which description fits best?": "Sai quale descrizione si adatta meglio?",
  "Something else: choose it from the list below. If you don't know yet, leave it: it keeps the name it has and waits here.": "Altro: sceglilo dall'elenco qui sotto. Se non lo sai ancora, lascialo: tiene il nome che ha e aspetta qui.",
  "Have the technical data sheet? Add it on the product's page.": "Hai la scheda tecnica? Aggiungila nella pagina del prodotto.",
  "The name it will have — the supplier's code stays in it until a grade or a specification is known. Change it if you know better.": "Il nome che avrà — il codice del fornitore resta finché non si conosce un grado o una specifica. Cambialo se ne sai di più.",
  "Vegetable wax": "Cera vegetale",
  "Candle wax blend": "Miscela di cere per candele",
  "Wax blend": "Miscela di cere",

  // ---- Import: the same product from someone else
  "Supplier's own code in the description": "Codice del fornitore nella descrizione",
  "Same product by what it is: the same thing in the same grade, the supplier's name and codes aside": "Stesso prodotto per quello che è: la stessa cosa nello stesso grado, a parte nome e codici del fornitore",
  "Looks like a product you already have: the same thing in the same grade, described with other words": "Sembra un prodotto che hai già: la stessa cosa nello stesso grado, descritta con altre parole",

  // ---- Merges
  "Products you merged": "Prodotti che hai unito",
  "{n} merge, which can be taken back": "{n} unione, che si può annullare",
  "{n} merges, each of which can be taken back": "{n} unioni, ciascuna annullabile",
  "is read as": "è letto come",
  "This merge is no longer in force.": "Questa unione non è più in vigore.",
} as const;
