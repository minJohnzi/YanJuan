/**
 * Pure deterministic domain logic for Mistake Summary aggregation,
 * statistics calculation, subject isolation, minimal AI payload extraction,
 * 25-item module-aware batching, cache key/hash computation, and Markdown/HTML export.
 *
 * Zero Node/Browser-specific I/O so it runs identically in React/Vite and node --test.
 */

import type {
  ConfidenceLevel,
  ExamAttempt,
  MistakeDeterministicStats,
  MistakeFilterMode,
  MistakeItemMinimalPayload,
  MistakeModuleBreakdown,
  MistakeSummaryScope,
  ObjectiveItemResponse,
  ReviewItem,
} from './learning.ts';
import type { Exam, ExamItem } from './paper.ts';
import {
  type SubjectId,
  type UnitType,
  formatExamTitle,
  resolveCanonicalPaperId,
  resolveSubjectId,
} from './subjects.ts';
import { dedupeSubmittedAttemptsByPaper } from './reviewAnalytics.ts';
import { normalizeChoiceAnswer } from './scoringEngine.ts';

export const POLITICS_KNOWLEDGE_MODULES = [
  '马原',
  '毛中特与新思想',
  '史纲',
  '思修法基',
  '当代与时政',
] as const;

export const ENGLISH_OBJECTIVE_UNIT_TYPES: UnitType[] = [
  'cloze',
  'reading',
  'passage-assembly',
];

const UNIT_TYPE_LABELS: Record<string, string> = {
  cloze: '完形填空 (Cloze)',
  reading: '阅读理解 (Reading Part A)',
  'passage-assembly': '新题型 (Part B)',
  'politics-single': '政治单选',
  'politics-multi': '政治多选',
};

export function getEnglishModuleLabel(unitType: UnitType | string): string {
  return UNIT_TYPE_LABELS[unitType] || String(unitType);
}

export function classifyMultiChoiceMiss(
  selectedAnswer: string,
  correctAnswer: string
): 'partial-miss' | 'wrong-option' | undefined {
  const userSet = new Set(normalizeChoiceAnswer(selectedAnswer, true).split('').filter(Boolean));
  const correctSet = new Set(normalizeChoiceAnswer(correctAnswer, true).split('').filter(Boolean));
  if (correctSet.size === 0) return undefined;

  let hasWrongOption = false;
  for (const ch of userSet) {
    if (!correctSet.has(ch)) {
      hasWrongOption = true;
      break;
    }
  }
  if (hasWrongOption || userSet.size === 0) {
    return 'wrong-option';
  }
  if (userSet.size < correctSet.size) {
    return 'partial-miss';
  }
  return undefined;
}

interface ExamItemMeta {
  item: ExamItem;
  unitType: UnitType;
}

function buildExamItemIndex(exam?: Exam): Map<number, ExamItemMeta> {
  const map = new Map<number, ExamItemMeta>();
  if (!exam?.sections) return map;
  for (const section of exam.sections) {
    for (const unit of section.units || []) {
      for (const item of unit.items || []) {
        map.set(item.questionNumber, { item, unitType: unit.unitType });
      }
    }
  }
  return map;
}

function inferPoliticsModuleFallback(questionNumber: number): string {
  if (questionNumber >= 1 && questionNumber <= 4) return '马原';
  if (questionNumber >= 17 && questionNumber <= 21) return '马原';
  if (questionNumber >= 5 && questionNumber <= 8) return '毛中特与新思想';
  if (questionNumber >= 22 && questionNumber <= 26) return '毛中特与新思想';
  if (questionNumber >= 9 && questionNumber <= 12) return '史纲';
  if (questionNumber >= 27 && questionNumber <= 29) return '史纲';
  if (questionNumber >= 13 && questionNumber <= 14) return '思修法基';
  if (questionNumber >= 30 && questionNumber <= 31) return '思修法基';
  return '当代与时政';
}

function inferModuleKeyAndLabel(
  subjectId: SubjectId,
  unitType: UnitType,
  questionNumber: number,
  examItem?: ExamItem
): { moduleKey: string; moduleLabel: string } {
  if (subjectId === 'politics') {
    const km = examItem?.knowledgeModule?.trim() || inferPoliticsModuleFallback(questionNumber);
    return { moduleKey: km, moduleLabel: km };
  }
  const key = unitType || 'reading';
  return { moduleKey: key, moduleLabel: getEnglishModuleLabel(key) };
}

