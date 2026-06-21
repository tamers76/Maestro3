/**
 * First-run admin seeding.
 *
 * On startup, if MAESTRO_ADMIN_EMAIL + MAESTRO_ADMIN_PASSWORD are set, ensure an
 * admin account exists with those credentials. If no users exist at all and the
 * env vars are absent, we log a clear warning rather than creating a default
 * password (avoids shipping a known credential).
 */
import * as userRepo from '../db/repos/userRepo.js';
import { hashPassword } from './password.js';
import type { UserRole } from '../db/schema/auth.js';

export async function seedAdminUser(): Promise<void> {
  const email = process.env.MAESTRO_ADMIN_EMAIL?.trim();
  const password = process.env.MAESTRO_ADMIN_PASSWORD;
  const name = process.env.MAESTRO_ADMIN_NAME?.trim() || 'Administrator';

  if (!email || !password) {
    const count = await userRepo.countUsers();
    if (count === 0) {
      console.warn(
        '[Auth] No users exist and MAESTRO_ADMIN_EMAIL/MAESTRO_ADMIN_PASSWORD are not set. ' +
          'Set them to seed the first admin account, then restart.'
      );
    }
    return;
  }

  const existing = await userRepo.getUserByEmail(email);
  if (existing) {
    // Keep the seeded admin usable: ensure role=admin, active, and password in sync.
    if (!existing.is_active) {
      await userRepo.setUserActive(existing.id, true);
    }
    if (existing.role !== 'admin') {
      await userRepo.setUserRole(existing.id, 'admin');
    }
    await userRepo.updatePassword(existing.id, await hashPassword(password));
    console.log(`[Auth] Admin account ensured for ${email}.`);
    return;
  }

  await userRepo.createUser({
    email,
    name,
    role: 'admin',
    passwordHash: await hashPassword(password),
  });
  console.log(`[Auth] Seeded first admin account for ${email}.`);
}

/** Default dev accounts: simple username==password credentials for local use. */
const DEV_USERS: { email: string; name: string; role: UserRole; password: string }[] = [
  { email: 'admin', name: 'Admin', role: 'admin', password: 'admin' },
  { email: 'prof', name: 'Professor', role: 'professor', password: 'prof' },
  { email: 'prof2', name: 'Professor 2', role: 'professor', password: 'prof2' },
  { email: 'prof3', name: 'Professor 3', role: 'professor', password: 'prof3' },
  { email: 'prof4', name: 'Professor 4', role: 'professor', password: 'prof4' },
  { email: 'student', name: 'Student', role: 'student', password: 'student' },
];

/**
 * Whether to seed the default dev accounts. Enabled by default unless running in
 * production; can be forced on/off via SEED_DEV_USERS=1/0. These are well-known
 * credentials and MUST NOT be used in production.
 */
function devSeedingEnabled(): boolean {
  const flag = process.env.SEED_DEV_USERS;
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Seed the default dev accounts (admin/admin, prof/prof, student/student) on a
 * fresh database. Create-if-missing per user so a re-install on a clean DB always
 * has them, while existing accounts (and any changed passwords) are left intact.
 */
export async function seedDevUsers(): Promise<void> {
  if (!devSeedingEnabled()) return;

  const created: string[] = [];
  for (const u of DEV_USERS) {
    const existing = await userRepo.getUserByEmail(u.email);
    if (existing) continue;
    await userRepo.createUser({
      email: u.email,
      name: u.name,
      role: u.role,
      passwordHash: await hashPassword(u.password),
    });
    created.push(`${u.email}/${u.password} (${u.role})`);
  }

  if (created.length > 0) {
    console.warn(
      `[Auth] Seeded DEV accounts: ${created.join(', ')}. ` +
        'These are insecure defaults — disable with SEED_DEV_USERS=0 or NODE_ENV=production.'
    );
  }
}
