import Link from "next/link";
import { Building2 } from "lucide-react";
import { getDb } from "@/db";
import type { RoleKind } from "@/lib/companies/plan";
import type { T } from "@/lib/i18n";
import { companyOfRecord } from "@/server/companies";

/** The way from one record (a supplier, a reply, a directory entry) to the company it is a role of, with its other roles. */
export async function CompanyLink({ t, kind, id }: { t: T; kind: RoleKind; id: string }) {
  const companyId = await companyOfRecord(await getDb(), kind, id);
  if (!companyId) return null;
  return (
    <Link href={`/companies/${companyId}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ledger hover:underline">
      <Building2 size={14} aria-hidden /> {t("The company and its other roles")}
    </Link>
  );
}