function isWrongObjectiveResponse(resp: ObjectiveItemResponse): boolean {
  if (typeof resp.isCorrect === 'boolean') {
    return !resp.isCorrect;
  }
  if (!resp.correctAnswer) return false;
  const isMulti = resp.unitType === 'politics-multi';
  const u = normalizeChoiceAnswer(resp.selectedAnswer || '', isMulti);
  const c = normalizeChoiceAnswer(resp.correctAnswer, isMulti);
  return u.length > 0 && u !== c;
}

export interface CollectMistakeItemsParams {
  attempts: ExamAttempt[];
  reviewItems: ReviewItem[];
  examsByYear: Record<number, Exam>;
  scope: MistakeSummaryScope;
  subjectId: SubjectId;
  paperId?: string;
  paperYear?: number;
  filterMode: MistakeFilterMode;
  moduleKey: string; // 'all' or specific moduleKey
}

export interface CollectMistakeItemsResult {
  items: MistakeItemMinimalPayload[];
  stats: MistakeDeterministicStats;
  availableModules: MistakeModuleBreakdown[];
  allPaperWrongCount: number;
}

interface RawMistakeCandidate {
  payload: MistakeItemMinimalPayload;
  scoreLost: number;
  isMultiChoice: boolean;
}

/**
 * Deterministically collects wrong objective items & computes module-level statistics
 * with strict subject isolation (`politics` vs `english-i`).
 * Never includes full English reading passage text!
 */
