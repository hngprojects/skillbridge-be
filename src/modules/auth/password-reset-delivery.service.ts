import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { parseDurationToMs } from '../../config/duration';
import { env } from '../../config/env';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';

type IssuedPasswordResetToken = {
  token: string;
  expiresAt: Date;
};

@Injectable()
export class PasswordResetDeliveryService {
  private readonly logger = new Logger(PasswordResetDeliveryService.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    private readonly mailService: MailService,
  ) {}

  async deliverForUser(userId: string): Promise<void> {
    const user = await this.usersService.findOneOrNull(userId);
    if (!user) return;

    const issued = await this.issuePasswordResetToken(user.id);
    const resetLink = this.buildPasswordResetLink(issued.token);

    try {
      await this.mailService.sendPasswordReset({
        to: user.email,
        token: issued.token,
        expiresAt: issued.expiresAt,
        ...(resetLink ? { resetLink } : {}),
      });
    } catch (err) {
      this.logger.error(
        `Forgot-password side effects failed for ${this.redactEmailForLog(user.email)}`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }

  private async issuePasswordResetToken(
    userId: string,
  ): Promise<IssuedPasswordResetToken> {
    const token = randomBytes(32).toString('base64url');
    const tokenLookupHash = this.passwordResetLookupHash(token);
    const expiresAt = new Date(
      Date.now() + parseDurationToMs(env.PASSWORD_RESET_EXPIRES_IN),
    );
    const tokenHash = await argon2.hash(token);

    await this.passwordResetTokenRepository.manager.transaction(
      async (manager) => {
        const lockedUser = await manager.findOne(User, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedUser) {
          throw new Error('Password reset issuer: user row missing');
        }

        await manager
          .createQueryBuilder()
          .update(PasswordResetToken)
          .set({ usedAt: () => 'CURRENT_TIMESTAMP' })
          .where('user_id = :userId', { userId })
          .andWhere('used_at IS NULL')
          .andWhere('expires_at > NOW()')
          .execute();

        const row = manager.create(PasswordResetToken, {
          userId,
          tokenLookupHash,
          tokenHash,
          expiresAt,
          usedAt: null,
        });
        await manager.save(row);
      },
    );

    return { token, expiresAt };
  }

  private buildPasswordResetLink(token: string): string | undefined {
    const base = env.PASSWORD_RESET_WEB_BASE_URL?.trim();
    if (!base) {
      return undefined;
    }
    const trimmed = base.replace(/\/$/, '');
    const enc = encodeURIComponent(token);
    const hashIdx = trimmed.indexOf('#');
    if (hashIdx === -1) {
      return `${trimmed}#token=${enc}`;
    }
    const withHash = trimmed.slice(0, hashIdx + 1);
    const frag = trimmed.slice(hashIdx + 1);
    if (!frag) {
      return `${withHash}token=${enc}`;
    }
    return `${withHash}${frag}&token=${enc}`;
  }

  private passwordResetLookupHash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private redactEmailForLog(email: string): string {
    const at = email.indexOf('@');
    if (at <= 0) {
      return '[redacted]';
    }
    return `***${email.slice(at)}`;
  }
}
