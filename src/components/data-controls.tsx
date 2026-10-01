"use client";

import { useState, useTransition } from "react";
import { clearAllData, loadDemoData } from "@/app/actions";
import { DeleteButton } from "./form-kit";
import { buttonClass } from "./ui";

export function DataControls({ counts }: { counts: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DeleteButton
        label="Clear all data"
        note={`Deletes ${counts}, imports and stored files. Cannot be undone.`}
        onConfirm={async () => {
          await clearAllData();
          setMessage("All data cleared. The app is empty and ready for real data.");
        }}
      />
      <button
        type="button"
        disabled={pending}
        className={buttonClass("secondary")}
        onClick={() =>
          startTransition(async () => {
            await loadDemoData();
            setMessage("Demo data reloaded.");
          })
        }
      >
        {pending ? "Loading…" : "Reload demo data"}
      </button>
      {message && <span className="text-[12.5px] text-down">{message}</span>}
    </div>
  );
}
