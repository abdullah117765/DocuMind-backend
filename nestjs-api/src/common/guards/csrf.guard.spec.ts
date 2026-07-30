import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CsrfService } from '../../modules/auth/csrf.service';
import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  const request = {
    headers: {},
  };
  const validateRequest = jest.fn();
  const csrfService = {
    validateRequest,
  } as unknown as CsrfService;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  const guard = new CsrfGuard(csrfService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows a request with a valid double-submit token', () => {
    validateRequest.mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(validateRequest).toHaveBeenCalledWith(request);
  });

  it('rejects a missing or invalid CSRF token', () => {
    validateRequest.mockReturnValue(false);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
