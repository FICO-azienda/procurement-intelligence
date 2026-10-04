"use client";

import { startTransition, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { buttonClass, cx } from "./ui";

// ---------- Controls ----------

const control = cx(
  "w-full rounded-md border border-rule-strong bg-well text-[13.5px] text-ink placeholder:text-ink-4",
  "transition-[border-color,box-shadow,background-color] duration-150",
  "hover:border-ink/25 focus:border-ledger focus:bg-canvas focus:ring-3 focus:ring-ledger/15 focus:outline-none",
  "aria-invalid:border-up/60 aria-invalid:focus:ring-up/15",
  "disabled:opacity-60",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} data-autofocus={props.autoFocus || undefined} className={cx(control, "h-9 px-2.5", className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select {...props} className={cx(control, "h-9 appearance-none pr-8 pl-2.5", className)}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-3"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} data-autofocus={props.autoFocus || undefined} className={cx(control, "px-2.5 py-2 leading-snug", className)} />;
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
  required,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-ink-4">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-up">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

/** Number → form value, comma decimals so parsing stays unambiguous. */
export function toInput(n: number | null | undefined) {
  return n == null ? "" : String(n).replace(".", ",");
}

// ---------- Sheet (modal) ----------

export function useSheet() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  return {
    open,
    /** Remount key so each opening starts from a fresh form. */
    version,
    show: () => {
      setVersion((v) => v + 1);
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  wide,
  tabs,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Room for a summary beside the fields. */
  wide?: boolean;
  /** Ways of doing the same thing, shown under the title. */
  tabs?: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The browser focuses the Close button; the form says where typing should start.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "sheet mt-auto mr-0 mb-0 ml-auto h-[min(100dvh,100%)] max-h-dvh w-full overflow-hidden bg-canvas p-0 text-ink shadow-[0_0_0_1px_rgba(17,17,19,.08),-12px_0_32px_-12px_rgba(17,17,19,.22)] sm:mt-0",
        wide ? "max-w-[700px]" : "max-w-[520px]",
      )}
    >
      <div className="flex h-full max-h-dvh flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="-mr-2 grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-ledger"
          >
            <X size={16} />
          </button>
        </div>
        {open && tabs}
        {open && children}
      </div>
    </dialog>
  );
}

/**
 * Scrollable body + sticky footer for forms inside a Sheet.
 * Submits via onSubmit (not the `action` prop) so React doesn't reset the
 * fields when validation fails — the user keeps what they typed.
 */
export function SheetForm({
  action,
  children,
  footer,
}: {
  action: (formData: FormData) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      onKeyDown={formKeys}
      className="flex min-h-0 flex-1 flex-col"
      noValidate
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">{footer}</div>
    </form>
  );
}

/**
 * Data entry without the mouse: Enter moves to the next field (and saves from
 * the last one), Ctrl/Cmd + Enter saves from anywhere.
 */
function formKeys(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  const form = e.currentTarget;
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    form.requestSubmit();
    return;
  }
  const el = e.target as HTMLElement;
  if (!(el instanceof HTMLInputElement) || el.type === "submit" || el.type === "button") return;
  const fields = [...form.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")].filter(
    (f) => f.offsetParent !== null,
  );
  const next = fields[fields.indexOf(el) + 1];
  if (next) {
    e.preventDefault();
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  }
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-md bg-up-wash px-3 py-2 text-[13px] text-up">
      {message}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? t("Saving…") : children}
    </button>
  );
}

/** Two-step delete: first click arms, second click confirms. */
export function DeleteButton({
  onConfirm,
  note,
  label,
}: {
  onConfirm: () => void | Promise<void>;
  note?: string;
  label?: string;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className={buttonClass("ghost")}>
        <span className="text-up">{label ?? t("Delete")}</span>
      </button>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
          }
        }}
        className={buttonClass("danger")}
      >
        {busy ? t("Deleting…") : t("Confirm delete")}
      </button>
      {note && <span className="truncate text-[12px] text-ink-3">{note}</span>}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>;
}

// ---------- Optional fields, closed until needed ----------

