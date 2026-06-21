/**
 * Seed admin + dev user accounts (shared by migrate and db:seed).
 */
import { seedAdminUser, seedDevUsers } from '../auth/seed.js';

export async function seedUsers(): Promise<void> {
  await seedAdminUser();
  await seedDevUsers();
}
