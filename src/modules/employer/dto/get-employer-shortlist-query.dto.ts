import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../users/dto/pagination.dto';

export const EMPLOYER_SHORTLIST_SORT_FIELDS = [
  'shortlistedAt',
  'fullName',
  'roleTrack',
] as const;

export type EmployerShortlistSortField =
  (typeof EMPLOYER_SHORTLIST_SORT_FIELDS)[number];

export const EMPLOYER_SHORTLIST_SORT_ORDERS = ['asc', 'desc'] as const;

export type EmployerShortlistSortOrder =
  (typeof EMPLOYER_SHORTLIST_SORT_ORDERS)[number];

export class GetEmployerShortlistQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: EMPLOYER_SHORTLIST_SORT_FIELDS,
    default: 'shortlistedAt',
    description: 'Field to sort shortlisted candidates by',
  })
  @IsOptional()
  @IsIn(EMPLOYER_SHORTLIST_SORT_FIELDS, {
    message: 'sort must be one of shortlistedAt, fullName, or roleTrack',
  })
  sort?: EmployerShortlistSortField = 'shortlistedAt';

  @ApiPropertyOptional({
    enum: EMPLOYER_SHORTLIST_SORT_ORDERS,
    default: 'desc',
    description: 'Sort direction',
  })
  @IsOptional()
  @IsIn(EMPLOYER_SHORTLIST_SORT_ORDERS, {
    message: 'order must be asc or desc',
  })
  order?: EmployerShortlistSortOrder = 'desc';
}
