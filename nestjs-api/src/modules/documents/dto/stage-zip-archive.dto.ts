import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

function normalizeSelectedPaths({ value }: TransformFnParams): unknown {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;

    return parsed;
  } catch {
    return trimmedValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
}

export class StageZipArchiveDto {
  @ApiProperty({
    description:
      'ZIP entry paths selected from the zip manifest. Provide JSON array in multipart form data.',
    type: [String],
    minItems: 1,
    maxItems: 8,
  })
  @Transform(normalizeSelectedPaths)
  @IsArray({ message: 'Selected paths must be an array' })
  @ArrayMinSize(1, { message: 'Select at least one ZIP file to stage' })
  @ArrayMaxSize(8, { message: 'A maximum of 8 files can be staged at once' })
  @IsString({ each: true, message: 'Each selected path must be a string' })
  @MaxLength(500, {
    each: true,
    message: 'Selected path must not exceed 500 characters',
  })
  selectedPaths!: string[];
}
