'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Form,
  Input,
  Button,
  Alert,
  Typography,
  Divider,
  Space,
  Card,
} from 'antd';
import { MailOutlined, LockOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { setToken, isAuthenticated } from '@/lib/auth';
import { useAuth } from '@/contexts/AuthContext';
import type { LoginResponse } from '@butterfly/shared-types';

const { Title, Text } = Typography;

const SSO_ENABLED = !!(process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID);

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/dashboard');
    }
  }, [router]);

  const handleLogin = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/auth/login', values);
      const { accessToken, user } = res.data;
      login(accessToken, user);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(
        axiosErr.response?.data?.message ||
          '登录失败，请检查邮箱和密码后重试。'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSsoLogin = async () => {
    setSsoLoading(true);
    setError(null);
    try {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const { msalConfig, loginRequest } = await import('@/lib/msalConfig');
      const msalInstance = new PublicClientApplication(msalConfig);
      await msalInstance.initialize();
      const result = await msalInstance.loginPopup(loginRequest);
      const entraToken = result.idToken;
      const res = await api.post<LoginResponse>('/auth/entra-login', { entraToken });
      const { accessToken, user } = res.data;
      login(accessToken, user);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      setError(
        axiosErr.response?.data?.message ||
          axiosErr.message ||
          'SSO 登录失败，请稍后重试。'
      );
    } finally {
      setSsoLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d1117',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
        }}
        bodyStyle={{ padding: '40px 40px 32px' }}
      >
        {/* Logo & Title */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1677ff 0%, #0050b3 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <ThunderboltOutlined style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <Title level={3} style={{ color: '#c9d1d9', margin: 0 }}>
            Butterfly
          </Title>
          <Text style={{ color: '#8b949e', fontSize: 13 }}>
            电流数据采集与可视化平台
          </Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 24 }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleLogin}
          requiredMark={false}
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#8b949e' }} />}
              placeholder="邮箱"
              autoComplete="email"
              style={{ background: '#0d1117', borderColor: '#30363d' }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
            style={{ marginBottom: 24 }}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#8b949e' }} />}
              placeholder="密码"
              autoComplete="current-password"
              style={{ background: '#0d1117', borderColor: '#30363d' }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ height: 44 }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        {SSO_ENABLED && (
          <>
            <Divider style={{ borderColor: '#30363d', color: '#8b949e', fontSize: 12 }}>
              或
            </Divider>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                block
                size="large"
                loading={ssoLoading}
                onClick={handleSsoLogin}
                style={{
                  height: 44,
                  background: '#0d1117',
                  borderColor: '#30363d',
                  color: '#c9d1d9',
                }}
              >
                Microsoft SSO 登录
              </Button>
            </Space>
          </>
        )}
      </Card>
    </div>
  );
}
