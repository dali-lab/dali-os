const API_BASE = import.meta.env.VITE_DALI_DB_URL ?? "http://localhost:3001";

const USER_COOKIE = "__dali_user";
const USER_COOKIE_MAX_AGE = 900; // 15 min, matches access token

// user cookie

export interface UserInfo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  type: string;
}

function setUserCookie(user: UserInfo) {
  document.cookie = `${USER_COOKIE}=${encodeURIComponent(JSON.stringify(user))}; path=/; max-age=${USER_COOKIE_MAX_AGE}; SameSite=Lax`;
}

function clearUserCookie() {
  document.cookie = `${USER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function getUser(): UserInfo | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${USER_COOKIE}=`));
    if (!match) return null;
    return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")));
  } catch {
    return null;
  }
}

// token exchange

export async function exchangeAndStoreUser(res: Response): Promise<void> {
  const data = await res.json();
  if (data.user) setUserCookie(data.user);
}

// authenticated fetch

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url, { ...options, credentials: "include" });

  if (res.status === 401) {
    // try a transparent cookie refresh
    const refreshRes = await fetch(`${API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ grant_type: "refresh_token" }),
    });
    if (!refreshRes.ok) throw new Error("Not authenticated");
    // update the user cookie from refresh response
    await exchangeAndStoreUser(refreshRes);
    // retry original request with fresh cookies
    return fetch(url, { ...options, credentials: "include" });
  }

  return res;
}

// logout

export async function logout() {
  await fetch(`${API_BASE}/oauth/revoke`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
  clearUserCookie();
}
