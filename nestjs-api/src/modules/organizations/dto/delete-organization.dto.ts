import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteOrganizationDto {
  @ApiProperty({
    description:
      'Type the organization name or URL name to confirm permanent deletion.',
    example: 'acme-finance',
    maxLength: 150,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Deletion confirmation is required' })
  @IsNotEmpty({ message: 'Deletion confirmation is required' })
  @MaxLength(150, {
    message: 'Deletion confirmation must not exceed 150 characters',
  })
  confirmation!: string;
}
