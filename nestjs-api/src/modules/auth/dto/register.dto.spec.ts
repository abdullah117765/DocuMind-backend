import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  it('accepts a valid registration and normalizes the email', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: '  USER@Example.COM ',
      password: 'SecureP@ss1',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
  });

  it('rejects an invalid email address', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'not-an-email',
      password: 'SecureP@ss1',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });

  it.each([
    ['fewer than 8 characters', 'Short1!'],
    ['no uppercase letter', 'securep@ss1'],
    ['no lowercase letter', 'SECUREP@SS1'],
    ['no number', 'SecureP@ss'],
    ['no supported special character', 'SecurePass1'],
  ])('rejects a password with %s', async (_reason, password) => {
    const dto = plainToInstance(RegisterDto, {
      email: 'user@example.com',
      password,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('rejects unexpected registration properties', async () => {
    const dto = plainToInstance(RegisterDto, {
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
