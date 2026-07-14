import axios from 'axios';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const API_V1_BASE = API_BASE_URL ? `${API_BASE_URL}/api/v1` : '/api/v1';

export const api = axios.create({ baseURL: API_V1_BASE });
export const ssoLoginPath = `${API_V1_BASE}/auth/entra/login?returnTo=%2Fdashboard`;

// Add auth header
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('cyberbee_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('cyberbee_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
