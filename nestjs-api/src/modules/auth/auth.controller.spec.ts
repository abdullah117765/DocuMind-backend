import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  const registerUser = jest.fn();
  const verifyUserEmail = jest.fn();
  const authService = {
    register: registerUser,
    verifyEmail: verifyUserEmail,
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
});
