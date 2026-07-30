import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorEnvelope {
  status: 'error';
  code: number;
  message: string;
  details?: unknown;
}

const serverErrorStatusThreshold: number = HttpStatus.INTERNAL_SERVER_ERROR;

const defaultErrorMessages: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Invalid request parameters',
  [HttpStatus.UNAUTHORIZED]: 'Authentication required',
  [HttpStatus.FORBIDDEN]: 'You do not have permission to perform this action',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.CONFLICT]: 'Resource already exists',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests. Please slow down.',
  498: 'Invalid or expired token',
  [HttpStatus.INTERNAL_SERVER_ERROR]:
    'An unexpected error occurred. Please try again later.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable',
};

const genericNestMessages = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Too Many Requests',
  'Internal Server Error',
  'Service Unavailable',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getDefaultMessage(statusCode: number): string {
  return defaultErrorMessages[statusCode] ?? 'Request failed';
}

function shouldUseDefaultMessage(message: string): boolean {
  return (
    genericNestMessages.has(message) ||
    /^Cannot [A-Z]+ /.test(message) ||
    /unexpected (end|token)|json/i.test(message)
  );
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorEnvelope = this.createErrorEnvelope(exception, statusCode);

    if (
      !(exception instanceof HttpException) ||
      statusCode >= serverErrorStatusThreshold
    ) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json(errorEnvelope);
  }

  private createErrorEnvelope(
    exception: unknown,
    statusCode: number,
  ): ErrorEnvelope {
    const envelope: ErrorEnvelope = {
      status: 'error',
      code: statusCode,
      message: getDefaultMessage(statusCode),
    };

    if (!(exception instanceof HttpException)) {
      return envelope;
    }

    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      if (
        statusCode < serverErrorStatusThreshold &&
        !shouldUseDefaultMessage(exceptionResponse)
      ) {
        envelope.message = exceptionResponse;
      }

      return envelope;
    }

    if (!isRecord(exceptionResponse)) {
      return envelope;
    }

    const message = exceptionResponse.message;

    if (
      statusCode < serverErrorStatusThreshold &&
      typeof message === 'string' &&
      !shouldUseDefaultMessage(message)
    ) {
      envelope.message = message;
    }

    if ('details' in exceptionResponse) {
      envelope.details = exceptionResponse.details;
    }

    return envelope;
  }
}
