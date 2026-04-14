'use client';

import React, { useState } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { AuthProvider } from '@/contexts/AuthContext';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';

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

function AntdConfigProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();

  return (
    <ConfigProvider
      locale={locale === 'zh' ? zhCN : enUS}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
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
        },
        components: {
          Layout: {
            siderBg: '#161b22',
            headerBg: '#161b22',
            bodyBg: '#0d1117',
          },
          Menu: {
            darkItemBg: '#161b22',
            darkSubMenuItemBg: '#0d1117',
            darkItemSelectedBg: '#1f2937',
          },
          Table: {
            colorBgContainer: '#161b22',
            headerBg: '#1c2128',
          },
          Card: {
            colorBgContainer: '#161b22',
          },
          Modal: {
            contentBg: '#161b22',
            headerBg: '#161b22',
          },
          Drawer: {
            colorBgElevated: '#161b22',
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <AntdConfigProvider>
          <AuthProvider>{children}</AuthProvider>
        </AntdConfigProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
