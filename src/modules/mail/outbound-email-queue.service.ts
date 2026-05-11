import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { Resend } from 'resend';
import { z } from 'zod';
import { env } from '../../config/env';
import { redisQueueConnection } from '../../config/redis-queue';
import { loadMailTemplateFile, substituteMailTemplate } from './mail-templates';
import type { PasswordResetEmailPayload, SendMailOptions } from './mail.types';

const QUEUE_NAME = 'password-reset-email';

const passwordResetEmailJobSchema = z.object({
  to: z.string().min(1),
  token: z.string().min(1),
  expiresAt: z.union([z.date(), z.string(), z.number()]),
  resetLink: z.string().optional(),
});

@Injectable()
export class OutboundEmailQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OutboundEmailQueueService.name);
  private readonly client = new Resend(env.RESEND_API_KEY);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  onModuleInit(): void {
    const conn = redisQueueConnection();
    if (!conn) {
      this.logger.log(
        'REDIS_URL not set; password-reset emails send inline after the request returns',
      );
      return;
    }
    this.queue = new Queue(QUEUE_NAME, { connection: conn });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== 'password-reset') {
          throw new Error(`Unknown outbound email job: ${job.name}`);
        }
        const parsed = passwordResetEmailJobSchema.safeParse(job.data);
        if (!parsed.success) {
          this.logger.error(
            'Invalid password-reset email job payload',
            parsed.error.flatten(),
          );
          throw new Error('Invalid password-reset email job payload');
        }
        await this.sendPasswordResetImmediate(parsed.data);
      },
      { connection: conn },
    );
    this.worker.on('failed', (job: Job | undefined, err) => {
      this.logger.error(
        `Outbound email job ${job?.id} failed`,
        err instanceof Error ? err.stack : err,
      );
    });
  }

  async enqueuePasswordReset(
    payload: PasswordResetEmailPayload,
  ): Promise<void> {
    const conn = redisQueueConnection();
    if (!conn) {
      await this.sendPasswordResetImmediate(payload);
      return;
    }
    await this.queue!.add('password-reset', payload, {
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async send({ to, subject, html, text, from }: SendMailOptions) {
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

    const { error } = await this.client.emails.send(payload);
    if (error) {
      throw new Error(error.message);
    }
  }

  private async sendPasswordResetImmediate(
    params: PasswordResetEmailPayload,
  ): Promise<void> {
    const token = params.token?.trim();
    if (!token) {
      throw new Error('sendPasswordReset requires a non-empty token');
    }

    const expiresAt = OutboundEmailQueueService.coerceExpiresAt(
      params.expiresAt,
    );
    const expiresInMinutes = Math.max(
      1,
      Math.ceil((expiresAt.getTime() - Date.now()) / (60 * 1000)),
    );

    const linkLine = params.resetLink
      ? `Open this link to reset your password (expires in ${expiresInMinutes} minute(s).):\n${params.resetLink}\n\n`
      : '';
    const tokenLineText = `Your reset token: ${token}\n\n`;
    const text = `${linkLine}${tokenLineText}This token expires in ${expiresInMinutes} minute(s). If you did not request a reset, ignore this email.`;

    const resetLinkBlock = params.resetLink
      ? `<p style="margin:12px 0 0 0"><a href="${params.resetLink.replace(/"/g, '&quot;')}" style="color:#1f5f6b;font-weight:600;text-decoration:underline">Open password reset link</a></p>`
      : '';

    const rawHtml = loadMailTemplateFile('password-reset.html');
    const html = substituteMailTemplate(rawHtml, {
      token,
      expiresMinutes: String(expiresInMinutes),
      resetLinkBlock,
    });

    await this.send({
      to: params.to,
      subject: 'Reset your SkillBridge password',
      text,
      html,
    });
  }

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
}
