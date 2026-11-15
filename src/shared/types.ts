/**
 * Backwards-compatible barrel re-exporting all domain contracts from src/domain/*.
 * Prefer importing directly from src/domain/subjects.ts, paper.ts, learning.ts, or ai.ts in new code.
 */

export * from '../domain/subjects.ts';
export * from '../domain/paper.ts';
export * from '../domain/ai.ts';
export * from '../domain/learning.ts';
