const SESSION_TOKEN_STORAGE_KEY = 'ss_session_token';
let inMemorySessionToken: string | null = null;

export function getSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  if (typeof window === 'undefined') return null;
  try {
    const stored =
      window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) ||
      window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (stored) {
      inMemorySessionToken = stored;
      return stored;
    }
  } catch {
    // Ignore storage access restrictions inside sandboxed iframes
  }
  return null;
}

export function setSessionToken(token: string | null): void {
  inMemorySessionToken = token;
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access restrictions inside sandboxed iframes
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface UploadedMediaAsset {
  id: string;
  ownerUserId: string;
  storageProvider: 'local' | 's3';
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  category: string;
  createdAt: string;
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const trimmed = text.trim().toLowerCase();
      data = {
        error:
          trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
            ? 'Sunucu geçici bir hata ile karşılaştı.'
            : text,
      };
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `İstek başarısız oldu (${res.status})`, res.status);
  }

  return data as T;
}

export async function uploadMediaFile(
  file: File,
  category = 'general'
): Promise<UploadedMediaAsset> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  const headers: Record<string, string> = {};
  const token = getSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch('/api/media/upload', {
    method: 'POST',
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: formData,
  });

  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const trimmed = text.trim().toLowerCase();
      data = {
        error:
          trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
            ? 'Sunucu geçici bir hata ile karşılaştı.'
            : text,
      };
    }
  }

  if (!res.ok || !data?.asset) {
    throw new ApiError(data?.error || `Dosya yüklenemedi (${res.status})`, res.status);
  }

  return data.asset as UploadedMediaAsset;
}
