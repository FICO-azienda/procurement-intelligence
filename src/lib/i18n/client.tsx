"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, translator, type Locale, type Msg, type Params, type T } from "./index";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Set once in the layout: every client component below reads the language from here. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** The translator for the language in use, in a client component. */
export const useT = (): T => translator(useContext(LocaleContext));

/**
 * One translated text as an element — for components that are rendered on
 * both sides (badges, shared UI) and so cannot ask the server for a translator.
 */
export function Tx({ msg, params }: { msg: Msg; params?: Params }) {
  return <>{useT()(msg, params)}</>;
}
