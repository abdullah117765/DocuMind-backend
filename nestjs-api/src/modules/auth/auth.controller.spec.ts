import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { AuthenticatedPrincipal } from './interfaces/authenticated-principal.interface';

describe('AuthController', () => {
  const registerUser = jest.fn();
  const verifyUserEmail = jest.fn();
  const loginUser = jest.fn();
  const refreshSession = jest.fn();
  const authService = {
    register: registerUser,
    verifyEmail: verifyUserEmail,
    login: loginUser,
    refresh: refreshSession,
  } as unknown as AuthService;
  const controller = new AuthController(authService);

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('delegates email verification using the query token', async () => {
    const dto = {
      token: '550e8400-e29b-41d4-a716-446655440000',
    };
    const result = {
      message: 'Email verified successfully',
    };
    verifyUserEmail.mockResolvedValue(result);

    await expect(controller.verifyEmail(dto)).resolves.toEqual(result);
    expect(verifyUserEmail).toHaveBeenCalledWith(dto.token);
  });

  it('delegates login with request device metadata', async () => {
    const dto = {
      email: 'user@example.com',
      password: 'SecureP@ss1',
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

    await expect(controller.login(dto, request)).resolves.toEqual(result);
    expect(loginUser).toHaveBeenCalledWith(dto, {
      deviceName: 'Chrome on Windows',
      userAgent: 'Mozilla/5.0',
      ipAddress: '203.0.113.10',
    });
  });

  it('delegates refresh using the submitted opaque token', async () => {
    const dto = {
      refreshToken:
        '550e8400-e29b-41d4-a716-446655440000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    };
    const result = {
      data: {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
    };
    refreshSession.mockResolvedValue(result);

    await expect(controller.refresh(dto)).resolves.toEqual(result);
    expect(refreshSession).toHaveBeenCalledWith(dto.refreshToken);
  });

  it('returns the current user and session without exposing token claims', () => {
    const principal: AuthenticatedPrincipal = {
      userId: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
      email: 'user@example.com',
      isVerified: true,
      sessionId: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
      tokenId: '550e8400-e29b-41d4-a716-446655440000',
    };

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
});
