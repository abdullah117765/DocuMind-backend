import type { Request, Response } from 'express';
import { AuthCookieService } from './auth-cookie.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import type { AuthenticatedPrincipal } from './interfaces/authenticated-principal.interface';

describe('AuthController', () => {
  const registerUser = jest.fn();
  const verifyUserEmail = jest.fn();
  const resendVerificationEmail = jest.fn();
  const loginUser = jest.fn();
  const refreshSession = jest.fn();
  const requestPasswordReset = jest.fn();
  const verifyPasswordResetOtp = jest.fn();
  const resetUserPassword = jest.fn();
  const getPasswordResetSession = jest.fn();
  const getActiveSessions = jest.fn();
  const logoutCurrentSession = jest.fn();
  const logoutSession = jest.fn();
  const logoutAllSessions = jest.fn();
  const setAuthenticationCookies = jest.fn();
  const clearAuthenticationCookies = jest.fn();
  const getRefreshToken = jest.fn();
  const toBrowserResult = jest.fn();
  const setPasswordResetCookie = jest.fn();
  const clearPasswordResetCookie = jest.fn();
  const getPasswordResetToken = jest.fn();
  const issueCsrfToken = jest.fn();
  const authService = {
    register: registerUser,
    verifyEmail: verifyUserEmail,
    resendVerificationEmail,
    login: loginUser,
    refresh: refreshSession,
    forgotPassword: requestPasswordReset,
    verifyPasswordResetOtp,
    resetPassword: resetUserPassword,
    getPasswordResetSession,
    getActiveSessions,
    logoutCurrentSession,
    logoutSession,
    logoutAllSessions,
  } as unknown as AuthService;
  const authCookieService = {
    setAuthenticationCookies,
    clearAuthenticationCookies,
    getRefreshToken,
    toBrowserResult,
    setPasswordResetCookie,
    clearPasswordResetCookie,
    getPasswordResetToken,
  } as unknown as AuthCookieService;
  const csrfService = {
    issueToken: issueCsrfToken,
  } as unknown as CsrfService;
  const controller = new AuthController(
    authService,
    authCookieService,
    csrfService,
  );
  const response = {} as Response;
  const principal: AuthenticatedPrincipal = {
    userId: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    email: 'user@example.com',
    isVerified: true,
    sessionId: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    tokenId: '550e8400-e29b-41d4-a716-446655440000',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getRefreshToken.mockReturnValue('refresh-token');
    getPasswordResetToken.mockReturnValue('password-reset-token');
  });

  it('issues a CSRF token through the response cookie service', () => {
    issueCsrfToken.mockReturnValue('csrf-token');

    expect(controller.getCsrfToken(response)).toEqual({
      data: {
        csrfToken: 'csrf-token',
      },
    });
    expect(issueCsrfToken).toHaveBeenCalledWith(response);
  });

  it('delegates registration to AuthService', async () => {
    const dto = {
      email: 'user@example.com',
      password: 'SecureP@ss1',
    };
    const result = {
      message:
        'Registration successful. Please check your email to verify your account.',
    };
    registerUser.mockResolvedValue(result);

    await expect(controller.register(dto)).resolves.toEqual(result);
    expect(registerUser).toHaveBeenCalledWith(dto);
  });

  it('delegates explicit email verification using the request body token', async () => {
    const dto = {
      token: '550e8400-e29b-41d4-a716-446655440000',
    };
    const result = {
      message: 'Email verified successfully. You can now sign in.',
      data: { state: 'VERIFIED' },
    };
    verifyUserEmail.mockResolvedValue(result);

    await expect(controller.verifyEmail(dto)).resolves.toEqual(result);
    expect(verifyUserEmail).toHaveBeenCalledWith(dto.token);
  });

  it('delegates a generic verification-email resend with the client IP', async () => {
    const dto = { email: 'user@example.com' };
    const request = { ip: '203.0.113.10' } as Request;
    const result = {
      message:
        'If an unverified account exists for this email, a new verification link has been sent.',
      data: { cooldownSeconds: 60 },
    };
    resendVerificationEmail.mockResolvedValue(result);

    await expect(
      controller.resendVerificationEmail(dto, request),
    ).resolves.toEqual(result);
    expect(resendVerificationEmail).toHaveBeenCalledWith(dto, '203.0.113.10');
  });

  it('delegates login with request device metadata', async () => {
    const dto = {
      email: 'user@example.com',
      password: 'SecureP@ss1',
    };
    const browserResult = {
      data: {
        user: {
          id: principal.userId,
        },
        session: {
          id: principal.sessionId,
        },
      },
    };
    const result = {
      data: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    };
    const request = {
      ip: '203.0.113.10',
      get: jest.fn((headerName: string) => {
        const headers: Record<string, string> = {
          'x-device-name': 'Chrome on Windows',
          'user-agent': 'Mozilla/5.0',
        };

        return headers[headerName];
      }),
    } as unknown as Request;
    loginUser.mockResolvedValue(result);
    toBrowserResult.mockReturnValue(browserResult);

    await expect(controller.login(dto, request, response)).resolves.toEqual(
      browserResult,
    );
    expect(loginUser).toHaveBeenCalledWith(dto, {
      deviceName: 'Chrome on Windows',
      userAgent: 'Mozilla/5.0',
      ipAddress: '203.0.113.10',
    });
    expect(setAuthenticationCookies).toHaveBeenCalledWith(response, result);
    expect(toBrowserResult).toHaveBeenCalledWith(result);
  });

  it('rotates the refresh cookie without exposing either token', async () => {
    const result = {
      data: {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
    };
    const browserResult = {
      data: {
        user: {
          id: principal.userId,
        },
        session: {
          id: principal.sessionId,
        },
      },
    };
    const request = {} as Request;
    refreshSession.mockResolvedValue(result);
    toBrowserResult.mockReturnValue(browserResult);

    await expect(controller.refresh(request, response)).resolves.toEqual(
      browserResult,
    );
    expect(getRefreshToken).toHaveBeenCalledWith(request);
    expect(refreshSession).toHaveBeenCalledWith('refresh-token');
    expect(setAuthenticationCookies).toHaveBeenCalledWith(response, result);
  });

  it('clears authentication cookies when the refresh cookie is missing', async () => {
    getRefreshToken.mockReturnValue(null);

    await expect(
      controller.refresh({} as Request, response),
    ).rejects.toMatchObject({
      status: 498,
    });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(clearAuthenticationCookies).toHaveBeenCalledWith(response);
  });

  it('delegates a password-reset request with the client IP', async () => {
    const dto = {
      email: 'user@example.com',
    };
    const request = {
      ip: '203.0.113.10',
    } as Request;
    const result = {
      message: 'A six-digit verification code has been sent to your email.',
      data: {
        cooldownSeconds: 40,
        expiresInSeconds: 120,
      },
    };
    requestPasswordReset.mockResolvedValue(result);

    await expect(
      controller.forgotPassword(dto, request, response),
    ).resolves.toEqual(result);
    expect(requestPasswordReset).toHaveBeenCalledWith(dto, '203.0.113.10');
    expect(clearPasswordResetCookie).toHaveBeenCalledWith(response);
  });

  it('delegates password-reset OTP verification', async () => {
    const dto = {
      email: 'user@example.com',
      otp: '042817',
    };
    const result = {
      message: 'Code verified. You can now choose a new password.',
      data: {
        resetToken: '550e8400-e29b-41d4-a716-446655440000',
        expiresInSeconds: 120,
      },
    };
    verifyPasswordResetOtp.mockResolvedValue(result);

    await expect(
      controller.verifyPasswordResetOtp(dto, response),
    ).resolves.toEqual({
      message: result.message,
      data: { expiresInSeconds: 120 },
    });
    expect(verifyPasswordResetOtp).toHaveBeenCalledWith(dto);
    expect(setPasswordResetCookie).toHaveBeenCalledWith(
      response,
      result.data.resetToken,
      120,
    );
  });

  it('reports the active HttpOnly password-reset session', async () => {
    const request = {} as Request;
    const result = { data: { expiresInSeconds: 91 } };
    getPasswordResetSession.mockResolvedValue(result);

    await expect(controller.getPasswordResetSession(request)).resolves.toEqual(
      result,
    );
    expect(getPasswordResetToken).toHaveBeenCalledWith(request);
    expect(getPasswordResetSession).toHaveBeenCalledWith(
      'password-reset-token',
    );
  });

  it('delegates password reset with the verified token and new password', async () => {
    const dto = {
      newPassword: 'NewSecureP@ss2',
    };
    const result = {
      message: 'Password reset successfully. Please log in again.',
    };
    resetUserPassword.mockResolvedValue(result);

    const request = {} as Request;

    await expect(
      controller.resetPassword(dto, request, response),
    ).resolves.toEqual(result);
    expect(resetUserPassword).toHaveBeenCalledWith(dto, 'password-reset-token');
    expect(clearPasswordResetCookie).toHaveBeenCalledWith(response);
    expect(clearAuthenticationCookies).toHaveBeenCalledWith(response);
  });

  it('returns the current user and session without exposing token claims', () => {
    expect(controller.me(principal)).toEqual({
      data: {
        user: {
          id: principal.userId,
          email: principal.email,
          isVerified: true,
        },
        session: {
          id: principal.sessionId,
        },
      },
    });
  });

  it('delegates active-session listing with the current session ID', async () => {
    const result = {
      data: {
        sessions: [
          {
            id: principal.sessionId,
            isCurrent: true,
          },
        ],
      },
    };
    getActiveSessions.mockResolvedValue(result);

    await expect(controller.getActiveSessions(principal)).resolves.toEqual(
      result,
    );
    expect(getActiveSessions).toHaveBeenCalledWith(
      principal.userId,
      principal.sessionId,
    );
  });

  it('delegates current-device logout', async () => {
    const result = {
      message: 'Logged out successfully',
    };
    logoutCurrentSession.mockResolvedValue(result);

    await expect(controller.logout(principal, response)).resolves.toEqual(
      result,
    );
    expect(logoutCurrentSession).toHaveBeenCalledWith(
      principal.userId,
      principal.sessionId,
    );
    expect(clearAuthenticationCookies).toHaveBeenCalledWith(response);
  });

  it('delegates logout for a selected owned session', async () => {
    const dto = {
      sessionId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    };
    const result = {
      message: 'Session logged out successfully',
    };
    logoutSession.mockResolvedValue(result);

    await expect(
      controller.logoutSession(principal, dto, response),
    ).resolves.toEqual(result);
    expect(logoutSession).toHaveBeenCalledWith(principal.userId, dto.sessionId);
    expect(clearAuthenticationCookies).not.toHaveBeenCalled();
  });

  it('delegates logout for all user sessions', async () => {
    const result = {
      message: 'Logged out from all devices successfully',
    };
    logoutAllSessions.mockResolvedValue(result);

    await expect(controller.logoutAll(principal, response)).resolves.toEqual(
      result,
    );
    expect(logoutAllSessions).toHaveBeenCalledWith(principal.userId);
    expect(clearAuthenticationCookies).toHaveBeenCalledWith(response);
  });
});
