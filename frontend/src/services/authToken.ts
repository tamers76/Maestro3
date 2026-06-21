/**
 * Auth token store + transport wiring.
 *
 * Holds the JWT in localStorage and installs a one-time fetch interceptor that
 * attaches `Authorization: Bearer <token>` to same-origin `/api` requests. This
 * keeps the ~100 existing `fetch(`${API_BASE}/...`)` call sites unchanged.
 *
 * EventSource and <video src> cannot send headers, so `withAccessToken(url)`
 * appends the token as an `access_token` query param for those transports (the
 * backend middleware accepts either).
 */
const TOKEN_KEY = 'maestro_auth_token';

let memoryToken: string | null = null;

export function getToken(): string | null {
  if (memoryToken !== null) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export function setToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore storage failures */
  }
}

export function clearToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Append the access token as a query param (for EventSource / media src URLs). */
export function withAccessToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}

function isApiRequest(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return url.startsWith('/api') || url.includes('/api/');
  } catch {
    return false;
  }
}

let installed = false;

/**
 * Install the fetch interceptor once. Adds the bearer header to API calls and
 * emits a `maestro:unauthorized` event on 401 so the app can redirect to login.
 */
export function installAuthFetch(): void {
  if (installed) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getToken();
    let nextInit = init;
    if (token && isApiRequest(input)) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      nextInit = { ...init, headers };
    }

    const response = await originalFetch(input, nextInit);

    if (response.status === 401 && isApiRequest(input) && !isAuthEndpoint(input)) {
      clearToken();
      window.dispatchEvent(new CustomEvent('maestro:unauthorized'));
    }
    return response;
  };
}

function isAuthEndpoint(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return url.includes('/api/auth/login');
  } catch {
    return false;
  }
}
