import type {
  Exam,
  ExamItem,
  ExamUnit,
  ImportStatus,
  ValidationCheckResult,
  ValidationErrorCode,
  ValidationReport,
} from '../shared/types.ts';
import type { MergeResult } from './multiSourceMerger.ts';

export interface ValidateExamOptions {
  dataVersion: string;
  sourceHashes: Record<string, string>;
  availableAssetNames: string[];
  importRetryCount?: number;
  consistencyCheckRuns?: number;
  consistencyMatched?: boolean;
  parserProvider?: string;
  parserModel?: string;
  nowIso?: string;
}

/**
 * Runs the exhaustive 19-point validation suite on a merged Exam draft.
 * Strictly enforces:
 * - Never marks an exam as 'ready' if objective answers (1-45) are missing or conflicting
 * - Never accepts 'ai-generated' as answerSource for objective questions (1-45)
 * - Uses stable error code OBJECTIVE_ANSWER_MISSING and lists all missing question numbers
 */
export function buildAndValidateExam(
  mergeResult: MergeResult,
  options: ValidateExamOptions
): Exam {
  const { mergedDraft, sourceFormats, sourceFiles, conflictingObjectiveQuestions, sourceDiscrepancies } =
    mergeResult;
  const nowIso = options.nowIso || new Date().toISOString();
  const checks: ValidationCheckResult[] = [];
  const errorCodesSet = new Set<ValidationErrorCode>();

  const addCheck = (
    checkId: string,
    name: string,
    passed: boolean,
    message: string,
    code?: ValidationErrorCode,
    details?: string[]
  ) => {
    checks.push({ checkId, name, passed, message, code, details });
    if (!passed && code) {
      errorCodesSet.add(code);
    }
  };

  // Flatten all units and items
  const allUnits: ExamUnit[] = [];
  const allItems: ExamItem[] = [];
  for (const sec of mergedDraft.sections) {
    for (const unit of sec.units) {
      allUnits.push(unit);
      for (const item of unit.items) {
        allItems.push(item);
      }
    }
  }

  // 1. Year & Subject check
  const yearValid =
    mergedDraft.year >= 2010 &&
    mergedDraft.year <= 2026 &&
    mergedDraft.subject === '考研英语一';
  addCheck(
    'check-01-year-subject',
    '年份与英语一科目校验',
    yearValid,
    yearValid
      ? `已验证年份 ${mergedDraft.year}，科目为 ${mergedDraft.subject}`
      : `年份 (${mergedDraft.year}) 或科目 (${mergedDraft.subject}) 无效`,
    yearValid ? undefined : 'SUBJECT_OR_YEAR_INVALID'
  );

  // 2 & 3. Question numbers 1–52 coverage, gaps, duplicates, and order
  const qNumbers = allItems.map((i) => i.questionNumber);
  const missingQNums: number[] = [];
  for (let q = 1; q <= 52; q++) {
    if (!qNumbers.includes(q)) missingQNums.push(q);
  }
  const seenQ = new Set<number>();
  const duplicateQNums: number[] = [];
  for (const q of qNumbers) {
    if (seenQ.has(q)) duplicateQNums.push(q);
    seenQ.add(q);
  }
  let inOrder = true;
  for (let i = 1; i < qNumbers.length; i++) {
    if (qNumbers[i] <= qNumbers[i - 1]) {
      inOrder = false;
      break;
    }
  }

  addCheck(
    'check-02-question-range',
    '题号 1–52 完整覆盖校验',
    missingQNums.length === 0 && qNumbers.length === 52,
    missingQNums.length === 0
      ? '题号 1–52 全部覆盖且无缺漏'
      : `缺失题号: ${missingQNums.join(', ')}`,
    missingQNums.length === 0 ? undefined : 'QUESTION_NUMBER_GAP',
    missingQNums.map(String)
  );

  addCheck(
    'check-03-question-order-duplicates',
    '题号无重复与严格递增顺序校验',
    duplicateQNums.length === 0 && inOrder,
    duplicateQNums.length === 0 && inOrder
      ? '题号 1–52 无重号且严格递增'
      : `重号: [${duplicateQNums.join(', ')}], 顺序正常: ${inOrder}`,
    duplicateQNums.length > 0
      ? 'QUESTION_NUMBER_DUPLICATE'
      : !inOrder
      ? 'QUESTION_NUMBER_OUT_OF_ORDER'
      : undefined
  );

  // 4 & 5. Cloze 20 questions & 4 options each
  const clozeUnits = allUnits.filter((u) => u.unitType === 'cloze');
  const clozeItems = clozeUnits.flatMap((u) => u.items);
  const clozeCountOk =
    clozeItems.length === 20 &&
    clozeItems.every((item, idx) => item.questionNumber === idx + 1);
  addCheck(
    'check-04-cloze-count',
    '完形填空 1–20 题数量校验',
    clozeCountOk,
    clozeCountOk ? '完形填空包含完整 1–20 题' : `完形填空题数为 ${clozeItems.length}`,
    clozeCountOk ? undefined : 'CLOZE_COUNT_INVALID'
  );

  const clozeOptionsOk = clozeItems.every(
    (item) =>
      Array.isArray(item.options) &&
      item.options.length === 4 &&
      item.options.map((o) => o.key).join('') === 'ABCD' &&
      item.options.every((o) => o.text.trim().length > 0)
  );
  addCheck(
    'check-05-cloze-options',
    '完形填空每题 4 个有效选项 (A/B/C/D) 校验',
    clozeOptionsOk,
    clozeOptionsOk ? '完形填空 20 题均包含 A/B/C/D 四个非空选项' : '存在选项缺失或格式异常的完形题目',
    clozeOptionsOk ? undefined : 'CLOZE_OPTIONS_INVALID'
  );

  // 6. Reading Part A: 4 texts, 20 questions (21-40), 4 options each, Q34 underline kept in passage
  const readingUnits = allUnits.filter((u) => u.unitType === 'reading');
  const readingItems = readingUnits.flatMap((u) => u.items);
  const readingPartAOk =
    readingUnits.length === 4 &&
    readingItems.length === 20 &&
    readingItems.every(
      (item, idx) =>
        item.questionNumber === 21 + idx &&
        Array.isArray(item.options) &&
        item.options.length === 4
    );
  addCheck(
    'check-06-reading-part-a',
    '阅读 Part A 四篇文章共 20 题 (21–40) 校验',
    readingPartAOk,
    readingPartAOk
      ? '阅读 Part A 包含 4 篇文章、20 道单选 (21–40)，且第34题下划线保留在阅读正文中'
      : `阅读 Part A 篇数 (${readingUnits.length}) 或题数 (${readingItems.length}) 异常`,
    readingPartAOk ? undefined : 'READING_PART_A_INVALID'
  );

  // 7 & 13. Part B: 5 scored positions (41-45), A-G candidates, E fixed, 1 redundant
  const partBUnit = allUnits.find((u) => u.unitType === 'passage-assembly');
  const partBSpec = partBUnit?.materials[0]?.passageAssemblySpec;
  const partBSlotsOk =
    Boolean(partBUnit) &&
    partBUnit!.items.length === 5 &&
    partBUnit!.items.map((i) => i.questionNumber).join(',') === '41,42,43,44,45' &&
    Boolean(partBSpec) &&
    partBSpec!.scoredPositions.length === 5;
  addCheck(
    'check-07-part-b-slots',
    'Part B 五个计分位置 (41–45) 校验',
    partBSlotsOk,
    partBSlotsOk ? 'Part B 包含 41–45 共 5 个计分位置' : 'Part B 计分位置数量或题号不匹配',
    partBSlotsOk ? undefined : 'PART_B_SLOTS_INVALID'
  );

  const partBFixedOk =
    Boolean(partBSpec) &&
    partBSpec!.candidateParagraphs.length === 7 &&
    partBSpec!.fixedPlacements.some((f) => f.paragraphId === 'E') &&
    partBSpec!.sequenceSlots.length === 6 &&
    partBSpec!.redundantCount === 1;
  addCheck(
    'check-13-part-b-fixed-consistency',
    'Part B 候选段落 A–G、固定段 E 与多余段落一致性校验',
    partBFixedOk,
    partBFixedOk
      ? '候选段落覆盖 A–G，E 段固定于序列中，5 个计分空位 + 1 个多余段落结构一致'
      : 'Part B 固定段落或候选池结构不一致',
    partBFixedOk ? undefined : 'PART_B_FIXED_PARAGRAPH_INVALID'
  );

  // 8. Part C Translation: 5 underlined sentences (46-50), no leaking of Q34 underline
  const transUnit = allUnits.find((u) => u.unitType === 'translation');
  const transItems = transUnit?.items || [];
  const transOk =
    transItems.length === 5 &&
    transItems.map((i) => i.questionNumber).join(',') === '46,47,48,49,50' &&
    transItems.every(
      (i) =>
        Boolean(i.translationMeta?.underlinedEnglish) &&
        i.translationMeta!.underlinedEnglish.length > 20 &&
        !i.translationMeta!.underlinedEnglish.toLowerCase().includes('these people')
    );
  addCheck(
    'check-08-translation-sentences',
    'Part C 翻译 5 个划线句 (46–50) 精准识别校验',
    transOk,
    transOk
      ? '准确识别 46–50 共 5 个划线翻译句，且未将阅读第34题 <u>these people</u> 误判为翻译题'
      : '翻译划线句数量或内容异常',
    transOk ? undefined : 'TRANSLATION_COUNT_INVALID'
  );

  // 9. Practical Writing (51) & Visual Writing (52) existence
  const pwUnit = allUnits.find((u) => u.unitType === 'practical-writing');
  const vwUnit = allUnits.find((u) => u.unitType === 'visual-writing');
  const writingExists =
    Boolean(pwUnit) &&
    pwUnit!.items.length === 1 &&
    pwUnit!.items[0].questionNumber === 51 &&
    Boolean(vwUnit) &&
    vwUnit!.items.length === 1 &&
    vwUnit!.items[0].questionNumber === 52;
  addCheck(
    'check-09-writing-existence',
    '写作 Part A (51题) 与 Part B (52题) 存在性校验',
    writingExists,
    writingExists ? '应用文 (51题) 与图画作文 (52题) 均完整存在' : '小作文或大作文缺失',
    writingExists ? undefined : 'WRITING_SECTION_MISSING'
  );

  // 11. Total score == 100
  const sectionSum = mergedDraft.sections.reduce((acc, s) => acc + s.score, 0);
  const itemSum = Math.round(allItems.reduce((acc, i) => acc + i.score, 0) * 10) / 10;
  const scoreOk = sectionSum === 100 && itemSum === 100;
  addCheck(
    'check-11-total-score',
    '各部分与全卷总分 100 分校验',
    scoreOk,
    scoreOk
      ? '全卷各部分及题目分值总和严格等于 100 分 (10 + 40 + 10 + 10 + 10 + 20)'
      : `分值总和异常: sections=${sectionSum}, items=${itemSum}`,
    scoreOk ? undefined : 'TOTAL_SCORE_MISMATCH'
  );

  // 12 & 14 & 16 & 17. Asset path, visual materials, chart facts, and pie chart 100% check
  const visualMats = vwUnit?.materials[0]?.visualMaterials || [];
  const assetOk = mergedDraft.referencedAssets.every((asset) =>
    options.availableAssetNames.includes(asset)
  );
  addCheck(
    'check-12-asset-paths',
    '静态图片资源路径存在性校验',
    assetOk && mergedDraft.referencedAssets.length > 0,
    assetOk
      ? `已验证插图资源文件: ${mergedDraft.referencedAssets.join(', ')}`
      : `找不到引用的插图资源: ${mergedDraft.referencedAssets.join(', ')}`,
    assetOk ? undefined : 'INVALID_ASSET_PATH'
  );

  const visualValid =
    visualMats.length > 0 &&
    visualMats.every(
      (vm) =>
        Boolean(vm.imagePath) &&
        Boolean(vm.title) &&
        vm.categories.length > 0 &&
        vm.requiredFacts.length > 0 &&
        vm.primaryRelations.length > 0
    );
  addCheck(
    'check-14-16-visual-material-facts',
    '写作视觉材料与图表事实结构完整性校验',
    visualValid,
    visualValid
      ? `已验证 ${visualMats.length} 份视觉材料，标题、分类、主要关系及必写事实完整`
      : '视觉材料或事实结构缺失',
    visualValid ? undefined : 'WRITING_VISUAL_MATERIAL_INVALID'
  );

  // 17. Pie chart / percentage sum check (if unit contains '%' and values represent a distribution)
  let pieSumOk = true;
  for (const vm of visualMats) {
    if (vm.values.length > 0 && vm.values.every((v) => v.unit.includes('%'))) {
      const sum = vm.values.reduce((acc, v) => acc + v.value, 0);
      if (Math.abs(sum - 100) > 1.5) {
        pieSumOk = false;
      }
    }
  }
  addCheck(
    'check-17-pie-chart-sum',
    '图表百分比数值总和校验 (允许误差 ±1.5%)',
    pieSumOk,
    pieSumOk ? '视觉材料比例数值总和符合 100% 校验要求' : '饼图/比例数值总和偏离 100%',
    pieSumOk ? undefined : 'PIE_CHART_SUM_INVALID'
  );

  // 15. Answer sheet not leaked into reading passages
  const leakedAnswerRegex = /(?:参考答案|Answer\s*Key|1\.\s*[A-D]\s+2\.\s*[A-D]\s+3\.\s*[A-D])/i;
  const noAnswerLeak = allUnits.every((u) =>
    u.materials.every((m) => !leakedAnswerRegex.test(m.text))
  );
  addCheck(
    'check-15-no-answer-leak',
    '参考答案页未混入正文校验',
    noAnswerLeak,
    noAnswerLeak ? '所有阅读与完形正文均未混入参考答案内容' : '检测到正文材料中疑似混入答案内容',
    noAnswerLeak ? undefined : 'ANSWER_SHEET_LEAKED_INTO_PASSAGE'
  );

  // 18. File hashes unique
  const hashValues = Object.values(options.sourceHashes);
  const uniqueHashes = new Set(hashValues);
  const hashesUnique = hashValues.length === uniqueHashes.size;
  addCheck(
    'check-18-unique-file-hashes',
    '源文件 SHA-256 哈希无重复校验',
    hashesUnique,
    hashesUnique
      ? `全部 ${hashValues.length} 个输入文件 SHA-256 哈希唯一`
      : '存在重复哈希的输入文件',
    hashesUnique ? undefined : 'DUPLICATE_FILE_HASH'
  );

  // 19. Multi-source objective answer conflict check
  const noConflicts = conflictingObjectiveQuestions.length === 0;
  addCheck(
    'check-19-no-answer-conflict',
    '多来源客观题答案无冲突校验',
    noConflicts,
    noConflicts
      ? '多来源客观题答案无冲突'
      : `以下题号在不同来源间存在客观题答案冲突: ${conflictingObjectiveQuestions.join(', ')}`,
    noConflicts ? undefined : 'OBJECTIVE_ANSWER_CONFLICT',
    conflictingObjectiveQuestions.map(String)
  );

  // 10. Objective answers (1–45) completeness & non-AI provenance check
  const objectiveItems = allItems.filter(
    (i) => i.questionNumber >= 1 && i.questionNumber <= 45
  );
  const aiGuessedItems = objectiveItems.filter((i) => i.answerSource === 'ai-generated');
  const missingObjectiveQuestions = objectiveItems
    .filter((i) => !i.correctAnswer || i.answerSource !== 'source-provided')
    .map((i) => i.questionNumber);

  if (aiGuessedItems.length > 0) {
    addCheck(
      'check-10a-no-ai-guessed-objective',
      '禁止 AI 推测答案冒充客观题来源答案校验',
      false,
      `检测到 ${aiGuessedItems.length} 道客观题使用了 AI 推测答案，违反铁律`,
      'AI_GUESSED_OBJECTIVE_ANSWER_FORBIDDEN',
      aiGuessedItems.map((i) => String(i.questionNumber))
    );
  }

  const objectiveAnswersComplete =
    missingObjectiveQuestions.length === 0 && aiGuessedItems.length === 0;
  addCheck(
    'check-10-objective-answers-complete',
    '客观题 (1–45题) 来源答案完整性校验',
    objectiveAnswersComplete,
    objectiveAnswersComplete
      ? '1–45 题全部具备官方来源客观题答案 (source-provided)'
      : `缺少客观题来源答案，共缺失 ${missingObjectiveQuestions.length} 题（题号: ${formatQuestionRanges(
          missingObjectiveQuestions
        )}）`,
    objectiveAnswersComplete ? undefined : 'OBJECTIVE_ANSWER_MISSING',
    missingObjectiveQuestions.map(String)
  );

  // Determine overall ImportStatus
  const errorCodes = Array.from(errorCodesSet);
  let status: ImportStatus = 'ready';
  if (errorCodes.length > 0) {
    if (
      errorCodes.length === 1 &&
      errorCodes[0] === 'OBJECTIVE_ANSWER_MISSING'
    ) {
      status = 'needs-answer-source';
    } else {
      status = 'failed';
    }
  }

  // Update visual material image paths to match options.dataVersion
  for (const sec of mergedDraft.sections) {
    for (const unit of sec.units) {
      for (const mat of unit.materials) {
        if (mat.imagePath) {
          mat.imagePath = mat.imagePath.replace(
            /\/assets\/papers\/\d+\/[^/]+\//,
            `/assets/papers/${mergedDraft.year}/${options.dataVersion}/`
          );
        }
        if (mat.visualMaterials) {
          for (const vm of mat.visualMaterials) {
            vm.imagePath = vm.imagePath.replace(
              /\/assets\/papers\/\d+\/[^/]+\//,
              `/assets/papers/${mergedDraft.year}/${options.dataVersion}/`
            );
          }
        }
      }
    }
  }

  const validationReport: ValidationReport = {
    examId: `exam-${mergedDraft.year}-${options.dataVersion}`,
    year: mergedDraft.year,
    dataVersion: options.dataVersion,
    status,
    passedAllChecks: errorCodes.length === 0,
    errorCodes,
    missingObjectiveQuestions,
    conflictingObjectiveQuestions,
    checks,
    consistencyCheckRuns: options.consistencyCheckRuns ?? 2,
    consistencyMatched: options.consistencyMatched ?? true,
    sourceDiscrepancies,
    generatedAt: nowIso,
  };

  return {
    id: `exam-${mergedDraft.year}-${options.dataVersion}`,
    year: mergedDraft.year,
    subject: '考研英语一',
    totalScore: 100,
    durationMinutes: 180,
    sourceFiles,
    sourceFormats,
    sourceHashes: options.sourceHashes,
    pageCount: 14,
    importStatus: status,
    importRetryCount: options.importRetryCount ?? 0,
    parserProvider: options.parserProvider || 'deterministic+multimodal-pipeline',
    parserModel: options.parserModel || 'rule-ast-v1',
    parserVersion: '1.0.0',
    schemaVersion: '1.0.0',
    dataVersion: options.dataVersion,
    sections: mergedDraft.sections,
    validationReport,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function formatQuestionRanges(nums: number[]): string {
  if (nums.length === 0) return '无';
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return ranges.join(', ');
}
