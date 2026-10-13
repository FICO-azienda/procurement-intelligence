"use client";

import { useState } from "react";
import { clearAllData, loadDemoData } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { DeleteButton } from "./form-kit";
import { ExportLink } from "./ui";

/**
 * Clearing and loading the demo, offered only while the data is the demo's (or there is none). With the company's own
 * data on file neither is shown — and the server refuses both, whatever a page shows (server/data-guard.ts).
 */
export function DataControls({ counts, state }: { counts: string; state: "empty" | "demo" | "real" }) {
  const t = useT();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (state === "real") {
    return (
      <div className="max-w-[68ch] text-[13px] text-ink-2">
        <p>{t("This is your company's data: it cannot be cleared or replaced with the demo data from the app.")}</p>
        <p className="mt-2">
          <ExportLink href="/export/data">{t("Download a full copy of the data")}</ExportLink>
          <span className="text-ink-3"> · {t("a single file, as private as the data itself")}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "demo" && (
        <DeleteButton
          label={t("Clear the demo data")}
          note={t("Deletes {counts}, imports and stored files. Cannot be undone.", { counts })}
          onConfirm={async () => {
            const res = await clearAllData();
            if (res.ok) setMessage({ ok: true, text: t("All data cleared. The app is empty and ready for real data.") });
            return res;
          }}
        />
      )}
      <DeleteButton
        label={state === "demo" ? t("Reload demo data") : t("Load the demo data")}
        note={state === "demo" ? t("Puts the demo data back as it was at the start.") : t("Example figures to look around with: clear them before loading your own.")}
        onConfirm={async () => {
          const res = await loadDemoData();
          if (res.ok) setMessage({ ok: true, text: t("Demo data reloaded.") });
          return res;
        }}
      />
      {message && <span className={`text-[12.5px] ${message.ok ? "text-down" : "text-up"}`}>{message.text}</span>}
    </div>
  );
}
