import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type {
  CreateVerifiedUserWithOauthLinkParams,
  UserOauthProvisioning,
} from './user-oauth-provisioning.types';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { UserModelAction } from './actions/user.action';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationDto } from './dto/pagination.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { OAuthUser } from './entities/user-oauth-account.entity';
import { User, UserRole } from './entities/user.entity';
import { OAuthUserModelAction } from './actions/user-oauth.action';
import { OAuthUser } from './entities/user-oauth.entity';

const NO_TRANSACTION = {
  transactionOptions: { useTransaction: false as const },
};

function isPostgresUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const code =
    (err as QueryFailedError & { code?: string }).code ??
    (err.driverError as { code?: string } | undefined)?.code;
  return code === '23505';
}

export type OAuthProviderProfileInput = {
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

const OAUTH_DEFAULT_COUNTRY = 'Unknown';

@Injectable()
export class UsersService {
  constructor(
    private readonly userModelAction: UserModelAction,
    @InjectRepository(OAuthUser)
    private readonly oauthRepository: Repository<OAuthUser>,
    private readonly oauthUserModelAction: OAuthUserModelAction,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.userModelAction.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password);
    return this.userModelAction.create({
      ...NO_TRANSACTION,
      createPayload: {
        email: dto.email,
        password: passwordHash,
        first_name: dto.first_name,
        last_name: dto.last_name,
        country: dto.country,
        avatar_url: dto.profile_pic_url ?? null,
        is_verified: false,
        onboarding_complete: false,
        role: dto.role ?? UserRole.CANDIDATE,
      },
    });
  }

  findAll(pagination: PaginationDto) {
    return this.userModelAction.list({
      paginationPayload: { page: pagination.page!, limit: pagination.limit! },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModelAction.get({
      identifierOptions: { id },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  findOneOrNull(id: string): Promise<User | null> {
    return this.userModelAction.get({
      identifierOptions: { id },
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userModelAction.findByEmail(email);
  }

  findOAuthAccount(provider: string, provider_id: string) {
    return this.oauthUserModelAction.findOAuthUser(provider, provider_id);
  }

  async createOAuthAccount(
    userId: string,
    provider: string,
    provider_id: string,
  ): Promise<OAuthUser> {
    try {
      await this.oauthUserModelAction.insertOAuthUser(
        userId,
        provider,
        provider_id,
      );

      // Fetch the created entity
      const oauthUser = await this.oauthUserModelAction.findOAuthUser(
        provider,
        provider_id,
      );

      if (!oauthUser) {
        throw new Error('Failed to retrieve created OAuth account');
      }

      return oauthUser;
    } catch (err) {
      // Handle unique constraint violation (concurrent insert)
      if (
        err instanceof QueryFailedError &&
        'code' in err &&
        err.code === '23505'
      ) {
        const existing = await this.oauthUserModelAction.findOAuthUser(
          provider,
          provider_id,
        );
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Atomically creates a new User and links their OAuth provider account in a
   * single DB transaction. If a concurrent request created the same rows between
   * our outer check and this insert (unique-constraint violation), we re-query
   * and return the already-existing record instead of propagating the error.
   */
  async findOrCreateAndLinkOAuthUser(
    provider: string,
    provider_id: string,
    first_name: string,
    last_name: string,
    email: string,
    country: string,
    avatar_url?: string | null,
  ): Promise<{ user: User; oauthUser: OAuthUser }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const tx = {
          transactionOptions: {
            useTransaction: true as const,
            transaction: manager,
          },
        };

        const user = await this.userModelAction.create({
          ...tx,
          createPayload: {
            first_name,
            last_name,
            email,
            password: null,
            is_verified: true,
            onboarding_complete: false,
            role: UserRole.CANDIDATE,
            avatar_url: avatar_url ?? null,
            country,
          },
        });

        const oauthUser = await this.oauthUserModelAction.create({
          ...tx,
          createPayload: { user_id: user.id, provider, provider_id },
        });

        // Attach the user relation so callers don't need an extra query.
        oauthUser.user = user;

        return { user, oauthUser };
      });
    } catch (err) {
      // PostgreSQL unique-violation code 23505: a concurrent request already
      // created these rows. Re-query and return the winner's result.
      if (
        err instanceof QueryFailedError &&
        'code' in err &&
        err.code === '23505'
      ) {
        const oauthUser = await this.oauthUserModelAction.findOAuthUser(
          provider,
          provider_id,
        );
        if (oauthUser) return { user: oauthUser.user, oauthUser };
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    await this.findOne(id);

    const { profile_pic_url: profilePicUrl, ...userDto } = dto;
    const payload: Partial<User> = {
      ...userDto,
      ...(profilePicUrl !== undefined ? { avatar_url: profilePicUrl } : {}),
    };
    if (dto.password) {
      payload.password = await argon2.hash(dto.password);
    }

    const updated = await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: payload,
    });
    if (!updated) {
      throw new InternalServerErrorException('Failed to update user');
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.userModelAction.delete({
      ...NO_TRANSACTION,
      identifierOptions: { id },
    });
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: { refreshTokenHash: hash },
    });
  }

  async markVerified(id: string): Promise<User> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: { is_verified: true },
    });
    return this.findOne(id);
  }

  async markOnboardingComplete(id: string): Promise<User> {
    await this.userModelAction.update({
      ...NO_TRANSACTION,
      identifierOptions: { id },
      updatePayload: { onboarding_complete: true },
    });
    return this.findOne(id);
  }

  rotateRefreshTokenHash(
    id: string,
    currentHash: string,
    nextHash: string,
  ): Promise<boolean> {
    return this.userModelAction.rotateRefreshTokenHash(
      id,
      currentHash,
      nextHash,
    );
  }

  async findOauthAccountWithUser(
    provider: string,
    providerId: string,
  ): Promise<{ oauth: OAuthUser; user: User } | null> {
    const oauth = await this.oauthRepository.findOne({
      where: { provider, provider_id: providerId },
      relations: ['user'],
    });
    if (!oauth?.user) return null;
    return { oauth, user: oauth.user };
  }

  async createVerifiedUserWithOauthLink(
    params: CreateVerifiedUserWithOauthLinkParams,
  ): Promise<User> {
    const provisioning = this.userModelAction as UserOauthProvisioning;
    return await provisioning.createVerifiedUserWithOauthLink(params);
  }

  async linkOauthAccountToUser(
    userId: string,
    provider: string,
    providerId: string,
  ): Promise<void> {
    try {
      await this.oauthRepository.save(
        this.oauthRepository.create({
          user_id: userId,
          provider,
          provider_id: providerId,
        }),
      );
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) {
        throw err;
      }
      const byExternal = await this.findOauthAccountWithUser(
        provider,
        providerId,
      );
      if (byExternal?.user.id === userId) {
        return;
      }
      const forUserProvider = await this.oauthRepository.findOne({
        where: { user_id: userId, provider },
      });
      if (forUserProvider?.provider_id === providerId) {
        return;
      }
      throw err;
    }
  }

  /**
   * OAuth callback resolution: existing provider link, auto-link by email, or new user.
   */
  async resolveOAuthUserFromProviderProfile(
    provider: string,
    profile: OAuthProviderProfileInput,
  ): Promise<User> {
    const linked = await this.findOauthAccountWithUser(
      provider,
      profile.providerId,
    );
    if (linked) {
      return linked.user;
    }

    const byEmail = await this.findByEmail(profile.email);
    if (byEmail) {
      if (!byEmail.is_verified) {
        await this.markVerified(byEmail.id);
      }
      await this.linkOauthAccountToUser(
        byEmail.id,
        provider,
        profile.providerId,
      );
      return this.findOne(byEmail.id);
    }

    try {
      return await this.createVerifiedUserWithOauthLink({
        email: profile.email,
        first_name: profile.firstName,
        last_name: profile.lastName,
        country: OAUTH_DEFAULT_COUNTRY,
        avatar_url: profile.avatarUrl,
        provider,
        providerId: profile.providerId,
      });
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) {
        throw err;
      }
      const raced = await this.findByEmail(profile.email);
      if (!raced) {
        throw err;
      }
      if (!raced.is_verified) {
        await this.markVerified(raced.id);
      }
      await this.linkOauthAccountToUser(
        raced.id,
        provider,
        profile.providerId,
      );
      return this.findOne(raced.id);
    }
  }
}