export function collectMistakeItemsForScope(
  params: CollectMistakeItemsParams
): CollectMistakeItemsResult {
  const {
    attempts,
    reviewItems,
    examsByYear,
    scope,
    subjectId,
    paperId,
    paperYear,
    filterMode,
    moduleKey,
  } = params;

  const submittedDeduped = dedupeSubmittedAttemptsByPaper(
    attempts.filter((a) => a.status === 'submitted' || Boolean(a.submittedAt))
  );

  // Strict subject (and optional single-paper) isolation
  const targetCanonicalPaperId =
    scope === 'by-paper' && (paperId || paperYear !== undefined)
      ? resolveCanonicalPaperId(paperYear ?? paperId ?? '', paperId)
      : undefined;

  const scopedAttempts = submittedDeduped.filter((att) => {
    const attSubject = resolveSubjectId(att.year, att.subjectId);
    if (attSubject !== subjectId) return false;
    if (scope === 'by-paper' && targetCanonicalPaperId) {
      const attPaperId = resolveCanonicalPaperId(att.year, att.paperId);
      return attPaperId === targetCanonicalPaperId;
    }
    return true;
  });

  // Lookup mastered flags by paperId + questionNumber
  const masteredMap = new Map<string, boolean>();
  for (const rev of reviewItems) {
    const revSubject = resolveSubjectId(rev.year, rev.subjectId);
    if (revSubject !== subjectId) continue;
    const revPaperId = resolveCanonicalPaperId(rev.year, rev.paperId);
    const key = `${revPaperId}:${rev.questionNumber}`;
    if (rev.mastered || !masteredMap.has(key)) {
      masteredMap.set(key, Boolean(rev.mastered));
    }
  }

  // Track module-level totals across ALL answered questions in scope
  const moduleStatsMap = new Map<
    string,
    {
      moduleKey: string;
      moduleLabel: string;
      answeredCount: number;
      correctCount: number;
      wrongCount: number;
      scoreLost: number;
    }
  >();

  const ensureModuleBucket = (mKey: string, mLabel: string) => {
    let bucket = moduleStatsMap.get(mKey);
    if (!bucket) {
      bucket = {
        moduleKey: mKey,
        moduleLabel: mLabel,
        answeredCount: 0,
        correctCount: 0,
        wrongCount: 0,
        scoreLost: 0,
      };
      moduleStatsMap.set(mKey, bucket);
    }
    return bucket;
  };

  let totalAnsweredScope = 0;
  let totalCorrectScope = 0;
  const allWrongCandidates: RawMistakeCandidate[] = [];

  for (const att of scopedAttempts) {
    const canonicalPaperId = resolveCanonicalPaperId(att.year, att.paperId);
    const paperTitle = formatExamTitle(canonicalPaperId);
    const exam = examsByYear[att.year];
    const itemIndex = buildExamItemIndex(exam);

    const responses = Object.values(att.objectiveResponses || {}).sort(
      (a, b) => a.questionNumber - b.questionNumber
    );

    for (const resp of responses) {
      const hasAnswer = Boolean((resp.selectedAnswer || '').trim());
      if (!hasAnswer && typeof resp.isCorrect !== 'boolean') continue;

      const meta = itemIndex.get(resp.questionNumber);
      const effectiveUnitType = meta?.unitType || resp.unitType;
      const { moduleKey: itemModuleKey, moduleLabel: itemModuleLabel } =
        inferModuleKeyAndLabel(
          subjectId,
          effectiveUnitType,
          resp.questionNumber,
          meta?.item
        );

      const isWrong = isWrongObjectiveResponse(resp);
      const maxScore = resp.maxScore || meta?.item.score || 1;
      const scoreEarned =
        typeof resp.scoreEarned === 'number' ? resp.scoreEarned : isWrong ? 0 : maxScore;
      const scoreLost = Math.max(0, Math.round((maxScore - scoreEarned) * 10) / 10);

      const bucket = ensureModuleBucket(itemModuleKey, itemModuleLabel);
      bucket.answeredCount += 1;
      totalAnsweredScope += 1;

      if (!isWrong) {
        bucket.correctCount += 1;
        totalCorrectScope += 1;
        continue;
      }

      const masteredKey = `${canonicalPaperId}:${resp.questionNumber}`;
      const isMastered = masteredMap.get(masteredKey) ?? false;

      if (scope === 'by-subject' && filterMode === 'unmastered' && isMastered) {
        // When filtering to unmastered mistakes only, exclude mastered items from wrong list & stats
        continue;
      }

      bucket.wrongCount += 1;
      bucket.scoreLost = Math.round((bucket.scoreLost + scoreLost) * 10) / 10;

      const correctAns = resp.correctAnswer || meta?.item.correctAnswer || '';
      const isMulti =
        effectiveUnitType === 'politics-multi' ||
        meta?.item.answerMode === 'multi-choice';
      const multiChoiceTag = isMulti
        ? classifyMultiChoiceMiss(resp.selectedAnswer || '', correctAns)
        : undefined;

      // Minimal prompt & option payload — NEVER attach reading passage full text
      const payload: MistakeItemMinimalPayload = {
        paperId: canonicalPaperId,
        paperYear: att.year,
        paperTitle,
        subjectId,
        questionNumber: resp.questionNumber,
        unitType: effectiveUnitType,
        moduleKey: itemModuleKey,
        moduleLabel: itemModuleLabel,
        knowledgeModule:
          subjectId === 'politics'
            ? meta?.item.knowledgeModule || itemModuleKey
            : undefined,
        questionCategory:
          subjectId === 'english-i'
            ? meta?.item.readingMeta?.questionCategory
            : undefined,
        prompt: (meta?.item.prompt || `第 ${resp.questionNumber} 题`).slice(0, 600),
        options: (meta?.item.options || []).map((o) => ({
          key: o.key,
          text: String(o.text || '').slice(0, 240),
        })),
        userSelectedAnswer: (resp.selectedAnswer || '').trim().toUpperCase(),
        correctAnswer: String(correctAns).trim().toUpperCase(),
        multiChoiceTag,
        officialExplanation:
          subjectId === 'politics' && meta?.item.officialExplanation
            ? meta.item.officialExplanation.slice(0, 900)
            : undefined,
        userNotes: (resp.userNotes || '').trim().slice(0, 400),
        knownErrorCauses: Array.isArray(resp.knownErrorCauses)
          ? [...resp.knownErrorCauses]
          : [],
        confidence: (resp.confidence || 'certain') as ConfidenceLevel,
        mastered: isMastered,
      };

      allWrongCandidates.push({
        payload,
        scoreLost,
        isMultiChoice: isMulti,
      });
    }
  }

  // Order availableModules canonically for politics / english-i
  const orderedModuleBreakdowns: MistakeModuleBreakdown[] = Array.from(
    moduleStatsMap.values()
  )
    .map((b) => ({
      moduleKey: b.moduleKey,
      moduleLabel: b.moduleLabel,
      answeredCount: b.answeredCount,
      wrongCount: b.wrongCount,
      accuracyRate:
        b.answeredCount > 0
          ? Math.round((b.correctCount / b.answeredCount) * 1000) / 10
          : 0,
      scoreLost: b.scoreLost,
    }))
    .sort((a, b) => {
      if (subjectId === 'politics') {
        const ia = POLITICS_KNOWLEDGE_MODULES.indexOf(a.moduleKey as any);
        const ib = POLITICS_KNOWLEDGE_MODULES.indexOf(b.moduleKey as any);
        if (ia !== -1 || ib !== -1) {
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        }
      } else {
        const ia = ENGLISH_OBJECTIVE_UNIT_TYPES.indexOf(a.moduleKey as UnitType);
        const ib = ENGLISH_OBJECTIVE_UNIT_TYPES.indexOf(b.moduleKey as UnitType);
        if (ia !== -1 || ib !== -1) {
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        }
      }
      return b.wrongCount - a.wrongCount;
    });

  // Apply secondary moduleKey filter if specific module selected
  const filteredCandidates =
    moduleKey && moduleKey !== 'all'
      ? allWrongCandidates.filter((c) => c.payload.moduleKey === moduleKey)
      : allWrongCandidates;

  const finalModuleBreakdown =
    moduleKey && moduleKey !== 'all'
      ? orderedModuleBreakdowns.filter((m) => m.moduleKey === moduleKey)
      : orderedModuleBreakdowns;

  const filteredAnswered =
    moduleKey && moduleKey !== 'all'
      ? finalModuleBreakdown.reduce((acc, m) => acc + m.answeredCount, 0)
      : totalAnsweredScope;

  let certainWrongCount = 0;
  let hesitantWrongCount = 0;
  let guessedWrongCount = 0;
  let multiTotalWrong = 0;
  let multiPartialMissOnly = 0;
  let multiWrongOptionSelected = 0;
  let totalScoreLost = 0;
  const paperSet = new Set<string>();

  for (const c of filteredCandidates) {
    paperSet.add(c.payload.paperId);
    totalScoreLost = Math.round((totalScoreLost + c.scoreLost) * 10) / 10;
    if (c.payload.confidence === 'certain') certainWrongCount++;
    else if (c.payload.confidence === 'hesitant') hesitantWrongCount++;
    else if (c.payload.confidence === 'guessed') guessedWrongCount++;

    if (c.isMultiChoice) {
      multiTotalWrong++;
      if (c.payload.multiChoiceTag === 'partial-miss') multiPartialMissOnly++;
      else if (c.payload.multiChoiceTag === 'wrong-option') multiWrongOptionSelected++;
    }
  }

  const totalWrong = filteredCandidates.length;
  const totalCorrectInModule =
    moduleKey && moduleKey !== 'all'
      ? moduleStatsMap.get(moduleKey)?.correctCount ?? 0
      : totalCorrectScope;

  const accuracyRate =
    filteredAnswered > 0
      ? Math.round((totalCorrectInModule / filteredAnswered) * 1000) / 10
      : 0;

  // Sort mistake items deterministically by paperYear DESC, questionNumber ASC
  const sortedItems = filteredCandidates
    .map((c) => c.payload)
    .sort((a, b) => {
      if (b.paperYear !== a.paperYear) return b.paperYear - a.paperYear;
      return a.questionNumber - b.questionNumber;
    });

  return {
    items: sortedItems,
    stats: {
      totalAnswered: filteredAnswered,
      totalCorrect: totalCorrectInModule,
      totalWrong,
      accuracyRate,
      totalScoreLost,
      certainWrongCount,
      hesitantWrongCount,
      guessedWrongCount,
      multiTotalWrong,
      multiPartialMissOnly,
      multiWrongOptionSelected,
      sourcePapersCount: paperSet.size || scopedAttempts.length,
      moduleBreakdown: finalModuleBreakdown,
    },
    availableModules: orderedModuleBreakdowns.filter((m) => m.wrongCount > 0),
    allPaperWrongCount: allWrongCandidates.length,
  };
}

