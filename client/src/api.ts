import { clearSession } from './auth';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const requestToken = authenticated ? localStorage.getItem('token') : null;
  if (authenticated) {
    if (!requestToken) { clearSession(); throw new ApiError(401, 'Please sign in again'); }
    headers.set('Authorization', `Bearer ${requestToken}`);
  }
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  let response: Response;
  let data: unknown;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
    if (authenticated && response.status === 401 && localStorage.getItem('token') === requestToken) clearSession();
    data = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return null;
    });
  }
  catch (error) {
    if (timedOut) throw new Error('Seatbook took too long to respond. Check the result before retrying.');
    if (controller.signal.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Cannot reach Seatbook. Check your connection and retry.');
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'error' in data ? data.error : null;
    const error = detail && typeof detail === 'object' ? detail as { message?: unknown; code?: unknown } : null;
    throw new ApiError(response.status, typeof error?.message === 'string' ? error.message : 'Request failed. Please retry.', typeof error?.code === 'string' ? error.code : undefined);
  }
  if (data === null) throw new Error('Seatbook returned an invalid response. Please retry.');
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
}
