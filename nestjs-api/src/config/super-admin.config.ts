import { registerAs } from '@nestjs/config';
import {
  APP_EMAIL_PATTERN,
  normalizeEmail,
} from '../common/validation/email.validation';

const SUPER_ADMIN_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
const SUPER_ADMIN_PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!]).+$/;

export interface SuperAdminConfiguration {
  configured: boolean;
  email: string | null;
  password: string | null;
  name: string | null;
}

function getOptionalEnvironmentValue(name: string): string | null {
  const value = process.env[name]?.trim();

  return value ? value : null;
}

function requireCompleteSuperAdminConfiguration(
  email: string | null,
  password: string | null,
  name: string | null,
): void {
  const configuredValues = [email, password, name].filter(Boolean).length;

  if (configuredValues > 0 && configuredValues < 3) {
    throw new Error(
      'SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, and SUPER_ADMIN_NAME must be set together.',
    );
  }
}

function validateSuperAdminEmail(email: string): string {
  const normalizedEmail = normalizeEmail(email) as string;

  if (!APP_EMAIL_PATTERN.test(normalizedEmail)) {
    throw new Error('SUPER_ADMIN_EMAIL must be a valid email address.');
  }

  return normalizedEmail;
}

function validateSuperAdminPassword(password: string): string {
  if (password.length < 8 || password.length > 64) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD must be between 8 and 64 characters.',
    );
  }

  if (!SUPER_ADMIN_PASSWORD_PATTERN.test(password)) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD must contain uppercase, lowercase, number, and one special character (@#$%^&*!).',
    );
  }

  return password;
}

function validateSuperAdminName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, ' ');

  if (normalizedName.length < 2 || normalizedName.length > 100) {
    throw new Error(
      'SUPER_ADMIN_NAME must be between 2 and 100 characters.',
    );
  }

  if (!SUPER_ADMIN_NAME_PATTERN.test(normalizedName)) {
    throw new Error(
      'SUPER_ADMIN_NAME may contain only letters, numbers, and single spaces.',
    );
  }

  return normalizedName;
}

export default registerAs('superAdmin', (): SuperAdminConfiguration => {
  const email = getOptionalEnvironmentValue('SUPER_ADMIN_EMAIL');
  const password = getOptionalEnvironmentValue('SUPER_ADMIN_PASSWORD');
  const name = getOptionalEnvironmentValue('SUPER_ADMIN_NAME');

  requireCompleteSuperAdminConfiguration(email, password, name);

  if (!email || !password || !name) {
    return {
      configured: false,
      email: null,
      password: null,
      name: null,
    };
  }

  return {
    configured: true,
    email: validateSuperAdminEmail(email),
    password: validateSuperAdminPassword(password),
    name: validateSuperAdminName(name),
  };
});
