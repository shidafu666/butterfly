'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { UserProfile } from '@butterfly/shared-types';
import { api } from '@/lib/api';
import { getToken, clearToken, setToken } from '@/lib/auth';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (token: string, user: UserProfile) => void;
  logout: () => void;
  isAdmin: boolean;
  isAuditor: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
  isAdmin: false,
  isAuditor: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<UserProfile>('/auth/me', { timeout: 8000 });
      setUser(res.data);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const login = useCallback((token: string, userProfile: UserProfile) => {
    setToken(token);
    setUser(userProfile);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    window.location.href = '/login';
  }, []);

  const isAdmin = user?.roles?.includes('admin') ?? false;
  const isAuditor = user?.roles?.includes('auditor') ?? false;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isAuditor }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
