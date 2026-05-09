import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixUserOauthAccountConstraints1778312000000
  implements MigrationInterface
{
  name = 'FixUserOauthAccountConstraints1778312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" DROP CONSTRAINT IF EXISTS "UQ_e378ee51a78adea4509c0e906d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" DROP CONSTRAINT IF EXISTS "UQ_7eb25183e951b6ca44f292df21a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" DROP CONSTRAINT IF EXISTS "REL_a093a39110ecd3602d87f0e814"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_oauth_provider" ON "user_oauth_accounts" ("user_id", "provider")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oauth_provider_external_id" ON "user_oauth_accounts" ("provider", "provider_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_oauth_provider_external_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_oauth_provider"`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "REL_a093a39110ecd3602d87f0e814" UNIQUE ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "UQ_7eb25183e951b6ca44f292df21a" UNIQUE ("provider_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "UQ_e378ee51a78adea4509c0e906d8" UNIQUE ("provider")`,
    );
  }
}
