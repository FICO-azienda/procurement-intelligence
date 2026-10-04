import { ButtonLink } from "@/components/ui";
import { getT } from "@/lib/data";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="flex flex-col items-start py-16">
      <div className="text-[12.5px] font-medium text-ink-3">{t("Not found")}</div>
      <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.022em]">{t("This record doesn't exist")}</h1>
      <p className="mt-2 max-w-md text-[13.5px] text-ink-3">{t("It may have been deleted, or the demo data was reloaded and it has a new address. Search for it, or start from the overview.")}</p>
      <div className="mt-6 flex gap-2">
        <ButtonLink href="/" variant="primary">
          {t("Go to the overview")}
        </ButtonLink>
        <ButtonLink href="/products">{t("Products")}</ButtonLink>
      </div>
    </div>
  );
}
