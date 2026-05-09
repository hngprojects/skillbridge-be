import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '../../config/env';
import { SendMailOptions } from './mail.types';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client = new Resend(env.RESEND_API_KEY);

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

  async sendPasswordReset(params: {
    to: string;
    token: string;
    expiresAt: Date;
    resetLink?: string;
  }) {
    const token = params.token?.trim();
    if (!token) {
      throw new Error('sendPasswordReset requires a non-empty token');
    }

    const expiresInMinutes = Math.max(
      1,
      Math.ceil((params.expiresAt.getTime() - Date.now()) / (60 * 1000)),
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
