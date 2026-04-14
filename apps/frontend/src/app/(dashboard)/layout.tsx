'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Button,
  Typography,
  Space,
  Tooltip,
} from 'antd';
import {
  DashboardOutlined,
  LineChartOutlined,
  ExportOutlined,
  TeamOutlined,
  AuditOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ThunderboltOutlined,
  RadarChartOutlined,
  GlobalOutlined,
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemePreference } from '@/contexts/ThemeContext';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, isAdmin, isAuditor } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const { themeMode, themePreference, setThemePreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  const isDark = themeMode === 'dark';

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: t('nav.overview'),
    },
    {
      key: '/current-data',
      icon: <LineChartOutlined />,
      label: t('nav.currentData'),
    },
    {
      key: '/exports',
      icon: <ExportOutlined />,
      label: t('nav.exports'),
    },
    ...(isAdmin || isAuditor
      ? [
          {
            key: 'admin',
            icon: <TeamOutlined />,
            label: t('nav.system'),
            children: [
              ...(isAdmin
                ? [
                    {
                      key: '/admin/users',
                      icon: <TeamOutlined />,
                      label: t('nav.users'),
                    },
                    {
                      key: '/admin/devices',
                      icon: <RadarChartOutlined />,
                      label: t('nav.devices'),
                    },
                  ]
                : []),
              {
                key: '/admin/audit',
                icon: <AuditOutlined />,
                label: t('nav.audit'),
              },
            ],
          },
        ]
      : []),
  ];

  const getSelectedKeys = () => {
    if (pathname.startsWith('/admin/users')) return ['/admin/users'];
    if (pathname.startsWith('/admin/devices')) return ['/admin/devices'];
    if (pathname.startsWith('/admin/audit')) return ['/admin/audit'];
    if (pathname.startsWith('/current-data')) return ['/current-data'];
    if (pathname.startsWith('/exports')) return ['/exports'];
    return ['/dashboard'];
  };

  const getOpenKeys = () => {
    if (pathname.startsWith('/admin')) return ['admin'];
    return [];
  };

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: user?.email || '',
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('nav.logout'),
      danger: true,
    },
  ];

  const themeMenuItems = [
    {
      key: 'system',
      icon: <DesktopOutlined />,
      label: t('common.themeSystem'),
    },
    {
      key: 'light',
      icon: <SunOutlined />,
      label: t('common.themeLight'),
    },
    {
      key: 'dark',
      icon: <MoonOutlined />,
      label: t('common.themeDark'),
    },
  ];

  const themeIcon =
    themePreference === 'light' ? <SunOutlined /> :
    themePreference === 'dark'  ? <MoonOutlined /> :
    <DesktopOutlined />;

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--brand-bg)' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        style={{
          background: 'var(--brand-surface)',
          borderRight: '1px solid var(--brand-border)',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'auto',
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '0' : '0 16px',
            borderBottom: '1px solid var(--brand-border)',
            gap: 10,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={() => router.push('/dashboard')}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1677ff 0%, #0050b3 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ThunderboltOutlined style={{ fontSize: 16, color: '#fff' }} />
          </div>
          {!collapsed && (
            <Text strong style={{ color: 'var(--brand-text)', fontSize: 16, letterSpacing: 1 }}>
              Butterfly
            </Text>
          )}
        </div>

        <Menu
          theme={isDark ? 'dark' : 'light'}
          mode="inline"
          selectedKeys={getSelectedKeys()}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{
            background: 'var(--brand-surface)',
            border: 'none',
            marginTop: 8,
          }}
        />
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? 80 : 220,
          transition: 'margin-left 0.2s',
          background: 'var(--brand-bg)',
        }}
      >
        <Header
          style={{
            background: 'var(--brand-surface)',
            borderBottom: '1px solid var(--brand-border)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            height: 64,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ color: 'var(--brand-text-secondary)', fontSize: 16 }}
          />

          <Space size={8}>
            {/* Theme switcher */}
            <Dropdown
              menu={{
                items: themeMenuItems,
                selectedKeys: [themePreference],
                onClick: ({ key }) => setThemePreference(key as ThemePreference),
              }}
              trigger={['click']}
            >
              <Tooltip title={t('common.theme')}>
                <Button
                  type="text"
                  icon={themeIcon}
                  style={{ color: 'var(--brand-text-secondary)', fontSize: 15 }}
                />
              </Tooltip>
            </Dropdown>

            {/* Language switcher */}
            <Tooltip title={locale === 'zh' ? 'Switch to English' : '切换为中文'}>
              <Button
                type="text"
                icon={<GlobalOutlined />}
                onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
                style={{
                  color: 'var(--brand-text-secondary)',
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {locale === 'zh' ? 'EN' : '中'}
              </Button>
            </Tooltip>

            {user && (
              <Tooltip title={user.email}>
                <Dropdown
                  menu={{
                    items: userMenuItems,
                    onClick: ({ key }) => {
                      if (key === 'logout') logout();
                    },
                  }}
                  trigger={['click']}
                >
                  <Space style={{ cursor: 'pointer' }}>
                    <Avatar
                      size="small"
                      style={{ background: '#1677ff', cursor: 'pointer' }}
                      icon={<UserOutlined />}
                    />
                    <Text style={{ color: 'var(--brand-text)', fontSize: 13 }}>
                      {user.name || user.email}
                    </Text>
                  </Space>
                </Dropdown>
              </Tooltip>
            )}
          </Space>
        </Header>

        <Content
          style={{
            padding: 24,
            minHeight: 'calc(100vh - 64px)',
            background: 'var(--brand-bg)',
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </AuthGuard>
  );
}
