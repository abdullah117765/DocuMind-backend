import { BadRequestException } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { createAppValidationPipe } from './app-validation.pipe';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class ValidationTestDto {
  @IsEmail()
  email!: string;
}

describe('createAppValidationPipe', () => {
  it('returns field-level details for invalid and unknown properties', async () => {
    const validationPipe = createAppValidationPipe();

    try {
      await validationPipe.transform(
        {
          email: 'not-an-email',
          unexpected: true,
        },
        {
          metatype: ValidationTestDto,
          type: 'body',
        },
      );
      fail('Expected validation to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);

      if (!(error instanceof BadRequestException)) {
        return;
      }

      const response = error.getResponse();

      expect(isRecord(response)).toBe(true);

      if (!isRecord(response)) {
        return;
      }

      expect(response.message).toBe('Validation failed');
      expect(Array.isArray(response.details)).toBe(true);

      if (!Array.isArray(response.details)) {
        return;
      }

      const fields = response.details
        .filter(isRecord)
        .map((detail) => detail.field)
        .filter((field): field is string => typeof field === 'string');

      expect(fields).toEqual(expect.arrayContaining(['email', 'unexpected']));
    }
  });
});
