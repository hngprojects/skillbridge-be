import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { UserRole } from '../../users/entities/user.entity';

class RegisterBaseDto extends PickType(CreateUserDto, [
  'email',
  'password',
] as const) {}

export class RegisterDto extends RegisterBaseDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/\S/, { message: 'firstName must not be empty' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/\S/, { message: 'lastName must not be empty' })
  lastName: string;

  @ApiProperty({ enum: [UserRole.CANDIDATE, UserRole.EMPLOYER] })
  @IsIn([UserRole.CANDIDATE, UserRole.EMPLOYER], {
    message: 'role must be either talent or employer',
  })
  role: UserRole.CANDIDATE | UserRole.EMPLOYER;
}
