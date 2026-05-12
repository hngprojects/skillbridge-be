import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateAssessmentsAndTaskSubmissions1779200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create assessment_status enum
    await queryRunner.query(`
      CREATE TYPE assessment_status AS ENUM ('in_progress', 'completed', 'flagged')
    `);

    // Create submission_status enum
    await queryRunner.query(`
      CREATE TYPE submission_status AS ENUM ('pending', 'under_review', 'approved', 'rejected')
    `);

    // Create assessments table
    await queryRunner.createTable(
      new Table({
        name: 'assessments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'talent_profile_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'attempt_number',
            type: 'int',
            isNullable: false,
            default: 1,
          },
          {
            name: 'status',
            type: 'assessment_status',
            isNullable: false,
            default: "'in_progress'",
          },
          {
            name: 'tab_switch_flagged',
            type: 'boolean',
            default: false,
          },
          {
            name: 'started_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
          {
            name: 'completed_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Add foreign key for assessments.talent_profile_id
    await queryRunner.createForeignKey(
      'assessments',
      new TableForeignKey({
        columnNames: ['talent_profile_id'],
        referencedTableName: 'talent_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create index on assessments.talent_profile_id
    await queryRunner.createIndex(
      'assessments',
      new TableIndex({
        name: 'IDX_assessments_talent_profile_id',
        columnNames: ['talent_profile_id'],
      }),
    );

    // Create task_submissions table
    await queryRunner.createTable(
      new Table({
        name: 'task_submissions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'talent_profile_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'assessment_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'file_url',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'external_link',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'submitted_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
          {
            name: 'status',
            type: 'submission_status',
            isNullable: false,
            default: "'pending'",
          },
          {
            name: 'score',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'feedback',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'reviewed_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'reviewed_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Add foreign key for task_submissions.talent_profile_id
    await queryRunner.createForeignKey(
      'task_submissions',
      new TableForeignKey({
        columnNames: ['talent_profile_id'],
        referencedTableName: 'talent_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Add foreign key for task_submissions.assessment_id
    await queryRunner.createForeignKey(
      'task_submissions',
      new TableForeignKey({
        columnNames: ['assessment_id'],
        referencedTableName: 'assessments',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Add foreign key for task_submissions.reviewed_by
    await queryRunner.createForeignKey(
      'task_submissions',
      new TableForeignKey({
        columnNames: ['reviewed_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Create indexes for task_submissions
    await queryRunner.createIndex(
      'task_submissions',
      new TableIndex({
        name: 'IDX_task_submissions_talent_profile_id',
        columnNames: ['talent_profile_id'],
      }),
    );

    await queryRunner.createIndex(
      'task_submissions',
      new TableIndex({
        name: 'IDX_task_submissions_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'task_submissions',
      new TableIndex({
        name: 'IDX_task_submissions_submitted_at',
        columnNames: ['submitted_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      'task_submissions',
      'IDX_task_submissions_submitted_at',
    );
    await queryRunner.dropIndex(
      'task_submissions',
      'IDX_task_submissions_status',
    );
    await queryRunner.dropIndex(
      'task_submissions',
      'IDX_task_submissions_talent_profile_id',
    );
    await queryRunner.dropIndex(
      'assessments',
      'IDX_assessments_talent_profile_id',
    );

    // Drop tables
    await queryRunner.dropTable('task_submissions');
    await queryRunner.dropTable('assessments');

    // Drop enums
    await queryRunner.query('DROP TYPE submission_status');
    await queryRunner.query('DROP TYPE assessment_status');
  }
}
