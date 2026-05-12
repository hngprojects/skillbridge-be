import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TalentProfile } from '../../talent/entities/talent-profile.entity';
import { User } from '../../users/entities/user.entity';

@Entity('shortlists')
@Index('UQ_shortlists_employer_id_candidate_id', ['employer_id', 'candidate_id'], {
  unique: true,
})
export class Shortlist {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Index('IDX_shortlists_employer_id')
  @Column({ type: 'uuid' })
  employer_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employer_id' })
  employer: User;

  @ApiProperty({ format: 'uuid' })
  @Index('IDX_shortlists_candidate_id')
  @Column({ type: 'uuid' })
  candidate_id: string;

  @ManyToOne(() => TalentProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_id' })
  candidate: TalentProfile;

  @ApiProperty()
  @Column({
    name: 'saved_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  saved_at: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updated_at: Date;
}
