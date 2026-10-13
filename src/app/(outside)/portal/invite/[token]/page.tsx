import Link from "next/link";
import type { Metadata } from "next";
import { JoinButton, RegisterForm } from "@/components/orders/portal";
import { Card } from "@/components/ui";
import { getDb } from "@/db";
import { readInvite } from "@/server/orgs";
import { getOutsideT, supplierPrincipal } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Invitation") };
}

export default async function InvitePage({ params }: PageProps<"/portal/invite/[token]">) {
  const [{ token }, t, who] = await Promise.all([params, getOutsideT(), supplierPrincipal()]);
  const invite = await readInvite(await getDb(), token);
  if (!invite || invite.state !== "open")
    return (
      <div className="mx-auto max-w-[520px] pt-10">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{invite?.state === "accepted" ? t("This invitation was accepted already") : t("This invitation is not valid")}</h1>
        <p className="mt-2 text-[13.5px] text-ink-3">
          {invite?.state === "accepted" ? t("Sign in with the account that accepted it.") : invite?.state === "expired" ? t("It has expired: ask the company that invited you for a new one.") : t("The link may be incomplete, or the invitation was withdrawn: ask the company that invited you.")}
        </p>
        <Link href="/portal/login" className="mt-4 inline-block text-[13.5px] font-medium text-ledger hover:underline">
          {t("Sign in")}
        </Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-[640px] pt-6">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("{buyer} invites {company} to receive its orders here", { buyer: invite.buyerName, company: invite.companyName })}</h1>
      <p className="mt-2 mb-5 text-[13.5px] text-ink-2">
        {t("Once registered, you choose which articles {buyer} can order and at which conditions; its order requests arrive here, and you accept them, propose changes or decline. Registering is free and takes a few minutes; nothing can be ordered until you say so.", { buyer: invite.buyerName })}
      </p>
      <Card className="p-5">
        {who ? (
          <div className="flex flex-col gap-3 text-[13.5px]">
            <p>{t("You are signed in as {name} of {company}. Accepting adds {buyer} to your company's customers.", { name: who.name, company: who.orgName, buyer: invite.buyerName })}</p>
            <JoinButton token={token} company={who.orgName} />
          </div>
        ) : (
          <RegisterForm token={token} invite={invite} />
        )}
      </Card>
      {!who && (
        <p className="mt-4 text-[12.5px] text-ink-3">
          {t("Does your company have an account already?")}{" "}
          <Link href="/portal/login" className="font-medium text-ledger hover:underline">
            {t("Sign in, then open this link again")}
          </Link>
        </p>
      )}
    </div>
  );
}
