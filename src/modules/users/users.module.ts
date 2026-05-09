import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModelAction } from './actions/user.action';
import { User } from './entities/user.entity';
<<<<<<< HEAD
import { OAuthUser } from './entities/user-oauth.entity';
=======
import { OAuthUser } from './entities/user-oauth-account.entity';
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, OAuthUser])],
  controllers: [UsersController],
  providers: [UserModelAction, UsersService],
  exports: [UsersService, UserModelAction],
})
export class UsersModule {}
