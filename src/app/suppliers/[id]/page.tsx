import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { PurchaseDialog, QuoteDialog, SupplierDialog } from "@/components/dialogs";
import { Remember } from "@/components/shell/recent";
import { DuplicateSuggestion, UndoMergeButton } from "@/components/suppliers/resolution";
import { getDb } from "@/db";
import { catalogueOf } from "@/lib/catalog/spend";
import { LEVEL_LABEL } from "@/lib/negotiation/engine";
import { BASIS_LABEL, type MatchBasis } from "@/lib/suppliers/resolve";
import { canonicalSupplierId, readResolution, supplierIdentity, supplierRelationship } from "@/server/suppliers";
import { Basis, Crumbs, Delta, Disclosure, Empty, PageHeader, Section, SupplierStatusBadge, Table, Td, Th, rowClass } from "@/components/ui";
import { basePrice, isPriced, priceChange, supplierMetrics, supplierOrderStats, todayISO } from "@/lib/analytics";
import { countryName } from "@/lib/countries";
import { KIND_LABEL } from "@/lib/catalog/kinds";
import { getDataset, getIntel, getLearning, getSpend, getT } from "@/lib/data";
import { SourceTag } from "@/components/import/labels";
import * as f from "@/lib/format";
import { lowerFirst } from "@/lib/i18n";
import { lookups } from "@/lib/lookups";

