import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordDto } from './forgot-password.dto';

describe('ForgotPasswordDto', () => {
  it('accepts and normalizes a valid email address', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: '  USER@Example.COM ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
  });

  it.each([
    undefined,
    '',
    'not-an-email',
    'user[bracket]@example.com',
    'user@[example].com',
    '(user)@example.com',
  ])('rejects an invalid email value: %s', async (email) => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });
});
