/**
 * Canonical subject metadata registry and paper identity resolution.
 * Replaces magic pseudo-year (2101..2108) checks across the codebase with
 * explicit SubjectId and PaperIdentity mappings while remaining compatible
 * with legacy numeric year identifiers.
 */

export type SubjectId = 'english-i' | 'politics';

export type ExamSubject = '考研英语一' | '考研政治';

export type UnitType =
  | 'cloze'
  | 'reading'
  | 'passage-assembly'
  | 'translation'
  | 'practical-writing'
  | 'visual-writing'
  | 'politics-single'
  | 'politics-multi'
  | 'politics-analysis';

export type SubjectiveUnitType =
  | 'translation'
  | 'practical-writing'
  | 'visual-writing'
  | 'politics-analysis';

export interface SubjectDescriptor {
  id: SubjectId;
  subjectLabel: ExamSubject;
  name: string;
  shortName: string;
  defaultDurationMinutes: number;
  totalScore: number;
  objectiveMaxScore: number;
  subjectiveMaxScore: number;
  expectedQuestionCount: number;
  unitTypes: UnitType[];
  subjectiveUnitTypes: SubjectiveUnitType[];
}

export const SUBJECT_REGISTRY: Record<SubjectId, SubjectDescriptor> = {
  'english-i': {
    id: 'english-i',
    subjectLabel: '考研英语一',
    name: '考研英语（一）历年真题',
    shortName: '英语一',
    defaultDurationMinutes: 180,
    totalScore: 100,
    objectiveMaxScore: 60,
    subjectiveMaxScore: 40,
    expectedQuestionCount: 52,
    unitTypes: [
      'cloze',
      'reading',
      'passage-assembly',
      'translation',
      'practical-writing',
      'visual-writing',
    ],
    subjectiveUnitTypes: ['translation', 'practical-writing', 'visual-writing'],
  },
  politics: {
    id: 'politics',
    subjectLabel: '考研政治',
    name: '考研政治冲刺模拟卷',
    shortName: '政治',
    defaultDurationMinutes: 180,
    totalScore: 100,
    objectiveMaxScore: 50,
    subjectiveMaxScore: 50,
    expectedQuestionCount: 38,
    unitTypes: ['politics-single', 'politics-multi', 'politics-analysis'],
    subjectiveUnitTypes: ['politics-analysis'],
  },
};

export interface PaperIdentity {
  paperId: string;
  legacyYear: number;
  subjectId: SubjectId;
  examYear: number;
  seriesCode: 'real-exam' | 'xiao8';
  setNumber?: number;
  title: string;
  shortTitle: string;
  badgeLabel: string;
}

const CHINESE_SET_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八'];
const SUBJECTIVE_UNIT_SET = new Set<UnitType>([
  'translation',
  'practical-writing',
  'visual-writing',
  'politics-analysis',
]);

export function isSubjectiveUnitType(unitType: UnitType): unitType is SubjectiveUnitType {
  return SUBJECTIVE_UNIT_SET.has(unitType);
}

export function isPoliticsExamYear(year: number): boolean {
  return year >= 2101 && year <= 2199;
}

export function getPoliticsSetNumber(year: number): number {
  return isPoliticsExamYear(year) ? year - 2100 : 1;
}

/** Map legacy year (2010..2026, 2101..2108) or paperId to canonical paperId. */
export function resolveCanonicalPaperId(
  yearOrPaperId: number | string,
  explicitPaperId?: string
): string {
  if (explicitPaperId && explicitPaperId.trim()) {
    return resolveCanonicalPaperId(explicitPaperId.trim());
  }
  if (typeof yearOrPaperId === 'string') {
    const trimmed = yearOrPaperId.trim();
    if (/^(en1|pol)-/.test(trimmed)) {
      return trimmed;
    }
    if (/^\d{4}$/.test(trimmed)) {
      return resolveCanonicalPaperId(Number(trimmed));
    }
    return trimmed;
  }

  if (isPoliticsExamYear(yearOrPaperId)) {
    const setNo = String(yearOrPaperId - 2100).padStart(2, '0');
    return `pol-2027-xiao8-${setNo}`;
  }
  return `en1-${yearOrPaperId}`;
}

