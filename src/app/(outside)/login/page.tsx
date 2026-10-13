import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { SignInForm } from "@/components/orders/portal";
import { Card } from "@/components/ui";
import { workspaceAccess } from "@/lib/auth/cookie";
import { APP_NAME } from "@/lib/config";
import { getOutsideT, workspacePrincipal } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Sign in") };
}

/** The way in to the buyer's workspace when it runs on a server. On the company's own computer there is no sign-in, and no such page. */
export default async function WorkspaceLogin() {
  if (workspaceAccess() !== "login") notFound();
  if (await workspacePrincipal()) redirect("/");
  const t = await getOutsideT();
  return (
    <div className="mx-auto max-w-[400px] px-6 pt-24">
      <div className="mb-6 flex items-center gap-2.5">
        <span aria-hidden className="grid size-8 place-items-center rounded-[8px] bg-ledger text-[12px] font-semibold text-white">
          PI
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
      </div>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("Sign in")}</h1>
      <p className="mt-1.5 mb-5 text-[13.5px] text-ink-3">{t("This workspace holds a company's purchasing data: it opens only to its own people.")}</p>
      <Card className="p-5">
        <SignInForm side="buyer" />
      </Card>
    </div>
  );
}
