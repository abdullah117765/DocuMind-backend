import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verificationUrl = this.createVerificationUrl(token);

    await this.mailerService.sendMail({
      to: email.trim().toLowerCase(),
      subject: 'Verify your email address',
      template: 'verify-email',
      context: {
        verificationUrl,
      },
      text: [
        'Welcome to AI Document Intelligence.',
        '',
        'Verify your email address by opening this link:',
        verificationUrl,
        '',
        'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
      ].join('\n'),
    });
  }

  private createVerificationUrl(token: string): string {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const verificationUrl = new URL(
      '/verify-email',
      this.ensureTrailingSlash(frontendUrl),
    );

    verificationUrl.searchParams.set('token', token);

    return verificationUrl.toString();
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }
}
