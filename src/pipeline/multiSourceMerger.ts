import type { ParsedExamDraft } from './markdownParser.ts';

export interface MergeResult {
  mergedDraft: ParsedExamDraft;
  sourceFormats: ('md' | 'pdf' | 'docx')[];
  sourceFiles: string[];
  conflictingObjectiveQuestions: number[];
  sourceDiscrepancies: {
    locator: string;
    mdText?: string;
    pdfText?: string;
    docxText?: string;
    resolution: string;
  }[];
}

/**
 * Merges multiple sources (MD, PDF, DOCX) for the same exam year:
 * Priority:
 * 1. MD provides text and base structure
 * 2. PDF provides visual layout, bounding boxes, and chart/underline verification
 * 3. DOCX supplements editable text, formatting, and embedded images
 *
 * CRITICAL INVARIANT:
 * - Saves sourceDiscrepancies when text differs across formats.
 * - If objective answers (1-45) conflict between any two sources, records the conflict
 *   in conflictingObjectiveQuestions so the entire version fails validation with OBJECTIVE_ANSWER_CONFLICT!
 */
export function mergeMultiSourceExamDrafts(drafts: ParsedExamDraft[]): MergeResult {
  if (drafts.length === 0) {
    throw new Error('mergeMultiSourceExamDrafts: 至少需要一个解析源');
  }

  // Sort by item completeness first (full exam paper before answer-only supplement), then format priority: md > docx > pdf
  const priorityOrder: Record<'md' | 'docx' | 'pdf', number> = {
    md: 1,
    docx: 2,
    pdf: 3,
  };
  const scoreDraftCompleteness = (d: ParsedExamDraft) =>
    d.sections.reduce(
      (sum, s) =>
        sum +
        s.units.reduce(
          (uSum, u) =>
            uSum +
            u.materials.reduce((mSum, m) => mSum + (m.text ? m.text.length : 0), 0) +
            u.items.reduce(
              (iSum, item) =>
                iSum +
                (item.options
                  ? item.options.reduce((oSum, o) => oSum + (o.text ? o.text.length : 0), 0)
                  : 0),
              0
            ),
          0
        ),
      0
    );
  const sorted = [...drafts].sort((a, b) => {
    const completenessDiff = scoreDraftCompleteness(b) - scoreDraftCompleteness(a);
    if (completenessDiff !== 0) return completenessDiff;
    return priorityOrder[a.sourceFormat] - priorityOrder[b.sourceFormat];
  });

  const primary = structuredClone(sorted[0]);
  const sourceFormats = Array.from(new Set(sorted.map((d) => d.sourceFormat)));
  const sourceFiles = Array.from(new Set(sorted.map((d) => d.sourceFile)));
  const conflictingObjectiveQuestions: number[] = [];
  const sourceDiscrepancies: MergeResult['sourceDiscrepancies'] = [];

  // Merge objective answers across all sources & detect conflicts
  const mergedAnswers: Record<number, { answer: string; sourceFile: string }> = {
    ...primary.extractedObjectiveAnswers,
  };

  for (let i = 1; i < sorted.length; i++) {
    const secondary = sorted[i];

    for (const [qStr, secAns] of Object.entries(secondary.extractedObjectiveAnswers)) {
      const qNum = Number(qStr);
      const existingAns = mergedAnswers[qNum];
      if (!existingAns) {
        mergedAnswers[qNum] = secAns;
      } else if (existingAns.answer.toUpperCase() !== secAns.answer.toUpperCase()) {
        if (!conflictingObjectiveQuestions.includes(qNum)) {
          conflictingObjectiveQuestions.push(qNum);
        }
        sourceDiscrepancies.push({
          locator: `Question ${qNum} Objective Answer`,
          mdText:
            primary.sourceFormat === 'md'
              ? existingAns.answer
              : secondary.sourceFormat === 'md'
              ? secAns.answer
              : undefined,
          pdfText:
            secondary.sourceFormat === 'pdf'
              ? secAns.answer
              : primary.sourceFormat === 'pdf'
              ? existingAns.answer
              : undefined,
          docxText:
            secondary.sourceFormat === 'docx'
              ? secAns.answer
              : primary.sourceFormat === 'docx'
              ? existingAns.answer
              : undefined,
          resolution: `CONFLICT: ${existingAns.sourceFile}=${existingAns.answer} vs ${secAns.sourceFile}=${secAns.answer} (拒绝自动选择，整套版本构建失败)`,
        });
      }
    }

    // Supplement PDF bounding boxes and compare text discrepancies
    for (let sIdx = 0; sIdx < primary.sections.length; sIdx++) {
      const pSec = primary.sections[sIdx];
      const sSec = secondary.sections[sIdx];
      if (!sSec) continue;

      for (let uIdx = 0; uIdx < pSec.units.length; uIdx++) {
        const pUnit = pSec.units[uIdx];
        const sUnit = sSec.units[uIdx];
        if (!sUnit) continue;

        for (let mIdx = 0; mIdx < pUnit.materials.length; mIdx++) {
          const pMat = pUnit.materials[mIdx];
          const sMat = sUnit.materials[mIdx];
          if (!sMat) continue;

          if (secondary.sourceFormat === 'pdf') {
            pMat.sourcePage = sMat.sourcePage ?? pMat.sourcePage;
            pMat.sourceBoundingBox = sMat.sourceBoundingBox ?? pMat.sourceBoundingBox;
          }

          if (
            sMat.text &&
            pMat.text &&
            sMat.text.replace(/\s+/g, ' ').trim() !== pMat.text.replace(/\s+/g, ' ').trim()
          ) {
            sourceDiscrepancies.push({
              locator: `${pUnit.id}/${pMat.id}`,
              mdText: primary.sourceFormat === 'md' ? pMat.text.slice(0, 120) : undefined,
              pdfText: secondary.sourceFormat === 'pdf' ? sMat.text.slice(0, 120) : undefined,
              docxText: secondary.sourceFormat === 'docx' ? sMat.text.slice(0, 120) : undefined,
              resolution: `保留 ${primary.sourceFormat.toUpperCase()} 主文本结构，记录 ${secondary.sourceFormat.toUpperCase()} 差异证据`,
            });
          }
        }
      }
    }
  }

  // Apply merged non-conflicting objective answers to items
  for (const sec of primary.sections) {
    for (const unit of sec.units) {
      for (const item of unit.items) {
        if (item.questionNumber >= 1 && item.questionNumber <= 45) {
          if (conflictingObjectiveQuestions.includes(item.questionNumber)) {
            item.correctAnswer = null;
            item.answerSource = 'unavailable';
          } else if (mergedAnswers[item.questionNumber]) {
            item.correctAnswer = mergedAnswers[item.questionNumber].answer;
            item.answerSource = 'source-provided';
          }
        }
      }
      // Also update Part B finalOrder if answers 41-45 are now available
      if (unit.unitType === 'passage-assembly' && unit.materials[0]?.passageAssemblySpec) {
        const spec = unit.materials[0].passageAssemblySpec;
        spec.finalOrder = spec.sequenceSlots.map((slot) => {
          if (slot.type === 'fixed') return slot.fixedParagraphId || 'E';
          const q = slot.questionNumber;
          return q && mergedAnswers[q] && !conflictingObjectiveQuestions.includes(q)
            ? mergedAnswers[q].answer
            : null;
        });
        const used = new Set(spec.finalOrder.filter(Boolean) as string[]);
        if (used.size === 6) {
          spec.redundantOptions = spec.candidateParagraphs
            .map((c) => c.label)
            .filter((l) => !used.has(l));
        }
      }
    }
  }

  primary.extractedObjectiveAnswers = mergedAnswers;

  return {
    mergedDraft: primary,
    sourceFormats,
    sourceFiles,
    conflictingObjectiveQuestions,
    sourceDiscrepancies,
  };
}
