import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class CreateShortlistsTable1779200000000 implements MigrationInterface {
  name = 'CreateShortlistsTable1779200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
            name: 'employer_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'candidate_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'saved_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
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
        name: 'FK_shortlists_employer_id_users',
        columnNames: ['employer_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'shortlists',
      new TableForeignKey({
        name: 'FK_shortlists_candidate_id_talent_profiles',
        columnNames: ['candidate_id'],
        referencedTableName: 'talent_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'shortlists',
      new TableIndex({
        name: 'IDX_shortlists_employer_id',
        columnNames: ['employer_id'],
      }),
    );

    await queryRunner.createIndex(
      'shortlists',
      new TableIndex({
        name: 'IDX_shortlists_candidate_id',
        columnNames: ['candidate_id'],
      }),
    );

    await queryRunner.createUniqueConstraint(
      'shortlists',
      new TableUnique({
        name: 'UQ_shortlists_employer_id_candidate_id',
        columnNames: ['employer_id', 'candidate_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropUniqueConstraint(
      'shortlists',
      'UQ_shortlists_employer_id_candidate_id',
    );
    await queryRunner.dropIndex('shortlists', 'IDX_shortlists_candidate_id');
    await queryRunner.dropIndex('shortlists', 'IDX_shortlists_employer_id');
    await queryRunner.dropForeignKey(
      'shortlists',
      'FK_shortlists_candidate_id_talent_profiles',
    );
    await queryRunner.dropForeignKey(
      'shortlists',
      'FK_shortlists_employer_id_users',
    );
    await queryRunner.dropTable('shortlists');
  }
}
