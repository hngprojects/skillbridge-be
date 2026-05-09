import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  first_name: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  last_name: string;

  @ApiProperty({ example: 'Nigeria' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  country: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  profile_pic_url?: string;

  @ApiProperty({ enum: UserRole, required: false, default: UserRole.CANDIDATE })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
