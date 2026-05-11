import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { ContactMessage } from './entities/contact-message.entity';
import { WaitlistEntry } from './entities/waitlist-entry.entity';

@Injectable()
export class InquiriesService {
  constructor(
    @InjectRepository(WaitlistEntry)
    private readonly waitlistRepository: Repository<WaitlistEntry>,
    @InjectRepository(ContactMessage)
    private readonly contactMessageRepository: Repository<ContactMessage>,
  ) {}

  async joinWaitlist(dto: JoinWaitlistDto): Promise<{ message: string }> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existingEntry = await this.waitlistRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existingEntry) {
      return { message: 'Email already on waitlist' };
    }

    await this.waitlistRepository.save(
      this.waitlistRepository.create({
        email: normalizedEmail,
        joiningAs: dto.joiningAs,
        fullName: dto.fullName.trim(),
        preferredRole: dto.preferredRole?.trim() || null,
        referralSource: dto.referralSource?.trim() || null,
      }),
    );

    return { message: 'Added to waitlist' };
  }

  async createContactMessage(
    dto: CreateContactMessageDto,
  ): Promise<{ message: string }> {
    await this.contactMessageRepository.save(
      this.contactMessageRepository.create({
        fullName: dto.fullName.trim(),
        email: dto.email.trim().toLowerCase(),
        subject: dto.subject.trim(),
        message: dto.message.trim(),
      }),
    );

    return { message: 'Message received' };
  }
}
