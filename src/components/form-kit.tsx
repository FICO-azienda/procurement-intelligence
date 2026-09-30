"use client";

import { startTransition, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { X } from "lucide-react";
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
  return <input {...props} className={cx(control, "h-9 px-2.5", className)} />;
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
  return <textarea rows={3} {...props} className={cx(control, "px-2.5 py-2 leading-snug", className)} />;
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="sheet m-auto max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] max-w-[600px] overflow-hidden rounded-xl bg-canvas p-0 text-ink shadow-[0_0_0_1px_rgba(17,17,19,.08),0_12px_32px_-8px_rgba(17,17,19,.22),0_4px_8px_-4px_rgba(17,17,19,.08)]"
    >
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-ledger"
          >
            <X size={16} />
          </button>
        </div>
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
      className="flex min-h-0 flex-1 flex-col"
      noValidate
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">{footer}</div>
    </form>
  );
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
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary")}>
      {pending ? "Saving…" : children}
    </button>
  );
}

/** Two-step delete: first click arms, second click confirms. */
export function DeleteButton({
  onConfirm,
  note,
  label = "Delete",
}: {
  onConfirm: () => void | Promise<void>;
  note?: string;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className={buttonClass("ghost")}>
        <span className="text-up">{label}</span>
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
        {busy ? "Deleting…" : "Confirm delete"}
      </button>
      {note && <span className="truncate text-[12px] text-ink-3">{note}</span>}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>;
}
