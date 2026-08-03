import { HttpException, HttpStatus } from '@nestjs/common';

const INVALID_TOKEN_STATUS = 498;

export const AUTH_ERROR_REASONS = {
  emailNotVerified: 'EMAIL_NOT_VERIFIED',
  verificationDeliveryFailed: 'VERIFICATION_DELIVERY_FAILED',
  verificationExpired: 'VERIFICATION_LINK_EXPIRED',
  verificationInvalid: 'INVALID_VERIFICATION_LINK',
  verificationUsed: 'VERIFICATION_LINK_USED',
  passwordResetExpired: 'PASSWORD_RESET_SESSION_EXPIRED',
  passwordResetInvalid: 'INVALID_PASSWORD_RESET_SESSION',
  passwordResetUsed: 'PASSWORD_RESET_SESSION_USED',
  passwordUnchanged: 'PASSWORD_UNCHANGED',
} as const;

function errorResponse(message: string, reason: string) {
  return {
    message,
    details: { reason },
  };
}

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

export class InvalidPasswordResetOtpException extends HttpException {
  constructor() {
    super('Invalid or expired password reset code', INVALID_TOKEN_STATUS);
  }
}

export class InvalidPasswordResetAuthorizationException extends HttpException {
  constructor() {
    super(
      errorResponse(
        'This password reset session is invalid. Please request a new code.',
        AUTH_ERROR_REASONS.passwordResetInvalid,
      ),
      INVALID_TOKEN_STATUS,
    );
  }
}

export class ExpiredPasswordResetAuthorizationException extends HttpException {
  constructor() {
    super(
      errorResponse(
        'Your password reset session has expired. Please request a new code.',
        AUTH_ERROR_REASONS.passwordResetExpired,
      ),
      HttpStatus.GONE,
    );
  }
}

export class UsedPasswordResetAuthorizationException extends HttpException {
  constructor() {
    super(
      errorResponse(
        'This password reset session has already been used or replaced.',
        AUTH_ERROR_REASONS.passwordResetUsed,
      ),
      HttpStatus.CONFLICT,
    );
  }
}

export class InvalidEmailVerificationTokenException extends HttpException {
  constructor() {
    super(
      errorResponse(
        'This verification link is invalid. Please request a new link.',
        AUTH_ERROR_REASONS.verificationInvalid,
      ),
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ExpiredEmailVerificationTokenException extends HttpException {
  constructor() {
    super(
      errorResponse(
        'This verification link has expired. Request a fresh link to continue.',
        AUTH_ERROR_REASONS.verificationExpired,
      ),
      HttpStatus.GONE,
    );
  }
}

export class UsedEmailVerificationTokenException extends HttpException {
  constructor() {
    super(
      errorResponse(
        'This verification link has already been used or replaced.',
        AUTH_ERROR_REASONS.verificationUsed,
      ),
      HttpStatus.CONFLICT,
    );
  }
}
