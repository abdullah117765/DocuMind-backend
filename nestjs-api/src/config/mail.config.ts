import { registerAs } from '@nestjs/config';

export interface MailConfiguration {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to initialize the mail service.`);
  }

  return value;
}

function getSmtpPort(): number {
  const rawPort = process.env.SMTP_PORT?.trim() || '587';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
  }

  return port;
}

function getSmtpSecure(): boolean {
  const value = process.env.SMTP_SECURE?.trim().toLowerCase() || 'false';

  if (value !== 'true' && value !== 'false') {
    throw new Error('SMTP_SECURE must be either true or false.');
  }

  return value === 'true';
}

export default registerAs('mail', (): MailConfiguration => ({
  host: requireEnvironmentVariable('SMTP_HOST'),
  port: getSmtpPort(),
  secure: getSmtpSecure(),
  user: requireEnvironmentVariable('SMTP_USER'),
  pass: requireEnvironmentVariable('SMTP_PASS'),
  from: requireEnvironmentVariable('MAIL_FROM'),
}));
