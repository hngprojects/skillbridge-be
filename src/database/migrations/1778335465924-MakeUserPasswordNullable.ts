import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeUserPasswordNullable1778335465924 implements MigrationInterface {
  name = 'MakeUserPasswordNullable1778335465924';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_oauth_provider_external_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_user_oauth_provider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_waitlist_entries_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contact_messages_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_verification_otps_user_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "UQ_e378ee51a78adea4509c0e906d8" UNIQUE ("provider")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "UQ_7eb25183e951b6ca44f292df21a" UNIQUE ("provider_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_oauth_provider_external_id" ON "user_oauth_accounts" ("provider", "provider_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_oauth_provider" ON "user_oauth_accounts" ("user_id", "provider") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_user_oauth_provider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_oauth_provider_external_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" DROP CONSTRAINT "UQ_7eb25183e951b6ca44f292df21a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_oauth_accounts" DROP CONSTRAINT "UQ_e378ee51a78adea4509c0e906d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_otps_user_created_at" ON "verification_otps" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_created_at" ON "contact_messages" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_waitlist_entries_created_at" ON "waitlist_entries" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_oauth_provider" ON "user_oauth_accounts" ("user_id", "provider") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_oauth_provider_external_id" ON "user_oauth_accounts" ("provider", "provider_id") `,
    );
  }
}
