"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, ExternalLink, Plus, Trash2 } from "lucide-react";
import { addCandidateAction, convertCandidateAction, deleteCandidateAction, updateCandidateAction, type SourcingResult } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { CANDIDATE_STATUSES, CANDIDATE_STATUS_LABEL, COMPANY_TYPE_LABEL, SOURCE_LEVEL_LABEL, TECHNICAL_LABEL, type CandidateStatus, type Comparability, type CompanyType, type MatchStrength, type PriceType, type SourceLevel, type TechnicalFit } from "@/lib/sourcing/types";
import { CONTACT_VALUE_LABEL, EVIDENCE_LABEL, LOGISTICS_LABEL, ROLE_LABEL, STAGE_LABEL, type ContactValue, type EvidenceQuality, type EvidenceRole, type FunnelStage, type Logistics } from "@/lib/sourcing/screening";
import type { RfqLineData } from "@/server/sourcing";
import { Field, Grid, Input, Select, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";
import { ReplyPanel, RfqPanel, type RfqContext, type RfqItem } from "./rfq";
import { ComparabilityText, PriceTypeTag, StagePill } from "./tags";

export interface CandidateVM {
  id: string;
  name: string;
  country: string | null;
  flag: string | null;
  website: string | null;
  regionLabel: string;
  strength: MatchStrength;
  comparability: Comparability | null;
  reasons: string[];
  productMatched: string | null;
  matchReason: string | null;
  technicalCompatibility: TechnicalFit | null;
  /** The published price as it can be shown, with its kind and where it was read. */
  price: { text: string; type: PriceType; sourceUrl: string | null } | null;
  terms: string[];
  sourceUrl: string | null;
  sourceHost: string | null;
  sourceDate: string | null;
  sourceLevel: SourceLevel;
  /** Found by a provider (its name), or added by hand. */
  foundBy: string | null;
  /** Found through research (in the app or loaded from outside), not typed in by the user. */
  researched: boolean;
  discoveredAt: string | null;
  companyType: CompanyType | null;
  /** What its own page confirms of the specification. Null: the page has not been read. */
  specCheck: { stated: boolean; confirmed: string[]; missing: string[]; checkedAt: string } | null;
  minimumOrder: string | null;
  /** The supplier on file it became. */
  supplierId: string | null;
  /** Where it stands before anyone is contacted, and why. */
  stage: FunnelStage;
  stageReason: string;
  fit: string;
  evidence: EvidenceQuality;
  logistics: Logistics;
  mainStrength: string | null;
  mainUnknown: string;
  /** Recommended for a request for quotation, and why. */
  shortlisted: boolean;
  why: string | null;
  contactValue: ContactValue;
  role: EvidenceRole;
  /** A request was sent, or a quote arrived. */
  inProgress: boolean;
  email: string | null;
  /** When this company was written to, on whatever product. */
  history: { times: number; last: string | null; lastISO: string | null; days: number | null; recent: boolean; followUpDue: boolean };
  notes: string | null;
  status: CandidateStatus;
  top: boolean;
  /** Buying there means customs: transport and duties are not in any price shown. */
  customs: boolean;
}

function useRun() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SourcingResult>, then?: (res: SourcingResult) => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok && !res.errors) setError(res.error ?? t("Something went wrong."));
      else if (res.ok) router.refresh();
      then?.(res);
    });
  return { pending, error, run, t };
}

const STAGES: FunnelStage[] = ["strong", "plausible", "discovered", "low_priority", "not_suitable"];

/**
 * The possible suppliers of a product, already filtered: how many were found,
 * how many are plausible, and the few recommended for a request for
 * quotation — the only ones the user is asked to look at. Everything else is
 * one click away, each with why it was put aside.
 */
