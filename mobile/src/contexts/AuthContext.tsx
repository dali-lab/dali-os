import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, api, configureClient, errorMessage } from '../api/client';
import { environment, loadEnvironment, saveEnvironment, type EnvironmentId } from '../api/env';

const TOKEN_KEY = 'dali.token';
const MIN_POLL_SECONDS = 3;

export type AuthStatus = 'loading' | 'signedOut' | 'pairing' | 'signedIn';

export interface Pairing {
  userCode: string;
  verificationUrl: string;
}

interface AuthContextValue {
  status: AuthStatus;
  environmentId: EnvironmentId;
  pairing: Pairing | null;
  error: string | null;
  startPairing: () => Promise<void>;
  reopenPairingPage: () => void;
  cancelPairing: () => void;
  signOut: () => Promise<void>;
  setEnvironment: (id: EnvironmentId) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const tokenKey = (env: EnvironmentId) => `${TOKEN_KEY}.${env}`;

const PAIR_FAILURES: Record<string, string> = {
  denied: 'Sign-in was denied. Try again.',
  expired: 'That code expired. Try again.',
  already_used: 'That code was already used. Try again.',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>('production');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pairRun = useRef(0);
  const envRef = useRef<EnvironmentId>('production');

  const clearSession = useCallback(async () => {
    pairRun.current += 1;
    configureClient({ token: null });
    await SecureStore.deleteItemAsync(tokenKey(envRef.current)).catch(() => {});
    setPairing(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    configureClient({ onUnauthorized: () => void clearSession() });
  }, [clearSession]);

  useEffect(() => {
    (async () => {
      const env = await loadEnvironment();
      envRef.current = env;
      setEnvironmentId(env);
      const token = await SecureStore.getItemAsync(tokenKey(env)).catch(() => null);
      configureClient({ baseUrl: environment(env).baseUrl, token });
      setStatus(token ? 'signedIn' : 'signedOut');
    })();
  }, []);

  const cancelPairing = useCallback(() => {
    pairRun.current += 1;
    WebBrowser.dismissBrowser();
    setPairing(null);
    setStatus('signedOut');
  }, []);

  const startPairing = useCallback(async () => {
    const run = ++pairRun.current;
    setError(null);
    setStatus('pairing');
    let start;
    try {
      start = await api.pairStart(`DALI OS Mobile (${Platform.OS === 'ios' ? 'iOS' : 'Android'})`);
    } catch (err) {
      if (run !== pairRun.current) return;
      setError(errorMessage(err));
      setStatus('signedOut');
      return;
    }
    if (run !== pairRun.current) return;
    setPairing({ userCode: start.userCode, verificationUrl: start.verificationUrl });
    WebBrowser.openBrowserAsync(start.verificationUrl).catch(() => {});

    const deadline = Date.now() + start.expiresIn * 1000;
    let interval = Math.max(MIN_POLL_SECONDS, start.interval);
    const fail = (message: string) => {
      if (run !== pairRun.current) return;
      WebBrowser.dismissBrowser();
      setPairing(null);
      setError(message);
      setStatus('signedOut');
    };

    while (run === pairRun.current) {
      await new Promise((r) => setTimeout(r, interval * 1000));
      if (run !== pairRun.current) return;
      if (Date.now() > deadline) return fail(PAIR_FAILURES.expired);
      let result;
      try {
        result = await api.pairPoll(start.deviceCode);
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          interval += 5;
          continue;
        }
        if (err instanceof ApiError && err.status === 0) continue;
        return fail(errorMessage(err));
      }
      if (run !== pairRun.current) return;
      if (result.status === 'approved') {
        await SecureStore.setItemAsync(tokenKey(envRef.current), result.desktopToken);
        configureClient({ token: result.desktopToken });
        WebBrowser.dismissBrowser();
        setPairing(null);
        setStatus('signedIn');
        return;
      }
      if (result.status === 'slow_down') interval = Math.max(interval + 5, result.interval ?? 0);
      else if (result.status === 'pending') interval = Math.max(MIN_POLL_SECONDS, result.interval ?? interval);
      else return fail(PAIR_FAILURES[result.status] ?? 'Sign-in failed. Try again.');
    }
  }, []);

  const reopenPairingPage = useCallback(() => {
    if (pairing) WebBrowser.openBrowserAsync(pairing.verificationUrl).catch(() => {});
  }, [pairing]);

  const signOut = useCallback(async () => {
    await api.logout();
    await clearSession();
  }, [clearSession]);

  const setEnvironment = useCallback(
    async (id: EnvironmentId) => {
      if (id === envRef.current) return;
      await saveEnvironment(id);
      envRef.current = id;
      setEnvironmentId(id);
      const token = await SecureStore.getItemAsync(tokenKey(id)).catch(() => null);
      pairRun.current += 1;
      setPairing(null);
      configureClient({ baseUrl: environment(id).baseUrl, token });
      setStatus(token ? 'signedIn' : 'signedOut');
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, environmentId, pairing, error, startPairing, reopenPairingPage, cancelPairing, signOut, setEnvironment }),
    [status, environmentId, pairing, error, startPairing, reopenPairingPage, cancelPairing, signOut, setEnvironment],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