export interface MistakeBatch {
  batchIndex: number;
  totalBatches: number;
  moduleKey: string;
  moduleLabel: string;
  items: MistakeItemMinimalPayload[];
}

/**
 * Splits large mistake collections (>25 items) by secondary module first,
 * and further chunks oversized modules so each AI batch never exceeds `maxBatchSize` (<= 25).
 */
export function splitMistakeItemsIntoBatches(
  items: MistakeItemMinimalPayload[],
  maxBatchSize: number = 25
): MistakeBatch[] {
  const safeCap = Math.max(1, Math.min(30, maxBatchSize));
  if (items.length === 0) return [];
  if (items.length <= safeCap) {
    const distinctModules = Array.from(new Set(items.map((i) => i.moduleLabel)));
    return [
      {
        batchIndex: 1,
        totalBatches: 1,
        moduleKey: distinctModules.length === 1 ? items[0].moduleKey : 'all',
        moduleLabel:
          distinctModules.length === 1 ? distinctModules[0] : '当前选中全部模块',
        items,
      },
    ];
  }

  // Group by moduleKey preserving first-seen order
  const byModule = new Map<string, { label: string; items: MistakeItemMinimalPayload[] }>();
  for (const item of items) {
    let entry = byModule.get(item.moduleKey);
    if (!entry) {
      entry = { label: item.moduleLabel, items: [] };
      byModule.set(item.moduleKey, entry);
    }
    entry.items.push(item);
  }

  const rawBatches: Omit<MistakeBatch, 'batchIndex' | 'totalBatches'>[] = [];
  for (const [mKey, group] of byModule.entries()) {
    for (let i = 0; i < group.items.length; i += safeCap) {
      const slice = group.items.slice(i, i + safeCap);
      const partCount = Math.ceil(group.items.length / safeCap);
      const partSuffix = partCount > 1 ? ` (${Math.floor(i / safeCap) + 1}/${partCount})` : '';
      rawBatches.push({
        moduleKey: mKey,
        moduleLabel: `${group.label}${partSuffix}`,
        items: slice,
      });
    }
  }

  return rawBatches.map((b, idx) => ({
    ...b,
    batchIndex: idx + 1,
    totalBatches: rawBatches.length,
  }));
}

