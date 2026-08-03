import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './reset-password.dto';

describe('ResetPasswordDto', () => {
  it('accepts a secure new password', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      newPassword: 'NewSecureP@ss2',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    ['fewer than 8 characters', 'Short1!'],
    ['no uppercase letter', 'newsecurep@ss2'],
    ['no lowercase letter', 'NEWSECUREP@SS2'],
    ['no number', 'NewSecureP@ss'],
    ['no supported special character', 'NewSecurePass2'],
  ])('rejects a new password with %s', async (_reason, newPassword) => {
    const dto = plainToInstance(ResetPasswordDto, {
      newPassword,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'newPassword')).toBe(true);
  });
});
