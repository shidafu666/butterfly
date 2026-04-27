'use client';

import React, { useState } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { App, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { AuthProvider } from '@/contexts/AuthContext';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

const DARK_TOKENS = {
  colorPrimary: '#1677ff',
  colorBgContainer: '#161b22',
  colorBgElevated: '#1c2128',
  colorBgLayout: '#0d1117',
  colorBorder: '#30363d',
  colorText: '#c9d1d9',
  colorTextSecondary: '#8b949e',
  borderRadius: 6,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const LIGHT_TOKENS = {
  colorPrimary: '#1677ff',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#f6f8fa',
  colorBorder: '#d0d7de',
  colorText: '#24292f',
  colorTextSecondary: '#57606a',
  borderRadius: 6,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const DARK_COMPONENTS = {
  Layout: { siderBg: '#161b22', headerBg: '#161b22', bodyBg: '#0d1117' },
  Menu: { darkItemBg: '#161b22', darkSubMenuItemBg: '#0d1117', darkItemSelectedBg: '#1f2937' },
  Table: { colorBgContainer: '#161b22', headerBg: '#1c2128' },
  Card: { colorBgContainer: '#161b22' },
  Modal: { contentBg: '#161b22', headerBg: '#161b22' },
  Drawer: { colorBgElevated: '#161b22' },
};

const LIGHT_COMPONENTS = {
  Layout: { siderBg: '#ffffff', headerBg: '#ffffff', bodyBg: '#f6f8fa' },
  Menu: { itemBg: '#ffffff', subMenuItemBg: '#f6f8fa' },
  Table: { colorBgContainer: '#ffffff', headerBg: '#f6f8fa' },
  Card: { colorBgContainer: '#ffffff' },
  Modal: { contentBg: '#ffffff', headerBg: '#ffffff' },
  Drawer: { colorBgElevated: '#ffffff' },
};

function AntdConfigProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();
  const { themeMode } = useTheme();
  const isDark = themeMode === 'dark';

  return (
    <ConfigProvider
      locale={locale === 'zh' ? zhCN : enUS}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: isDark ? DARK_TOKENS : LIGHT_TOKENS,
        components: isDark ? DARK_COMPONENTS : LIGHT_COMPONENTS,
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <AntdConfigProvider>
            <AuthProvider>{children}</AuthProvider>
          </AntdConfigProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
