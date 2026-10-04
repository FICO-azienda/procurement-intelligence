"use client";

import { useEffect } from "react";

export interface RecentItem {
  kind: "product" | "supplier";
  id: string;
  title: string;
  href: string;
}

const KEY = "pi.recent";
const MAX = 6;

export function readRecent(): RecentItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Remembers that this record was opened, for "Recently viewed" in the command bar. Kept in the browser only. */
export function Remember({ kind, id, title }: Omit<RecentItem, "href">) {
  useEffect(() => {
    try {
      const item: RecentItem = { kind, id, title, href: `/${kind}s/${id}` };
      localStorage.setItem(KEY, JSON.stringify([item, ...readRecent().filter((r) => r.id !== id)].slice(0, MAX)));
    } catch {
      // Private browsing or storage disabled: recent items are a convenience, not a need.
    }
  }, [kind, id, title]);
  return null;
}
