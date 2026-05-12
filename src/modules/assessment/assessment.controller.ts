import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { AssessmentService } from './assessment.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { SuccessMessages } from '../../shared';

class SubmitAssessmentDto {
  result: 'PASSED' | 'FAILED';
}

@ApiTags('talent/assessment')
@ApiCookieAuth()
@Controller('talent/assessment')
@Roles(UserRole.TALENT)
export class AssessmentController {
  constructor(private readonly assessmentService: AssessmentService) {}

  @Get('eligibility')
  @ApiOperation({ summary: 'Get current readiness state' })
  @ApiOkResponse({ description: 'Returns the user current readiness state' })
  async getEligibility(@CurrentUser('sub') userId: string) {
    const data = await this.assessmentService.getEligibility(userId);
    return {
      status: 'success',
      data,
    };
  }

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an assessment' })
  async startAssessment(@CurrentUser('sub') userId: string) {
    const data = await this.assessmentService.startAssessment(userId);
    return {
      status: 'success',
      message: SuccessMessages.ASSESSMENT.STARTED,
      data,
    };
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit an assessment simulation' })
  async submitAssessment(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitAssessmentDto,
  ) {
    const data = await this.assessmentService.submitAssessment(
      userId,
      dto.result,
    );
    return {
      status: 'success',
      message: SuccessMessages.ASSESSMENT.SUBMITTED,
      data,
    };
  }
}
