"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Lang = "ko" | "en";

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LanguageContext = createContext<LangCtx>({ lang: "ko", setLang: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ko");

  useEffect(() => {
    const stored = localStorage.getItem("laki_lang");
    if (stored === "en" || stored === "ko") setLangState(stored as Lang);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("laki_lang", l);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
