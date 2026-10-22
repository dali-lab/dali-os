import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export type EnvironmentId = 'production' | 'staging' | 'local';

export interface Environment {
  id: EnvironmentId;
  label: string;
  baseUrl: string;
}

const ENV_KEY = 'dali.environment';

function localBaseUrl() {
  if (process.env.EXPO_PUBLIC_LOCAL_API_URL) return process.env.EXPO_PUBLIC_LOCAL_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:3001`;
}

export const ENVIRONMENTS: Environment[] = [
  { id: 'production', label: 'Production', baseUrl: 'https://os.dali.dartmouth.edu' },
  { id: 'staging', label: 'Staging', baseUrl: 'https://os-staging.dali.dartmouth.edu' },
  { id: 'local', label: 'Local', baseUrl: localBaseUrl() },
];

export const DEFAULT_ENVIRONMENT: EnvironmentId = !__DEV__
  ? 'production'
  : process.env.EXPO_PUBLIC_LOCAL_API_URL
    ? 'local'
    : 'staging';

export function environment(id: EnvironmentId): Environment {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
}

export async function loadEnvironment(): Promise<EnvironmentId> {
  if (!__DEV__) return 'production';
  const saved = await SecureStore.getItemAsync(ENV_KEY).catch(() => null);
  return ENVIRONMENTS.some((e) => e.id === saved) ? (saved as EnvironmentId) : DEFAULT_ENVIRONMENT;
}

export async function saveEnvironment(id: EnvironmentId) {
  await SecureStore.setItemAsync(ENV_KEY, id);
}
