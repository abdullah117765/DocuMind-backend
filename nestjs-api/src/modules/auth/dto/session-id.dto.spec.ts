import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SessionIdDto } from './session-id.dto';

describe('SessionIdDto', () => {
  it('accepts a UUID v4 session identifier', async () => {
    const dto = plainToInstance(SessionIdDto, {
      sessionId: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['', 'not-a-uuid', '550e8400-e29b-11d4-a716-446655440000'])(
    'rejects an invalid session identifier: %s',
    async (sessionId) => {
      const dto = plainToInstance(SessionIdDto, {
        sessionId,
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'sessionId')).toBe(true);
    },
  );
});
