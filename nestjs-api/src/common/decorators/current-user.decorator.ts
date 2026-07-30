import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../../modules/auth/interfaces/authenticated-principal.interface';

type AuthenticatedRequest = Request & {
  user?: AuthenticatedPrincipal;
};

export const CurrentUser = createParamDecorator(
  (
    property: keyof AuthenticatedPrincipal | undefined,
    context: ExecutionContext,
  ):
    | AuthenticatedPrincipal
    | AuthenticatedPrincipal[keyof AuthenticatedPrincipal]
    | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    return property ? user?.[property] : user;
  },
);
