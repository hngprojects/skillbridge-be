import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../../config/env';
import type { PasswordResetEmailPayload, SendMailOptions } from './mail.types';
import { OutboundEmailQueueService } from './outbound-email-queue.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client = new Resend(env.RESEND_API_KEY);

  constructor(
    @Inject(forwardRef(() => OutboundEmailQueueService))
    private readonly outboundEmailQueue: OutboundEmailQueueService,
  ) {}

  async send({ to, subject, html, text, from }: SendMailOptions) {
    if (!html && !text) {
      throw new Error('Sending a mail requires either `html` or `text`.');
    }

    const basePayload = {
      from: from ?? env.RESEND_MAIL_FROM,
      to,
      subject,
    };

    const payload: Parameters<Resend['emails']['send']>[0] = html
      ? { ...basePayload, html, ...(text ? { text } : {}) }
      : { ...basePayload, text: text! };

    const { data, error } = await this.client.emails.send(payload);

    if (error) {
      this.logger.error(
        `Failed to send email to ${String(to)}: ${error.message}`,
      );
      throw new Error(error.message);
    }

    return data;
  }

  /** Enqueues when REDIS_URL is set; otherwise sends immediately (still off the forgot-password await path when called from the password-reset worker). */
  async sendPasswordReset(params: PasswordResetEmailPayload): Promise<unknown> {
    return this.outboundEmailQueue.enqueuePasswordReset(params);
  }

  /** Used by OutboundEmailQueueService worker (or inline enqueue path). */
  async sendPasswordResetImmediate(params: PasswordResetEmailPayload) {
    const token = params.token?.trim();
    if (!token) {
      throw new Error('sendPasswordReset requires a non-empty token');
    }

    const expiresAt = MailService.coerceExpiresAt(params.expiresAt);

    const expiresInMinutes = Math.max(
      1,
      Math.ceil((expiresAt.getTime() - Date.now()) / (60 * 1000)),
    );

    const linkLine = params.resetLink
      ? `Open this link to reset your password (expires in ${expiresInMinutes} minute(s).):\n${params.resetLink}\n\n`
      : '';

    const tokenLineText = `Your reset token: ${token}\n\n`;

    const text = `${linkLine}${tokenLineText}This token expires in ${expiresInMinutes} minute(s). If you did not request a reset, ignore this email.`;

    const linkHtml = params.resetLink
      ? `<p><a href="${params.resetLink}">Reset your password</a> (expires in ${expiresInMinutes} minute(s).)</p>`
      : '';

    return this.send({
      to: params.to,
      subject: 'Reset your SkillBridge password',
      text,
      html: `${linkHtml}<p>Your reset token: <strong>${token}</strong></p><p>It expires in ${expiresInMinutes} minute(s). If you did not request a reset, ignore this email.</p>`,
    });
  }

  /** BullMQ serializes job data; `expiresAt` becomes an ISO string. */
  private static coerceExpiresAt(value: Date | string | number): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new Error('Invalid expiresAt for password reset email');
    }
    return d;
  }

  async sendVerificationOtp(params: {
    to: string;
    otp: string;
    expiresAt: Date;
  }) {
    const expiresInMinutes = Math.max(
      1,
      Math.ceil((params.expiresAt.getTime() - Date.now()) / (60 * 1000)),
    );

    return this.send({
      to: params.to,
      subject: 'Verify your SkillBridge email',
      text: `Your SkillBridge verification code is ${params.otp}. It expires in ${expiresInMinutes} minute(s).`,
      html: `<p>Your SkillBridge verification code is <strong>${params.otp}</strong>.</p><p>It expires in ${expiresInMinutes} minute(s).</p>`,
    });
  }
}
