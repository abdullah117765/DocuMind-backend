import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';

interface SuccessEnvelope {
  status: 'success';
  code: number;
  data?: unknown;
  message?: string;
}

interface ResponsePayload {
  data?: unknown;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResponsePayload(value: unknown): value is ResponsePayload {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);

  return (
    keys.length > 0 &&
    keys.every((key) => key === 'data' || key === 'message') &&
    ('data' in value || typeof value.message === 'string')
  );
}

function isSuccessEnvelope(value: unknown): value is SuccessEnvelope {
  return (
    isRecord(value) &&
    value.status === 'success' &&
    typeof value.code === 'number'
  );
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (body instanceof StreamableFile || isSuccessEnvelope(body)) {
          return body;
        }

        const envelope: SuccessEnvelope = {
          status: 'success',
          code: response.statusCode,
        };

        if (isResponsePayload(body)) {
          if ('data' in body) {
            envelope.data = body.data;
          }

          if (typeof body.message === 'string') {
            envelope.message = body.message;
          }

          return envelope;
        }

        envelope.data = body ?? {};

        return envelope;
      }),
    );
  }
}
