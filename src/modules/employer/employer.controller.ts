import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { setAuthCookies } from '../auth/auth.cookies';
import { UserRole } from '../users/entities/user.entity';
import { CompleteEmployerOnboardingDto } from './dto/complete-employer-onboarding.dto';
import { DiscoveryQueryDto } from './dto/discovery-query.dto';
import { UpdateEmployerProfileDto } from './dto/update-employer-profile.dto';
import { EmployerService } from './employer.service';

@ApiTags('employer')
@ApiCookieAuth()
@Controller('employer')
@Roles(UserRole.EMPLOYER)
export class EmployerController {
  constructor(private readonly employerService: EmployerService) {}

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete employer onboarding' })
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

  @Get('me')
  @ApiOperation({ summary: 'Get the current employer profile' })
  @ApiOkResponse({ description: 'Employer profile returned' })
  @ApiNotFoundResponse({ description: 'Employer profile not found' })
  getProfile(@CurrentUser('sub') userId: string) {
    return this.employerService.getProfile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update employer profile fields' })
  @ApiOkResponse({ description: 'Employer profile updated' })
  @ApiNotFoundResponse({ description: 'Employer profile not found' })
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateEmployerProfileDto,
  ) {
    return this.employerService.updateProfile(userId, dto);
  }

  @Get('discovery')
  @ApiOperation({ summary: 'Browse published candidate profiles' })
  @ApiOkResponse({ description: 'Paginated list of candidate cards' })
  @ApiForbiddenResponse({
    description: 'Complete employer onboarding before using discovery',
  })
  discoverCandidates(
    @CurrentUser('sub') userId: string,
    @Query() query: DiscoveryQueryDto,
  ) {
    return this.employerService.discoverCandidates(userId, query);
  }

  @Get('candidates/:candidateId')
  @ApiOperation({ summary: 'Get a single candidate profile by ID' })
  @ApiOkResponse({ description: 'Candidate profile returned' })
  @ApiNotFoundResponse({ description: 'Candidate profile not found' })
  getCandidateProfile(
    @CurrentUser('sub') userId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    return this.employerService.getCandidateProfile(userId, candidateId);
  }

  @Get('shortlists')
  @ApiOperation({ summary: 'Get the employer shortlist (paginated)' })
  @ApiOkResponse({ description: 'Paginated shortlist returned' })
  getShortlist(
    @CurrentUser('sub') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.employerService.getShortlist(userId, page, limit);
  }

  @Post('shortlists/:candidateId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a candidate to the shortlist' })
  @ApiCreatedResponse({ description: 'Candidate added to shortlist' })
  @ApiConflictResponse({ description: 'Candidate is already in your shortlist' })
  @ApiNotFoundResponse({ description: 'Candidate profile not found' })
  addToShortlist(
    @CurrentUser('sub') userId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    return this.employerService.addToShortlist(userId, candidateId);
  }

  @Delete('shortlists/:candidateId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a candidate from the shortlist' })
  @ApiOkResponse({ description: 'Candidate removed from shortlist' })
  @ApiNotFoundResponse({ description: 'Candidate not found in shortlist' })
  removeFromShortlist(
    @CurrentUser('sub') userId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    return this.employerService.removeFromShortlist(userId, candidateId);
  }

  @Post('contacts/:candidateId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate contact with a Job Ready candidate' })
  @ApiCreatedResponse({ description: 'Contact request sent' })
  @ApiConflictResponse({
    description: 'You have already initiated contact with this candidate',
  })
  @ApiForbiddenResponse({
    description: 'Contact can only be initiated with Job Ready candidates',
  })
  @ApiNotFoundResponse({ description: 'Candidate profile not found' })
  initiateContact(
    @CurrentUser('sub') userId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    return this.employerService.initiateContact(userId, candidateId);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'List all contact requests made by this employer' })
  @ApiOkResponse({ description: 'Paginated contact history returned' })
  getContacts(
    @CurrentUser('sub') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.employerService.getContacts(userId, page, limit);
  }
}
