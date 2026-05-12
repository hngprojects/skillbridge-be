import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shortlist } from '../entities/shortlist.entity';

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
}
