"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

/** Ends the workspace session. Shown only where the workspace asks for a sign-in. */
export function SignOut() {
  const t = useT();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={t("Sign out")}
      title={t("Sign out")}
      className="grid size-9 shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:bg-wash hover:text-ink"
      onClick={() => void fetch("/login/session", { method: "DELETE" }).finally(() => (router.replace("/login"), router.refresh()))}
    >
      <LogOut size={16} strokeWidth={1.75} />
    </button>
  );
}
