interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
}

const isTauriEnvironment = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.__TAURI__?.core?.invoke);

const normalizeHeaders = (
  headers: Record<string, string> | undefined,
  includeContentType: boolean
): Record<string, string> => {
  const normalized: Record<string, string> = { ...(headers || {}) };
  if (includeContentType) {
    const hasContentType = Object.keys(normalized).some(
      (key) => key.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
      normalized['Content-Type'] = 'application/json';
    }
  }
  return normalized;
};

export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const method = (options.method || 'GET').toUpperCase();
  const shouldIncludeContentType = options.body !== undefined;
  const headers = normalizeHeaders(options.headers, shouldIncludeContentType);

  if (isTauriEnvironment()) {
    const response = await window.__TAURI__!.core.invoke<HttpResponse<T>>(
      'http_request',
      {
        request: {
          method,
          url,
          headers: Object.keys(headers).length ? headers : null,
          body: options.body ?? null,
        },
      }
    );
    return response;
  }
  if (
    typeof window !== 'undefined' &&
    /^https:\/\/api\.openai\.com/.test(url)
  ) {
    throw new Error(
      'Tauriブリッジが利用できません。`npm run tauri dev` でアプリを起動するか、OpenAIリクエスト用のバックエンドプロキシを設定してください。'
    );
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `HTTPリクエストに失敗しました: ${error.message}`
        : 'HTTPリクエストに失敗しました'
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = await response.text();
  }

  return {
    status: response.status,
    ok: response.ok,
    body: parsedBody as T,
  };
}
