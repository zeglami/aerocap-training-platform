import type { ApiResponse } from '@/types';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function request<T>(url: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const json: ApiResponse<T> = await res.json();
  if (!res.ok || json.error) {
    throw new ApiError(json.error?.code ?? 'API_ERROR', json.error?.message ?? 'Request failed');
  }
  return json.data;
}

// Server-side client: calls services directly with full base URL
export function createServiceClient(baseUrl: string, token: string | null) {
  return {
    get:  <T>(path: string) => request<T>(`${baseUrl}${path}`, token),
    post: <T>(path: string, body: unknown) => request<T>(`${baseUrl}${path}`, token, { method: 'POST', body: JSON.stringify(body) }),
  };
}

// Client-side client: calls Next.js API proxy routes (relative paths)
export function createApiClient(token: string | null) {
  return {
    get:    <T>(path: string)                => request<T>(path, token),
    post:   <T>(path: string, body: unknown) => request<T>(path, token, { method: 'POST',   body: JSON.stringify(body) }),
    put:    <T>(path: string, body: unknown) => request<T>(path, token, { method: 'PUT',    body: JSON.stringify(body) }),
    delete: <T>(path: string)                => request<T>(path, token, { method: 'DELETE' }),
  };
}