export function CandidateBoard({
  productId,
  unit,
  candidates,
  counts,
  line,
  context,
  language,
  firstRound,
}: {
  productId: string;
  unit: string;
  candidates: CandidateVM[];
  counts: { found: number; plausible: number; strong: number; recommended: number };
  line: RfqLineData;
  context: RfqContext;
  language: "en" | "it";
  /** One of the few products the first round of requests is for. */
  firstRound: boolean;
}) {
  const t = useT();
  const shortlist = candidates.filter((c) => c.shortlisted);
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [asking, setAsking] = useState<{ kind: RfqItem["kind"]; ids: string[] } | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const chosen = picked ?? shortlist.filter((c) => !c.inProgress).map((c) => c.id);
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const items = (kind: RfqItem["kind"], ids: string[]): RfqItem[] =>
    candidates
      .filter((c) => ids.includes(c.id))
      .map((c) => ({ key: c.id, supplierName: c.name, email: c.email, kind: kind === "request" && c.history.recent ? "update" : kind, previousDate: c.history.lastISO, lines: [line], candidateIds: [c.id] }));
  const step = (n: number, label: string, strong?: boolean) => (
    <li className="flex items-center gap-2">
      <span className={cx("num text-[15px] font-semibold", strong && "text-ledger")}>{n}</span> <span className={cx(strong ? "font-medium text-ink" : "text-ink-3")}>{label}</span>
    </li>
  );
  return (
    <div className="space-y-5">
      {counts.found > 0 && (
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          {step(counts.found, t.n(counts.found, "company found", "companies found"))}
          <ArrowRight size={13} className="text-ink-4" />
          {step(counts.plausible, t.n(counts.plausible, "plausible supplier", "plausible suppliers"))}
          <ArrowRight size={13} className="text-ink-4" />
          {step(counts.strong, t.n(counts.strong, "strong match", "strong matches"))}
          <ArrowRight size={13} className="text-ink-4" />
          {step(counts.recommended, t("recommended for a request"), true)}
        </ol>
      )}

      <div id="shortlist" className="rounded-xl border border-ledger/25">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-ledger-wash/40 px-5 py-3.5">
          <div className="min-w-[240px] flex-1">
            <div className="text-[14.5px] font-semibold">{t("Recommended RFQ shortlist")}</div>
            <div className="text-[12.5px] text-ink-2">
              {shortlist.length
                ? t("The few worth a request, chosen from what is on file: technical fit first, then who they are and where. You decide who to write to.")
                : counts.found
                  ? t("None of the candidates on file is solid enough to be worth a request: their pages do not state the product. Look for better ones before writing to anyone.")
                  : t("No candidate on file yet: research the product, or add the suppliers you know.")}
            </div>
          </div>
          {shortlist.length > 0 && (
            <button type="button" className={buttonClass("primary")} disabled={!chosen.length} onClick={() => setAsking({ kind: "request", ids: chosen })}>
              {chosen.length ? t.n(chosen.length, "Prepare RFQ to {n} supplier", "Prepare RFQ to {n} suppliers") : t("Select who to ask")}
            </button>
          )}
        </div>
        {!firstRound && shortlist.length > 0 && <p className="border-t border-rule px-5 py-2 text-[12.5px] text-ink-3">{t("This product is outside the first round — the few that weigh most on your spend. The shortlist is ready when you get to it.")}</p>}
        {shortlist.length > 0 && (
          <ul>
            {shortlist.map((c) => (
              <li key={c.id} className="border-t border-rule px-5 py-3.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <input type="checkbox" checked={chosen.includes(c.id)} disabled={c.inProgress} onChange={() => toggle(c.id)} aria-label={t("Select {name}", { name: c.name })} className="mt-1 size-4 accent-ledger" />
                  <div className="min-w-[200px] flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14.5px] font-semibold">{c.name}</span>
                      <StagePill stage={c.stage} />
                      <span className={cx("text-[12px] font-medium", c.contactValue === "high" ? "text-down" : "text-ink-3")}>{t(CONTACT_VALUE_LABEL[c.contactValue])}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-3">{[c.flag ? `${c.flag} ${c.country}` : (c.country ?? t("Country not known")), t(COMPANY_TYPE_LABEL[c.companyType ?? "unknown"])].join(" · ")}</div>
                  </div>
                </div>
                <dl className="mt-2.5 grid gap-x-6 gap-y-1.5 pl-7 text-[13px] @2xl:grid-cols-2">
                  {[
                    [t("Technical fit"), c.fit],
                    [t("Evidence"), t(EVIDENCE_LABEL[c.evidence])],
                    [t("Public price"), c.price ? c.price.text : t("Not publicly available")],
                    [t("Logistics"), t(LOGISTICS_LABEL[c.logistics])],
                    [t("Main unknown"), c.mainUnknown],
                    [t("Why shortlisted"), c.why ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-2">
                      <dt className="w-[118px] shrink-0 text-[12px] text-ink-3">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7 text-[12.5px]">
                  {c.inProgress ? (
                    <>
                      <span className={c.history.followUpDue && c.status !== "quote_received" ? "text-caution" : "text-ink-3"}>
                        {c.status === "quote_received"
                          ? t("Quote received.")
                          : c.history.last
                            ? c.history.followUpDue
                              ? t("Asked on {date}: no answer after {n} days.", { date: c.history.last, n: c.history.days ?? 0 })
                              : t("Asked on {date}: waiting for the answer.", { date: c.history.last })
                            : t("Marked as asked: waiting for the answer.")}
                      </span>
                      {c.status !== "quote_received" && c.history.followUpDue && (
                        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAsking({ kind: "follow_up", ids: [c.id] })}>
                          {t("Prepare follow-up")}
                        </button>
                      )}
                      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAnswering(answering === c.id ? null : c.id)}>
                        {t("Record their answer")}
                      </button>
                    </>
                  ) : (
                    <span className="text-ink-3">
                      {t("Next step: ask for technical confirmation and a quotation.")}
                      {c.history.recent && ` ${t("Already written to on {date} for another product: this one is added to that request.", { date: c.history.last ?? "" })}`}
                    </span>
                  )}
                  {c.sourceUrl && (
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ledger hover:underline">
                      {t("Open source")} <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                {answering === c.id && (
                  <div className="pl-7">
                    <ReplyPanel candidateId={c.id} supplierName={c.name} unit={unit} onClose={() => setAnswering(null)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {asking && asking.ids.length > 0 && (
          <div className="border-t border-rule p-4">
            <RfqPanel items={items(asking.kind, asking.ids)} context={context} language={language} onClose={() => setAsking(null)} onSent={() => setPicked([])} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {candidates.length > 0 && (
          <button type="button" className="text-[13px] font-medium text-ledger hover:underline" onClick={() => setAll((a) => !a)} aria-expanded={all}>
            {all ? t("Hide the full list") : t.n(candidates.length, "View the {n} candidate", "View all {n} candidates")}
          </button>
        )}
        <button type="button" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:underline" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          <Plus size={13} /> {t("Add a supplier you found")}
        </button>
      </div>
      {adding && <CandidateForm productId={productId} unit={unit} onDone={() => setAdding(false)} />}
      {all &&
        STAGES.filter((stage) => candidates.some((c) => c.stage === stage)).map((stage) => (
          <div key={stage}>
            <div className="mb-2 text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">
              {t(STAGE_LABEL[stage])} · {candidates.filter((c) => c.stage === stage).length}
            </div>
            <ul className="space-y-2.5">
              {candidates
                .filter((c) => c.stage === stage)
                .map((c) => (
                  <CandidateCard key={c.id} c={c} onAsk={() => setAsking({ kind: "request", ids: [c.id] })} />
                ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function CandidateCard({ c, onAsk }: { c: CandidateVM; onAsk: () => void }) {
  const { pending, error, run, t } = useRun();
  const rejected = c.status === "rejected";
  const unvalidated = c.status === "discovered" || c.status === "to_review";
  const notPublic = <span className="text-ink-3">{t("Not publicly available")}</span>;
  return (
    <li className={cx("rounded-lg border border-rule px-4 py-3.5 sm:px-5", (rejected || c.stage === "not_suitable") && "opacity-60")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-semibold">{c.name}</span>
            <StagePill stage={c.stage} />
            {c.shortlisted && <span className="text-[12px] font-medium text-ledger">{t("Recommended for a request")}</span>}
            {c.role === "market_signal" && <span className="text-[12px] text-ink-3">{t(ROLE_LABEL.market_signal)}</span>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-2">{c.stageReason}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {[c.flag ? `${c.flag} ${c.country}` : (c.country ?? t("Country not known")), t(COMPANY_TYPE_LABEL[c.companyType ?? "unknown"]), c.website ? new URL(c.website).hostname.replace(/^www\./, "") : null].filter(Boolean).join(" · ")}
          </div>
          {c.supplierId ? (
            <Link href={`/suppliers/${c.supplierId}`} className="mt-1 inline-block text-[12.5px] font-medium text-ledger hover:underline">
              {t("Supplier on file")}
            </Link>
          ) : (
            unvalidated && <div className="mt-1 text-[12.5px] text-caution">{c.researched ? t("Found through research. Not yet validated.") : t("Added by you. Not yet validated.")}</div>
          )}
        </div>
        <Select
          value={c.status}
          disabled={pending}
          aria-label={t("Status")}
          className="h-7! text-[12.5px]"
          onChange={(e) => run(() => updateCandidateAction(c.id, { status: e.target.value }))}
        >
          {CANDIDATE_STATUSES.filter((s) => s !== "converted" || c.status === "converted").map((s) => (
            <option key={s} value={s}>
              {t(CANDIDATE_STATUS_LABEL[s])}
            </option>
          ))}
        </Select>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-[13px] @2xl:grid-cols-2">
        <div>
          <dt className="text-[12px] text-ink-3">{t("Product match")}</dt>
          <dd>{c.productMatched ?? <span className="text-ink-4">{t("Not stated by the source")}</span>}</dd>
          {c.matchReason && <dd className="text-[12px] text-ink-3">{c.matchReason}</dd>}
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t("Exact specification")}</dt>
          {!c.specCheck ? (
            <dd className="text-ink-3">{t("Their site has not been checked yet")}</dd>
          ) : !c.specCheck.stated ? (
            <dd className="text-caution">{t("The page read does not state the product")}</dd>
          ) : c.specCheck.missing.length ? (
            <dd>
              <span className="font-medium text-caution">{t("Not confirmed")}</span> <span className="text-ink-3">— {t("{spec} is not on their page: to ask", { spec: c.specCheck.missing.join(", ") })}</span>
            </dd>
          ) : c.specCheck.confirmed.length ? (
            <dd>
              <span className="font-medium text-down">{t("Stated on their site")}</span> <span className="text-ink-3">— {c.specCheck.confirmed.join(", ")}</span>
            </dd>
          ) : (
            <dd className="text-ink-3">{t("To confirm with them: the product's name gives no figure to check")}</dd>
          )}
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t("Public price")}</dt>
          {c.price ? (
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="num font-medium">{c.price.text}</span>
              <PriceTypeTag type={c.price.type} />
              {c.price.sourceUrl && (
                <a href={c.price.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-ledger hover:underline">
                  {t("where it is written")} <ExternalLink size={11} />
                </a>
              )}
            </dd>
          ) : (
            <dd>{notPublic}</dd>
          )}
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t("Minimum order and terms")}</dt>
          <dd>{c.minimumOrder || c.terms.length ? [c.minimumOrder, ...c.terms].filter(Boolean).join(" · ") : notPublic}</dd>
        </div>
        <div className="@2xl:col-span-2">
          <dt className="text-[12px] text-ink-3">{t("Technical match")}</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{t(TECHNICAL_LABEL[c.technicalCompatibility ?? "unknown"])}</span>
            <Select
              value={c.technicalCompatibility ?? ""}
              disabled={pending}
              aria-label={t("Specification")}
              className="h-6! text-[12px]"
              onChange={(e) => run(() => updateCandidateAction(c.id, { technicalCompatibility: e.target.value || null }))}
            >
              <option value="">{t("Specification not checked")}</option>
              <option value="high">{t("Same specification")}</option>
              <option value="partial">{t("Partly the same")}</option>
              <option value="not">{t("Different product")}</option>
            </Select>
            {c.technicalCompatibility && <ComparabilityText level={c.comparability} />}
          </dd>
          {c.reasons.length > 0 && c.technicalCompatibility && <dd className="mt-0.5 text-[12px] text-ink-3">{c.reasons.join(" · ")}</dd>}
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule pt-2.5 text-[12px] text-ink-3">
        <span>
          {t("Source:")} <span className="text-ink-2">{c.researched ? t("Web research") : c.foundBy ? c.foundBy : t("added by you")}</span>
        </span>
        {c.discoveredAt && <span>{t("Discovered: {date}", { date: c.discoveredAt })}</span>}
        <span>{t(SOURCE_LEVEL_LABEL[c.sourceLevel])}</span>
        {c.sourceUrl ? (
          <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ledger hover:underline">
            {t("Open source")} <ExternalLink size={11} />
          </a>
        ) : (
          <span>{t("no page: see the note")}</span>
        )}
        {c.customs && <span className="text-caution">{t("Outside your customs area: transport and duties are not in any price")}</span>}
      </div>
      {c.notes && <p className="mt-2 text-[12.5px] text-ink-2">{c.notes}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {unvalidated && (
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => updateCandidateAction(c.id, { status: "validated" }))}>
            <Check size={13} /> {t("Validate")}
          </button>
        )}
        {/* A request is offered only where it could be worth one. */}
        {!rejected && c.status !== "converted" && !c.inProgress && (c.stage === "strong" || c.stage === "plausible") && (
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={onAsk}>
            {t("Request quote")}
          </button>
        )}
        {!rejected && !unvalidated && !c.supplierId && (
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => convertCandidateAction(c.id))}>
            {t("Convert to supplier")}
          </button>
        )}
        {rejected ? (
          <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => updateCandidateAction(c.id, { status: "to_review" }))}>
            {t("Bring back")}
          </button>
        ) : (
          c.status !== "converted" && (
            <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => updateCandidateAction(c.id, { status: "rejected" }))}>
              {t("Reject")}
            </button>
          )
        )}
        <button type="button" disabled={pending} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-up" onClick={() => run(() => deleteCandidateAction(c.id))}>
          <Trash2 size={12} /> {t("Remove")}
        </button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-up">{error}</p>}
    </li>
  );
}

const EMPTY = { name: "", country: "", website: "", sourceUrl: "", sourceLevel: "external", productMatched: "", technicalCompatibility: "", priceLow: "", priceHigh: "", currency: "EUR", unit: "", incoterm: "", moq: "", leadTimeDays: "", paymentTerms: "", certifications: "", notes: "" };

/** A supplier the user knows or found: a name and where it was found are enough. A price is optional, and always "indicative". */
function CandidateForm({ productId, unit, onDone }: { productId: string; unit: string; onDone: () => void }) {
  const { pending, error, run, t } = useRun();
  const [v, setV] = useState({ ...EMPTY, unit });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [key]: e.target.value }));
  const field = (key: keyof typeof EMPTY, label: string, opts: { placeholder?: string; required?: boolean; hint?: string } = {}) => (
    <Field label={label} error={errors[key]} hint={opts.hint} required={opts.required}>
      <Input value={v[key]} onChange={set(key)} placeholder={opts.placeholder} />
    </Field>
  );
  return (
    <form
      className="space-y-3 rounded-xl border border-rule px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => addCandidateAction(productId, v),
          (res) => {
            setErrors(res.errors ?? {});
            if (res.ok) onDone();
          },
        );
      }}
    >
      <Grid>
        {field("name", t("Supplier"), { required: true })}
        {field("country", t("Country"))}
        {field("sourceUrl", t("Where you found it"), { placeholder: "https://…", hint: t("The page that shows this supplier sells the product. No page? Say it in the note.") })}
        <Field label={t("Kind of source")}>
          <Select value={v.sourceLevel} onChange={set("sourceLevel")}>
            {(["supplier_official", "official_data", "licensed_data", "external"] as const).map((l) => (
              <option key={l} value={l}>
                {t(SOURCE_LEVEL_LABEL[l])}
              </option>
            ))}
          </Select>
        </Field>
        {field("productMatched", t("Their product"), { placeholder: t("As they call it") })}
        <Field label={t("Specification")}>
          <Select value={v.technicalCompatibility} onChange={set("technicalCompatibility")}>
            <option value="">{t("Specification not checked")}</option>
            <option value="high">{t("Same specification")}</option>
            <option value="partial">{t("Partly the same")}</option>
            <option value="not">{t("Different product")}</option>
          </Select>
        </Field>
      </Grid>
      <Field label={t("Note")} error={errors.notes}>
        <Textarea value={v.notes} onChange={set("notes")} rows={2} placeholder={t("Who told you about them, what you know")} />
      </Field>
      <button type="button" className="text-[13px] font-medium text-ledger hover:underline" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? t("Fewer details") : t("A published price, minimum order, lead time…")}
      </button>
      {more && (
        <Grid>
          {field("priceLow", t("Published price, from"), { hint: t("Only a price you can point to: it will be shown as “indicative”, never as an offer.") })}
          {field("priceHigh", t("to"))}
          {field("unit", t("per"), { placeholder: unit })}
          {field("currency", t("Currency"))}
          {field("incoterm", t("Delivery terms"), { placeholder: "EXW, DAP…" })}
          {field("moq", t("Minimum order"))}
          {field("leadTimeDays", t("Lead time (days)"))}
          {field("paymentTerms", t("Payment terms"))}
          {field("certifications", t("Certifications"))}
          {field("website", t("Website"), { placeholder: "https://…" })}
        </Grid>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !v.name.trim()} className={buttonClass("primary")}>
          {pending ? t("Saving…") : t("Add supplier")}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onDone}>
          {t("Cancel")}
        </button>
        {error && <span className="text-[12.5px] text-up">{error}</span>}
      </div>
    </form>
  );
}
