import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TaskSubmission,
  TaskSubmissionStatus,
} from './entities/task-submission.entity';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import { Assessment } from '../assessment/entities/assessment.entity';
import { SubmitTaskDto } from './dto/submit-task.dto';
import {
  TaskStatusResponseDto,
  TaskSubmissionResponseDto,
} from './dto/task-response.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(TaskSubmission)
    private readonly taskSubmissionRepository: Repository<TaskSubmission>,
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepository: Repository<TalentProfile>,
    @InjectRepository(Assessment)
    private readonly assessmentRepository: Repository<Assessment>,
    private readonly uploadService: UploadService,
  ) {}

  async submitTask(
    userId: string,
    dto: SubmitTaskDto,
    file?: Express.Multer.File,
  ): Promise<TaskSubmission> {
    // Validate that either file or externalLink is provided
    if (!file && !dto.externalLink) {
      throw new BadRequestException(
        'Either file upload or external link is required',
      );
    }

    // Load talent profile
    const talentProfile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!talentProfile) {
      throw new NotFoundException('Talent profile not found');
    }

    // Validate assessment prerequisite (rite of passage check)
    const assessmentCount = await this.assessmentRepository.count({
      where: { talent_profile_id: talentProfile.id },
    });

    if (assessmentCount === 0) {
      throw new BadRequestException(
        'You must attempt an assessment before submitting tasks',
      );
    }

    // Upload file if provided
    let fileUrl: string | null = null;
    if (file) {
      try {
        fileUrl = await this.uploadService.uploadAvatar(file);
      } catch (error) {
        this.logger.error('File upload failed', error);
        throw new BadRequestException('File upload failed');
      }
    }

    // Create task submission
    const taskSubmission = this.taskSubmissionRepository.create({
      talent_profile_id: talentProfile.id,
      external_link: dto.externalLink || null,
      file_url: fileUrl,
      status: TaskSubmissionStatus.PENDING,
      assessment_id: null, // Tasks not linked to specific assessments
    });

    const savedSubmission =
      await this.taskSubmissionRepository.save(taskSubmission);

    this.logger.log(
      `Task submitted by talent ${talentProfile.id}: ${savedSubmission.id}`,
    );

    return savedSubmission;
  }

  async getMySubmissions(userId: string): Promise<TaskSubmission[]> {
    const talentProfile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!talentProfile) {
      return [];
    }

    return this.taskSubmissionRepository.find({
      where: { talent_profile_id: talentProfile.id },
      order: { submitted_at: 'DESC' },
    });
  }

  async getSubmissionStatus(userId: string): Promise<TaskStatusResponseDto> {
    const talentProfile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!talentProfile) {
      return {
        latestSubmission: null,
        totalSubmissions: 0,
      };
    }

    const [latestSubmission, totalCount] = await Promise.all([
      this.taskSubmissionRepository.findOne({
        where: { talent_profile_id: talentProfile.id },
        order: { submitted_at: 'DESC' },
      }),
      this.taskSubmissionRepository.count({
        where: { talent_profile_id: talentProfile.id },
      }),
    ]);

    let latestSubmissionDto: TaskSubmissionResponseDto | null = null;
    if (latestSubmission) {
      latestSubmissionDto = {
        id: latestSubmission.id,
        externalLink: latestSubmission.external_link,
        fileUrl: latestSubmission.file_url,
        submittedAt: latestSubmission.submitted_at,
        status: latestSubmission.status,
        score: latestSubmission.score,
        feedback: latestSubmission.feedback,
      };
    }

    return {
      latestSubmission: latestSubmissionDto,
      totalSubmissions: totalCount,
    };
  }

  async updateSubmissionStatus(
    submissionId: string,
    adminUserId: string,
    dto: UpdateTaskStatusDto,
  ): Promise<TaskSubmission> {
    const submission = await this.taskSubmissionRepository.findOne({
      where: { id: submissionId },
      relations: ['talentProfile'],
    });

    if (!submission) {
      throw new NotFoundException('Task submission not found');
    }

    if (
      submission.status !== TaskSubmissionStatus.PENDING &&
      submission.status !== TaskSubmissionStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        'Cannot update already reviewed submission',
      );
    }

    // Update submission fields
    submission.status = dto.status;
    submission.score = dto.score || null;
    submission.feedback = dto.feedback || null;
    submission.reviewed_by = adminUserId;
    submission.reviewed_at = new Date();

    const updatedSubmission =
      await this.taskSubmissionRepository.save(submission);

    this.logger.log(
      `Task ${submissionId} scored by admin ${adminUserId}: ${dto.status}`,
    );

    // TODO: Send notification to talent when notification service is implemented

    return updatedSubmission;
  }
}
