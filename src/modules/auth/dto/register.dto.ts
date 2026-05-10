import { ApiProperty, PickType } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { UserRole } from '../../users/entities/user.entity';
import { normalizeOAuthSignupRole } from '../oauth-signup-role';

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
  @Transform(({ value }: TransformFnParams): string | undefined => {
    const rawRole = typeof value === 'string' ? value : undefined;
    return normalizeOAuthSignupRole(rawRole) ?? rawRole;
  })
  @IsIn([UserRole.TALENT, UserRole.EMPLOYER], {
    message: 'role must be either talent or employer',
  })
  role: UserRole.TALENT | UserRole.EMPLOYER;
}
