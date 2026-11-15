/**
 * Pure domain helpers for deduplicated attempt analytics, paper-grouped
 * review organization, and post-submission editable note/annotation guards.
 */

import type {
  ExamAttempt,
  ObjectiveItemResponse,
  ReviewItem,
} from './learning.ts';
import type { SubjectId } from './subjects.ts';
import { resolveCanonicalPaperId, resolveSubjectId } from './subjects.ts';

function attemptTimestampMs(attempt: ExamAttempt): number {
  const raw = attempt.submittedAt || attempt.updatedAt || attempt.startedAt;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareAttemptsNewestFirst(a: ExamAttempt, b: ExamAttempt): number {
  const delta = attemptTimestampMs(b) - attemptTimestampMs(a);
  if (delta !== 0) return delta;
  return (b.clientRevision || 0) - (a.clientRevision || 0);
}

/**
 * Deduplicates submitted attempts by canonical paperId, retaining only the
 * most recently submitted attempt per exam paper.
 */
export function dedupeSubmittedAttemptsByPaper(
  submittedAttempts: ExamAttempt[]
): ExamAttempt[] {
  const latestByPaper = new Map<string, ExamAttempt>();
  for (const att of submittedAttempts) {
    if (att.status !== 'submitted' && !att.submittedAt) continue;
    const key = resolveCanonicalPaperId(att.year, att.paperId);
    const existing = latestByPaper.get(key);
    if (!existing || compareAttemptsNewestFirst(att, existing) < 0) {
      latestByPaper.set(key, att);
    }
  }
  return Array.from(latestByPaper.values()).sort(compareAttemptsNewestFirst);
}

export function findLatestSubmittedAttemptForYear(
  attempts: ExamAttempt[],
  year: number,
  dataVersion?: string
): ExamAttempt | undefined {
  const candidates = attempts.filter(
    (a) =>
      a.year === year &&
      a.status === 'submitted' &&
      (!dataVersion || a.dataVersion === dataVersion)
  );
  if (candidates.length === 0) return undefined;
  return [...candidates].sort(compareAttemptsNewestFirst)[0];
}

export function countUniquePapers(attempts: ExamAttempt[]): number {
  const set = new Set<string>();
  for (const att of attempts) {
    set.add(resolveCanonicalPaperId(att.year, att.paperId));
  }
  return set.size;
}

/**
 * Sanitizes updates to an ObjectiveItemResponse so that after submission
 * answers and confidence remain locked while review metadata (`userNotes`,
 * `flaggedForReview`, `knownErrorCauses`) can still be updated freely.
 */
export function sanitizeObjectiveResponsePatch(
  status: ExamAttempt['status'],
  patch: Partial<ObjectiveItemResponse>
): Partial<ObjectiveItemResponse> {
  if (status !== 'submitted') {
    return patch;
  }
  const safePatch: Partial<ObjectiveItemResponse> = {};
  if (patch.flaggedForReview !== undefined) {
    safePatch.flaggedForReview = patch.flaggedForReview;
  }
  if (patch.knownErrorCauses !== undefined) {
    safePatch.knownErrorCauses = patch.knownErrorCauses;
  }
  if (patch.userNotes !== undefined) {
    safePatch.userNotes = patch.userNotes;
  }
  return safePatch;
}

export interface ReviewPaperGroup {
  paperKey: string;
  year: number;
  subjectId: SubjectId;
  items: ReviewItem[];
  dueCount: number;
  masteredCount: number;
}

/**
 * Groups review items by canonical exam paper for paper-first mistake review.
 */
export function groupReviewItemsByPaper(items: ReviewItem[]): ReviewPaperGroup[] {
  const map = new Map<string, ReviewPaperGroup>();
  for (const item of items) {
    const paperKey = resolveCanonicalPaperId(item.year, item.paperId);
    const subjectId = resolveSubjectId(item.year, item.subjectId);
    let group = map.get(paperKey);
    if (!group) {
      group = {
        paperKey,
        year: item.year,
        subjectId,
        items: [],
        dueCount: 0,
        masteredCount: 0,
      };
      map.set(paperKey, group);
    }
    group.items.push(item);
    if (item.mastered) {
      group.masteredCount++;
    } else {
      group.dueCount++;
    }
  }

  const groups = Array.from(map.values());
  for (const group of groups) {
    group.items.sort((a, b) => a.questionNumber - b.questionNumber);
  }
  groups.sort((a, b) => {
    if (b.dueCount !== a.dueCount) return b.dueCount - a.dueCount;
    return b.year - a.year;
  });
  return groups;
}
