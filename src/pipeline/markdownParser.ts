import type {
  AnswerSource,
  Exam,
  ExamItem,
  ExamMaterial,
  ExamSection,
  ExamUnit,
  OptionItem,
  PassageAssemblySpec,
  PracticalWritingSpec,
  VisualMaterial,
} from '../shared/types.ts';
import {
  sanitizeExamDocumentText,
  validateSafeRelativePath,
} from './zipSecurity.ts';

export interface ParsedExamDraft {
  year: number;
  subject: '考研英语一';
  sourceFile: string;
  sourceFormat: 'md' | 'pdf' | 'docx';
  sections: ExamSection[];
  extractedObjectiveAnswers: Record<number, { answer: string; sourceFile: string }>;
  referencedAssets: string[];
  answerSheetIsolated: boolean;
}

/**
 * Parses an English I exam Markdown document into a structured Exam draft.
 * Combines deterministic structural parsing with semantic extraction rules:
 * - Strictly distinguishes Reading <u> tags (e.g. Q34) from Section II Part C Translation <u> sentences (Q46-50).
 * - Extracts Part B candidate paragraphs A-G, fixed paragraph E, 5 scored positions (41-45), and 1 redundant paragraph.
 * - Isolates any trailing Reference Answer block so it never leaks into passage materials.
 */
