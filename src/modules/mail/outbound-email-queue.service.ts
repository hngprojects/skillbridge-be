import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import { redisQueueConnection } from '../../config/redis-queue';
import type { PasswordResetEmailPayload } from './mail.types';
import { MailService } from './mail.service';

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
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(forwardRef(() => MailService))
    private readonly mailService: MailService,
  ) {}

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
      async (job) => {
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
        await this.mailService.sendPasswordResetImmediate(parsed.data);
      },
      { connection: conn },
    );
    this.worker.on('failed', (job, err) => {
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
      await this.mailService.sendPasswordResetImmediate(payload);
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
}
