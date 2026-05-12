import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TalentModule } from '../talent/talent.module';
import { UsersModule } from '../users/users.module';
import { EmployerController } from './employer.controller';
import { EmployerService } from './employer.service';
import { EmployerProfile } from './entities/employer-profile.entity';
import { Shortlist } from './entities/shortlist.entity';
import { ShortlistRepository } from './repositories/shortlist.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmployerProfile, Shortlist]),
    UsersModule,
    AuthModule,
    TalentModule,
  ],
  controllers: [EmployerController],
  providers: [EmployerService, ShortlistRepository],
})
export class EmployerModule {}