export async function generateMetadata({ params }: PageProps<"/suppliers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [data, t] = await Promise.all([getDataset(), getT()]);
  return { title: data.suppliers.find((s) => s.id === id)?.name ?? t("Supplier") };
}

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const [data, learning, intel, spend, t] = await Promise.all([getDataset(), getLearning(), getIntel(), getSpend(), getT()]);
  const otherSpend = spend.items.filter((i) => i.supplierIds.includes(id));
  const supplier = data.suppliers.find((s) => s.id === id);
  const si = intel.suppliers.find((s) => s.supplier.id === id);
  const db = await getDb();
  if (!supplier || !si) {
    // A record merged into another: its page is the page of the company it is read as.
    const canonical = await canonicalSupplierId(db, id);
    if (canonical !== id && data.suppliers.some((s) => s.id === canonical)) redirect(`/suppliers/${canonical}`);
    notFound();
  }
  const [identity, relationship, resolution] = await Promise.all([supplierIdentity(db, id), supplierRelationship(db, id, data, catalogueOf(data), t), readResolution(db, t)]);
  const duplicates = [...resolution.suggestions, ...resolution.weak].filter((x) => x.keep === id || x.merge === id);
  const named = (rid: string) => {
    const r = resolution.names.get(rid)!;
    return { id: rid, name: r.name, detail: [r.vatNumber ? t("VAT {vat}", { vat: r.vatNumber }) : t("no VAT number"), countryName(r.country, t.locale), t.n(r.records, "{n} line", "{n} lines")].filter(Boolean).join(" · ") };
  };
  const lev = relationship.leverage;

  const asOf = todayISO();
  const l = lookups(data);
  const country = countryName(supplier.country, t.locale);
  const payment = f.paymentTerms(supplier.paymentTermsDays, t);
  const m = supplierMetrics(supplier, data, asOf);
  const stats = supplierOrderStats(supplier.id, data.purchases, asOf);
  const aliases = learning.supplierAliases.filter((a) => a.supplierId === supplier.id);
  const own = data.purchases
    .filter((p) => p.supplierId === supplier.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const ownQuotes = data.quotes
    .filter((q) => q.supplierId === supplier.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const supplied = m.productIds
    .map((pid) => {
      const product = l.product(pid)!;
      const fromSupplier = own.filter((p) => p.productId === pid);
      return { product, change: priceChange(fromSupplier, asOf), count: fromSupplier.length };
    })
    .filter((r) => r.product)
    .sort((a, b) => a.product.name.localeCompare(b.product.name));

  return (
    <>
      <Remember kind="supplier" id={supplier.id} title={supplier.name} />
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/suppliers", label: t("Suppliers") }]} />}
        title={supplier.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{[supplier.city, country].filter(Boolean).join(", ") || "—"}</span>
            <SupplierStatusBadge status={m.status} />
          </span>
        }
        actions={
          <>
            <SupplierDialog
              supplier={supplier}
              deleteNote={t("Also deletes {purchases} and {quotes}.", { purchases: t.n(own.length, "{n} purchase", "{n} purchases"), quotes: t.n(ownQuotes.length, "{n} quote", "{n} quotes") })}
              trigger={{ label: t("Edit"), variant: "ghost" }}
            />
            <QuoteDialog defaultSupplierId={supplier.id} trigger={{ label: t("Add quote") }} />
            <PurchaseDialog defaultSupplierId={supplier.id} trigger={{ label: t("Add purchase") }} />
          </>
        }
      />

      {/* The supplier in four numbers */}
      <section aria-label={t("Key figures")} className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule xl:grid-cols-4">
        <Figure label={t("Annual spend")} value={f.money(Math.round(m.annualSpend))} note={si.spendShare > 0 ? t("{pct}% of what you buy", { pct: f.number(si.spendShare * 100, 0) }) : t("No purchases in 12 months")} />
        <Figure label={t("Products")} value={String(m.productIds.length)} note={m.quotedProductIds.length ? t("{n} with a quote on file", { n: m.quotedProductIds.length }) : t("bought from this supplier")} />
        <Figure
          label={t("Price movement")}
          value={si.priceChange.weightedPct == null ? "—" : f.pct(si.priceChange.weightedPct)}
          note={t("this year, weighted by spend")}
          tone={si.priceChange.weightedPct != null && Number(si.priceChange.weightedPct.toFixed(1)) > 0 ? "up" : undefined}
        />
        <Figure label={t("Orders")} value={String(stats.ordersLast12m)} note={stats.averageOrderValue != null ? t("{amount} on average", { amount: f.money(Math.round(stats.averageOrderValue)) }) : t("in the last 12 months")} />
      </section>

      {duplicates.length > 0 && (
        <Section className="mb-6" title={t("This supplier may be on file twice")} description={t("Merging reads one record as the other: both stay on file with their invoices, and it can be undone.")} flush>
          <ul className="border-t border-rule">
            {duplicates.map((x) => (
              <DuplicateSuggestion key={`${x.keep}|${x.merge}`} pair={{ keep: named(x.keep), merge: named(x.merge), why: x.why, confidence: x.confidence, conflicts: x.conflicts }} />
            ))}
          </ul>
        </Section>
      )}

      {/* Who it is: one company, whatever name a document writes. */}
      {identity && (
        <Section className="mb-6" title={t("Who this supplier is")} description={t("One company, whatever name a document writes: recognised by its VAT number first, then by the names confirmed.")}>
          <dl className="grid gap-x-8 gap-y-2 text-[13px] @2xl:grid-cols-2">
            {[
              [t("VAT number"), identity.vatNumbers.join(", ")],
              [t("Tax code"), identity.taxCodes.join(", ")],
              [t("Web domain"), identity.domains.join(", ")],
              [t("Address"), identity.addresses.map((a) => [a.city, countryName(a.country, t.locale)].filter(Boolean).join(", ")).join(" · ")],
              [t("Contacts"), identity.contacts.join(" · ")],
              [t("Records on file"), `${t.n(identity.purchases, "{n} purchase", "{n} purchases")} · ${t.n(identity.quotes, "{n} quote", "{n} quotes")}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-rule pb-1.5">
                <dt className="text-ink-3">{label}</dt>
                <dd className={value ? "text-right font-medium" : "text-ink-4"}>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <h3 className="text-[13px] font-semibold">{t("Names it is known by")}</h3>
            {identity.aliases.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">{t("Only one: every document on file writes “{name}”.", { name: identity.canonicalName })}</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {identity.aliases.map((a) => (
                  <li key={a.name} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-[12.5px] text-ink-3">
                      {[a.source === "record" ? t("a supplier record merged into this one") : a.source === "alias" ? t("a name you confirmed") : t("as written on documents"), a.lines ? t.n(a.lines, "{n} line", "{n} lines") : null, a.vatNumber ? t("VAT {vat}", { vat: a.vatNumber }) : null].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12.5px] text-ink-3">
              {t("Lines tied to this company: {vat} by VAT number, {name} by name, {other} entered by hand or otherwise.", { vat: identity.matched.byVat, name: identity.matched.byName, other: identity.matched.other })}{" "}
              {identity.documents.length > 0 && t.n(identity.documents.length, "Read from {n} document.", "Read from {n} documents.")}
            </p>
          </div>
          {identity.merged.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[13px] font-semibold">{t("Records merged into this one")}</h3>
              <ul className="mt-1.5 divide-y divide-rule text-[13px]">
                {identity.merged.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
                    <span>
                      <span className="font-medium">{m.name}</span>{" "}
                      <span className="text-[12.5px] text-ink-3">
                        {[m.vatNumber ? t("VAT {vat}", { vat: m.vatNumber }) : null, t.n(m.lines, "{n} line", "{n} lines"), m.basis.map((b) => lowerFirst(t(BASIS_LABEL[b as MatchBasis] ?? "Similar name"))).join(", "), m.decidedBy === "auto" ? t("merged automatically on {date}", { date: f.date(m.at.slice(0, 10)) }) : t("merged by you on {date}", { date: f.date(m.at.slice(0, 10)) })].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <UndoMergeButton supplierId={m.id} />
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-ink-3">{t("A merged record keeps its name, its invoices and its quotes: nothing was moved, so a merge can always be taken back.")}</p>
            </div>
          )}
          {identity.history.length > 0 && (
            <Disclosure className="mt-4" title={t("Decisions taken")} description={t.n(identity.history.length, "{n} decision on file", "{n} decisions on file")}>
              <ul className="space-y-1 text-[13px] text-ink-2">
                {identity.history.map((h, i) => (
                  <li key={i}>
                    {h.decision === "separate" ? t("Kept separate from {name} on {date}.", { name: h.name, date: f.date(h.at.slice(0, 10)) }) : t("Merged with {name} on {date}, taken back on {undone}.", { name: h.name, date: f.date(h.at.slice(0, 10)), undone: f.date((h.undoneAt ?? h.at).slice(0, 10)) })}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </Section>
      )}

      {/* Everything bought from it, over every name it is known by. */}
      <Section className="mb-6" title={t("The whole relationship")} description={t("Everything you buy from this company, over every name it is known by: what the leverage on each of its products is read from.")}>
        <dl className="grid gap-x-8 gap-y-2 text-[13px] @2xl:grid-cols-2">
          {[
            [t("Total spend, last 12 months"), f.money(Math.round(relationship.totalSpend))],
            [t("Historical spend on file"), relationship.firstPurchase ? t("{amount} since {date}", { amount: f.money(Math.round(relationship.historicalSpend)), date: f.date(relationship.firstPurchase) }) : "—"],
            [t("Products purchased"), String(relationship.products.length)],
            [t("Categories bought"), lev ? `${lev.facts.groups.length} (${lev.facts.groups.map((g) => (g.label ? t(g.label) : g.name)).join(", ")})` : "—"],
            [t("Purchase frequency"), lev ? lev.parts.find((x) => x.key === "regularity")!.fact : "—"],
            [t("Quotes on file"), String(relationship.quotes)],
            [t("Requests for quotation sent"), String(relationship.requests)],
            [t("Spend beyond its largest product"), lev ? `${f.money(Math.round(lev.onFile.cross))} (${lev.productName})` : "—"],
            [t("Relationship breadth"), lev ? t(LEVEL_LABEL[lev.breadth]) : "—"],
            [t("Supplier relationship leverage"), lev ? `${t("{score} out of 10", { score: f.number(lev.score, 1) })} · ${t(LEVEL_LABEL[lev.level])}` : "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-rule pb-1.5">
              <dt className="text-ink-3">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {lev && (
          <p className="mt-2 text-[12.5px] text-ink-3">
            {t("The leverage is read on its largest product and is a lever at the table, never a discount.")}{" "}
            <Link href={`/products/${lev.productId}#negotiation`} className="font-medium text-ledger hover:underline">
              {t("View leverage analysis")}
            </Link>
          </p>
        )}
        {relationship.products.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-rule">
            <Table>
              <thead>
                <tr>
                  <Th className="border-t-0">{t("Current products")}</Th>
                  <Th className="border-t-0" align="right">{t("Spend, 12 months")}</Th>
                  <Th className="border-t-0" align="right">{t("Share")}</Th>
                </tr>
              </thead>
              <tbody>
                {relationship.products.map((x) => (
                  <tr key={x.id} className={rowClass(true)}>
                    <Td className="whitespace-normal! font-medium">
                      <Link href={`/products/${x.id}`} className="stretched">
                        {x.name}
                      </Link>
                    </Td>
                    <Td align="right">{f.money(Math.round(x.spend))}</Td>
                    <Td align="right" muted>{`${f.number(x.share * 100, 0)}%`}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {relationship.byMonth.length > 1 && (
          <Disclosure className="mt-4" title={t("Spend by month")} description={t.n(relationship.byMonth.length, "{n} month on file", "{n} months on file")}>
            <ul className="grid gap-x-8 gap-y-1 text-[13px] @2xl:grid-cols-2">
              {relationship.byMonth.map((x) => (
                <li key={x.month} className="flex justify-between gap-4 border-b border-rule pb-1">
                  <span className="text-ink-2">{f.month(`${x.month}-01`, t)}</span>
                  <span className="num font-medium">{f.money(Math.round(x.spend))}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </Section>

      {/* Key observations: what a buyer would point out */}
      <Section title={t("Key observations")} className="mb-6">
        <ul className="max-w-3xl list-disc space-y-1 pl-4 text-[14px] leading-relaxed text-ink-2 marker:text-ink-4">
          {si.summary.map((x) => (
            <li key={x}>{x}</li>
          ))}
          {stats.priceIncreases > 0 && (
            <li>{t.n(stats.priceIncreases, "{n} product has gone up in price over 12 months.", "{n} products have gone up in price over 12 months.")}</li>
          )}
        </ul>
      </Section>

      {(si.singleSourcedHighSpend.length > 0 || si.productsWithAlternatives.length > 0) && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title={t("Dependency")} description={t("High-spend products bought only from this supplier")}>
            {si.singleSourcedHighSpend.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("No high-spend product depends on this supplier alone.")}</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {si.singleSourcedHighSpend.map((pid) => {
                  const pi = intel.products.find((p) => p.product.id === pid)!;
                  return (
                    <li key={pid} className="flex items-baseline justify-between gap-4">
                      <Link href={`/products/${pid}`} className="font-medium hover:text-ledger">
                        {pi.product.name}
                      </Link>
                      <span className="num text-ink-2">
                        {f.money(pi.metrics.annualSpend)} · {t("{pct}% of total spend", { pct: f.number(pi.spendShare * 100, 0) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title={t("Alternatives on file")} description={t("Products of this supplier with a recent quote from someone else")}>
            {si.productsWithAlternatives.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("No recent alternative quotes for this supplier's products.")}</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {si.productsWithAlternatives.map((pid) => {
                  const pi = intel.products.find((p) => p.product.id === pid)!;
                  return (
                    <li key={pid} className="flex items-baseline justify-between gap-4">
                      <Link href={`/compare?product=${pid}`} className="font-medium hover:text-ledger">
                        {pi.product.name}
                      </Link>
                      <span className="num text-ink-2">
                        {pi.bestSaving ? t("{pct} lowest comparable quote", { pct: f.pct(-pi.bestSaving.priceDifferencePct!) }) : t("no lower comparable quote")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      )}

      <Section title={t("Products supplied")} description={t("The price is the last one paid to this supplier")} flush>
        {supplied.length === 0 ? (
          <Empty title={t("Nothing bought yet")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("Product")}</Th>
                <Th align="right">{t("Price")}</Th>
                <Th align="right">{t("12 months")}</Th>
                <Th className="hidden @2xl:table-cell" align="right">{t("Purchases")}</Th>
                <Th className="hidden @2xl:table-cell">{t("Last purchase")}</Th>
              </tr>
            </thead>
            <tbody>
              {supplied.map(({ product, change, count }) => (
                <tr key={product.id} className={rowClass(true)}>
                  <Td className="font-medium">
                    <Link href={`/products/${product.id}`} className="stretched">
                      {product.name}
                    </Link>
                  </Td>
                  <Td align="right" className="font-medium">
                    {change.currentPrice != null ? `${f.priceShort(change.currentPrice)}/${product.unit}` : "—"}
                  </Td>
                  <Td align="right">
                    <Delta value={change.changePct} className="justify-end" />
                  </Td>
                  <Td align="right" muted className="hidden @2xl:table-cell">{count}</Td>
                  <Td muted className="num hidden @2xl:table-cell">{f.date(change.currentDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="mt-6 space-y-3">
      {otherSpend.length > 0 && (
        <Section title={t("Other company spend")} description={t("Not products to compare: counted in the spend with this supplier")} className="mb-6">
          <ul className="space-y-1.5 text-[13.5px]">
            {otherSpend.map((i) => (
              <li key={i.product.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <Link href={`/products/${i.product.id}`} className="min-w-0 font-medium hover:text-ledger">
                  {i.product.name}
                </Link>
                <span className="text-ink-3">
                  {t(KIND_LABEL[i.kind])} · {t.n(i.lines, "{n} invoice line", "{n} invoice lines")} · <span className="num font-medium text-ink">{f.money(Math.round(i.annualSpend))}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Disclosure title={t("Purchase history")} description={t.n(own.length, "{n} purchase", "{n} purchases")} flush>
        {own.length === 0 ? (
          <Empty title={t("No purchases from this supplier")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Date")}</Th>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="border-t-0" align="right">{t("Quantity")}</Th>
                <Th className="border-t-0" align="right">{t("Unit price")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Total")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("Source")}</Th>
                <Th className="w-10 border-t-0" />
              </tr>
            </thead>
            <tbody>
              {own.map((p) => (
                <tr key={p.id} className={rowClass()}>
                  <Td className="num">{f.date(p.date)}</Td>
                  <Td>
                    <Link href={`/products/${p.productId}`} className="hover:text-ledger">
                      {l.product(p.productId)?.name}
                    </Link>
                  </Td>
                  <Td align="right">{f.quantity(p.quantity, p.unit)}</Td>
                  <Td align="right" className="font-medium">{f.price(p.unitPrice, p.currency)}</Td>
                  <Td align="right" className="hidden @2xl:table-cell">{f.money(p.totalAmount, p.currency)}</Td>
                  <Td className="hidden @4xl:table-cell">
                    <SourceTag source={p.source} doc={p.sourceDoc} />
                    {p.invoiceReference && <span className="ml-1.5 text-[12px] text-ink-3">{p.invoiceReference}</span>}
                  </Td>
                  <Td>
                    <PurchaseDialog purchase={p} trigger={{ label: t("Edit purchase"), iconOnly: true }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Disclosure>

      <Disclosure title={t("Quotes")} description={ownQuotes.length ? t.n(ownQuotes.length, "{n} quote", "{n} quotes") : t("None on file")} flush>
        {ownQuotes.length === 0 ? (
          <Empty title={t("No quotes from this supplier yet")} body={t("Add one to compare their price with what you pay.")} action={<QuoteDialog defaultSupplierId={supplier.id} trigger={{ label: t("Add quote") }} />} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Date")}</Th>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="border-t-0" align="right">{t("Quoted price")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Minimum order")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Lead time")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("Payment")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("Valid until")}</Th>
                <Th className="w-10 border-t-0" />
              </tr>
            </thead>
            <tbody>
              {ownQuotes.map((q) => {
                const product = l.product(q.productId);
                return (
                  <tr key={q.id} className={rowClass()}>
                    <Td className="num">{f.date(q.date)}</Td>
                    <Td>{product?.name}</Td>
                    <Td align="right" className="font-medium">
                      {f.price(q.unitPrice, q.currency)}
                      {q.currency !== "EUR" && isPriced(q) && <span className="ml-1 text-ink-3">({f.price(basePrice(q))})</span>}
                    </Td>
                    <Td align="right" muted className="hidden @2xl:table-cell">{q.moq != null ? f.quantity(q.moq, product?.unit) : "—"}</Td>
                    <Td align="right" muted className="hidden @2xl:table-cell">{f.days(q.leadTimeDays, t)}</Td>
                    <Td muted className="hidden @4xl:table-cell">
                      {f.paymentTerms(q.paymentTermsDays, t)} {q.incoterm && <Basis>{q.incoterm}</Basis>}
                    </Td>
                    <Td muted className="num hidden @4xl:table-cell">{f.date(q.validUntil)}</Td>
                    <Td>
                      <QuoteDialog quote={q} trigger={{ label: t("Edit quote"), iconOnly: true }} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Disclosure>

      <Disclosure title={t("Contacts and terms")} description={[country, payment !== "—" ? t("payment {terms}", { terms: payment.toLowerCase() }) : null].filter(Boolean).join(" · ")}>
        <dl className="grid grid-cols-1 gap-x-10 text-[13px] sm:grid-cols-2">
          <Row label={t("Country")}>{country ?? "—"}</Row>
          <Row label={t("City")}>{supplier.city ?? "—"}</Row>
          <Row label={t("VAT number")}>{supplier.vatNumber ?? "—"}</Row>
          <Row label={t("Contact person")}>{supplier.contactName ?? "—"}</Row>
          <Row label={t("Email")}>
            {supplier.email ? (
              <a href={`mailto:${supplier.email}`} className="text-ledger hover:underline">
                {supplier.email}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label={t("Phone")}>{supplier.phone ?? "—"}</Row>
          <Row label={t("Payment terms")}>{payment}</Row>
          <Row label={t("Usual lead time")}>{f.days(supplier.defaultLeadTimeDays, t)}</Row>
          <Row label={t("Invoices in")}>{supplier.currency}</Row>
        </dl>
        {supplier.notes && <p className="mt-3 text-[12.5px] text-ink-3">{supplier.notes}</p>}
        {aliases.length > 0 && (
          <div className="mt-3 text-[12.5px] text-ink-3">
            {t("Also written as:")} <span className="text-ink-2">{aliases.map((a) => a.alias).join(" · ")}</span>
          </div>
        )}
      </Disclosure>
      </div>

    </>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" }) {
  return (
    <div className="bg-canvas p-4 sm:p-5">
      <div className={`num text-[26px] leading-none font-semibold tracking-[-0.025em] ${tone === "up" ? "text-up" : ""}`}>{value}</div>
      <div className="mt-2 text-[13px] font-medium text-ink-2">{label}</div>
      {note && <div className="mt-0.5 text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}
