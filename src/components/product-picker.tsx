"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "./form-kit";

export function ProductPicker({
  products,
  value,
}: {
  products: { id: string; name: string; sku: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <label className={`block w-full max-w-[360px] transition-opacity ${pending ? "opacity-70" : ""}`}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Product</span>
      <Select
        value={value}
        onChange={(e) =>
          startTransition(() => router.replace(`${pathname}?product=${e.target.value}`, { scroll: false }))
        }
      >
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.sku}
          </option>
        ))}
      </Select>
    </label>
  );
}
