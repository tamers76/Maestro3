/**
 * Express auth middleware.
 *
 * - requireAuth: validates a Bearer JWT, loads the user, attaches req.user.
 * - requireRole: gate by one or more roles.
 * - requireCourseAccess: gate by course-scoped access (owner/reviewer/assigned).
 *
 * req.user is the verified, currently-active user (DB-checked, not just the token)
 * so deactivating an account takes effect immediately.
 */
import type { Request, Response, NextFunction, RequestHandler, RequestParamHandler } from 'express';
import { verifyAuthToken } from './jwt.js';
import * as userRepo from '../db/repos/userRepo.js';
import { resolveCourseAccess, type CourseAccessLevel } from './courseAccess.js';
import type { UserRole } from '../db/schema/auth.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      courseAccess?: CourseAccessLevel;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const queryToken = req.query?.access_token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
  return null;
}

export const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = verifyAuthToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const user = await userRepo.getUserById(payload.sub);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Account is inactive or no longer exists' });
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (error) {
    console.error('[Auth] requireAuth failed:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

/**
 * Gate a course-scoped route. Resolves req.params[paramName] (default `code`) to a
 * course-access level and rejects with 403 if the user has none. Stores the level
 * on req.courseAccess for downstream handlers.
 */
export function requireCourseAccess(paramName = 'code'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      const courseCode = req.params[paramName];
      if (!courseCode) return res.status(400).json({ error: 'Course code is required' });
      const access = await resolveCourseAccess(req.user, courseCode);
      if (access === 'none') {
        return res.status(403).json({ error: 'You do not have access to this course' });
      }
      req.courseAccess = access;
      next();
    } catch (error) {
      console.error('[Auth] requireCourseAccess failed:', error);
      res.status(500).json({ error: 'Course access check failed' });
    }
  };
}

/**
 * router.param handler that enforces course-scoped access for any route declaring a
 * course code param (e.g. `:code` or `:courseCode`). Because it is keyed to the
 * route param, it only runs for course-scoped routes and never for siblings like
 * `POST /form` that have no such param. Requires requireAuth to have run first.
 */
export const courseAccessParamHandler: RequestParamHandler = async (req, res, next, value) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (typeof value !== 'string' || !value) {
      return res.status(400).json({ error: 'Course code is required' });
    }
    const access = await resolveCourseAccess(req.user, value);
    if (access === 'none') {
      return res.status(403).json({ error: 'You do not have access to this course' });
    }
    req.courseAccess = access;
    next();
  } catch (error) {
    console.error('[Auth] courseAccessParamHandler failed:', error);
    res.status(500).json({ error: 'Course access check failed' });
  }
};
