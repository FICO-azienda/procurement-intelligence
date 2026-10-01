"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

/** The browser's print dialog also saves as PDF: the page is laid out for paper. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}>
      <Printer size={14} strokeWidth={1.75} /> Print
    </button>
  );
}
