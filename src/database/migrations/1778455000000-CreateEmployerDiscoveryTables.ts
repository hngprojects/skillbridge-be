import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class CreateEmployerDiscoveryTables1778455000000
  implements MigrationInterface
{
  name = 'CreateEmployerDiscoveryTables1778455000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE contact_status AS ENUM (
          'pending',
          'accepted',
          'declined'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'shortlists',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'employer_profile_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'candidate_profile_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'saved_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'shortlists',
      new TableForeignKey({
        columnNames: ['employer_profile_id'],
        referencedTableName: 'employer_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_shortlists_employer_profile_id',
      }),
    );

    await queryRunner.createForeignKey(
      'shortlists',
      new TableForeignKey({
        columnNames: ['candidate_profile_id'],
        referencedTableName: 'candidate_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_shortlists_candidate_profile_id',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'shortlists',
      new TableUnique({
        name: 'UQ_shortlists_employer_candidate',
        columnNames: ['employer_profile_id', 'candidate_profile_id'],
      }),
    );

    await queryRunner.createIndex(
      'shortlists',
      new TableIndex({
        name: 'IDX_shortlists_employer_profile_id',
        columnNames: ['employer_profile_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'employer_contacts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'employer_profile_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'candidate_profile_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'accepted', 'declined'],
            enumName: 'contact_status',
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'initiated_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'employer_contacts',
      new TableForeignKey({
        columnNames: ['employer_profile_id'],
        referencedTableName: 'employer_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_employer_contacts_employer_profile_id',
      }),
    );

    await queryRunner.createForeignKey(
      'employer_contacts',
      new TableForeignKey({
        columnNames: ['candidate_profile_id'],
        referencedTableName: 'candidate_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        name: 'FK_employer_contacts_candidate_profile_id',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'employer_contacts',
      new TableUnique({
        name: 'UQ_employer_contacts_employer_candidate',
        columnNames: ['employer_profile_id', 'candidate_profile_id'],
      }),
    );

    await queryRunner.createIndex(
      'employer_contacts',
      new TableIndex({
        name: 'IDX_employer_contacts_employer_profile_id',
        columnNames: ['employer_profile_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('employer_contacts', true, true, true);
    await queryRunner.dropTable('shortlists', true, true, true);
    await queryRunner.query('DROP TYPE IF EXISTS contact_status');
  }
}