/** Map canonical paperId or numeric year back to legacy integer year key. */
export function resolveLegacyYearFromPaperId(paperIdOrYear: string | number): number {
  if (typeof paperIdOrYear === 'number') {
    return paperIdOrYear;
  }
  const trimmed = paperIdOrYear.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const polMatch = /^pol-\d+-xiao8-(\d+)$/i.exec(trimmed);
  if (polMatch) {
    return 2100 + Number(polMatch[1]);
  }
  const enMatch = /^en1-(\d+)$/i.exec(trimmed);
  if (enMatch) {
    return Number(enMatch[1]);
  }
  const trailingNum = /(\d{4})$/.exec(trimmed);
  return trailingNum ? Number(trailingNum[1]) : 0;
}

export function resolveSubjectId(
  paperIdOrYear: string | number,
  explicitSubjectId?: SubjectId
): SubjectId {
  if (explicitSubjectId) {
    return explicitSubjectId;
  }
  if (typeof paperIdOrYear === 'string') {
    const trimmed = paperIdOrYear.trim();
    if (trimmed.startsWith('pol-')) {
      return 'politics';
    }
    if (trimmed.startsWith('en1-')) {
      return 'english-i';
    }
    if (/^\d+$/.test(trimmed)) {
      return isPoliticsExamYear(Number(trimmed)) ? 'politics' : 'english-i';
    }
    return 'english-i';
  }
  return isPoliticsExamYear(paperIdOrYear) ? 'politics' : 'english-i';
}

export function resolveSubjectLabel(paperIdOrYear: string | number): ExamSubject {
  return SUBJECT_REGISTRY[resolveSubjectId(paperIdOrYear)].subjectLabel;
}

export function getSubjectDescriptor(
  subjectIdOrPaper: SubjectId | string | number
): SubjectDescriptor {
  if (subjectIdOrPaper === 'english-i' || subjectIdOrPaper === 'politics') {
    return SUBJECT_REGISTRY[subjectIdOrPaper];
  }
  return SUBJECT_REGISTRY[resolveSubjectId(subjectIdOrPaper)];
}

export function formatExamTitle(
  yearOrPaperId: number | string,
  modeOrSubject: 'full' | 'short' | ExamSubject | string = 'full'
): string {
  const mode = modeOrSubject === 'short' ? 'short' : 'full';
  const paperId = resolveCanonicalPaperId(yearOrPaperId);
  const subjectId = resolveSubjectId(paperId);
  const legacyYear = resolveLegacyYearFromPaperId(paperId);

  if (subjectId === 'politics') {
    const idx = Math.max(0, legacyYear - 2101);
    const cn = CHINESE_SET_NUMERALS[idx] || String(idx + 1);
    return mode === 'short'
      ? `27肖八·卷${cn}`
      : `2027 考研政治冲刺 8 套卷（${cn}）`;
  }

  return mode === 'short' ? `${legacyYear}年 英语一` : `${legacyYear}年 考研英语一`;
}

export function buildPaperIdentity(
  yearOrPaperId: number | string,
  customTitle?: string
): PaperIdentity {
  const paperId = resolveCanonicalPaperId(yearOrPaperId);
  const subjectId = resolveSubjectId(paperId);
  const legacyYear = resolveLegacyYearFromPaperId(paperId);

  if (subjectId === 'politics') {
    const setNumber = Math.max(1, legacyYear - 2100);
    const title = customTitle || formatExamTitle(paperId, 'full');
    const shortTitle = formatExamTitle(paperId, 'short');
    return {
      paperId,
      legacyYear,
      subjectId,
      examYear: 2027,
      seriesCode: 'xiao8',
      setNumber,
      title,
      shortTitle,
      badgeLabel: `2027 肖八第${setNumber}套`,
    };
  }

  const title = customTitle || formatExamTitle(paperId, 'full');
  const shortTitle = formatExamTitle(paperId, 'short');
  return {
    paperId,
    legacyYear,
    subjectId,
    examYear: legacyYear,
    seriesCode: 'real-exam',
    title,
    shortTitle,
    badgeLabel: `${legacyYear} 真题`,
  };
}
