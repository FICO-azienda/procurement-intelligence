"use client";

import { useState, useTransition } from "react";
import { clearAllData, loadDemoData } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { DeleteButton } from "./form-kit";
import { buttonClass } from "./ui";

export function DataControls({ counts }: { counts: string }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DeleteButton
        label={t("Clear all data")}
        note={t("Deletes {counts}, imports and stored files. Cannot be undone.", { counts })}
        onConfirm={async () => {
          await clearAllData();
          setMessage(t("All data cleared. The app is empty and ready for real data."));
        }}
      />
      <button
        type="button"
        disabled={pending}
        className={buttonClass("secondary")}
        onClick={() =>
          startTransition(async () => {
            await loadDemoData();
            setMessage(t("Demo data reloaded."));
          })
        }
      >
        {pending ? t("Loading…") : t("Reload demo data")}
      </button>
      {message && <span className="text-[12.5px] text-down">{message}</span>}
    </div>
  );
}
