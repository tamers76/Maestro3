/**
 * Audit logging helper.
 *
 * `recordAudit` writes a single high-value action to the `audit_events` table,
 * snapshotting the acting user from `req.user` plus request metadata. It is
 * intentionally fire-and-forget and NEVER throws: an audit failure must not break
 * the underlying action. Call it AFTER the action succeeds.
 *
 * IMPORTANT: never pass secrets (API keys, passwords, connection strings) in
 * `metadata`/`summary`. For settings changes, log the field NAMES that changed.
 */
import type { Request } from 'express';
import * as auditRepo from '../db/repos/auditRepo.js';

/** Coarse grouping used by the Audit page category filter. */
export type AuditCategory =
  | 'user'
  | 'access'
  | 'course'
  | 'approval'
  | 'review'
  | 'settings'
  | 'auth';

export interface AuditDetails {
  action: string;
  category: AuditCategory;
  entityType?: string;
  entityId?: string;
  courseCode?: string;
  targetUserId?: string;
  status?: 'success' | 'failure';
  summary?: string;
  metadata?: Record<string, unknown>;
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

/**
 * Record an audit event for an authenticated request. Resolves immediately and
 * swallows any persistence error (logged to the console) so callers can `void`
 * it without risk.
 */
export async function recordAudit(req: Request, details: AuditDetails): Promise<void> {
  try {
    await auditRepo.createAuditEvent({
      actorUserId: req.user?.id ?? null,
      actorEmail: req.user?.email ?? '',
      actorName: req.user?.name ?? '',
      actorRole: req.user?.role ?? '',
      action: details.action,
      category: details.category,
      entityType: details.entityType ?? '',
      entityId: details.entityId ?? '',
      courseCode: details.courseCode ?? '',
      targetUserId: details.targetUserId ?? '',
      status: details.status ?? 'success',
      summary: details.summary ?? '',
      metadata: details.metadata ?? null,
      method: req.method ?? '',
      path: req.originalUrl ?? req.path ?? '',
      ip: clientIp(req),
    });
  } catch (error) {
    console.error('[Audit] Failed to record event:', details.action, error);
  }
}
