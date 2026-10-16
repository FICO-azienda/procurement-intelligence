"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { attachInvoiceDocumentAction } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { buttonClass } from "./ui";

/** Attach the original of an invoice: a PDF or the electronic invoice. A copy is kept, as private as the data. */
export function AttachInvoiceOriginal({ invoiceId }: { invoiceId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          const res = await attachInvoiceDocumentAction(invoiceId, data);
          if (!res.ok) return setError(res.error ?? t("Something went wrong."));
          router.refresh();
        });
      }}
    >
      <input type="file" name="file" accept=".pdf,.xml,.p7m,application/pdf,text/xml" aria-label={t("The invoice's original")} className="text-[13px]" required />
      <button type="submit" className={buttonClass("secondary", "sm")} disabled={pending}>
        {pending ? t("Saving…") : t("Attach the original")}
      </button>
      {error && (
        <span role="alert" className="text-[12.5px] text-up">
          {error}
        </span>
      )}
    </form>
  );
}
