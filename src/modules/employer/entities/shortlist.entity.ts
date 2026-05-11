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

@Entity('shortlists')
@Unique(['employer_profile_id', 'candidate_profile_id'])
export class Shortlist {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid', name: 'employer_profile_id' })
  employer_profile_id: string;

  @ManyToOne(
    () => EmployerProfile,
    (employer: EmployerProfile) => employer.shortlists,
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

  @ApiProperty()
  @CreateDateColumn({ name: 'saved_at', type: 'timestamp with time zone' })
  saved_at: Date;
}
