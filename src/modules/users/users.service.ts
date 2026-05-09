import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserModelAction } from './actions/user.action';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationDto } from './dto/pagination.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserRole } from './entities/user.entity';
import { OAuthUserModelAction } from './actions/user-oauth.action';
import { OAuthUser } from './entities/user-oauth.entity';

const NO_TRANSACTION = {
  transactionOptions: { useTransaction: false as const },
};

@Injectable()
export class UsersService {
  constructor(
    private readonly userModelAction: UserModelAction,
    private readonly oauthUserModelAction: OAuthUserModelAction,
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
        role: UserRole.CANDIDATE,
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

  createOAuthAccount() {}

  createOAuthUser() {}

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
}
