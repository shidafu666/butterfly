import { Configuration, PopupRequest } from '@azure/msal-browser';

const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID || '';
const authority =
  process.env.NEXT_PUBLIC_ENTRA_AUTHORITY ||
  `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_ENTRA_TENANT_ID || 'common'}`;
const redirectUri =
  process.env.NEXT_PUBLIC_ENTRA_REDIRECT_URI ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority,
    redirectUri,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', 'email'],
};

export const isSsoEnabled = (): boolean => {
  return !!(typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID);
};
