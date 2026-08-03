import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyPasswordResetOtpDto } from './verify-password-reset-otp.dto';

describe('VerifyPasswordResetOtpDto', () => {
  it('accepts and normalizes valid verification details', async () => {
    const dto = plainToInstance(VerifyPasswordResetOtpDto, {
      email: ' USER@Example.COM ',
      otp: ' 042817 ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
    expect(dto.otp).toBe('042817');
  });

  it.each(['12345', '1234567', '12A456', '', 123456])(
    'rejects an invalid OTP: %s',
    async (otp) => {
      const dto = plainToInstance(VerifyPasswordResetOtpDto, {
        email: 'user@example.com',
        otp,
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'otp')).toBe(true);
    },
  );
});
