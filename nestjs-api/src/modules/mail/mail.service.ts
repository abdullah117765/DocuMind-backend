import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { EmailVerificationConfiguration } from '../../config/email-verification.config';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verificationUrl = this.createVerificationUrl(token);
    const verificationConfig =
      this.configService.getOrThrow<EmailVerificationConfiguration>(
        'emailVerification',
      );
    const expiryDescription = this.formatDuration(
      verificationConfig.tokenTtlSeconds,
    );

    await this.mailerService.sendMail({
      to: email.trim().toLowerCase(),
      subject: 'Verify your email address',
      template: 'verify-email',
      context: {
        expiryDescription,
        verificationUrl,
      },
      text: [
        'Welcome to AI Document Intelligence.',
        '',
        'Verify your email address by opening this link:',
        verificationUrl,
        '',
        `This link expires in ${expiryDescription}. If you did not create an account, you can ignore this email.`,
      ].join('\n'),
    });
  }

  async sendPasswordResetOtp(
    email: string,
    otp: string,
    expiresInMinutes: number,
  ): Promise<void> {
    await this.mailerService.sendMail({
      to: email.trim().toLowerCase(),
      subject: 'Your password reset code',
      template: 'reset-password',
      context: {
        otp,
        expiresInMinutes,
      },
      text: [
        'A password reset was requested for your AI Document Intelligence account.',
        '',
        `Your password reset code is: ${otp}`,
        '',
        `This code expires in ${expiresInMinutes} minutes and can only be used once.`,
        'If you did not request a password reset, you can ignore this email.',
      ].join('\n'),
    });
  }

  async sendOrganizationInvite(
    email: string,
    organizationName: string,
    token: string,
    expiresInDays: number,
  ): Promise<void> {
    const inviteUrl = this.createInviteUrl(token);

    await this.mailerService.sendMail({
      to: email.trim().toLowerCase(),
      subject: `You're invited to ${organizationName}`,
      template: 'organization-invite',
      context: {
        expiresInDays,
        inviteUrl,
        organizationName,
      },
      text: [
        `You have been invited to join ${organizationName} on AI Document Intelligence.`,
        '',
        'Accept your invitation by opening this link:',
        inviteUrl,
        '',
        `This invitation expires in ${expiresInDays} ${expiresInDays === 1 ? 'day' : 'days'}.`,
        'If you did not expect this invite, you can ignore this email.',
      ].join('\n'),
    });
  }

  private createVerificationUrl(token: string): string {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const verificationUrl = new URL(
      '/verify-email',
      this.ensureTrailingSlash(frontendUrl),
    );

    verificationUrl.hash = new URLSearchParams({ token }).toString();

    return verificationUrl.toString();
  }

  private createInviteUrl(token: string): string {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const inviteUrl = new URL(
      '/accept-invite',
      this.ensureTrailingSlash(frontendUrl),
    );

    inviteUrl.hash = new URLSearchParams({ token }).toString();

    return inviteUrl.toString();
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private formatDuration(seconds: number): string {
    if (seconds % 3600 === 0) {
      const hours = seconds / 3600;
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }

    const minutes = Math.ceil(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
}
