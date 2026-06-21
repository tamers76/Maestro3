/**
 * Admin-only user management + course access assignments.
 *
 * Mounted at /api/users. Every route requires an authenticated admin. Covers user
 * CRUD-lite (create/list/activate/reset password) and the course access grants:
 * course owner, professor review assignments, and student assignments.
 */
import { Router, Request, Response } from 'express';
import * as userRepo from '../db/repos/userRepo.js';
import * as courseStore from '../services/curriculumStore.service.js';
import { hashPassword } from '../auth/password.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { isRole, type UserRole } from '../auth/permissions.js';

const router = Router();

// All user-management routes are admin-only.
router.use(requireAuth, requireRole('admin'));

// GET /api/users — list all users
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json({ users: await userRepo.listUsers() });
  } catch (error) {
    console.error('[Users] list failed:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users — create a user
router.post('/', async (req: Request, res: Response) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!isRole(role)) {
      return res.status(400).json({ error: 'role must be one of admin, professor, student' });
    }

    const existing = await userRepo.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const user = await userRepo.createUser({
      email,
      name,
      role: role as UserRole,
      passwordHash: await hashPassword(password),
    });
    res.status(201).json({ user });
  } catch (error) {
    console.error('[Users] create failed:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /api/users/:id/active — activate/deactivate
router.patch('/:id/active', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const isActive = Boolean(req.body?.is_active);
    if (req.user && req.user.id === id && !isActive) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    const user = await userRepo.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await userRepo.setUserActive(id, isActive);
    res.json({ user: { ...user, is_active: isActive } });
  } catch (error) {
    console.error('[Users] set active failed:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /api/users/:id/password — reset a user's password
router.post('/:id/password', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const user = await userRepo.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await userRepo.updatePassword(id, await hashPassword(password));
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] reset password failed:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ===== Course access assignments =====

// GET /api/users/courses/:code/access — owner + reviewers + students for a course
router.get('/courses/:code/access', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    if (!(await courseStore.courseExists(code))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const [ownerId, reviewerIds, studentIds] = await Promise.all([
      userRepo.getCourseOwner(code),
      userRepo.listReviewerIdsForCourse(code),
      userRepo.listStudentIdsForCourse(code),
    ]);
    res.json({ owner_user_id: ownerId, reviewer_ids: reviewerIds, student_ids: studentIds });
  } catch (error) {
    console.error('[Users] course access read failed:', error);
    res.status(500).json({ error: 'Failed to read course access' });
  }
});

// PUT /api/users/courses/:code/owner — set/clear course owner
router.put('/courses/:code/owner', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const ownerUserId = req.body?.owner_user_id;
    if (ownerUserId !== null && typeof ownerUserId !== 'string') {
      return res.status(400).json({ error: 'owner_user_id must be a user id or null' });
    }
    if (!(await courseStore.courseExists(code))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (ownerUserId) {
      const owner = await userRepo.getUserById(ownerUserId);
      if (!owner) return res.status(404).json({ error: 'Owner user not found' });
      if (owner.role === 'student') {
        return res.status(400).json({ error: 'A student cannot own a course' });
      }
    }
    await userRepo.setCourseOwner(code, ownerUserId ?? null);
    res.json({ success: true, owner_user_id: ownerUserId ?? null });
  } catch (error) {
    console.error('[Users] set owner failed:', error);
    res.status(500).json({ error: 'Failed to set course owner' });
  }
});

// POST /api/users/courses/:code/reviewers — assign a professor reviewer
router.post('/courses/:code/reviewers', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const professorId = typeof req.body?.professor_id === 'string' ? req.body.professor_id : '';
    if (!professorId) return res.status(400).json({ error: 'professor_id is required' });
    if (!(await courseStore.courseExists(code))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const prof = await userRepo.getUserById(professorId);
    if (!prof) return res.status(404).json({ error: 'Professor not found' });
    if (prof.role !== 'professor' && prof.role !== 'admin') {
      return res.status(400).json({ error: 'Only professors can be assigned as reviewers' });
    }
    await userRepo.assignReviewer(code, professorId, req.user?.id ?? '');
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Users] assign reviewer failed:', error);
    res.status(500).json({ error: 'Failed to assign reviewer' });
  }
});

// DELETE /api/users/courses/:code/reviewers/:professorId
router.delete('/courses/:code/reviewers/:professorId', async (req: Request, res: Response) => {
  try {
    const { code, professorId } = req.params;
    await userRepo.removeReviewer(code, professorId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] remove reviewer failed:', error);
    res.status(500).json({ error: 'Failed to remove reviewer' });
  }
});

// POST /api/users/courses/:code/students — assign a student to a course
router.post('/courses/:code/students', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const studentId = typeof req.body?.student_id === 'string' ? req.body.student_id : '';
    if (!studentId) return res.status(400).json({ error: 'student_id is required' });
    if (!(await courseStore.courseExists(code))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const student = await userRepo.getUserById(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (student.role !== 'student') {
      return res.status(400).json({ error: 'Only students can be assigned for consumption' });
    }
    await userRepo.assignStudent(code, studentId, req.user?.id ?? '');
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Users] assign student failed:', error);
    res.status(500).json({ error: 'Failed to assign student' });
  }
});

// DELETE /api/users/courses/:code/students/:studentId
router.delete('/courses/:code/students/:studentId', async (req: Request, res: Response) => {
  try {
    const { code, studentId } = req.params;
    await userRepo.removeStudent(code, studentId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] remove student failed:', error);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

export default router;
