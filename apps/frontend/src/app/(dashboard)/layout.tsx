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
} from '@ant-design/icons';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/contexts/AuthContext';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, isAdmin, isAuditor } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '概览',
    },
    {
      key: '/current-data',
      icon: <LineChartOutlined />,
      label: '电流数据',
    },
    {
      key: '/exports',
      icon: <ExportOutlined />,
      label: '导出任务',
    },
    ...(isAdmin || isAuditor
      ? [
          {
            key: 'admin',
            icon: <TeamOutlined />,
            label: '系统管理',
            children: [
              ...(isAdmin
                ? [
                    {
                      key: '/admin/users',
                      icon: <TeamOutlined />,
                      label: '用户管理',
                    },
                    {
                      key: '/admin/devices',
                      icon: <RadarChartOutlined />,
                      label: '设备清单',
                    },
                  ]
                : []),
              {
                key: '/admin/audit',
                icon: <AuditOutlined />,
                label: '审计日志',
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
      label: '退出登录',
      danger: true,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#0d1117' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        style={{
          background: '#161b22',
          borderRight: '1px solid #30363d',
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
            borderBottom: '1px solid #30363d',
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
            <Text strong style={{ color: '#c9d1d9', fontSize: 16, letterSpacing: 1 }}>
              Butterfly
            </Text>
          )}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={getSelectedKeys()}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{
            background: '#161b22',
            border: 'none',
            marginTop: 8,
          }}
        />
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? 80 : 220,
          transition: 'margin-left 0.2s',
          background: '#0d1117',
        }}
      >
        <Header
          style={{
            background: '#161b22',
            borderBottom: '1px solid #30363d',
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
            style={{ color: '#8b949e', fontSize: 16 }}
          />

          <Space>
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
                    <Text style={{ color: '#c9d1d9', fontSize: 13 }}>
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
            background: '#0d1117',
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
