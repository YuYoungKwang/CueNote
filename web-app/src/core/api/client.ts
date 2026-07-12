export interface ApiMeta {
  requestId: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export interface ApiClient {
  baseUrl: string;
  getHealth(): Promise<ApiEnvelope<{ status: string; version: string }>>;
}

export function createApiClient(baseUrl: string): ApiClient {
  return {
    baseUrl,
    async getHealth() {
      const response = await fetch(`${baseUrl}/health`);
      return (await response.json()) as ApiEnvelope<{ status: string; version: string }>;
    }
  };
}
