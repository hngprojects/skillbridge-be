import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TalentProfile } from '../../talent/entities/talent-profile.entity';

export enum AssessmentEligibilityStatus {
  UNINITIALIZED = 'UNINITIALIZED',
  ELIGIBLE = 'ELIGIBLE',
  IN_PROGRESS = 'IN_PROGRESS',
  LOCKED_OUT = 'LOCKED_OUT',
  PASSED = 'PASSED',
}

@Entity('assessment_eligibility')
export class AssessmentEligibility {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  talent_id: string;

  @OneToOne(() => TalentProfile)
  @JoinColumn({ name: 'talent_id' })
  talent: TalentProfile;

  @ApiProperty({ enum: AssessmentEligibilityStatus })
  @Column({
    type: 'enum',
    enum: AssessmentEligibilityStatus,
    default: AssessmentEligibilityStatus.UNINITIALIZED,
  })
  status: AssessmentEligibilityStatus;

  @ApiProperty({ default: 0 })
  @Column({ type: 'integer', default: 0 })
  attempts_count: number;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  last_attempt_at: Date | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'timestamp with time zone', nullable: true })
  retake_eligible_at: Date | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  created_at: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updated_at: Date;
}
