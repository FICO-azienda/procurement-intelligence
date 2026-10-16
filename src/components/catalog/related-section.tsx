import Link from "next/link";
import * as f from "@/lib/format";
import type { Msg, T } from "@/lib/i18n";
import { ARTICLE_LINK_LABEL } from "@/lib/catalog/articles";
import { RELATION_TYPE_LABEL } from "@/lib/catalog/technical";
import type { ProductArticle } from "@/server/articles";
import type { ProductRelations } from "@/server/relations";
import { Section, cx } from "../ui";
import { RelationDecision, WithdrawRelation } from "./relations";

const SOURCE_LABEL: Record<string, Msg> = { invoice: "from the invoices", offer: "from an offer", portal: "from the portal", price_list: "from a price list", manual: "written by hand" };

/**
 * One product and the articles of the suppliers that are it or could stand for it, then the buyer's other products
 * it is related to. The app proposes from one technical engine; what a person said is shown with who and when.
 */
export function RelatedSection({ t, productId, articles, relations }: { t: T; productId: string; articles: ProductArticle[]; relations: ProductRelations }) {
  const decided = (by: string | null) => (by === "import" ? t("an invoice approved at import") : by === "system" ? t("carried over from an offer by the app") : by === "ai" ? t("the AI assistant") : t("a person"));
  return (
    <Section
      id="related"
      className="mt-6"
      flush
      title={t("Suppliers' articles and related products")}
      description={t("The articles it is bought as, the articles of other companies tied to it, and your products that could stand for it. Only a person validates an equivalence.")}
    >
      {articles.length > 0 && (
        <ul className="border-t border-rule">
          {articles.map((a) => (
            <li key={a.articleId} className="grid gap-x-4 gap-y-0.5 border-b border-rule px-5 py-2.5 text-[13px] last:border-b-0 @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                {a.company.id ? (
                  <Link href={`/companies/${a.company.id}`} className="font-medium hover:text-ledger">
                    {a.company.name}
                  </Link>
                ) : (
                  <span className="font-medium">{a.company.name}</span>
                )}
                <div className="truncate text-[12px] text-ink-3">
                  {[a.code, a.name].filter(Boolean).join(" · ")} · {t(SOURCE_LABEL[a.source] ?? "from the invoices")}
                </div>
              </div>
              <div>
                <span className={cx("font-medium", a.type === "identical" || a.type === "equivalent_validated" ? "text-down" : a.type === "not_equivalent" ? "text-up" : "text-ink-2")}>{a.type ? t(ARTICLE_LINK_LABEL[a.type]) : t("Tied to it by an offer, nothing said yet")}</span>
                {a.type && <span className="text-[12px] text-ink-3"> · {decided(a.decidedByType)}</span>}
                {a.reason && <div className="text-[12px] text-ink-3">{a.reason}</div>}
              </div>
              <div className="text-[12.5px] text-ink-3">
                {[a.purchases ? t.n(a.purchases, "{n} purchase", "{n} purchases") : null, a.offers ? t.n(a.offers, "{n} offer line", "{n} offer lines") : null, a.lastSeen ? t("last seen {date}", { date: f.date(a.lastSeen) }) : null].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(relations.stored.length > 0 || relations.proposed.length > 0) && (
        <div className="border-t border-rule px-5 py-3">
          <div className="mb-1.5 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{t("Your other products")}</div>
          <ul className="space-y-2 text-[13px]">
            {relations.stored.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={cx("font-medium", r.type === "equivalent_validated" ? "text-down" : r.type === "not_equivalent" ? "text-up" : "text-ink-2")}>{t(RELATION_TYPE_LABEL[r.type])}</span>
                <Link href={`/products/${r.other.id}`} className="font-medium hover:text-ledger">
                  {r.other.name}
                </Link>
                {r.application && <span className="text-ink-3">{t("for {use}", { use: r.application })}</span>}
                {r.reason && <span className="text-ink-3">· {r.reason}</span>}
                <span className="text-[12px] text-ink-4">{t("{who}, {date}", { who: r.decidedBy, date: f.date(r.createdAt.slice(0, 10)) })}</span>
                {r.history.length > 0 && <span className="text-[12px] text-ink-4">{t.n(r.history.length, "{n} earlier decision kept", "{n} earlier decisions kept")}</span>}
                <WithdrawRelation id={r.id} />
                <RelationDecision productId={productId} otherId={r.other.id} initial={r.type} />
              </li>
            ))}
            {relations.proposed.map((p) => (
              <li key={p.other.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium text-caution">{t("Proposed: possible equivalent")}</span>
                <Link href={`/products/${p.other.id}`} className="font-medium hover:text-ledger">
                  {p.other.name}
                </Link>
                <span className="text-ink-3">{t.any(p.reason.text, p.reason.values)}</span>
                <RelationDecision productId={productId} otherId={p.other.id} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {relations.family.length > 0 && (
        <p className="border-t border-rule px-5 py-3 text-[12.5px] text-ink-3">
          {t("Same family, another grade or no grade said")}:{" "}
          {relations.family.slice(0, 12).map((x, i) => (
            <span key={x.other.id}>
              {i > 0 && " · "}
              <Link href={`/products/${x.other.id}`} className="text-ledger hover:underline">
                {x.other.name}
              </Link>
            </span>
          ))}
          {relations.family.length > 12 && ` · ${t.n(relations.family.length - 12, "and {n} more", "and {n} more")}`}
        </p>
      )}

      {articles.length === 0 && relations.stored.length + relations.proposed.length + relations.family.length === 0 && <p className="border-t border-rule px-5 py-3 text-[13px] text-ink-3">{t("No supplier's article and no related product on file yet.")}</p>}
    </Section>
  );
}
