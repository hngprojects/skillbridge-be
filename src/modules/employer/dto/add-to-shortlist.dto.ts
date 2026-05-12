import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddToShortlistDto {
  @ApiProperty({
    example: '6e72fd7d-f556-4c6b-93de-0c115e7b4362',
    description: 'Talent profile id of the candidate to shortlist',
  })
  @IsUUID('4', { message: 'talentId must be a valid UUID' })
  talentId: string;
}
