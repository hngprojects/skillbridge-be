import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { TasksService } from './tasks.service';
import { SubmitTaskDto } from './dto/submit-task.dto';

const ALLOWED_FILE_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

@ApiTags('tasks')
@ApiCookieAuth()
@Controller('tasks')
@Roles(UserRole.TALENT)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a task with file upload or external link' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Task file (zip, pdf, or image)',
        },
        externalLink: {
          type: 'string',
          description: 'External link to task (GitHub, Figma, etc.)',
        },
        track: {
          type: 'string',
          description: 'Role track (optional)',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Task submitted successfully' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Invalid file type. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`,
            ),
            false,
          );
        }
      },
    }),
  )
  async submitTask(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitTaskDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const submission = await this.tasksService.submitTask(userId, dto, file);

    return {
      message: 'Task submitted successfully',
      id: submission.id,
      status: submission.status,
      submittedAt: submission.submitted_at,
      externalLink: submission.external_link,
      fileUrl: submission.file_url,
    };
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get latest submission status and total count' })
  @ApiOkResponse({ description: 'Returns submission status' })
  async getStatus(@CurrentUser('sub') userId: string) {
    return this.tasksService.getSubmissionStatus(userId);
  }

  @Get('my-submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all task submissions for the current user' })
  @ApiOkResponse({ description: 'Returns array of submissions' })
  async getMySubmissions(@CurrentUser('sub') userId: string) {
    const submissions = await this.tasksService.getMySubmissions(userId);

    return {
      submissions: submissions.map((s) => ({
        id: s.id,
        externalLink: s.external_link,
        fileUrl: s.file_url,
        submittedAt: s.submitted_at,
        status: s.status,
        score: s.score,
        feedback: s.feedback,
      })),
      total: submissions.length,
    };
  }
}
