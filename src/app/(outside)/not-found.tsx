import { getOutsideT } from "@/server/session";

export default async function NotFound() {
  const t = await getOutsideT();
  return (
    <div className="mx-auto max-w-[520px] px-6 py-24">
      <div className="text-[12.5px] font-medium text-ink-3">{t("Not found")}</div>
      <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">{t("This page does not exist")}</h1>
      <p className="mt-2 text-[13.5px] text-ink-3">{t("The address may be wrong, or what it showed is not available to you.")}</p>
    </div>
  );
}
