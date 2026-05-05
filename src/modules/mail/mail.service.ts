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
}
