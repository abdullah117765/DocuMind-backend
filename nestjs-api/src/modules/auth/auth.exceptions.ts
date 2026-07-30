import { HttpException } from '@nestjs/common';

const INVALID_TOKEN_STATUS = 498;

export class InvalidRefreshTokenException extends HttpException {
  constructor() {
    super('Invalid or expired refresh token', INVALID_TOKEN_STATUS);
  }
}

export class RefreshTokenReuseException extends HttpException {
  constructor() {
    super(
      'Refresh token reuse detected. The session has been revoked.',
      INVALID_TOKEN_STATUS,
    );
  }
}
