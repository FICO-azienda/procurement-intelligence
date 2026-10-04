"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setProductKind } from "@/app/actions";
import { KIND_LABEL, PRODUCT_KINDS, type ProductKind } from "@/lib/catalog/kinds";
import { useT } from "@/lib/i18n/client";
import { Select } from "../form-kit";

/**
 * What a product is for the company's spend, changed in place. The choice
 * decides whether it belongs to the catalogue (materials, components,
 * packaging) or to the rest of the spend — and is remembered for every
 * future invoice line that means this product.
 */
export function KindSelect({ productId, kind }: { productId: string; kind: ProductKind }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Select
        value={kind}
        disabled={pending}
        aria-label={t("What it is")}
        className="h-7! text-[12.5px]"
        onChange={(e) =>
          start(async () => {
            setError(null);
            const res = await setProductKind(productId, e.target.value as ProductKind);
            if (!res.ok) setError(res.error ?? t("Something went wrong."));
            else router.refresh();
          })
        }
      >
        {PRODUCT_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(KIND_LABEL[k])}
          </option>
        ))}
      </Select>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </span>
  );
}
