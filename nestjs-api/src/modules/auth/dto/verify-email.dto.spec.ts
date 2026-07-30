import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyEmailDto } from './verify-email.dto';

describe('VerifyEmailDto', () => {
  it('accepts and trims a UUID v4 token', async () => {
    const dto = plainToInstance(VerifyEmailDto, {
      token: '  550e8400-e29b-41d4-a716-446655440000  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.token).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it.each([undefined, '', 'not-a-uuid'])(
    'rejects an invalid token value: %s',
    async (token) => {
      const dto = plainToInstance(VerifyEmailDto, { token });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'token')).toBe(true);
    },
  );
});
