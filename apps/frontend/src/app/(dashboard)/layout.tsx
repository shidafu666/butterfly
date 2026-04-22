'use client';

import React, { useEffect, useState } from 'react';
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
  Modal,
  Form,
  Input,
  message,
} from 'antd';
import {
  DashboardOutlined,
  LineChartOutlined,
  ExportOutlined,
  TeamOutlined,
  AuditOutlined,
  LogoutOutlined,
  UserOutlined,
  LockOutlined,
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
import { ExportJobNotifier } from '@/components/ExportJobNotifier';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemePreference } from '@/contexts/ThemeContext';
import type { ChangePasswordRequest } from '@butterfly/shared-types';
import { api } from '@/lib/api';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, isAdmin, isAuditor } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const { themeMode, themePreference, setThemePreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [messageApi, messageContextHolder] = message.useMessage();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordForm] = Form.useForm<ChangePasswordRequest & { confirmPassword: string }>();

  const isDark = themeMode === 'dark';

  useEffect(() => {
    if (!passwordModalOpen) {
      passwordForm.resetFields();
      setPasswordSubmitting(false);
    }
  }, [passwordForm, passwordModalOpen]);

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
    ...(user?.localAuth
      ? [
          {
            key: 'change-password',
            icon: <LockOutlined />,
            label: t('nav.changePassword'),
          },
        ]
      : []),
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

  const handleChangePassword = async (values: ChangePasswordRequest & { confirmPassword: string }) => {
    setPasswordSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setPasswordModalOpen(false);
      messageApi.success(t('changePassword.success'));
      window.setTimeout(() => logout(), 800);
    } catch (error) {
      const nextMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message !== 'undefined'
          ? (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message
          : undefined;
      const description = Array.isArray(nextMessage) ? nextMessage[0] : nextMessage;
      messageApi.error(description || t('changePassword.failed'));
    } finally {
      setPasswordSubmitting(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--brand-bg)' }}>
      {messageContextHolder}
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
                      if (key === 'change-password') setPasswordModalOpen(true);
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
          <ExportJobNotifier />
          {children}
        </Content>
      </Layout>

      <Modal
        title={t('changePassword.title')}
        open={passwordModalOpen}
        onCancel={() => setPasswordModalOpen(false)}
        onOk={() => passwordForm.submit()}
        confirmLoading={passwordSubmitting}
        okText={t('changePassword.submit')}
        cancelText={t('common.cancel')}
        destroyOnHidden
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
          autoComplete="off"
        >
          <Form.Item
            name="currentPassword"
            label={t('changePassword.currentPassword')}
            rules={[{ required: true, message: t('changePassword.currentPasswordRequired') }]}
          >
            <Input.Password
              placeholder={t('changePassword.currentPasswordPlaceholder')}
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label={t('changePassword.newPassword')}
            rules={[
              { required: true, message: t('changePassword.newPasswordRequired') },
              { min: 8, message: t('changePassword.passwordMinLength') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('currentPassword') !== value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('changePassword.passwordMustDiffer')));
                },
              }),
            ]}
          >
            <Input.Password
              placeholder={t('changePassword.newPasswordPlaceholder')}
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label={t('changePassword.confirmPassword')}
            dependencies={['newPassword']}
            rules={[
              { required: true, message: t('changePassword.confirmPasswordRequired') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('changePassword.passwordMismatch')));
                },
              }),
            ]}
          >
            <Input.Password
              placeholder={t('changePassword.confirmPasswordPlaceholder')}
              autoComplete="new-password"
            />
          </Form.Item>
        </Form>
      </Modal>
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
