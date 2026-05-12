import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TalentProfile } from '../../talent/entities/talent-profile.entity';
import { Assessment } from '../../assessment/entities/assessment.entity';
import { User } from '../../users/entities/user.entity';

export enum TaskSubmissionStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('task_submissions')
export class TaskSubmission {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Index()
  @Column({ type: 'uuid' })
  talent_profile_id: string;

  @ManyToOne(() => TalentProfile)
  @JoinColumn({ name: 'talent_profile_id' })
  talentProfile: TalentProfile;

  @ApiProperty({ format: 'uuid', required: false, nullable: true })
  @Column({ type: 'uuid', nullable: true })
  assessment_id: string | null;

  @ManyToOne(() => Assessment, { nullable: true })
  @JoinColumn({ name: 'assessment_id' })
  assessment: Assessment | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'https://s3.amazonaws.com/...',
  })
  @Column({ type: 'varchar', length: 500, nullable: true })
  file_url: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'https://github.com/user/repo',
  })
  @Column({ type: 'varchar', length: 500, nullable: true })
  external_link: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'submitted_at', type: 'timestamp with time zone' })
  @Index()
  submitted_at: Date;

  @ApiProperty({
    enum: TaskSubmissionStatus,
    example: TaskSubmissionStatus.PENDING,
  })
  @Index()
  @Column({
    type: 'enum',
    enum: TaskSubmissionStatus,
    default: TaskSubmissionStatus.PENDING,
  })
  status: TaskSubmissionStatus;

  @ApiProperty({ required: false, nullable: true, example: 85 })
  @Column({ type: 'int', nullable: true })
  score: number | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'text', nullable: true })
  feedback: string | null;

  @ApiProperty({ format: 'uuid', required: false, nullable: true })
  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: User | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  reviewed_at: Date | null;
}