/**
 * Deterministic FNV-1a 64-bit style dual-32 hash safe in both Browser & Node without crypto import.
 */
function deterministicHexHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function computeMistakeSummaryCacheKeyAndHash(params: {
  scope: MistakeSummaryScope;
  subjectId: SubjectId;
  paperId?: string;
  filterMode: MistakeFilterMode;
  moduleKey: string;
  items: MistakeItemMinimalPayload[];
}): { cacheKey: string; inputHash: string } {
  const scopePart =
    params.scope === 'by-paper'
      ? `paper:${params.paperId || 'unknown'}`
      : `subject:${params.subjectId}:${params.filterMode}:${params.moduleKey || 'all'}`;
  const cacheKey = `${params.subjectId}::${scopePart}`;

  const canonicalItems = [...params.items]
    .sort((a, b) => {
      if (a.paperId !== b.paperId) return a.paperId.localeCompare(b.paperId);
      return a.questionNumber - b.questionNumber;
    })
    .map((item) => ({
      p: item.paperId,
      q: item.questionNumber,
      u: item.userSelectedAnswer,
      c: item.correctAnswer,
      n: item.userNotes,
      k: [...item.knownErrorCauses].sort(),
      m: item.mastered,
      conf: item.confidence,
    }));

  const inputHash = deterministicHexHash(
    JSON.stringify({
      cacheKey,
      items: canonicalItems,
    })
  );

  return { cacheKey, inputHash };
}

export function computeMistakeDeterministicStats(
  params: CollectMistakeItemsParams
): MistakeDeterministicStats {
  return collectMistakeItemsForScope(params).stats;
}

