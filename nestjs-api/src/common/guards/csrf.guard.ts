import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { CsrfService } from '../../modules/auth/csrf.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrfService: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.csrfService.validateRequest(request)) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }
}
