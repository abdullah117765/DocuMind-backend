import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

interface ValidationIssue {
  field: string;
  issue: string;
}

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationIssue[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const issues = Object.values(error.constraints ?? {}).map((issue) => ({
      field,
      issue,
    }));

    return [...issues, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function createAppValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Validation failed',
        details: flattenValidationErrors(errors),
      }),
    forbidNonWhitelisted: true,
    transform: true,
    validationError: {
      target: false,
      value: false,
    },
    whitelist: true,
  });
}
