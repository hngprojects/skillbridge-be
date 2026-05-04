import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { User, UserRole } from '../../modules/users/entities/user.entity';
import { Seeder } from './seeder.interface';

export const userSeeder: Seeder = {
  name: 'UserSeeder',
  async run(dataSource: DataSource) {
    const repository = dataSource.getRepository(User);

    const adminEmail = env.SEED_ADMIN_EMAIL;
    const existing = await repository.findOne({ where: { email: adminEmail } });
    if (existing) {
      console.log(`[UserSeeder] ${adminEmail} already exists - skipping`);
      return;
    }

    const admin = repository.create({
      email: adminEmail,
      password: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10),
      fullName: env.SEED_ADMIN_FULL_NAME,
      role: UserRole.ADMIN,
    });
    await repository.save(admin);
    console.log(`[UserSeeder] created admin user ${adminEmail}`);
  },
};
