'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { zh } from '@/locales/zh';
import { en } from '@/locales/en';
import type { Translations } from '@/locales/zh';

export type Locale = 'zh' | 'en';

const translations: Record<Locale, Translations> = { zh, en };

const STORAGE_KEY = 'butterfly_locale';

type NestedRecord = { [key: string]: string | NestedRecord };

function getNestedValue(obj: NestedRecord, keys: string[]): string {
  let val: string | NestedRecord | undefined = obj;
  for (const key of keys) {
    if (val && typeof val === 'object') {
      val = (val as NestedRecord)[key];
    } else {
      return keys.join('.');
    }
  }
  return typeof val === 'string' ? val : keys.join('.');
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh',
  setLocale: () => {},
  t: (key) => key,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh');

  // Read persisted preference after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored === 'zh' || stored === 'en') {
      setLocaleState(stored);
    }
  }, []);

  // Sync dayjs locale and html lang attribute
  useEffect(() => {
    const setDayjsLocale = async () => {
      const dayjs = (await import('dayjs')).default;
      if (locale === 'zh') {
        await import('dayjs/locale/zh-cn');
        dayjs.locale('zh-cn');
      } else {
        dayjs.locale('en');
      }
    };
    setDayjsLocale();
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const keys = key.split('.');
      let str = getNestedValue(
        translations[locale] as unknown as NestedRecord,
        keys,
      );
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
