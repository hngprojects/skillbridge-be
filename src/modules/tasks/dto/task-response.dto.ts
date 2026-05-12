import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskSubmissionStatus } from '../entities/task-submission.entity';

export class TaskSubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ example: 'https://github.com/username/project' })
  externalLink: string | null;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/...' })
  fileUrl: string | null;

  @ApiProperty()
  submittedAt: Date;

  @ApiProperty({ enum: TaskSubmissionStatus })
  status: TaskSubmissionStatus;

  @ApiPropertyOptional({ example: 85 })
  score: number | null;

  @ApiPropertyOptional()
  feedback: string | null;
}

export class TaskStatusResponseDto {
  @ApiPropertyOptional({ type: TaskSubmissionResponseDto })
  latestSubmission: TaskSubmissionResponseDto | null;

  @ApiProperty({ example: 3 })
  totalSubmissions: number;
}
