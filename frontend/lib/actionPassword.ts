/**
 * The site password as the backend expects it on changing requests (`X-Action-Password`).
 *
 * In the browser it is kept for the tab once the prompt has verified it (`ActionAuthProvider`);
 * outside the browser (the API tests) it comes from `ACTION_PASSWORD`. With no password anywhere,
 * no header is sent, which is what an unprotected local backend expects.
 */
const STORAGE_KEY = "action-password";

export const ACTION_PASSWORD_HEADER = "X-Action-Password";

export function getActionPassword(): string | null {
  if (typeof window === "undefined") {
    return process.env.ACTION_PASSWORD?.trim() || null;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActionPassword(password: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, password);
  } catch {
    // Storage blocked: the prompt will simply ask again next time.
  }
}

export function clearActionPassword(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/**
 * `fetch` for endpoints the backend protects: adds the password header, and forgets a password the
 * backend rejected so the next action prompts again instead of failing the same way.
 */
export async function actionFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const password = getActionPassword();
  const headers = new Headers(init.headers);
  if (password) {
    headers.set(ACTION_PASSWORD_HEADER, password);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined") {
    clearActionPassword();
  }
  return res;
}
