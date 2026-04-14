'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'butterfly_theme';

interface ThemeContextValue {
  themePreference: ThemePreference;
  themeMode: ThemeMode;
  setThemePreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themePreference: 'system',
  themeMode: 'dark',
  setThemePreference: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [systemDark, setSystemDark] = useState(true); // default dark until mounted

  // Detect system preference and listen for changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Read stored preference after mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setPreference(stored);
    }
  }, []);

  const themeMode: ThemeMode =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Apply data-theme attribute to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const setThemePreference = useCallback((p: ThemePreference) => {
    setPreference(p);
    localStorage.setItem(STORAGE_KEY, p);
  }, []);

  return (
    <ThemeContext.Provider value={{ themePreference: preference, themeMode, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
