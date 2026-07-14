'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Spin, Typography } from 'antd';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { ssoErrorMessage } from '@/lib/ssoErrors';
import type { EntraExchangeRequest, LoginResponse } from '@butterfly/shared-types';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useLocale();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const providerError = params.get('sso_error');
    if (providerError || !code) {
      setError(ssoErrorMessage(t, providerError));
      return;
    }

    const returnTo = params.get('returnTo');
    const destination =
      returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';

    api
      .post<LoginResponse>('/auth/entra/exchange', { code } satisfies EntraExchangeRequest)
      .then(({ data }) => {
        login(data.accessToken, data.user);
        router.replace(destination);
      })
      .catch(() => setError(ssoErrorMessage(t, 'exchange')));
  }, [login, router, t]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--brand-bg)',
      }}
    >
      <Card style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        {error ? (
          <Alert type="error" showIcon message={error} />
        ) : (
          <>
            <Spin size="large" />
            <Typography.Paragraph style={{ marginTop: 20, marginBottom: 0 }}>
              {t('login.ssoCompleting')}
            </Typography.Paragraph>
          </>
        )}
      </Card>
    </div>
  );
}
