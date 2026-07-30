import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

describe('MailService', () => {
  const sendMail = jest.fn();
  const getOrThrow = jest.fn();
  const mailerService = {
    sendMail,
  } as unknown as MailerService;
  const configService = {
    getOrThrow,
  } as unknown as ConfigService;
  const service = new MailService(mailerService, configService);

  beforeEach(() => {
    jest.clearAllMocks();
    getOrThrow.mockReturnValue('http://localhost:5173');
    sendMail.mockResolvedValue(undefined);
  });

  it('sends a verification email to a normalized recipient', async () => {
    await service.sendVerificationEmail(
      '  USER@Example.COM ',
      'verification-token',
    );

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Verify your email address',
        template: 'verify-email',
        context: {
          verificationUrl:
            'http://localhost:5173/verify-email?token=verification-token',
        },
      }),
    );
  });

  it('URL-encodes the verification token', async () => {
    await service.sendVerificationEmail('user@example.com', 'token + value');

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          verificationUrl:
            'http://localhost:5173/verify-email?token=token+%2B+value',
        },
      }),
    );
  });

  it('sends a password-reset OTP with its expiry', async () => {
    await service.sendPasswordResetOtp('  USER@Example.COM ', '042817', 10);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Your password reset code',
        template: 'reset-password',
        context: {
          otp: '042817',
          expiresInMinutes: 10,
        },
      }),
    );
  });
});
