import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './reset-password.dto';

describe('ResetPasswordDto', () => {
  it('accepts valid reset details and normalizes their string values', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      email: '  USER@Example.COM ',
      otp: ' 042817 ',
      newPassword: 'NewSecureP@ss2',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
    expect(dto.otp).toBe('042817');
  });

  it.each(['12345', '1234567', '12A456', '', 123456])(
    'rejects an invalid OTP value: %s',
    async (otp) => {
      const dto = plainToInstance(ResetPasswordDto, {
        email: 'user@example.com',
        otp,
        newPassword: 'NewSecureP@ss2',
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'otp')).toBe(true);
    },
  );

  it.each([
    ['fewer than 8 characters', 'Short1!'],
    ['no uppercase letter', 'newsecurep@ss2'],
    ['no lowercase letter', 'NEWSECUREP@SS2'],
    ['no number', 'NewSecureP@ss'],
    ['no supported special character', 'NewSecurePass2'],
  ])('rejects a new password with %s', async (_reason, newPassword) => {
    const dto = plainToInstance(ResetPasswordDto, {
      email: 'user@example.com',
      otp: '042817',
      newPassword,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'newPassword')).toBe(true);
  });
});
