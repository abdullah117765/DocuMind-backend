import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';

export interface RagIngestPayload {
  document_id: string;
  organization_id: string;
  version_id?: string | null;
  version_number: number;
  document_name: string;
  file_type: string;
  storage_bucket: string;
  storage_key: string;
  uploaded_by_id?: string | null;
}

export interface RagQueryPayload {
  organization_id: string;
  query: string;
  allowed_document_ids: string[];
  search_type?: 'semantic' | 'keyword' | 'hybrid';
  top_k?: number;
}

export interface RagIngestResponse {
  status: 'PENDING' | 'INDEXING' | 'INDEXED' | 'FAILED' | 'NO_CONTENT';
  document_id: string;
  chunks_created: number;
  error_message?: string | null;
  processing_time_ms: number;
}

export interface RagSearchResult {
  score: number;
  text: string;
  document_id: string;
  document_name: string;
  file_type?: string | null;
  chunk_index: number;
  version_number: number;
  metadata?: Record<string, unknown>;
}

export interface RagSearchResponse {
  results: RagSearchResult[];
  total_results: number;
  search_type: 'semantic' | 'keyword' | 'hybrid';
  processing_time_ms: number;
}

export interface RagAskResponse {
  answer: string;
  sources: Array<{
    document_id: string;
    document_name: string;
    chunk_index: number;
    version_number: number;
  }>;
  search_results: RagSearchResult[];
  llm_model?: string | null;
  llm_available: boolean;
  processing_time_ms: number;
}

@Injectable()
export class RagOrchestratorService {
  private readonly logger = new Logger(RagOrchestratorService.name);
  private readonly enabled: boolean;
  private readonly serviceUrl: string;
  private readonly hmacSecret: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<string>('RAG_ENABLED', 'true').toLowerCase() !==
      'false';
    this.serviceUrl = this.configService.get<string>(
      'RAG_SERVICE_URL',
      this.configService.get<string>('FASTAPI_URL', 'http://localhost:8000'),
    );
    this.hmacSecret = this.configService.get<string>(
      'RAG_HMAC_SECRET',
      this.configService.get<string>('HMAC_SECRET', ''),
    );
    this.timeoutMs = Number(
      this.configService.get<string>('RAG_REQUEST_TIMEOUT_MS', '120000'),
    );
  }

  isConfigured(): boolean {
    return this.enabled && this.hmacSecret.trim().length > 0;
  }

  getEmbeddingModel(): string {
    return this.configService.get<string>(
      'RAG_EMBEDDING_MODEL',
      'BAAI/bge-small-en-v1.5',
    );
  }

  async ingest(payload: RagIngestPayload): Promise<RagIngestResponse | null> {
    if (!this.isConfigured()) return null;

    return this.request<RagIngestResponse>('POST', '/rag/ingest', payload);
  }

  async reindex(
    payloads: RagIngestPayload[],
  ): Promise<RagIngestResponse[] | null> {
    if (!this.isConfigured()) return null;

    return this.request<RagIngestResponse[]>('POST', '/rag/reindex', payloads);
  }

  async search(payload: RagQueryPayload): Promise<RagSearchResponse> {
    return this.request<RagSearchResponse>('POST', '/rag/search', payload);
  }

  async ask(payload: RagQueryPayload): Promise<RagAskResponse> {
    return this.request<RagAskResponse>('POST', '/rag/ask', payload);
  }

  async deleteDocument(
    organizationId: string,
    documentId: string,
  ): Promise<void> {
    if (!this.isConfigured()) return;

    await this.request(
      'DELETE',
      `/rag/documents/${organizationId}/${documentId}`,
      undefined,
    ).catch((error: unknown) => {
      this.logger.warn(
        `Failed to delete RAG vectors for document ${documentId}: ${String(
          error,
        )}`,
      );
    });
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    if (!this.isConfigured()) return;

    await this.request(
      'DELETE',
      `/rag/organizations/${organizationId}`,
      undefined,
    ).catch((error: unknown) => {
      this.logger.warn(
        `Failed to delete RAG vectors for organization ${organizationId}: ${String(
          error,
        )}`,
      );
    });
  }

  async getStats(
    organizationId: string,
  ): Promise<{ organization_id: string; vectors_count: number | null }> {
    return this.request('GET', `/rag/stats/${organizationId}`, undefined);
  }

  private async request<T>(
    method: string,
    path: string,
    payload: unknown,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('RAG service is not configured.');
    }

    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.sign(method, path, timestamp, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.serviceUrl}${path}`, {
        method,
        body: method === 'GET' || method === 'DELETE' ? undefined : body,
        headers: {
          'content-type': 'application/json',
          'x-service-request-id': randomUUID(),
          'x-service-signature': signature,
          'x-service-timestamp': timestamp,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `RAG service failed with ${response.status}: ${errorBody}`,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private sign(
    method: string,
    path: string,
    timestamp: string,
    body: string,
  ): string {
    const payload = `${timestamp}.${method.toUpperCase()}.${path}.${body}`;

    return createHmac('sha256', this.hmacSecret).update(payload).digest('hex');
  }
}
