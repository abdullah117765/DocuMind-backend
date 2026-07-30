import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefreshTokenDto } from './refresh-token.dto';

describe('RefreshTokenDto', () => {
  const validToken =
    '550e8400-e29b-41d4-a716-446655440000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

  it('accepts and trims a correctly formatted refresh token', async () => {
    const dto = plainToInstance(RefreshTokenDto, {
      refreshToken: `  ${validToken}  `,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.refreshToken).toBe(validToken);
  });

  it.each([
    undefined,
    '',
    'not-a-refresh-token',
    '550e8400-e29b-41d4-a716-446655440000.secret-too-short',
  ])('rejects an invalid refresh token: %s', async (refreshToken) => {
    const dto = plainToInstance(RefreshTokenDto, { refreshToken });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'refreshToken')).toBe(
      true,
    );
  });
});
