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

  @ApiProperty({ enum: [UserRole.TALENT, UserRole.EMPLOYER] })
  @IsIn([UserRole.TALENT, UserRole.EMPLOYER], {
    message: 'role must be either talent or employer',
  })
  role: UserRole.TALENT | UserRole.EMPLOYER;

  @ApiProperty({ example: 'Find a new role in tech' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reasonForJoining: string;
}
