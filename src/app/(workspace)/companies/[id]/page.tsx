import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { CompanyPairDecision, ContactForm, RELATION_LABEL, RelateCompanyForm, RemoveContact, UndoRelation } from "@/components/companies/companies";
import { Crumbs, Disclosure, PageHeader, Section } from "@/components/ui";
import { getDb } from "@/db";
import { ROLE_LABEL, roleChips } from "@/lib/companies/labels";
import { countryName } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { MATCH_CONFIDENCE_LABEL } from "@/lib/suppliers/resolve";
import { readCompanies, readCompany, syncCompanies } from "@/server/companies";

export async function generateMetadata({ params }: PageProps<"/companies/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const c = await readCompany(await getDb(), id);
  return { title: c?.name ?? (await getT())("Companies") };
}

/**
 * One company and every part it plays for the buyer, each with the way to its own page; its identifiers, the people
 * to talk to, and what a person said of it and other companies. Nothing on this page changes a supplier, a
 * candidate, a directory record, a reply or a purchase.
 */
export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  await syncCompanies(db);
  const t = await getT();
  const c = await readCompany(db, id, t);
  if (!c) notFound();
  // A company read as another: its page is the other's.
  if (c.id !== id) redirect(`/companies/${c.id}`);
  const others = (await readCompanies(db, t)).companies.filter((x) => x.id !== c.id).map((x) => ({ id: x.id, name: x.name, hint: [countryName(x.country, t.locale), x.domain].filter(Boolean).join(" · ") }));
  const facts: [string, string | null][] = [
    [t("VAT number"), c.vatNumber],
    [t("Tax code"), c.taxCode],
    [t("Country"), countryName(c.country, t.locale)],
    [t("City"), c.city],
    [t("Website"), c.website ?? c.domain],
    [t("Spend, last 12 months"), c.spend > 0 ? f.money(Math.round(c.spend)) : null],
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/suppliers", label: t("Suppliers") }, { href: "/companies", label: t("Companies") }]} />}
        title={c.name}
        meta={roleChips(t, c.roles).join(" · ") || t("No role on file")}
      />

      <Section className="mb-5" title={t("Who it is")} description={t("Read from its records: an identifier fills a gap, it never replaces one.")}>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] @xl:grid-cols-2 @4xl:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[12px] text-ink-3">{label}</dt>
              <dd className={value ? "font-medium" : "text-ink-4"}>{value ?? t("not on file")}</dd>
            </div>
          ))}
        </dl>
        {c.otherNames.length > 0 && (
          <p className="mt-3 text-[12.5px] text-ink-3">
            {t("Also written as")}: {c.otherNames.join(" · ")}
          </p>
        )}
      </Section>

      <Section className="mb-5" title={t("What it is to you")} description={t("Each part it plays keeps its own data on its own page.")} flush>
        <ul className="border-t border-rule">
          {c.list.map((r) => (
            <li key={`${r.kind}:${r.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-rule px-5 py-2.5 text-[13px] last:border-b-0">
              <span>
                <span className="font-medium">{t(ROLE_LABEL[r.kind])}</span>
                {r.detail && <span className="text-ink-3"> · {r.detail}</span>}
                {r.name !== c.name && <span className="text-ink-3"> · {t("as “{name}”", { name: r.name })}</span>}
              </span>
              <Link href={r.href} className="font-medium text-ledger hover:underline">
                {t("Open")}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {c.proposals.length > 0 && (
        <Section className="mb-5" title={t("It may be the same company as")} description={t("Proposed for a shared site or the same name: nothing is merged until you say so.")} flush>
          <ul className="border-t border-rule">
            {c.proposals.map((p) => (
              <li key={p.other.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-5 py-3 last:border-b-0">
                <div className="min-w-[220px] flex-1 text-[13.5px]">
                  <Link href={`/companies/${p.other.id}`} className="font-medium hover:text-ledger">
                    {p.other.name}
                  </Link>
                  <div className="mt-0.5 text-[12.5px] text-ink-3">
                    {t(MATCH_CONFIDENCE_LABEL[p.confidence])} · {p.why}
                  </div>
                </div>
                <CompanyPairDecision a={c.id} b={p.other.id} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section className="mb-5" title={t("People to talk to")} description={t("Written by a person, or read from its records with where they come from. Nothing is made up.")}>
        {c.contactList.length + c.recordContacts.length === 0 ? (
          <p className="mb-4 text-[13px] text-ink-3">{t("No contact on file.")}</p>
        ) : (
          <ul className="mb-4 space-y-1.5 text-[13px]">
            {c.contactList.map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{x.name ?? x.email}</span>
                {x.role && <span className="text-ink-3">{x.role}</span>}
                {x.email && <a href={`mailto:${x.email}`} className="text-ledger hover:underline">{x.email}</a>}
                {x.phone && <span className="num">{x.phone}</span>}
                <span className="text-[12px] text-ink-4">{t("written by {who}", { who: x.createdBy ?? "—" })}</span>
                <RemoveContact id={x.id} />
              </li>
            ))}
            {c.recordContacts.map((x, i) => (
              <li key={`r${i}`} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{x.name ?? x.email ?? x.phone}</span>
                {x.email && x.name && <a href={`mailto:${x.email}`} className="text-ledger hover:underline">{x.email}</a>}
                {x.phone && (x.name || x.email) && <span className="num">{x.phone}</span>}
                <span className="text-[12px] text-ink-4">{t("from its record “{role}”", { role: t(ROLE_LABEL[x.kind]) })}</span>
              </li>
            ))}
          </ul>
        )}
        <Disclosure title={t("Add a contact")}>
          <ContactForm companyId={c.id} />
        </Disclosure>
      </Section>

      <Section className="mb-5" title={t("Other companies")} description={t("Of one group, controlled by it, distributing it, or simply another company: said by a person, with the reason. Never a merge.")}>
        {c.relations.length + c.merged.length > 0 && (
          <ul className="mb-4 space-y-1.5 text-[13px]">
            {c.relations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-ink-3">{t(RELATION_LABEL[r.relation])}</span>
                <Link href={`/companies/${r.other.id}`} className="font-medium hover:text-ledger">
                  {r.other.name}
                </Link>
                {r.note && <span className="text-ink-3">· {r.note}</span>}
                <span className="text-[12px] text-ink-4">{t("{who}, {date}", { who: r.decidedBy, date: f.date(r.createdAt.slice(0, 10)) })}</span>
                <UndoRelation id={r.id} />
              </li>
            ))}
            {c.merged.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-ink-3">{t("Read as this company")}</span>
                <span className="font-medium">{m.name}</span>
                {m.relationId && <UndoRelation id={m.relationId} label={t("Take the merge back")} />}
              </li>
            ))}
          </ul>
        )}
        <RelateCompanyForm companyId={c.id} others={others} />
      </Section>
    </>
  );
}
