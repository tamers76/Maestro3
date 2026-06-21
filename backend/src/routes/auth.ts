/**
 * Authentication + self-service profile routes.
 *
 * - POST /api/auth/login           -> verify credentials, return JWT + user profile
 * - GET  /api/auth/me              -> current user (with profile fields + avatar_url)
 * - PUT  /api/auth/profile         -> update name/email/title/department/bio/phone
 * - POST /api/auth/avatar          -> upload avatar image (multipart)
 * - POST /api/auth/password        -> change own password
 * - GET  /api/auth/users/:id/avatar -> stream an avatar image (supports ?access_token=)
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as userRepo from '../db/repos/userRepo.js';
import type { UserRecord } from '../db/repos/userRepo.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { signAuthToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import {
  isSupportedAvatarMime,
  saveAvatar,
  resolveAvatarFile,
  streamAvatar,
} from '../services/avatar.service.js';

const router = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB cap
  fileFilter: (_req, file, cb) => {
    if (isSupportedAvatarMime(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPEG, WEBP, or GIF images are allowed'));
  },
});

/** Shape returned to the client for the authenticated user. */
function toMePayload(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    title: user.title,
    department: user.department,
    bio: user.bio,
    phone: user.phone,
    avatar_url: user.avatar_path ? `/api/auth/users/${user.id}/avatar` : null,
  };
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await userRepo.getUserByEmail(email);
    // Uniform error to avoid leaking which accounts exist.
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signAuthToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ token, user: toMePayload(user) });
  } catch (error) {
    console.error('[Auth] login failed:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await userRepo.getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: toMePayload(user) });
  } catch (error) {
    console.error('[Auth] me failed:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.put('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

    const email = str(body.email);
    if (email !== undefined) {
      if (!email) {
        return res.status(400).json({ error: 'Email cannot be empty' });
      }
      const existing = await userRepo.getUserByEmail(email);
      if (existing && existing.id !== req.user!.id) {
        return res.status(409).json({ error: 'That email is already in use' });
      }
    }

    const name = str(body.name);
    if (name !== undefined && !name) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    const updated = await userRepo.updateProfile(req.user!.id, {
      name,
      email,
      title: str(body.title),
      department: str(body.department),
      bio: typeof body.bio === 'string' ? body.bio : undefined,
      phone: str(body.phone),
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json({ user: toMePayload(updated) });
  } catch (error) {
    console.error('[Auth] update profile failed:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/avatar', requireAuth, (req: Request, res: Response) => {
  avatarUpload.single('avatar')(req, res, async (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No image uploaded' });
      const relPath = saveAvatar(req.user!.id, file.buffer, file.mimetype);
      await userRepo.setAvatarPath(req.user!.id, relPath);
      const user = await userRepo.getUserById(req.user!.id);
      res.json({ user: user ? toMePayload(user) : null });
    } catch (error) {
      console.error('[Auth] avatar upload failed:', error);
      res.status(500).json({ error: 'Failed to save avatar' });
    }
  });
});

router.post('/password', requireAuth, async (req: Request, res: Response) => {
  try {
    const currentPassword =
      typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = await userRepo.getUserByEmail(req.user!.email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return res.status(403).json({ error: 'Current password is incorrect' });
    const hash = await hashPassword(newPassword);
    await userRepo.updatePassword(req.user!.id, hash);
    res.json({ ok: true });
  } catch (error) {
    console.error('[Auth] change password failed:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.get('/users/:id/avatar', requireAuth, async (req: Request, res: Response) => {
  try {
    const target = await userRepo.getUserById(req.params.id);
    if (!target || !target.avatar_path) {
      return res.status(404).json({ error: 'Avatar not found' });
    }
    const full = resolveAvatarFile(target.avatar_path);
    if (!full) return res.status(404).json({ error: 'Avatar not found' });
    const { stream, size, contentType } = streamAvatar(full);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[Auth] avatar stream failed:', error);
    res.status(500).json({ error: 'Failed to load avatar' });
  }
});

export default router;
