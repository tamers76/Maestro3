/**
 * Reference Duplicate-Detection Service (Reference Anchoring V1.0)
 *
 * Detect-and-report ONLY (non-destructive). SMEs sometimes upload the same source
 * twice (e.g. MDLD602 has a duplicate pair of the same textbook). This service
 * fingerprints each document by the SET of its normalized chunk content hashes and
 * groups documents whose fingerprints are near-identical, suggesting a canonical
 * doc to keep. It NEVER deletes anything — removal stays with the existing SME
 * delete path.
 *
 * Similarity = Jaccard over the two docs' content-hash sets. A pair is also treated
 * as duplicate when their char_count is near-equal AND a sampled-hash overlap is
 * high, which catches re-uploads whose chunking drifted slightly.
 */

import { createHash } from 'node:crypto';
import type { ReferenceChunk, ReferenceDocument } from '../models/schemas.js';
import * as fileService from './file.service.js';

/** Jaccard threshold at/above which two docs are considered duplicates. */
export const DUPLICATE_JACCARD_THRESHOLD = 0.9;
/** char_count proximity (relative) for the near-equal-size duplicate heuristic. */
const CHAR_COUNT_TOLERANCE = 0.02;
/** Sampled-hash overlap threshold for the near-equal-size duplicate heuristic. */
const SAMPLED_OVERLAP_THRESHOLD = 0.85;

export interface DuplicateGroup {
  doc_ids: string[];
  suggested_canonical_doc_id: string;
  /** Max pairwise similarity observed within the group (0..1). */
  similarity: number;
  reason: string;
}

export interface DuplicateReport {
  course_code: string;
  doc_count: number;
  duplicate_group_count: number;
  groups: DuplicateGroup[];
}

/** Normalize a chunk's raw text (lowercase, collapse whitespace) before hashing. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashNormalized(text: string): string {
  return createHash('sha256').update(normalizeText(text), 'utf8').digest('hex');
}

/** Build the set of normalized content hashes for one document. */
function fingerprintDoc(chunks: ReferenceChunk[]): Set<string> {
  const set = new Set<string>();
  for (const c of chunks) set.add(hashNormalized(c.text));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Fraction of the smaller doc's hashes that also appear in the larger doc. */
function sampledOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hits = 0;
  for (const v of small) if (large.has(v)) hits += 1;
  return hits / small.size;
}

/**
 * Deterministic canonical pick within a group. Rule (documented):
 *   1. MORE chunks wins (more complete extraction is preferred), else
 *   2. EARLIER uploaded_at wins (the original upload), else
 *   3. lexicographically smaller doc_id (stable final tie-breaker).
 */
function pickCanonical(docs: ReferenceDocument[]): string {
  const sorted = [...docs].sort((x, y) => {
    if (y.chunk_count !== x.chunk_count) return y.chunk_count - x.chunk_count;
    const tx = Date.parse(x.uploaded_at) || 0;
    const ty = Date.parse(y.uploaded_at) || 0;
    if (tx !== ty) return tx - ty;
    return x.doc_id < y.doc_id ? -1 : x.doc_id > y.doc_id ? 1 : 0;
  });
  return sorted[0].doc_id;
}

/**
 * Detect duplicate reference documents for a course. Non-destructive: returns a
 * report of groups with a suggested canonical doc; does NOT modify any state.
 */
export function detectDuplicateDocuments(courseCode: string): DuplicateReport {
  const docs = fileService.getReferenceManifest(courseCode)?.documents ?? [];

  const fingerprints = new Map<string, Set<string>>();
  for (const doc of docs) {
    fingerprints.set(doc.doc_id, fingerprintDoc(fileService.getReferenceChunks(courseCode, doc.doc_id)));
  }

  // Union-find over docs, unioning any pair that meets either duplicate criterion.
  const parent = new Map<string, string>();
  docs.forEach((d) => parent.set(d.doc_id, d.doc_id));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const nextNode = parent.get(cur)!;
      parent.set(cur, root);
      cur = nextNode;
    }
    return root;
  };
  const union = (x: string, y: string) => parent.set(find(x), find(y));

  // Best similarity + reason per unioned pair (so the group can report them).
  const pairInfo: { a: string; b: string; similarity: number; reason: string }[] = [];

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const da = docs[i];
      const db = docs[j];
      const fa = fingerprints.get(da.doc_id)!;
      const fb = fingerprints.get(db.doc_id)!;

      const jac = jaccard(fa, fb);
      let isDup = jac >= DUPLICATE_JACCARD_THRESHOLD;
      let reason = '';
      if (isDup) {
        reason = `chunk content-hash Jaccard ${jac.toFixed(3)} >= ${DUPLICATE_JACCARD_THRESHOLD}`;
      } else {
        const maxChar = Math.max(da.char_count, db.char_count) || 1;
        const charDelta = Math.abs(da.char_count - db.char_count) / maxChar;
        const overlap = sampledOverlap(fa, fb);
        if (charDelta <= CHAR_COUNT_TOLERANCE && overlap >= SAMPLED_OVERLAP_THRESHOLD) {
          isDup = true;
          reason = `near-equal char_count (Δ ${(charDelta * 100).toFixed(1)}%) + sampled-hash overlap ${overlap.toFixed(
            3
          )} >= ${SAMPLED_OVERLAP_THRESHOLD}`;
        }
      }

      if (isDup) {
        union(da.doc_id, db.doc_id);
        pairInfo.push({ a: da.doc_id, b: db.doc_id, similarity: Math.max(jac, sampledOverlap(fa, fb)), reason });
      }
    }
  }

  // Collect non-trivial groups.
  const byRoot = new Map<string, ReferenceDocument[]>();
  for (const doc of docs) {
    const root = find(doc.doc_id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(doc);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const memberIds = new Set(members.map((m) => m.doc_id));
    const groupPairs = pairInfo.filter((p) => memberIds.has(p.a) && memberIds.has(p.b));
    const best = groupPairs.reduce(
      (acc, p) => (p.similarity > acc.similarity ? p : acc),
      groupPairs[0] ?? { similarity: 0, reason: 'grouped transitively' }
    );
    groups.push({
      doc_ids: members.map((m) => m.doc_id),
      suggested_canonical_doc_id: pickCanonical(members),
      similarity: Number(best.similarity.toFixed(3)),
      reason: best.reason,
    });
  }

  return {
    course_code: courseCode,
    doc_count: docs.length,
    duplicate_group_count: groups.length,
    groups,
  };
}
