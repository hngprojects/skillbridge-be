import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../../config/env';
import type { PasswordResetEmailPayload, SendMailOptions } from './mail.types';
import { OutboundEmailQueueService } from './outbound-email-queue.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client = new Resend(env.RESEND_API_KEY);

  constructor(private readonly outboundEmailQueue: OutboundEmailQueueService) {}

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
