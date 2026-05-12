import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskSubmissionStatus } from '../entities/task-submission.entity';

export class UpdateTaskStatusDto {
  @ApiProperty({
    enum: [
      TaskSubmissionStatus.UNDER_REVIEW,
      TaskSubmissionStatus.APPROVED,
      TaskSubmissionStatus.REJECTED,
    ],
    example: TaskSubmissionStatus.APPROVED,
  })
  @IsEnum([
    TaskSubmissionStatus.UNDER_REVIEW,
    TaskSubmissionStatus.APPROVED,
    TaskSubmissionStatus.REJECTED,
  ])
  status: TaskSubmissionStatus;

  @ApiPropertyOptional({ example: 85, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional({
    example: 'Great work! Well structured and clean code.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}
