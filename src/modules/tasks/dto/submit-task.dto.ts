import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength, IsIn } from 'class-validator';
import { TALENT_ROLE_TRACKS } from '../../talent/talent.constants';

export class SubmitTaskDto {
  @ApiPropertyOptional({
    example: 'https://github.com/username/project',
    description: 'External link to the task submission (GitHub, Figma, etc.)',
  })
  @IsOptional()
  @IsUrl({}, { message: 'externalLink must be a valid URL' })
  @MaxLength(500)
  externalLink?: string;

  @ApiPropertyOptional({
    example: 'frontend_developer',
    enum: TALENT_ROLE_TRACKS,
    description: 'Role track for the task',
  })
  @IsOptional()
  @IsString()
  @IsIn(TALENT_ROLE_TRACKS, {
    message: `track must be one of: ${TALENT_ROLE_TRACKS.join(', ')}`,
  })
  track?: string;
}