function formatDeterministicStatsMarkdown(
  subjectId: SubjectId,
  stats: MistakeDeterministicStats
): string {
  const lines: string[] = [
    '## 数据统计概览（本地确定性计算）',
    '',
    `- **纳入分析错题数**：${stats.totalWrong} 题（范围总作答 ${stats.totalAnswered} 题，正确率 **${stats.accuracyRate}%**）`,
    `- **累计客观题失分**：${stats.totalScoreLost} 分 · **覆盖试卷数**：${stats.sourcePapersCount} 套`,
    `- **把握度失分分布**：确定却错（高危盲区） ${stats.certainWrongCount} 题 · 犹豫选错 ${stats.hesitantWrongCount} 题 · 纯蒙错 ${stats.guessedWrongCount} 题`,
  ];

  if (subjectId === 'politics' && stats.multiTotalWrong > 0) {
    lines.push(
      `- **政治多选失分拆解**：多选共错 ${stats.multiTotalWrong} 题（其中仅漏选 ${stats.multiPartialMissOnly} 题 · 误选干扰项 ${stats.multiWrongOptionSelected} 题）`
    );
  }

  if (stats.moduleBreakdown.length > 0) {
    const colName = subjectId === 'politics' ? '政治知识模块' : '英语一题型模块';
    lines.push('');
    lines.push(`| ${colName} | 已作答 | 错题数 | 正确率 | 失分 |`);
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const m of stats.moduleBreakdown) {
      lines.push(
        `| ${m.moduleLabel} | ${m.answeredCount} | ${m.wrongCount} | ${m.accuracyRate}% | ${m.scoreLost} 分 |`
      );
    }
  }

  return lines.join('\n');
}

