import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PASSWORD_COMPLEXITY_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!]).+$/;

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current account password',
    example: 'CurrentP@ss1',
    maxLength: 64,
    format: 'password',
  })
  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  @MaxLength(64, { message: 'Current password must not exceed 64 characters' })
  currentPassword!: string;

  @ApiProperty({
    description:
      'New password containing uppercase, lowercase, number, and special character',
    example: 'NewSecureP@ss2',
    minLength: 8,
    maxLength: 64,
    format: 'password',
  })
  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, {
    message: 'New password must be at least 8 characters long',
  })
  @MaxLength(64, {
    message: 'New password must not exceed 64 characters',
  })
  @Matches(PASSWORD_COMPLEXITY_PATTERN, {
    message:
      'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@#$%^&*!)',
  })
  newPassword!: string;
}
