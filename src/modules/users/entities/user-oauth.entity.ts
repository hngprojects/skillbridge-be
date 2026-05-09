import { ApiProperty } from '@nestjs/swagger';
import { User } from './user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  CANDIDATE = 'candidate',
  EMPLOYER = 'employer',
}

@Entity('user_oauth_accounts')
export class OAuthUser {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column()
  user_id: string;

  @ManyToOne(() => User, (user: User) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 20, unique: true })
  provider: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  provider_id: string;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
