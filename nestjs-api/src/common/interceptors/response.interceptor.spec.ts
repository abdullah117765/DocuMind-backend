import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { firstValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  it('preserves a response containing both message and data', async () => {
    const response = { statusCode: 200 } as Response;
    const context = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const body = {
      message: 'Reset code sent.',
      data: {
        cooldownSeconds: 40,
      },
    };
    const next = {
      handle: () => of(body),
    } as CallHandler;

    await expect(
      firstValueFrom(new ResponseInterceptor().intercept(context, next)),
    ).resolves.toEqual({
      status: 'success',
      code: 200,
      ...body,
    });
  });
});