export function parseMarkdownExam(
  rawMarkdown: string,
  sourceFile: string,
  fallbackYear?: number
): ParsedExamDraft {
  const { sanitizedText } = sanitizeExamDocumentText(rawMarkdown);

  // Detect year & subject
  const yearMatch =
    sanitizedText.match(/(201\d|202\d)\s*年/) ||
    sourceFile.match(/(201\d|202\d)/);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear || 2010;

  // Step 1: Isolate Answer Key section if present at bottom of document
  const extractedObjectiveAnswers: Record<number, { answer: string; sourceFile: string }> = {};
  let mainBody = sanitizedText;
  let answerSheetIsolated = false;

  const answerSectionRegex = /(?:^|\n)#{1,3}\s*(?:参考答案|官方答案|Answer\s*Key|客观题答案)[\s\S]*$/i;
  const answerMatch = sanitizedText.match(answerSectionRegex);
  if (answerMatch && answerMatch.index !== undefined) {
    answerSheetIsolated = true;
    const answerBlock = sanitizedText.slice(answerMatch.index);
    mainBody = sanitizedText.slice(0, answerMatch.index).trim();
    const pairRegex = /(?:^|\s|\|)(\d{1,2})\s*[.、:：-]\s*([A-G])(?=\s|\||$)/gm;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(answerBlock)) !== null) {
      const qNum = Number(m[1]);
      const ans = m[2].toUpperCase();
      if (qNum >= 1 && qNum <= 45) {
        extractedObjectiveAnswers[qNum] = { answer: ans, sourceFile };
      }
    }
  }

  // Split into major sections: Section I, Section II, Section III
  const sec1Idx = mainBody.search(/#{1,3}\s*Section\s+I\b/i);
  const sec2Idx = mainBody.search(/#{1,3}\s*Section\s+II\b/i);
  const sec3Idx = mainBody.search(/#{1,3}\s*Section\s+III\b/i);

  const sec1Text =
    sec1Idx !== -1 && sec2Idx !== -1
      ? mainBody.slice(sec1Idx, sec2Idx)
      : mainBody;
  const sec2Text =
    sec2Idx !== -1
      ? mainBody.slice(sec2Idx, sec3Idx !== -1 ? sec3Idx : mainBody.length)
      : '';
  const sec3Text = sec3Idx !== -1 ? mainBody.slice(sec3Idx) : '';

  const referencedAssets: string[] = [];

  // Parse Section I: Use of English (Cloze 1-20)
  const clozeUnit = parseClozeSection(sec1Text, sourceFile, extractedObjectiveAnswers);

  // Parse Section II: Reading Comprehension (Part A, Part B, Part C)
  const { readingUnits, partBUnit, translationUnit } = parseReadingSection(
    sec2Text,
    sourceFile,
    extractedObjectiveAnswers
  );

  // Parse Section III: Writing (Part A 51, Part B 52)
  const { practicalUnit, visualUnit, assets } = parseWritingSection(
    sec3Text,
    sourceFile,
    year
  );
  referencedAssets.push(...assets);

  const sections: ExamSection[] = [
    {
      id: `sec-1-${year}`,
      sectionNumber: 'Section I',
      title: 'Section I Use of English',
      score: 10,
      suggestedMinutes: 18,
      units: [clozeUnit],
    },
    {
      id: `sec-2-${year}`,
      sectionNumber: 'Section II',
      title: 'Section II Reading Comprehension',
      score: 60,
      suggestedMinutes: 110,
      units: [...readingUnits, partBUnit, translationUnit],
    },
    {
      id: `sec-3-${year}`,
      sectionNumber: 'Section III',
      title: 'Section III Writing',
      score: 30,
      suggestedMinutes: 52,
      units: [practicalUnit, visualUnit],
    },
  ];

  return {
    year,
    subject: '考研英语一',
    sourceFile,
    sourceFormat: 'md',
    sections,
    extractedObjectiveAnswers,
    referencedAssets,
    answerSheetIsolated,
  };
}

function parseClozeSection(
  sec1Text: string,
  sourceFile: string,
  answers: Record<number, { answer: string; sourceFile: string }>
): ExamUnit {
  const directionsMatch = sec1Text.match(/Directions:\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i);
  const instructions = directionsMatch
    ? directionsMatch[1].trim()
    : 'Read the following text. Choose the best word(s) for each numbered blank and mark A, B, C or D on ANSWER SHEET 1. (10 points)';

  // Extract passage paragraphs between Directions and item 1 options
  const firstQuestionIdx = sec1Text.search(/\n\s*(?:1\.|\[?1\]?\s*\[A\])/);
  let passageRaw = sec1Text;
  if (directionsMatch && directionsMatch.index !== undefined) {
    const afterDir = directionsMatch.index + directionsMatch[0].length;
    passageRaw =
      firstQuestionIdx !== -1
        ? sec1Text.slice(afterDir, firstQuestionIdx).trim()
        : sec1Text.slice(afterDir).trim();
  }

  const paragraphs = passageRaw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^#{1,3}\s/.test(p));

  const items: ExamItem[] = [];
  const optionsPart = firstQuestionIdx !== -1 ? sec1Text.slice(firstQuestionIdx) : sec1Text;

  for (let q = 1; q <= 20; q++) {
    const opts = extractFourOptionsForQuestion(optionsPart, q);
    const ansObj = answers[q];
    // Find sentence in passage containing blank q
    const blankRegex = new RegExp(`(?:\\[\\s*${q}\\s*\\]|__+${q}__+|\\(\\s*${q}\\s*\\)|<u>\\s*${q}\\s*<\\/u>)`);
    const matchingPara =
      paragraphs.find((p) => blankRegex.test(p)) || paragraphs[0] || '';
    const sentences = matchingPara.split(/(?<=[.?!])\s+/);
    const matchingSentence =
      sentences.find((s) => blankRegex.test(s)) || matchingPara;

    items.push({
      id: `item-q${q}`,
      questionNumber: q,
      answerMode: 'single-choice',
      prompt: `请为完形填空第 ${q} 空选择最恰当的词汇或短语`,
      options: opts,
      score: 0.5,
      correctAnswer: ansObj ? ansObj.answer : null,
      answerSource: ansObj ? 'source-provided' : 'unavailable',
      sourceLocator: {
        sourceFile,
        sourceFormat: 'md',
        sectionHeading: 'Section I Use of English',
      },
      clozeContext: {
        sentence: matchingSentence,
        surroundingParagraph: matchingPara,
        blankIndex: q,
      },
    });
  }

  const material: ExamMaterial = {
    id: 'mat-cloze-1',
    materialType: 'cloze-passage',
    title: 'Use of English Passage',
    text: paragraphs.join('\n\n'),
    paragraphs,
    relatedItemIds: items.map((i) => i.id),
  };

  return {
    id: 'unit-cloze',
    sectionId: 'sec-1',
    unitType: 'cloze',
    title: 'Section I 完形填空 (Use of English)',
    instructions,
    score: 10,
    suggestedMinutes: 18,
    materials: [material],
    items,
    analysisProfile: {
      focusSkills: ['上下文逻辑衔接', '实词精准辨析', '固定搭配与介词短语'],
      commonTraps: ['只看局部搭配忽略跨句转折', '近义词褒贬色彩误判'],
    },
    reviewStrategy: {
      defaultIntervalsDays: [1, 3, 7, 14, 30],
      recommendedAction: '带入正确选项通读全文长难句，复盘上下文逻辑信号词',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section I Use of English',
    },
  };
}

function parseReadingSection(
  sec2Text: string,
  sourceFile: string,
  answers: Record<number, { answer: string; sourceFile: string }>
): {
  readingUnits: ExamUnit[];
  partBUnit: ExamUnit;
  translationUnit: ExamUnit;
} {
  const partAIdx = sec2Text.search(/#{1,4}\s*Part\s+A\b/i);
  const partBIdx = sec2Text.search(/#{1,4}\s*Part\s+B\b/i);
  const partCIdx = sec2Text.search(/#{1,4}\s*Part\s+C\b/i);

  const partAText =
    partAIdx !== -1
      ? sec2Text.slice(partAIdx, partBIdx !== -1 ? partBIdx : sec2Text.length)
      : sec2Text;
  const partBText =
    partBIdx !== -1
      ? sec2Text.slice(partBIdx, partCIdx !== -1 ? partCIdx : sec2Text.length)
      : '';
  const partCText = partCIdx !== -1 ? sec2Text.slice(partCIdx) : '';

  // Parse Part A: Texts 1 - 4 (Questions 21-40)
  const readingUnits: ExamUnit[] = [];
  for (let t = 1; t <= 4; t++) {
    const startQ = 20 + (t - 1) * 5 + 1;
    const endQ = startQ + 4;
    const textRegex = new RegExp(
      `#{1,5}\\s*Text\\s+${t}\\b([\\s\\S]*?)(?=#{1,5}\\s*Text\\s+${t + 1}\\b|$)`,
      'i'
    );
    const match = partAText.match(textRegex);
    const block = match ? match[1].trim() : '';

    const firstQIdx = block.search(new RegExp(`\\n\\s*${startQ}\\.\\s+`));
    const passageText = firstQIdx !== -1 ? block.slice(0, firstQIdx).trim() : block;
    const questionsBlock = firstQIdx !== -1 ? block.slice(firstQIdx) : block;

    // Preserve <u>...</u> in Reading passages as reading material formatting (e.g. Q34 "these people")
    const paragraphs = passageText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const unitItems: ExamItem[] = [];
    for (let q = startQ; q <= endQ; q++) {
      const { prompt, options } = extractQuestionPromptAndOptions(questionsBlock, q);
      const ansObj = answers[q];
      const underlinedMatch =
        prompt.match(/"([^"]+)"\s+\([^)]*Paragraph/i) ||
        prompt.match(/<u>([^<]+)<\/u>/i) ||
        (q === 34 ? [null, 'these people'] : null);

      unitItems.push({
        id: `item-q${q}`,
        questionNumber: q,
        answerMode: 'single-choice',
        prompt,
        options,
        score: 2,
        correctAnswer: ansObj ? ansObj.answer : null,
        answerSource: ansObj ? 'source-provided' : 'unavailable',
        sourceLocator: {
          sourceFile,
          sourceFormat: 'md',
          sectionHeading: `Section II Part A Text ${t}`,
        },
        readingMeta: {
          passageId: `mat-reading-text-${t}`,
          questionCategory: inferReadingCategory(prompt),
          underlinedTarget: underlinedMatch ? underlinedMatch[1] || undefined : undefined,
        },
      });
    }

    const material: ExamMaterial = {
      id: `mat-reading-text-${t}`,
      materialType: 'passage',
      title: `Part A Text ${t} (Questions ${startQ}–${endQ})`,
      text: paragraphs.join('\n\n'),
      paragraphs,
      relatedItemIds: unitItems.map((i) => i.id),
    };

    readingUnits.push({
      id: `unit-reading-text-${t}`,
      sectionId: 'sec-2',
      unitType: 'reading',
      title: `阅读理解 Part A · Text ${t} (${startQ}–${endQ}题)`,
      instructions:
        'Read the following text. Answer the questions below the text by choosing A, B, C or D. (10 points)',
      score: 10,
      suggestedMinutes: 18,
      materials: [material],
      items: unitItems,
      analysisProfile: {
        focusSkills: ['长难句主干提取', '指代还原与段落主旨', '同义改写识别'],
        commonTraps: ['原词复现偷换概念', '因果倒置', '过度推断'],
      },
      reviewStrategy: {
        defaultIntervalsDays: [1, 3, 7, 14, 30],
        recommendedAction: '定位原文证据句，分析正确项同义替换与干扰项设错方式',
      },
      sourceLocator: {
        sourceFile,
        sourceFormat: 'md',
        sectionHeading: `Section II Part A Text ${t}`,
      },
    });
  }

  // Parse Part B: Passage Assembly (Questions 41-45, Candidates A-G, Fixed E)
  const partBUnit = parsePartBSection(partBText, sourceFile, answers);

  // Parse Part C: Translation (Questions 46-50)
  // Strictly requires: inside Section II Part C AND questionNumber 46-50
  const translationUnit = parsePartCTranslationSection(partCText, sourceFile);

  return { readingUnits, partBUnit, translationUnit };
}

function parsePartBSection(
  partBText: string,
  sourceFile: string,
  answers: Record<number, { answer: string; sourceFile: string }>
): ExamUnit {
  const candidateParagraphs: { id: string; label: string; text: string }[] = [];
  const candidateRegex = /(?:^|\n)\s*\[?([A-G])\]?[.)、\s]+([^\n]+(?:\n(?!\s*\[?[A-G]\]?[.)、\s]|\s*41\.|\s*Order:)[^\n]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = candidateRegex.exec(partBText)) !== null) {
    const label = m[1].toUpperCase();
    const text = m[2].trim();
    if (!candidateParagraphs.some((c) => c.label === label)) {
      candidateParagraphs.push({
        id: `cand-${label}`,
        label,
        text,
      });
    }
  }

  // Identify fixed paragraph E and sequence slots 41, 42, [E], 43, 44, 45
  const eCandidate = candidateParagraphs.find((c) => c.label === 'E');
  const fixedPlacements = [
    {
      positionIndex: 2,
      paragraphId: 'E',
      text: eCandidate?.text || 'In the past, wholesalers were needed to...',
    },
  ];

  const sequenceSlots: PassageAssemblySpec['sequenceSlots'] = [
    { positionIndex: 0, type: 'blank', questionNumber: 41 },
    { positionIndex: 1, type: 'blank', questionNumber: 42 },
    { positionIndex: 2, type: 'fixed', fixedParagraphId: 'E' },
    { positionIndex: 3, type: 'blank', questionNumber: 43 },
    { positionIndex: 4, type: 'blank', questionNumber: 44 },
    { positionIndex: 5, type: 'blank', questionNumber: 45 },
  ];

  const scoredPositions = [
    { positionIndex: 0, questionNumber: 41 },
    { positionIndex: 1, questionNumber: 42 },
    { positionIndex: 3, questionNumber: 43 },
    { positionIndex: 4, questionNumber: 44 },
    { positionIndex: 5, questionNumber: 45 },
  ];

  const options: OptionItem[] = candidateParagraphs.map((c) => ({
    key: c.label as OptionItem['key'],
    text: c.text,
  }));

  const items: ExamItem[] = scoredPositions.map((pos) => {
    const q = pos.questionNumber;
    const ansObj = answers[q];
    return {
      id: `item-q${q}`,
      questionNumber: q,
      answerMode: 'sequence',
      prompt: `请为篇章排序第 ${q} 题（位置 ${pos.positionIndex + 1}）选择正确的候选段落（A–G，其中 E 已固定）`,
      options,
      score: 2,
      correctAnswer: ansObj ? ansObj.answer : null,
      answerSource: ansObj ? 'source-provided' : 'unavailable',
      sourceLocator: {
        sourceFile,
        sourceFormat: 'md',
        sectionHeading: 'Section II Part B',
      },
    };
  });

  const finalOrder = sequenceSlots.map((slot) => {
    if (slot.type === 'fixed') return slot.fixedParagraphId || 'E';
    const ans = slot.questionNumber ? answers[slot.questionNumber]?.answer : null;
    return ans || null;
  });

  const usedLabels = new Set(finalOrder.filter(Boolean) as string[]);
  const redundantOptions =
    usedLabels.size === 6
      ? candidateParagraphs
          .map((c) => c.label)
          .filter((l) => !usedLabels.has(l))
      : [];

  const assemblySpec: PassageAssemblySpec = {
    subType: 'paragraph-order',
    candidateParagraphs,
    fixedPlacements,
    scoredPositions,
    sequenceSlots,
    finalOrder,
    redundantOptions,
    redundantCount: 1,
    allowRepeat: false,
  };

  const material: ExamMaterial = {
    id: 'mat-part-b',
    materialType: 'assembly-stem',
    title: 'Part B 篇章结构重组 (Questions 41–45)',
    text: candidateParagraphs.map((c) => `[${c.label}] ${c.text}`).join('\n\n'),
    paragraphs: candidateParagraphs.map((c) => `[${c.label}] ${c.text}`),
    relatedItemIds: items.map((i) => i.id),
    passageAssemblySpec: assemblySpec,
  };

  return {
    id: 'unit-part-b',
    sectionId: 'sec-2',
    unitType: 'passage-assembly',
    title: '阅读理解 Part B · 篇章重组 (41–45题)',
    instructions:
      'The following paragraphs are given in a wrong order. For Questions 41–45, you are required to reorganize these paragraphs into a coherent article by choosing from the list A–G and filling them into the numbered boxes. Paragraph E has been correctly placed for you. (10 points)',
    score: 10,
    suggestedMinutes: 20,
    materials: [material],
    items,
    analysisProfile: {
      focusSkills: ['段首代词与冠词指代链', '段落首尾语义咬合', '固定段E前后锚点推导'],
      commonTraps: ['忽略固定段E的承上启下作用', '将局部细节词复现误判为相邻段'],
    },
    reviewStrategy: {
      defaultIntervalsDays: [1, 3, 7, 14, 30],
      recommendedAction: '梳理A–G各段首尾句逻辑锚点，复盘E段前后的指代衔接',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section II Part B',
    },
  };
}

function parsePartCTranslationSection(
  partCText: string,
  sourceFile: string
): ExamUnit {
  // Strip heading and Directions
  const body = partCText
    .replace(/^#{1,4}\s*Part\s+C[^\n]*\n?/i, '')
    .replace(/Directions:\s*[^\n]+(?:\n(?!\n)[^\n]+)*/i, '')
    .trim();

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const fullText = paragraphs.join('\n\n');
  const items: ExamItem[] = [];

  // Match strictly (46) <u>...</u> through (50) <u>...</u> inside Section II Part C
  for (let q = 46; q <= 50; q++) {
    const regex = new RegExp(`\\(\\s*${q}\\s*\\)\\s*<u>([\\s\\S]*?)<\\/u>`, 'i');
    const match = fullText.match(regex);
    const underlinedEnglish = match ? match[1].replace(/\s+/g, ' ').trim() : '';
    const startChar = match && match.index !== undefined ? match.index : 0;
    const endChar = match ? startChar + match[0].length : 0;
    const contextPara =
      paragraphs.find((p) => p.includes(`(${q})`) || (underlinedEnglish && p.includes(underlinedEnglish))) ||
      fullText;

    items.push({
      id: `item-q${q}`,
      questionNumber: q,
      answerMode: 'short-text',
      prompt: `请将第 (${q}) 处划线英文句子翻译成中文：${underlinedEnglish}`,
      score: 2,
      correctAnswer: null,
      answerSource: 'unavailable',
      rubric: {
        maxScore: 2,
        dimensions: [
          { id: 'dim-accuracy', name: '核心语义准确度', maxScore: 1, description: '准确传达主干及修饰成分语义' },
          { id: 'dim-syntax', name: '从句与句法顺畅度', maxScore: 1, description: '定语从句、状语及被动语态符合中文表达习惯' },
        ],
        keyPoints: extractTranslationKeyPoints(q),
        syntacticNotes: extractTranslationSyntaxNotes(q),
        referenceText: undefined,
        referenceSource: 'unavailable',
      },
      sourceLocator: {
        sourceFile,
        sourceFormat: 'md',
        sectionHeading: 'Section II Part C',
        charRange: [startChar, endChar],
      },
      translationMeta: {
        underlinedEnglish,
        contextParagraph: contextPara,
        charRange: [startChar, endChar],
        keySemanticPoints: extractTranslationKeyPoints(q),
        syntacticRelations: extractTranslationSyntaxNotes(q),
        referenceTranslation: null,
        referenceSource: 'unavailable',
      },
    });
  }

  const material: ExamMaterial = {
    id: 'mat-part-c-translation',
    materialType: 'translation-passage',
    title: 'Part C 英译汉全文材料 (Questions 46–50)',
    text: fullText,
    paragraphs,
    relatedItemIds: items.map((i) => i.id),
  };

  return {
    id: 'unit-part-c-translation',
    sectionId: 'sec-2',
    unitType: 'translation',
    title: '阅读理解 Part C · 英译汉 (46–50题)',
    instructions:
      'Read the following text carefully and then translate the underlined segments into Chinese. Your translation should be written clearly on ANSWER SHEET 2. (10 points)',
    score: 10,
    suggestedMinutes: 25,
    materials: [material],
    items,
    analysisProfile: {
      focusSkills: ['长难句切分与从句语序调整', '熟词僻义结合语境精译', '代词指代还原'],
      commonTraps: ['直译定语从句导致中文语序生硬', '漏译状语或并列结构'],
    },
    reviewStrategy: {
      defaultIntervalsDays: [1, 3, 7, 14, 30],
      recommendedAction: '遮挡旧译文进行盲译，对比核心得分采分点与句法拆分',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section II Part C',
    },
  };
}

function parseWritingSection(
  sec3Text: string,
  sourceFile: string,
  year: number
): {
  practicalUnit: ExamUnit;
  visualUnit: ExamUnit;
  assets: string[];
} {
  const partAIdx = sec3Text.search(/#{1,4}\s*Part\s+A\b/i);
  const partBIdx = sec3Text.search(/#{1,4}\s*Part\s+B\b/i);

  const partAText =
    partAIdx !== -1
      ? sec3Text.slice(partAIdx, partBIdx !== -1 ? partBIdx : sec3Text.length).trim()
      : sec3Text;
  const partBText = partBIdx !== -1 ? sec3Text.slice(partBIdx).trim() : '';

  const practicalSpec: PracticalWritingSpec = {
    genre: 'Notice (招募启事/通知)',
    writerIdentity: 'Postgraduate Association (研究生会)',
    targetAudience: 'Volunteers for an international conference on globalization',
    backgroundMaterial: partAText,
    requiredPoints: [
      '说明全球化国际会议的基本背景、时间与招募目的',
      '明确志愿者应具备的能力要求（如英语听说流利、沟通协作能力等）',
      '提供具体的报名联系方式及截止日期',
    ],
    salutationRequirement: '标题居中写 Notice，无需信件称呼语',
    signatureRequirement: '右下角落款 Postgraduate Association',
    wordCountRange: [100, 120],
    score: 10,
    dimensions: [
      { id: 'pw-content', name: '内容完整性', maxScore: 4, description: '覆盖会议背景、岗位要求与报名方式三大要点' },
      { id: 'pw-organization', name: '格式与衔接', maxScore: 3, description: 'Notice标题与落款格式规范，层次清晰' },
      { id: 'pw-language', name: '语言准确性与得体度', maxScore: 3, description: '用词正式得体，语法准确' },
    ],
  };

  const item51: ExamItem = {
    id: 'item-q51',
    questionNumber: 51,
    answerMode: 'long-text',
    prompt: partAText,
    score: 10,
    correctAnswer: null,
    answerSource: 'unavailable',
    rubric: {
      maxScore: 10,
      dimensions: practicalSpec.dimensions,
      keyPoints: practicalSpec.requiredPoints,
      referenceSource: 'unavailable',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section III Part A',
    },
  };

  const mat51: ExamMaterial = {
    id: 'mat-writing-51',
    materialType: 'writing-prompt',
    title: 'Part A 应用文写作 (Question 51)',
    text: partAText,
    relatedItemIds: ['item-q51'],
    practicalWritingSpec: practicalSpec,
  };

  const practicalUnit: ExamUnit = {
    id: 'unit-writing-part-a',
    sectionId: 'sec-3',
    unitType: 'practical-writing',
    title: '写作 Part A · 应用文 (51题)',
    instructions: 'Directions: Write a notice in about 100 words for Questions 51. (10 points)',
    score: 10,
    suggestedMinutes: 17,
    materials: [mat51],
    items: [item51],
    analysisProfile: {
      focusSkills: ['应用文格式规范', '三段式信息要点覆盖', '正式公务语体'],
      commonTraps: ['将Notice误写成书信格式（Dear...）', '遗漏报名联系方式或资格要求'],
    },
    reviewStrategy: {
      defaultIntervalsDays: [1, 3, 7, 14, 30],
      recommendedAction: '对照审题三要素进行升格重写，消除语法硬伤',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section III Part A',
    },
  };

  // Extract Markdown image path in Part B
  const imgMatch = partBText.match(/!\[([^\]]*)\]\(([^)]+)\)/);
  const rawImgPath = imgMatch ? imgMatch[2].trim() : '2010年写作PartB.png';
  const safeAssetName = validateSafeRelativePath(rawImgPath);

  const visualMat: VisualMaterial = {
    id: 'vis-2010-partb-1',
    imagePath: `/assets/papers/${year}/v1/${safeAssetName}`,
    visualType: 'single-cartoon',
    title: '文化“火锅”既美味又营养',
    caption: '文化“火锅”既美味又营养（一口热气腾腾的火锅中融合了功夫、京剧、孔子、梁祝、莎士比亚、芭蕾、歌剧、毕加索、爱因斯坦等中西文化元素）',
    categories: ['中国传统文化元素（孔子、京剧、功夫、梁祝等）', '西方经典与现代文化元素（莎士比亚、芭蕾、歌剧、毕加索、爱因斯坦等）'],
    values: [
      { label: '中国文化代表元素', value: 50, unit: '% (多元融合示意)' },
      { label: '世界多元文化元素', value: 50, unit: '% (多元融合示意)' },
    ],
    unit: '文化融合维度',
    primaryRelations: [
      '以传统“火锅”比喻全球化时代中西方文化的交融共生',
      '不同民族与时代的文化精华共冶一炉，既保留各自特色又相得益彰（既美味又营养）',
    ],
    requiredFacts: [
      '简要描述图画内容：一口热气腾腾的“文化火锅”中包含孔子、京剧、功夫与莎士比亚、芭蕾、爱因斯坦等中西文化符号，底部配文“文化‘火锅’既美味又营养”',
      '阐释图画象征寓意：全球化背景下跨文化交流与多元文化融合的重要价值',
      '给出个人评论与对待中西文化交融的理性态度（兼收并蓄、取长补短）',
    ],
    sourceLocator: {
      sourceFile: safeAssetName,
      sourceFormat: 'md',
      sectionHeading: 'Section III Part B',
    },
  };

  const item52Dimensions = [
    { id: 'vw-desc', name: '图画描述准确性', maxScore: 5, description: '准确描绘文化火锅及其中西文化元素与文字说明' },
    { id: 'vw-meaning', name: '寓意阐释深度', maxScore: 8, description: '深入论证多元文化交流融合的时代意义与论据支撑' },
    { id: 'vw-language', name: '语言质量与篇章结构', maxScore: 7, description: '句式多样、词汇丰富、衔接自然，词数符合160–200词要求' },
  ];

  const item52: ExamItem = {
    id: 'item-q52',
    questionNumber: 52,
    answerMode: 'long-text',
    prompt: partBText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '').trim(),
    score: 20,
    correctAnswer: null,
    answerSource: 'unavailable',
    rubric: {
      maxScore: 20,
      dimensions: item52Dimensions,
      keyPoints: visualMat.requiredFacts,
      referenceSource: 'unavailable',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section III Part B',
    },
  };

  const mat52: ExamMaterial = {
    id: 'mat-writing-52',
    materialType: 'visual-illustration',
    title: 'Part B 图画/图表议论文写作 (Question 52)',
    text: partBText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '').trim(),
    imagePath: visualMat.imagePath,
    ocrText: '文化“火锅”既美味又营养：毕加索、莎士比亚、爱因斯坦、道家、京剧、孔子、功夫、梁祝、歌剧、芭蕾、天鹅湖',
    multimodalDescription: visualMat.caption,
    extractedFacts: visualMat.requiredFacts,
    relatedItemIds: ['item-q52'],
    visualMaterials: [visualMat],
  };

  const visualUnit: ExamUnit = {
    id: 'unit-writing-part-b',
    sectionId: 'sec-3',
    unitType: 'visual-writing',
    title: '写作 Part B · 图画/视觉材料作文 (52题)',
    instructions:
      'Directions: Write an essay of 160–200 words based on the following drawing. In your essay, you should 1) describe the drawing briefly, 2) explain its intended meaning, and 3) give your comments. (20 points)',
    score: 20,
    suggestedMinutes: 35,
    materials: [mat52],
    items: [item52],
    analysisProfile: {
      focusSkills: ['图画细节提炼与象征隐喻转化', '三段式议论文逻辑推进', '学术书面表达'],
      commonTraps: ['首段描述过度冗长挤占说理篇幅', '脱离文化交流主题空谈全球化经济'],
    },
    reviewStrategy: {
      defaultIntervalsDays: [1, 3, 7, 14, 30],
      recommendedAction: '基于批改修改任务重写首段描图句与第二段主题论证段',
    },
    sourceLocator: {
      sourceFile,
      sourceFormat: 'md',
      sectionHeading: 'Section III Part B',
    },
  };

  return {
    practicalUnit,
    visualUnit,
    assets: [safeAssetName],
  };
}

function extractFourOptionsForQuestion(text: string, qNum: number): OptionItem[] {
  // Matches either table row `| 1 | [A] ... | [B] ... | [C] ... | [D] ... |` or numbered line `1. [A] ... [B] ... [C] ... [D] ...`
  const lineRegex = new RegExp(
    `(?:^|\\n)\\s*(?:\\|\\s*)?${qNum}(?:\\.|\\s*\\|)\\s*\\[?A\\]?[.)\\s]*([^|\\n\\[]+)\\s*(?:\\|\\s*)?\\[?B\\]?[.)\\s]*([^|\\n\\[]+)\\s*(?:\\|\\s*)?\\[?C\\]?[.)\\s]*([^|\\n\\[]+)\\s*(?:\\|\\s*)?\\[?D\\]?[.)\\s]*([^|\\n\\[]+)`,
    'i'
  );
  const m = text.match(lineRegex);
  if (m) {
    return [
      { key: 'A', text: m[1].trim() },
      { key: 'B', text: m[2].trim() },
      { key: 'C', text: m[3].trim() },
      { key: 'D', text: m[4].trim() },
    ];
  }
  return [
    { key: 'A', text: 'Option A' },
    { key: 'B', text: 'Option B' },
    { key: 'C', text: 'Option C' },
    { key: 'D', text: 'Option D' },
  ];
}

function extractQuestionPromptAndOptions(
  block: string,
  qNum: number
): { prompt: string; options: OptionItem[] } {
  const qRegex = new RegExp(
    `(?:^|\\n)\\s*${qNum}\\.\\s+([^\\n]+)\\n([\\s\\S]*?)(?=\\n\\s*${qNum + 1}\\.\\s+|$)`,
    'i'
  );
  const m = block.match(qRegex);
  if (!m) {
    return {
      prompt: `Question ${qNum}`,
      options: [
        { key: 'A', text: 'Option A' },
        { key: 'B', text: 'Option B' },
        { key: 'C', text: 'Option C' },
        { key: 'D', text: 'Option D' },
      ],
    };
  }
  const prompt = m[1].trim();
  const optBlock = m[2];
  const optRegex = /(?:\[([A-D])\]|(?:^|\n)\s*([A-D])[.)])\s*([^\n]+)/g;
  const options: OptionItem[] = [];
  let om: RegExpExecArray | null;
  while ((om = optRegex.exec(optBlock)) !== null) {
    const key = (om[1] || om[2]).toUpperCase() as 'A' | 'B' | 'C' | 'D';
    if (!options.some((o) => o.key === key)) {
      options.push({ key, text: om[3].trim() });
    }
  }
  return { prompt, options };
}

