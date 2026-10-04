import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence with elements inside it:
 *
 *   rich(t("Costs about {amount} a year"), { amount: <b>€900</b> })
 *
 * The sentence is translated whole — word order differs between languages —
 * and the elements land where its placeholders are.
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/g).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in parts ? <Fragment key={i}>{parts[name]}</Fragment> : piece;
  });
}
