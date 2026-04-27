'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Alert, Typography, Divider, Space, Card } from 'antd';
import { MailOutlined, LockOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { setToken, isAuthenticated } from '@/lib/auth';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import type { LoginResponse } from '@butterfly/shared-types';

const { Title, Text } = Typography;

const SSO_ENABLED = !!process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useLocale();
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
      setError(axiosErr.response?.data?.message || t('login.loginFailed'));
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
      setError(axiosErr.response?.data?.message || axiosErr.message || t('login.ssoFailed'));
    } finally {
      setSsoLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--brand-bg)',
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
          background: 'var(--brand-surface)',
          border: '1px solid var(--brand-border)',
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
          <Title level={3} style={{ color: 'var(--brand-text)', margin: 0 }}>
            Butterfly
          </Title>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
            {t('login.subtitle')}
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
              { required: true, message: t('login.emailRequired') },
              { type: 'email', message: t('login.emailInvalid') },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: 'var(--brand-text-secondary)' }} />}
              placeholder={t('login.emailPlaceholder')}
              autoComplete="email"
              style={{ background: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.passwordRequired') }]}
            style={{ marginBottom: 24 }}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: 'var(--brand-text-secondary)' }} />}
              placeholder={t('login.passwordPlaceholder')}
              autoComplete="current-password"
              style={{ background: 'var(--brand-bg)', borderColor: 'var(--brand-border)' }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 44 }}>
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>

        {SSO_ENABLED && (
          <>
            <Divider
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-secondary)',
                fontSize: 12,
              }}
            >
              {t('login.or')}
            </Divider>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                block
                size="large"
                loading={ssoLoading}
                onClick={handleSsoLogin}
                style={{
                  height: 44,
                  background: 'var(--brand-bg)',
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text)',
                }}
              >
                {t('login.ssoButton')}
              </Button>
            </Space>
          </>
        )}
      </Card>
    </div>
  );
}
