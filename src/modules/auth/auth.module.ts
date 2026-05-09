import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { StringValue } from 'ms';
import { env } from '../../config/env';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerificationOtp } from './entities/verification-otp.entity';
import { JwtStrategy } from './strategies/jwt.strategy';
import { VerificationOtpService } from './verification-otp.service';
<<<<<<< HEAD
import { GoogleStrategy } from './strategies/google.strategy';
=======
import { VerificationOtpService } from './verification-otp.service';
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationOtp]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: env.JWT_ACCESS_EXPIRES_IN as StringValue },
    }),
    UsersModule,
    MailModule,
  ],
  controllers: [AuthController],
<<<<<<< HEAD
  providers: [AuthService, JwtStrategy, GoogleStrategy],
=======
  providers: [AuthService, JwtStrategy, VerificationOtpService, VerificationOtpService],
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41
  exports: [AuthService],
})
export class AuthModule {}
