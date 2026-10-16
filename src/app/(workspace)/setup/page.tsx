import type { Metadata } from "next";
import { getDb } from "@/db";
import { SetupStep } from "@/components/setup-step";
import { getSettings, getT } from "@/lib/data";
import { dataState } from "@/server/data-guard";
import { readDestinations } from "@/server/destinations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Your company") };
}

/** Who the company is: asked on the first start, and here whenever someone wants to say it again in one place. */
export default async function SetupPage() {
  const [settings, t] = await Promise.all([getSettings(), getT()]);
  const db = await getDb();
  const [destinations, state] = await Promise.all([readDestinations(db), dataState(db)]);
  return <SetupStep t={t} settings={settings} hasDestination={destinations.length > 0} empty={state === "empty"} then="/import" />;
}
