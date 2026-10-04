"use client";

import { useT } from "@/lib/i18n/client";

/** Shown at once while a page's data is being read: never a blank screen. */
export default function Loading() {
  const t = useT();
  const bar = "animate-pulse rounded-md bg-wash";
  return (
    <div role="status" aria-label={t("Loading…")}>
      <div className={`${bar} h-7 w-56`} />
      <div className={`${bar} mt-3 h-4 w-80 max-w-full`} />
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-canvas p-5">
            <div className={`${bar} h-8 w-28`} />
            <div className={`${bar} mt-3 h-3.5 w-32`} />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-3 rounded-lg border border-rule p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`${bar} h-4`} style={{ width: `${92 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}
