import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResendVerificationEmailDto } from './resend-verification-email.dto';

describe('ResendVerificationEmailDto', () => {
  it('normalizes a supported email address', async () => {
    const dto = plainToInstance(ResendVerificationEmailDto, {
      email: ' USER@Example.COM ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
  });

  it.each(['', 'user[at]example.com', 'user@example', 'user name@example.com'])(
    'rejects an invalid email address: %s',
    async (email) => {
      const dto = plainToInstance(ResendVerificationEmailDto, { email });
      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'email')).toBe(true);
    },
  );
});