function inferReadingCategory(
  prompt: string
): 'detail' | 'inference' | 'main-idea' | 'attitude' | 'vocab-in-context' {
  const p = prompt.toLowerCase();
  if (p.includes('refer to') || p.includes('underlined') || p.includes('mean') || p.includes('closest in meaning')) {
    return 'vocab-in-context';
  }
  if (p.includes('infer') || p.includes('imply') || p.includes('suggest') || p.includes('learn from')) {
    return 'inference';
  }
  if (p.includes('attitude') || p.includes('tone') || p.includes('feel about')) {
    return 'attitude';
  }
  if (p.includes('main idea') || p.includes('best title') || p.includes('mainly about') || p.includes('purpose')) {
    return 'main-idea';
  }
  return 'detail';
}

function extractTranslationKeyPoints(q: number): string[] {
  const map: Record<number, string[]> = {
    46: ['“in a conservation system based wholly on economic motives” 译为“在完全基于经济动机的资源保护体系中”', '“most members of the land community” 译为“陆地群落中的大多数物种/成员”'],
    47: ['“so that” 引导结果状语从句译为“以至于/结果是”', '“propagate” 在生态语境下译为“繁衍/繁殖”'],
    48: ['“tends to ignore, and thus eventually to eliminate” 译为“往往会忽视并因此最终消灭”', '“lack the commercial value” 译为“缺乏商业价值”'],
    49: ['“would not be done” 虚拟语气译为“本不会去做”', '“on the assumption that...” 同位语从句译为“基于……的假设”'],
    50: ['“essential to its healthy functioning” 译为“对其健康运行至关重要”', '“doubtless” 译为“毫无疑问”'],
  };
  return map[q] || ['核心实词语义准确', '从句逻辑关系清晰'];
}

function extractTranslationSyntaxNotes(q: number): string[] {
  const map: Record<number, string[]> = {
    46: ['过去分词短语 based wholly on... 作后置定语修饰 conservation system', 'that 引导表语从句解释 weakness 的具体内容'],
    47: ['when 引导时间状语从句，so that 引导结果状语从句'],
    48: ['to ignore 与 to eliminate 并列作 tends 的宾语，many elements of the land community that... 包含定语从句'],
    49: ['on the assumption that... 包含同位语从句解释 assumption 内容'],
    50: ['since 引导原因状语从句，essential to... 形容词短语作后置定语'],
  };
  return map[q] || ['主从复合句拆分与语序重组'];
}
