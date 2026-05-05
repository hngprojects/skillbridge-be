import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { User, UserRole } from '../../modules/users/entities/user.entity';
import { Seeder } from './seeder.interface';

const splitName = (fullName: string) => {
  const [firstName, ...lastNameParts] = fullName.trim().split(/\s+/);
  return {
    first_name: firstName || 'Admin',
    last_name: lastNameParts.join(' ') || 'User',
  };
};

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

    const adminName = splitName(env.SEED_ADMIN_FULL_NAME);
    const admin = repository.create({
      email: adminEmail,
      password: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10),
      first_name: adminName.first_name,
      last_name: adminName.last_name,
      avatar_url: null,
      role: UserRole.ADMIN,
    });
    await repository.save(admin);
    console.log(`[UserSeeder] created admin user ${adminEmail}`);
  },
};
