import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import { UsersModule } from '../users/users.module';
import { EmployerController } from './employer.controller';
import { EmployerService } from './employer.service';
import { EmployerContact } from './entities/employer-contact.entity';
import { EmployerProfile } from './entities/employer-profile.entity';
import { Shortlist } from './entities/shortlist.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployerProfile,
      TalentProfile,
      Shortlist,
      EmployerContact,
    ]),
    UsersModule,
    AuthModule,
  ],
  controllers: [EmployerController],
  providers: [EmployerService],
})
export class EmployerModule {}
