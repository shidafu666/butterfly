'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';
import { useAuth } from '@/contexts/AuthContext';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireAuditor?: boolean;
}

export function AuthGuard({ children, requireAdmin, requireAuditor }: AuthGuardProps) {
  const router = useRouter();
  const { user, loading, isAdmin, isAuditor } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (requireAdmin && !isAdmin) {
      router.replace('/dashboard');
      return;
    }
    if (requireAuditor && !isAuditor && !isAdmin) {
      router.replace('/dashboard');
      return;
    }
  }, [user, loading, router, requireAdmin, requireAuditor, isAdmin, isAuditor]);

  if (loading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--brand-bg)',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!user) return null;
  if (requireAdmin && !isAdmin) return null;
  if (requireAuditor && !isAuditor && !isAdmin) return null;

  return <>{children}</>;
}
