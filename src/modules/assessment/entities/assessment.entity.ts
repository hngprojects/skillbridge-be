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

export enum AssessmentStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FLAGGED = 'flagged',
}

/**
 * Minimal Assessment entity shell for task submission FK relation.
 * Full assessment module implementation will be built by another developer.
 */
@Entity('assessments')
export class Assessment {
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

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', default: 1 })
  attempt_number: number;

  @ApiProperty({
    enum: AssessmentStatus,
    example: AssessmentStatus.IN_PROGRESS,
  })
  @Column({
    type: 'enum',
    enum: AssessmentStatus,
    default: AssessmentStatus.IN_PROGRESS,
  })
  status: AssessmentStatus;

  @ApiProperty({ default: false })
  @Column({ type: 'boolean', default: false })
  tab_switch_flagged: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'started_at', type: 'timestamp with time zone' })
  started_at: Date;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  completed_at: Date | null;
}
