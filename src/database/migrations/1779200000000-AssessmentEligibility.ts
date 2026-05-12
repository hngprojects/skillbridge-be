import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssessmentEligibility1779200000000 implements MigrationInterface {
  name = 'AssessmentEligibility1779200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."assessment_eligibility_status_enum" AS ENUM('UNINITIALIZED', 'ELIGIBLE', 'IN_PROGRESS', 'LOCKED_OUT', 'PASSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "assessment_eligibility" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "talent_id" uuid NOT NULL, "status" "public"."assessment_eligibility_status_enum" NOT NULL DEFAULT 'UNINITIALIZED', "attempts_count" integer NOT NULL DEFAULT '0', "last_attempt_at" TIMESTAMP WITH TIME ZONE, "retake_eligible_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_aab0b5d042969291c1fb6088e8" UNIQUE ("talent_id"), CONSTRAINT "PK_601adee8e825e77c2d9816ba02b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_aab0b5d042969291c1fb6088e8" ON "assessment_eligibility" ("talent_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_eligibility" ADD CONSTRAINT "FK_aab0b5d042969291c1fb6088e8c" FOREIGN KEY ("talent_id") REFERENCES "talent_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assessment_eligibility" DROP CONSTRAINT "FK_aab0b5d042969291c1fb6088e8c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aab0b5d042969291c1fb6088e8"`,
    );
    await queryRunner.query(`DROP TABLE "assessment_eligibility"`);
    await queryRunner.query(
      `DROP TYPE "public"."assessment_eligibility_status_enum"`,
    );
  }
}
