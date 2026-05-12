import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { setAuthCookies } from '../auth/auth.cookies';
import { UserRole } from '../users/entities/user.entity';
import { CompleteEmployerOnboardingDto } from './dto/complete-employer-onboarding.dto';
import { SaveEmployerProfileDto } from './dto/save-employer-profile.dto';
import { AddToShortlistDto } from './dto/add-to-shortlist.dto';
import { GetEmployerShortlistQueryDto } from './dto/get-employer-shortlist-query.dto';
import { EmployerService } from './employer.service';

@ApiTags('employer')
@ApiCookieAuth()
@Controller('employer')
@Roles(UserRole.EMPLOYER)
export class EmployerController {
  constructor(private readonly employerService: EmployerService) {}

  @Post('profile')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save employer profile and complete onboarding (BE-ONB-EMP-001)' })
  @ApiUnprocessableEntityResponse({ description: 'Validation failed — field-specific error messages' })
  @ApiForbiddenResponse({ description: 'Onboarding already completed or wrong role' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  async saveProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: SaveEmployerProfileDto,
  ) {
    return this.employerService.saveProfile(userId, dto);
  }

  /** Legacy single-step onboarding — kept for backward compatibility. */
  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete employer onboarding (legacy)' })
  @ApiForbiddenResponse({ description: 'Onboarding already completed' })
  async completeOnboarding(
    @CurrentUser('sub') userId: string,
    @Body() dto: CompleteEmployerOnboardingDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.employerService.completeOnboarding(userId, dto);
    setAuthCookies(response, result.tokens);
    return {
      message: result.message,
      user: result.user,
      profile: result.profile,
    };
  }

  @Post('shortlist')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a Job Ready candidate to the employer shortlist' })
  @ApiUnprocessableEntityResponse({ description: 'Validation failed — field-specific error messages' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  async addToShortlist(
    @CurrentUser('sub') userId: string,
    @Body() dto: AddToShortlistDto,
  ) {
    return this.employerService.addToShortlist(userId, dto.talentId);
  }

  @Get('shortlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the authenticated employer shortlist' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  async getShortlist(
    @CurrentUser('sub') userId: string,
    @Query() query: GetEmployerShortlistQueryDto,
  ) {
    return this.employerService.getShortlist(userId, query);
  }

  @Delete('shortlist/:candidateId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a candidate from the employer shortlist' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async removeFromShortlist(
    @CurrentUser('sub') userId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    return this.employerService.removeFromShortlist(userId, candidateId);
  }
}