/** "More details": what most people never fill in stays out of the way. */
export function MoreDetails({ label, summary, defaultOpen = false, children }: { label?: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <details open={defaultOpen} className="group mt-5 border-t border-rule pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[13px] font-medium text-ink-2 select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ledger [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="text-ink-4 transition-transform duration-150 group-open:rotate-90" />
        {label ?? t("More details")}
        {summary && <span className="font-normal text-ink-3 group-open:hidden">· {summary}</span>}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

// ---------- Combo: type to find, or create what is missing ----------

export interface ComboOption {
  id: string;
  label: string;
  /** Second line: code, country… also searched. */
  hint?: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * A select you can type in. Finds by any word of the name; when nothing
 * matches and `onCreate` is given, offers to create it on the spot.
 */
export function Combo({
  name,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  onCreate,
  createNoun,
  autoFocus,
  initialText = "",
}: {
  name: string;
  value: string;
  onChange: (id: string) => void;
  options: ComboOption[];
  placeholder?: string;
  invalid?: boolean;
  onCreate?: (text: string) => void;
  /** What "Create" makes, to say it in full. */
  createNoun?: "supplier" | "product";
  autoFocus?: boolean;
  /** Text to start from when nothing is selected (e.g. a name read from a sentence). */
  initialText?: string;
}) {
  const t = useT();
  const listId = useId();
  const selected = options.find((o) => o.id === value);
  const [text, setText] = useState(selected?.label ?? initialText);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Selection changed from outside (auto-fill, created on the fly): show its name.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (selected && text !== selected.label) setText(selected.label);
  }

  const query = norm(text.trim());
  const matches = useMemo(() => {
    if (!query || (selected && norm(selected.label) === query)) return options.slice(0, 50);
    const words = query.split(/\s+/);
    return options.filter((o) => words.every((w) => norm(`${o.label} ${o.hint ?? ""}`).includes(w))).slice(0, 50);
  }, [options, query, selected]);
  const exact = options.some((o) => norm(o.label) === query);
  const canCreate = !!onCreate && query.length > 0 && !exact;
  const count = matches.length + (canCreate ? 1 : 0);

  const pick = (o: ComboOption) => {
    setText(o.label);
    setOpen(false);
    onChange(o.id);
  };
  const create = () => {
    setOpen(false);
    onCreate?.(text.trim());
  };

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid}
        autoComplete="off"
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        placeholder={placeholder}
        value={text}
        className={cx(control, "h-9 px-2.5")}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange("");
        }}
        onBlur={() => {
          setOpen(false);
          // Typed a name that exists, or left a single match: take it.
          if (!value) {
            const only = options.find((o) => norm(o.label) === query) ?? (matches.length === 1 && query ? matches[0] : null);
            if (only) pick(only);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (count ? (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count : 0));
          } else if (e.key === "Enter" && open && count > 0 && !(e.metaKey || e.ctrlKey)) {
            // Choose here; the form's own Enter (next field) follows on the next press.
            if (active < matches.length) {
              if (matches[active].id !== value) {
                e.preventDefault();
                pick(matches[active]);
              } else setOpen(false);
            } else {
              e.preventDefault();
              create();
            }
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {open && count > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-30 max-h-60 overflow-y-auto rounded-md border border-rule-strong bg-canvas py-1 shadow-[0_8px_24px_-8px_rgba(17,17,19,.25)]"
        >
          {matches.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              // mousedown, not click: it must win over the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx("flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1.5 text-[13.5px]", i === active && "bg-wash")}
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[12px] text-ink-3">{o.hint}</span>}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                create();
              }}
              onMouseEnter={() => setActive(matches.length)}
              className={cx(
                "flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[13.5px] font-medium text-ledger",
                matches.length > 0 && "border-t border-rule",
                active === matches.length && "bg-ledger-wash",
              )}
            >
              <Plus size={14} /> {t(createNoun === "supplier" ? "Create supplier “{name}”" : createNoun === "product" ? "Create product “{name}”" : "Create “{name}”", { name: text.trim() })}
            </li>
          )}
        </ul>
      )}
      {!open && !value && query && !exact && (
        <div className="mt-1 text-[12px] text-ink-3">
          {t("Not found.")}{" "}
          {onCreate && (
            <button type="button" onClick={create} className="font-medium text-ledger hover:underline">
              {t("Create “{name}”", { name: text.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
