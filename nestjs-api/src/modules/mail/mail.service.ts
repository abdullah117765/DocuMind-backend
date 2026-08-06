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
    options: {
      invitedName?: string | null;
      roleNames?: string[];
      temporaryPassword?: string | null;
      temporaryPasswordExpiresInHours?: number | null;
    } = {},
  ): Promise<void> {
    const inviteUrl = this.createInviteUrl(token);
    const invitedEmail = email.trim().toLowerCase();
    const productName = this.getProductName();
    const hasTemporaryPassword = Boolean(options.temporaryPassword);
    const invitedName = options.invitedName?.trim() || null;
    const roleNames = options.roleNames ?? [];
    const roleSummary = roleNames.length ? roleNames.join(', ') : null;

    await this.mailerService.sendMail({
      to: invitedEmail,
      subject: `You're invited to ${organizationName}`,
      template: 'organization-invite',
      context: {
        expiresInDays,
        hasTemporaryPassword,
        invitedEmail,
        invitedName,
        inviteUrl,
        organizationName,
        productName,
        roleSummary,
        temporaryPassword: options.temporaryPassword,
        temporaryPasswordExpiresInHours:
          options.temporaryPasswordExpiresInHours,
      },
      text: [
        invitedName
          ? `Hello ${invitedName},`
          : `You have been invited to join ${organizationName} on ${productName}.`,
        '',
        invitedName
          ? `You have been invited to join ${organizationName} on ${productName}.`
          : `This invitation is for ${invitedEmail}.`,
        `Invited email: ${invitedEmail}.`,
        ...(roleSummary ? [`Assigned role: ${roleSummary}.`] : []),
        '',
        ...(hasTemporaryPassword
          ? [
              `Your one-time password is: ${options.temporaryPassword}`,
              `It expires in ${options.temporaryPasswordExpiresInHours} hours and can be used only once.`,
              '',
              'Open the invitation link, enter your email and one-time password, then set your permanent password.',
              '',
            ]
          : [
              'Sign in with your existing account, then accept the invitation.',
              '',
            ]),
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

  private getProductName(): string {
    return (
      this.configService.get<string>('APP_NAME')?.trim() ||
      'AI Document Intelligence'
    );
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
