import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeUserPasswordNullable1778335465924 implements MigrationInterface {
  name = 'MakeUserPasswordNullable1778335465924';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`,
    );
  }
}
