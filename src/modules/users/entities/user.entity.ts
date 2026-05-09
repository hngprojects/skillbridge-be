import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  CANDIDATE = 'candidate',
  EMPLOYER = 'employer',
}

@Entity('users')
export class User {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Exclude()
  @Column({ type: 'varchar', length: 255 })
  password: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 255 })
  first_name: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 255 })
  last_name: string;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar_url: string | null;

  @ApiProperty({ example: 'Nigeria' })
  @Column({ type: 'varchar', length: 100 })
  country: string;

  @ApiProperty({ default: false })
  @Column({ type: 'boolean', default: false })
  is_verified: boolean;

  @ApiProperty({ default: false })
  @Column({ type: 'boolean', default: false })
  onboarding_complete: boolean;

  @ApiProperty()
  @Expose()
  get fullname(): string {
    return `${this.first_name} ${this.last_name}`.trim();
  }

  @ApiProperty({ enum: UserRole, default: UserRole.CANDIDATE })
  @Column({ type: 'enum', enum: UserRole, default: UserRole.CANDIDATE })
  role: UserRole;

  @Exclude()
  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    name: 'refresh_token_hash',
  })
  refreshTokenHash: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  @Exclude()
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone' })
  deletedAt: Date | null;
}
