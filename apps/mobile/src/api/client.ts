/**
 * Talks to the MAVY NEWS server. Handles guest tokens, login tokens and silent refresh.
 * No secret keys live in the app — only the server address.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useSettings } from '../store/settings';

export const DEFAULT_SERVER = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
/** Current server: the address set in Profile, or the one built into the app. */
export const serverUrl = () => (useSettings.getState().serverUrl || DEFAULT_SERVER).replace(/\/$/, '');
const base = () => `${serverUrl()}/api/v1`;

// Tokens go in the phone's secure keychain (AsyncStorage only on web preview).
const vault = {
  get: (k: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

interface AuthState {
  ready: boolean;
  loggedIn: boolean;
  access: string | null;
  refresh: string | null;
}
export const useAuth = create<AuthState>(() => ({ ready: false, loggedIn: false, access: null, refresh: null }));

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

async function getGuestToken() {
  const res = await fetch(`${base()}/auth/guest`, { method: 'POST' });
  if (!res.ok) throw new ApiError(res.status, 'Server unavailable');
  const { accessToken } = await res.json();
  await vault.set('access', accessToken);
  useAuth.setState({ access: accessToken, refresh: null, loggedIn: false });
}

/** Call once at app start. */
export async function initAuth() {
  const [access, refresh] = await Promise.all([vault.get('access'), vault.get('refresh')]);
  useAuth.setState({ access, refresh, loggedIn: !!refresh, ready: true });
  if (!access) getGuestToken().catch(() => undefined); // retried on first request if offline
}

export async function saveLogin(accessToken: string, refreshToken: string) {
  await Promise.all([vault.set('access', accessToken), vault.set('refresh', refreshToken)]);
  useAuth.setState({ access: accessToken, refresh: refreshToken, loggedIn: true });
}

export async function logout() {
  const { refresh } = useAuth.getState();
  if (refresh) fetch(`${base()}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) }).catch(() => undefined);
  await Promise.all([vault.del('access'), vault.del('refresh')]);
  useAuth.setState({ access: null, refresh: null, loggedIn: false });
  await getGuestToken().catch(() => undefined);
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  const { refresh } = useAuth.getState();
  if (!refresh) {
    await getGuestToken().catch(() => undefined);
    return !!useAuth.getState().access;
  }
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${base()}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
      if (!res.ok) {
        await logout();
        return false;
      }
      const t = await res.json();
      await saveLogin(t.accessToken, t.refreshToken);
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  if (!useAuth.getState().access) await getGuestToken().catch(() => undefined);
  const { access } = useAuth.getState();
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No internet connection');
  }
  if (res.status === 401 && opts.retry !== false && (await tryRefresh())) return api<T>(path, { ...opts, retry: false });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new ApiError(res.status, msg ?? 'Something went wrong');
  }
  return data as T;
}

/** Sends a form with one photo (multipart). Works on phones and in the web preview. */
export async function apiUpload<T>(path: string, fields: Record<string, string>, file: { uri: string; name: string; type?: string }, retry = true): Promise<T> {
  const { access } = useAuth.getState();
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (Platform.OS === 'web') fd.append('file', await (await fetch(file.uri)).blob(), file.name);
  else fd.append('file', { uri: file.uri, name: file.name, type: file.type ?? 'image/jpeg' } as any);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { method: 'POST', headers: access ? { Authorization: `Bearer ${access}` } : {}, body: fd });
  } catch {
    throw new ApiError(0, 'No internet connection');
  }
  if (res.status === 401 && retry && (await tryRefresh())) return apiUpload<T>(path, fields, file, false);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new ApiError(res.status, msg ?? 'Something went wrong');
  }
  return data as T;
}

export const qs = (params: Record<string, string | number | boolean | undefined | null | string[]>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

/** Checks a server address; returns null if OK or an error message. */
export async function testServer(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const h = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${url.replace(/\/$/, '')}/api/v1/health`, { signal: ctrl.signal });
    clearTimeout(h);
    const j = await res.json().catch(() => null);
    return res.ok && j?.status === 'ok' ? null : `Server answered ${res.status}`;
  } catch {
    return 'Cannot reach this address';
  }
}

/** Switch to another server: old tokens belong to the old server, so start fresh as a guest. */
export async function switchServer(url: string) {
  await Promise.all([vault.del('access'), vault.del('refresh')]);
  useAuth.setState({ access: null, refresh: null, loggedIn: false });
  useSettings.getState().setServerUrl(url.trim().replace(/\/$/, ''));
  await getGuestToken().catch(() => undefined);
}
