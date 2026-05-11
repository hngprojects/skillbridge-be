import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TalentProfile } from '../../talent/entities/talent-profile.entity';
import { EmployerProfile } from './employer-profile.entity';

export enum ContactStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

@Entity('employer_contacts')
@Unique(['employer_profile_id', 'candidate_profile_id'])
export class EmployerContact {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid', name: 'employer_profile_id' })
  employer_profile_id: string;

  @ManyToOne(
    () => EmployerProfile,
    (employer: EmployerProfile) => employer.contacts,
    {
    onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'employer_profile_id' })
  employerProfile: EmployerProfile;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid', name: 'candidate_profile_id' })
  candidate_profile_id: string;

  @ManyToOne(() => TalentProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_profile_id' })
  candidateProfile: TalentProfile;

  @ApiProperty({ enum: ContactStatus, default: ContactStatus.PENDING })
  @Column({
    type: 'enum',
    enum: ContactStatus,
    default: ContactStatus.PENDING,
  })
  status: ContactStatus;

  @ApiProperty()
  @CreateDateColumn({ name: 'initiated_at', type: 'timestamp with time zone' })
  initiated_at: Date;
}
