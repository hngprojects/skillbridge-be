import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CreateUserDto } from '../../users/dto/create-user.dto';

class RegisterBaseDto extends PickType(CreateUserDto, [
  'email',
  'country',
  'password',
  'profile_pic_url',
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
}
