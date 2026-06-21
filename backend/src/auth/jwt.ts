/**
 * JWT sign/verify for stateless auth.
 *
 * Tokens are signed with JWT_SECRET (from env). In the absence of an explicit
 * secret a development fallback is used and a loud warning is logged, so local dev
 * works out of the box while production is encouraged to set a real secret.
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { UserRole } from '../db/schema/auth.js';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
}

const DEV_FALLBACK_SECRET = 'maestro-dev-insecure-secret-change-me';

let warned = false;

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim()) return secret;
  if (!warned) {
    console.warn(
      '[Auth] JWT_SECRET is not set — using an insecure development fallback. Set JWT_SECRET in production.'
    );
    warned = true;
  }
  return DEV_FALLBACK_SECRET;
}

function getExpiry(): string {
  return process.env.JWT_EXPIRES_IN || '7d';
}

export function signAuthToken(payload: AuthTokenPayload): string {
  const options: SignOptions = { expiresIn: getExpiry() as SignOptions['expiresIn'] };
  return jwt.sign(payload, getSecret(), options);
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    if (typeof decoded === 'string') return null;
    const { sub, email, role, name } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof role !== 'string') return null;
    return {
      sub,
      email: typeof email === 'string' ? email : '',
      role: role as UserRole,
      name: typeof name === 'string' ? name : '',
    };
  } catch {
    return null;
  }
}
