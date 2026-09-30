import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start py-16">
      <div className="text-[12.5px] font-medium text-ink-3">Not found</div>
      <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.022em]">This record doesn&apos;t exist</h1>
      <p className="mt-2 max-w-md text-[13.5px] text-ink-3">
        It may have been deleted, or the demo data was reloaded and it has a new address.
      </p>
      <div className="mt-6 flex gap-2">
        <ButtonLink href="/" variant="primary">
          Go to Today
        </ButtonLink>
        <ButtonLink href="/products">Products</ButtonLink>
      </div>
    </div>
  );
}
