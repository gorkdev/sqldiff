"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "tr" | "en";

export const STRINGS = {
  tr: {
    title: "sqldiff",
    subtitle: "İki MySQL dump'ını karşılaştır. Eski'de olup yeni'de eksik satırları çıkar.",
    oldLabel: "ESKİ YEDEK",
    newLabel: "YENİ DB (hedef)",
    oldHint: "referans · eksiklikler buradan alınacak",
    newHint: "hedef · sync.sql buraya uygulanacak",
    drop: "Sürükle bırak veya tıkla",
    sqlOnly: "MySQL dump (.sql)",
    compare: "Karşılaştır →",
    uploading: "yükleniyor…",
    reset: "✕ sıfırla",
    queued: "Sırada…",
    parsingOld: "Eski yedek okunuyor",
    parsingNew: "Yeni DB okunuyor",
    diffing: "Fark hesaplanıyor",
    current: "Şu an",
    rowsSeen: "satır okundu",
    tablesWord: "tablo",
    missingTotal: "eksik satır",
    selectAll: "tümünü seç",
    clearOne: "temizle",
    selected: "seçili",
    statement: "ifade",
    statements: "ifade",
    preparing: "hazırlanıyor…",
    download: "↓ sync.sql indir",
    noChanges: "fark yok",
    nothingMissing: "eksik yok",
    noPk: "PK yok",
    noPkTip: "Bu tabloda primary key yok — INSERT IGNORE hedefte dup'lara karşı koruma sağlayamaz",
    catExtra: "fazla (yeni'de var, eski'de yok)",
    catChanged: "değişen (ikisinde var, içerik farklı)",
    catMissing: "eksik (eski'de var, yeni'de yok)",
    extraHelp: "yok sayılır",
    changedHelp: "yok sayılır",
    missingHelp: "yeni'ye eklenecek",
    more: "diğer",
    appliesTo: "Uygulanacak hedef:",
    appliesToTarget: "yeni DB",
    note: "Bu SQL yeni DB'ye uygulandığında, eski yedekteki ama yeni'de eksik olan satırlar INSERT IGNORE ile eklenir. Yeni'deki mevcut satırlara dokunulmaz.",
    error: "Bir şeyler ters gitti.",
  },
  en: {
    title: "sqldiff",
    subtitle: "Compare two MySQL dumps. Extract rows present in OLD but missing in NEW.",
    oldLabel: "OLD BACKUP",
    newLabel: "NEW DB (target)",
    oldHint: "reference · missing rows come from here",
    newHint: "target · sync.sql will apply here",
    drop: "Drop or click",
    sqlOnly: "MySQL dump (.sql)",
    compare: "Compare →",
    uploading: "uploading…",
    reset: "✕ reset",
    queued: "Queued…",
    parsingOld: "Parsing old backup",
    parsingNew: "Parsing new DB",
    diffing: "Computing diff",
    current: "Current",
    rowsSeen: "rows seen",
    tablesWord: "tables",
    missingTotal: "missing rows",
    selectAll: "select all",
    clearOne: "clear",
    selected: "selected",
    statement: "statement",
    statements: "statements",
    preparing: "preparing…",
    download: "↓ sync.sql",
    noChanges: "no changes",
    nothingMissing: "nothing missing",
    noPk: "no pk",
    noPkTip: "This table has no primary key — INSERT IGNORE cannot de-duplicate against the target",
    catExtra: "extra (in new, not in old)",
    catChanged: "changed (in both, content differs)",
    catMissing: "missing (in old, not in new)",
    extraHelp: "ignored",
    changedHelp: "ignored",
    missingHelp: "will be added to new",
    more: "more",
    appliesTo: "Target:",
    appliesToTarget: "new DB",
    note: "Applied to new DB: rows present in the old backup but missing from new are inserted via INSERT IGNORE. Existing rows on the target are not touched.",
    error: "Something went wrong.",
  },
} as const;

export type StringKey = keyof typeof STRINGS.tr;

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (k: StringKey) => string;
};

const LocaleContext = createContext<Ctx>({
  locale: "tr",
  setLocale: () => {},
  t: (k) => STRINGS.tr[k],
});

const STORAGE_KEY = "sqldiff:locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("tr");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "tr" || saved === "en") setLocaleState(saved);
    } catch {
      /* localStorage not available */
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* localStorage not available */
    }
  };

  const t = (k: StringKey) => STRINGS[locale][k] ?? STRINGS.tr[k];

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): Ctx {
  return useContext(LocaleContext);
}

export function LocaleToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const next: Locale = locale === "tr" ? "en" : "tr";
  // Show the flag of the OTHER language (what you'll switch to)
  const flag = next === "en" ? "🇬🇧" : "🇹🇷";
  const label = next === "en" ? "English" : "Türkçe";
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={`Switch to ${label}`}
      title={label}
      className={`text-lg leading-none hover:opacity-70 transition-opacity ${className}`}
    >
      {flag}
    </button>
  );
}
