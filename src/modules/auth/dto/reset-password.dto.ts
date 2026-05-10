import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MatchField } from '../validators/match-field.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Plaintext reset token from the email' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @MatchField('password', { message: 'Passwords do not match' })
  confirmPassword: string;
}
