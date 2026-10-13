import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SignInForm } from "@/components/orders/portal";
import { Card } from "@/components/ui";
import { getOutsideT, supplierPrincipal } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Sign in") };
}

export default async function PortalLogin() {
  if (await supplierPrincipal()) redirect("/portal");
  const t = await getOutsideT();
  return (
    <div className="mx-auto max-w-[400px] pt-10">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("Sign in to the supplier portal")}</h1>
      <p className="mt-1.5 mb-5 text-[13.5px] text-ink-3">{t("Where you receive your customers' order requests and answer them.")}</p>
      <Card className="p-5">
        <SignInForm side="supplier" />
      </Card>
      <p className="mt-4 text-[12.5px] text-ink-3">{t("There is no open registration: a company joins by accepting the invitation of one of its customers.")}</p>
    </div>
  );
}
