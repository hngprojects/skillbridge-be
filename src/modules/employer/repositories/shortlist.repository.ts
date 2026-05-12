import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  EmployerShortlistSortField,
  EmployerShortlistSortOrder,
} from '../dto/get-employer-shortlist-query.dto';
import { Shortlist } from '../entities/shortlist.entity';

export type EmployerShortlistPage = {
  items: Shortlist[];
  total: number;
};

@Injectable()
export class ShortlistRepository {
  constructor(
    @InjectRepository(Shortlist)
    private readonly repository: Repository<Shortlist>,
  ) {}

  findByEmployerAndCandidate(
    employerId: string,
    candidateId: string,
  ): Promise<Shortlist | null> {
    return this.repository.findOne({
      where: {
        employer_id: employerId,
        candidate_id: candidateId,
      },
    });
  }

  create(employerId: string, candidateId: string): Promise<Shortlist> {
    const shortlist = this.repository.create({
      employer_id: employerId,
      candidate_id: candidateId,
    });

    return this.repository.save(shortlist);
  }

  findByEmployer(
    employerId: string,
    options: {
      page: number;
      limit: number;
      sort: EmployerShortlistSortField;
      order: EmployerShortlistSortOrder;
    },
  ): Promise<EmployerShortlistPage> {
    const { page, limit, sort, order } = options;
    const direction = order.toUpperCase() as 'ASC' | 'DESC';

    const queryBuilder = this.repository
      .createQueryBuilder('shortlist')
      .innerJoinAndSelect('shortlist.candidate', 'candidate')
      .innerJoinAndSelect('candidate.user', 'user')
      .where('shortlist.employer_id = :employerId', { employerId });

    switch (sort) {
      case 'fullName':
        queryBuilder
          .orderBy('user.first_name', direction)
          .addOrderBy('user.last_name', direction);
        break;
      case 'roleTrack':
        queryBuilder
          .orderBy('candidate.track', direction)
          .addOrderBy('candidate.role_track', direction);
        break;
      case 'shortlistedAt':
      default:
        queryBuilder.orderBy('shortlist.saved_at', direction);
        break;
    }

    return queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount()
      .then(([items, total]) => ({ items, total }));
  }
}
