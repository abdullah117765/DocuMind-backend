import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('accepts valid credentials and normalizes the email', async () => {
    const dto = plainToInstance(LoginDto, {
      email: '  USER@Example.COM ',
      password: 'SecureP@ss1',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
  });

  it('rejects an invalid email address', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'invalid-email',
      password: 'SecureP@ss1',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });

  it.each([undefined, '', '   ', 123])(
    'rejects an invalid password value: %s',
    async (password) => {
      const dto = plainToInstance(LoginDto, {
        email: 'user@example.com',
        password,
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'password')).toBe(true);
    },
  );

  it('rejects unexpected login properties', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@example.com',
      password: 'SecureP@ss1',
      isVerified: true,
    });

    const errors = await validate(dto, {
      forbidNonWhitelisted: true,
      whitelist: true,
    });

    expect(errors.some((error) => error.property === 'isVerified')).toBe(true);
  });
});
