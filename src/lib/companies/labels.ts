/** How the parts a company plays are said: labels for the roles, and the roles of one company in a few words. */
import type { Msg, T } from "../i18n";
import { ROLE_KINDS, type RoleKind } from "./plan";

export const ROLE_LABEL: Record<RoleKind, Msg> = {
  supplier: "Supplier",
  registered: "Registered on the portal",
  reply: "Answered a request",
  directory: "In a market directory",
  candidate: "Candidate",
};

/** The parts a company plays, in a few words each. */
export function roleChips(t: T, roles: Record<RoleKind, number>) {
  return ROLE_KINDS.filter((k) => roles[k] > 0).map((k) =>
    k === "candidate" ? t.n(roles[k], "Candidate for {n} product", "Candidate for {n} products") : k === "supplier" && roles[k] > 1 ? t("Supplier ({n} records)", { n: roles[k] }) : t(ROLE_LABEL[k]),
  );
}
