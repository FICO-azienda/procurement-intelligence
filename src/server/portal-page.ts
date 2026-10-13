/** What every page of the supplier portal starts from: the person signed in — or the way to the sign-in page. */
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { getOutsideT, supplierPrincipal } from "./session";

export async function portal() {
  const who = await supplierPrincipal();
  if (!who) redirect("/portal/login");
  return { who, db: await getDb(), t: await getOutsideT(), today: todayISO() };
}