function formatRawMistakeItemsMarkdown(items: MistakeItemMinimalPayload[]): string {
  if (items.length === 0) {
    return '当前筛选范围内暂无错题记录。';
  }
  const lines: string[] = ['## 错题原始明细清单', ''];
  items.forEach((item, idx) => {
    const tagText =
      item.multiChoiceTag === 'partial-miss'
        ? ' · [多选漏选]'
        : item.multiChoiceTag === 'wrong-option'
        ? ' · [误选干扰项]'
        : '';
    lines.push(
      `### ${idx + 1}. ${item.paperTitle} 第 ${item.questionNumber} 题（${item.moduleLabel}${tagText}）`
    );
    lines.push(`- **题干**：${item.prompt}`);
    if (item.options.length > 0) {
      lines.push(
        `- **选项**：${item.options.map((o) => `${o.key}. ${o.text}`).join(' / ')}`
      );
    }
    lines.push(
      `- **我的作答**：\`${item.userSelectedAnswer || '未作答'}\` | **官方答案**：\`${
        item.correctAnswer || '—'
      }\` | **把握度**：${
        item.confidence === 'certain'
          ? '很确定'
          : item.confidence === 'hesitant'
          ? '犹豫'
          : '蒙的'
      }`
    );
    if (item.knownErrorCauses.length > 0) {
      lines.push(`- **错因标签**：${item.knownErrorCauses.join('、')}`);
    }
    if (item.userNotes) {
      lines.push(`- **个人笔记**：${item.userNotes}`);
    }
    if (item.officialExplanation) {
      lines.push(`- **官方解析**：${item.officialExplanation}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function buildPureMistakeMarkdownExport(params: {
  title: string;
  subjectId: SubjectId;
  stats: MistakeDeterministicStats;
  items: MistakeItemMinimalPayload[];
}): string {
  const header = [
    `# ${params.title}`,
    '',
    `> 导出方式：本地确定性纯错题清单（未调用 AI） · 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    formatDeterministicStatsMarkdown(params.subjectId, params.stats),
    '',
    formatRawMistakeItemsMarkdown(params.items),
  ];
  return header.join('\n');
}

export function buildCombinedMistakeSummaryMarkdown(params: {
  title: string;
  subjectId: SubjectId;
  stats: MistakeDeterministicStats;
  aiMarkdown: string;
  modelLabel?: string;
  generatedAt?: string;
  items: MistakeItemMinimalPayload[];
  includeRawAppendix?: boolean;
}): string {
  const compactBreakdown = params.stats.moduleBreakdown
    .filter((m) => m.wrongCount > 0)
    .map((m) => `${m.moduleLabel} ${m.wrongCount}`)
    .join(' · ');

  const summaryHeaderLine = `> 错题 ${params.stats.totalWrong}/${params.stats.totalAnswered} 题（正确率 ${params.stats.accuracyRate}% · 失分 ${params.stats.totalScoreLost} 分${
    compactBreakdown ? ` ｜ ${compactBreakdown}` : ''
  }）· 模型：${params.modelLabel || '已配置 AI 模型'} · ${
    params.generatedAt || new Date().toLocaleString('zh-CN')
  }`;

  const sections = [
    `# ${params.title}`,
    '',
    summaryHeaderLine,
    '',
    ...(params.includeRawAppendix
      ? [formatDeterministicStatsMarkdown(params.subjectId, params.stats), '']
      : []),
    params.aiMarkdown.trim(),
  ];

  if (params.includeRawAppendix && params.items.length > 0) {
    sections.push('', '---', '', formatRawMistakeItemsMarkdown(params.items));
  }

  return sections.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineMarkdownToHtml(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

/**
 * Converts Markdown report into a standalone, print-ready HTML document
 * for browsers/iframes where direct window.print() is restricted.
 */
export function buildPrintableHtmlDocument(params: {
  title: string;
  markdownContent: string;
}): string {
  const lines = params.markdownContent.replace(/\r\n/g, '\n').split('\n');
  const htmlBlocks: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlBlocks.push('</ul>');
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    // Markdown table
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|[\s:|-]+\|/.test(lines[i + 1].trim())
    ) {
      closeList();
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const headers = splitRow(trimmed);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      const thHtml = headers
        .map((h) => `<th>${renderInlineMarkdownToHtml(h)}</th>`)
        .join('');
      const trHtml = bodyRows
        .map(
          (r) =>
            `<tr>${headers
              .map((_, idx) => `<td>${renderInlineMarkdownToHtml(r[idx] || '')}</td>`)
              .join('')}</tr>`
        )
        .join('');
      htmlBlocks.push(
        `<table><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table>`
      );
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      closeList();
      htmlBlocks.push('<hr />');
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      htmlBlocks.push(
        `<h${level}>${renderInlineMarkdownToHtml(headingMatch[2])}</h${level}>`
      );
      continue;
    }

    if (trimmed.startsWith('> ')) {
      closeList();
      htmlBlocks.push(
        `<blockquote>${renderInlineMarkdownToHtml(trimmed.slice(2))}</blockquote>`
      );
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      if (!inList) {
        htmlBlocks.push('<ul>');
        inList = true;
      }
      const itemText = trimmed.replace(/^([-*+]|\d+\.)\s+/, '');
      htmlBlocks.push(`<li>${renderInlineMarkdownToHtml(itemText)}</li>`);
      continue;
    }

    closeList();
    htmlBlocks.push(`<p>${renderInlineMarkdownToHtml(trimmed)}</p>`);
  }
  closeList();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(params.title)}</title>
  <style>
    @page { size: A4; margin: 10mm 12mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
      color: #1f2937;
      line-height: 1.5;
      max-width: 820px;
      margin: 18px auto;
      padding: 0 18px;
      font-size: 12.5px;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      margin-bottom: 18px;
      background: #f1f5f3;
      border: 1px solid #dce4e1;
      border-radius: 8px;
      font-size: 12px;
    }
    .print-btn {
      background: #174a5b;
      color: #fff;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    @media print {
      .toolbar { display: none !important; }
      body { margin: 0; padding: 0; max-width: none; }
    }
    h1 { font-size: 20px; border-bottom: 2px solid #174a5b; padding-bottom: 6px; margin-top: 8px; }
    h2 { font-size: 16px; color: #174a5b; margin-top: 20px; break-after: avoid; }
    h3 { font-size: 14px; color: #202b2f; margin-top: 14px; break-after: avoid; }
    blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      border-left: 3px solid #174a5b;
      background: #f6f8f7;
      color: #4b5563;
      font-size: 12.5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 12.5px;
      break-inside: avoid;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f3f6f5; font-weight: 600; }
    code {
      background: #f3f4f6;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      font-size: 12px;
    }
    ul { padding-left: 20px; }
    li { margin: 4px 0; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 18px 0; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>研卷台 · 纯享打印版报告（可直接按 Ctrl/Cmd+P 另存为 PDF）</span>
    <button class="print-btn" onclick="window.print()">打印 / 另存为 PDF</button>
  </div>
  ${htmlBlocks.join('\n  ')}
</body>
</html>`;
}
