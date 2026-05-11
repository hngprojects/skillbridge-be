import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TalentProfileStatus } from '../../talent/entities/talent-profile.entity';

const DISCOVERY_STATUSES = [
  TalentProfileStatus.EMERGING,
  TalentProfileStatus.JOB_READY,
];

export class DiscoveryQueryDto {
  @ApiPropertyOptional({ example: 'frontend' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  roleTrack?: string;

  @ApiPropertyOptional({ enum: DISCOVERY_STATUSES })
  @IsOptional()
  @IsIn(DISCOVERY_STATUSES)
  status?: TalentProfileStatus;

  @ApiPropertyOptional({ example: 'Nigeria' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
