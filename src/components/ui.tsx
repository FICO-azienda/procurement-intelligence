import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Download } from "lucide-react";
import type { ProductStatus, SupplierStatus } from "@/lib/analytics";
import { pct } from "@/lib/format";
import { Tx } from "@/lib/i18n/client";
import { PRODUCT_STATUS_LABEL, SUPPLIER_STATUS_LABEL } from "@/lib/intel/labels";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ---------- Buttons ----------

export type Variant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ledger",
    "disabled:pointer-events-none disabled:opacity-50",
    size === "md" ? "h-8 px-3 text-[13px]" : "h-7 px-2.5 text-[12.5px]",
    variant === "primary" && "bg-ledger text-white hover:bg-ledger/90",
    variant === "secondary" &&
      "border border-rule-strong bg-canvas text-ink hover:border-ink/25 hover:bg-wash",
    variant === "ghost" && "text-ink-2 hover:bg-wash hover:text-ink",
    variant === "danger" && "border border-up/25 bg-canvas text-up hover:bg-up-wash",
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

/** Link to a CSV export (a file download, not a page). */
export function ExportLink({ href, children, className }: { href: string; children?: ReactNode; className?: string }) {
  return (
    <a href={href} download className={cx("inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap text-ledger hover:underline", className)}>
      <Download size={13} strokeWidth={2} /> {children ?? <Tx msg="Export CSV" />}
    </a>
  );
}

// ---------- Page structure ----------

export function PageHeader({
  title,
  eyebrow,
  meta,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[13px] text-ink-3">{eyebrow}</div>}
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.022em]">{title}</h1>
        {meta && <div className="mt-2 text-[13px] text-ink-3">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("rounded-lg border border-rule bg-canvas", className)} />;
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content touches the card edges (tables). */
  flush?: boolean;
}) {
  return (
    <section className={cx("rounded-lg border border-rule bg-canvas", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-[-0.005em]">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className={flush ? "" : "px-5 pb-5"}>{children}</div>
    </section>
  );
}

/**
 * A section that stays closed until asked for: detail on demand. Same frame
 * as Section, so open and closed blocks sit together on a page.
 */
export function Disclosure({
  title,
  description,
  children,
  className,
  flush,
  defaultOpen,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className={cx("group rounded-lg border border-rule bg-canvas", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-5 py-3.5 select-none hover:bg-well focus-visible:outline-2 focus-visible:outline-ledger [&::-webkit-details-marker]:hidden">
        <ChevronRight size={15} className="shrink-0 text-ink-4 transition-transform duration-150 group-open:rotate-90" />
        <span className="text-[14px] font-semibold tracking-[-0.005em]">{title}</span>
        {description && <span className="min-w-0 truncate text-[12.5px] text-ink-3">{description}</span>}
      </summary>
      <div className={cx("border-t border-rule", flush ? "" : "px-5 py-4")}>{children}</div>
    </details>
  );
}

export { Crumbs } from "./crumbs";

/** Small uppercase label naming where a number comes from. */
export function Basis({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "muted" }) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] items-center rounded-[4px] border px-1.5 font-mono text-[10px] font-medium tracking-[0.04em] uppercase",
        tone === "neutral" ? "border-rule-strong text-ink-3" : "border-dashed border-rule-strong text-ink-4",
      )}
    >
      {children}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[12px] font-medium text-ink-3">{children}</div>;
}

// ---------- Numbers ----------

/** Price movement. Up is red (costs more), down is green. */
export function Delta({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={cx("text-ink-4", className)}>—</span>;
  const rounded = Number(value.toFixed(1));
  const tone = rounded > 0 ? "text-up" : rounded < 0 ? "text-down" : "text-ink-3";
  const Icon = rounded > 0 ? ArrowUpRight : rounded < 0 ? ArrowDownRight : null;
  return (
    <span className={cx("num inline-flex items-center gap-0.5 font-medium", tone, className)}>
      {Icon && <Icon size={13} strokeWidth={2} aria-hidden />}
      {pct(value)}
    </span>
  );
}

// ---------- Status ----------

const PRODUCT_STATUS: Record<ProductStatus, { className: string; dot: string }> = {
  increase: { className: "bg-up-wash text-up", dot: "bg-up" },
  stable: { className: "bg-wash text-ink-2", dot: "bg-ink-4" },
  review: { className: "bg-caution-wash text-caution", dot: "bg-caution" },
};

export function StatusBadge({ status, title }: { status: ProductStatus; title?: string }) {
  const s = PRODUCT_STATUS[status];
  return (
    <span
      title={title}
      className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium whitespace-nowrap", s.className)}
    >
      <span className={cx("size-1.5 rounded-full", s.dot)} />
      <Tx msg={PRODUCT_STATUS_LABEL[status]} />
    </span>
  );
}

const SUPPLIER_STATUS: Record<SupplierStatus, string> = {
  active: "bg-wash text-ink-2",
  inactive: "bg-caution-wash text-caution",
  "quote-only": "bg-ledger-wash text-ledger",
  new: "bg-wash text-ink-3",
};

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", SUPPLIER_STATUS[status])}>
      <Tx msg={SUPPLIER_STATUS_LABEL[status]} />
    </span>
  );
}

// ---------- Tables ----------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "h-9 border-y border-rule bg-well px-2.5 text-[12px] font-medium whitespace-nowrap text-ink-3 first:pl-5 last:pr-5",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
  muted,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
  muted?: boolean;
}) {
  return (
    <td
      className={cx(
        "h-11 border-b border-rule px-2.5 whitespace-nowrap first:pl-5 last:pr-5",
        align === "right" && "num text-right",
        muted && "text-ink-3",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function rowClass(clickable = false) {
  return cx("group [&:last-child>td]:border-b-0", clickable && "row-link transition-colors duration-100 hover:bg-well");
}

// ---------- Empty ----------

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="text-[14px] font-medium">{title}</div>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Sku({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12px] text-ink-3">{children}</span>;
}
