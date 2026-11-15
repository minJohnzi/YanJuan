import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  Keyboard,
  ClipboardPaste,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RotateCcw,
  BookOpen,
  ArrowRight,
  HelpCircle,
  Eye,
  Check,
} from 'lucide-react';
import type {
  ConfidenceLevel,
  Exam,
  ExamItem,
  ObjectiveItemResponse,
  UnitType,
} from '../shared/types';
import { formatExamTitle, isPoliticsExamYear } from '../shared/types';
import {
  gradeObjectiveResponses,
  normalizeChoiceAnswer,
  type ObjectiveScoringSummary,
} from '../shared/scoringAndReview';

interface QuickAnswerCheckerModalProps {
  isOpen: boolean;
  onClose: () => void;
  exam: Exam;
  onConfirmApply: (responses: Record<number, ObjectiveItemResponse>) => void;
  initialResponses?: Record<number, ObjectiveItemResponse>;
}

type InputTab = 'keyboard' | 'paste';

const EMPTY_INITIAL_RESPONSES: Record<number, ObjectiveItemResponse> = {};

function getAllowedOptionKeys(item: ExamItem, unitType: UnitType): string[] {
  if (item.options && item.options.length > 0) {
    return item.options.map((o) => o.key.toUpperCase());
  }
  return unitType === 'passage-assembly'
    ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    : ['A', 'B', 'C', 'D'];
}

export function QuickAnswerCheckerModal({
  isOpen,
  onClose,
  exam,
  onConfirmApply,
  initialResponses = EMPTY_INITIAL_RESPONSES,
}: QuickAnswerCheckerModalProps) {
  // Current active tab
  const [activeTab, setActiveTab] = useState<InputTab>('keyboard');

  // Objective item definitions collected from exam units
  const objectiveItems = useMemo(() => {
    const list: {
      item: ExamItem;
      unitTitle: string;
      unitType: UnitType;
      unitId: string;
    }[] = [];
    for (const section of exam.sections) {
      for (const unit of section.units) {
        if (
          unit.unitType === 'politics-single' ||
          unit.unitType === 'politics-multi' ||
          unit.unitType === 'cloze' ||
          unit.unitType === 'reading' ||
          unit.unitType === 'passage-assembly'
        ) {
          for (const it of unit.items) {
            list.push({
              item: it,
              unitTitle: unit.title,
              unitType: unit.unitType as UnitType,
              unitId: unit.id,
            });
          }
        }
      }
    }
    return list.sort((a, b) => a.item.questionNumber - b.item.questionNumber);
  }, [exam]);

  // Working responses map: questionNumber -> string of uppercase letters
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const { item } of objectiveItems) {
      const qNum = item.questionNumber;
      if (initialResponses[qNum]?.selectedAnswer) {
        init[qNum] = normalizeChoiceAnswer(
          initialResponses[qNum].selectedAnswer,
          item.answerMode === 'multi-choice'
        );
      } else {
        init[qNum] = '';
      }
    }
    return init;
  });

  // Paste text state
  const [pasteText, setPasteText] = useState('');
  const [pasteReport, setPasteReport] = useState<string | null>(null);

  // Review & Grading state
  const [isGraded, setIsGraded] = useState(false);
  const [onlyShowMistakes, setOnlyShowMistakes] = useState(false);
  const [expandedQuestionNumber, setExpandedQuestionNumber] = useState<number | null>(null);

  // Input refs for keyboard auto-advance
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);

  // Question lookup
  const itemMap = useMemo(
    () => new Map(objectiveItems.map((o) => [o.item.questionNumber, o])),
    [objectiveItems]
  );

  // Group objective items into logical sections for rendering
  const singleChoiceItems = useMemo(
    () => objectiveItems.filter((o) => o.item.answerMode === 'single-choice'),
    [objectiveItems]
  );
  const multiChoiceItems = useMemo(
    () => objectiveItems.filter((o) => o.item.answerMode === 'multi-choice'),
    [objectiveItems]
  );

  // Focus navigation helpers
  const focusNext = (currentQNum: number) => {
    const currIdx = objectiveItems.findIndex(
      (o) => o.item.questionNumber === currentQNum
    );
    if (currIdx >= 0 && currIdx < objectiveItems.length - 1) {
      const nextQNum = objectiveItems[currIdx + 1].item.questionNumber;
      inputRefs.current[nextQNum]?.focus();
      inputRefs.current[nextQNum]?.select();
    }
  };

  const focusPrev = (currentQNum: number) => {
    const currIdx = objectiveItems.findIndex(
      (o) => o.item.questionNumber === currentQNum
    );
    if (currIdx > 0) {
      const prevQNum = objectiveItems[currIdx - 1].item.questionNumber;
      inputRefs.current[prevQNum]?.focus();
      inputRefs.current[prevQNum]?.select();
    }
  };

  const initializedKeyRef = useRef<string | null>(null);

  // Reset or initialize only when modal opens or exam changes (never reset mid-typing)
  useEffect(() => {
    if (!isOpen) {
      initializedKeyRef.current = null;
      return;
    }
    const initKey = `${exam.id}-${exam.dataVersion}`;
    if (initializedKeyRef.current === initKey) {
      return;
    }
    initializedKeyRef.current = initKey;

    const init: Record<number, string> = {};
    for (const { item } of objectiveItems) {
      const qNum = item.questionNumber;
      if (initialResponses[qNum]?.selectedAnswer) {
        init[qNum] = normalizeChoiceAnswer(
          initialResponses[qNum].selectedAnswer,
          item.answerMode === 'multi-choice'
        );
      } else {
        init[qNum] = '';
      }
    }
    setUserAnswers(init);
    setIsGraded(false);
    setPasteReport(null);
    setExpandedQuestionNumber(null);
    setOnlyShowMistakes(false);

    // Auto focus first question
    const timer = setTimeout(() => {
      if (objectiveItems[0]) {
        inputRefs.current[objectiveItems[0].item.questionNumber]?.focus();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [isOpen, exam.id, exam.dataVersion, initialResponses, objectiveItems]);

  // Global ESC key listener to close
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onClose]);

  // Scroll to top when grading is triggered
  useEffect(() => {
    if (isGraded && bodyScrollRef.current) {
      bodyScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [isGraded]);

  if (!isOpen) return null;

  // Calculate grading summary if in graded mode
  const gradeSummary: ObjectiveScoringSummary | null = isGraded
    ? (() => {
        const formattedResponses: Record<number, ObjectiveItemResponse> = {};
        for (const { item, unitId, unitType } of objectiveItems) {
          const qNum = item.questionNumber;
          const ans = userAnswers[qNum] || '';
          formattedResponses[qNum] = {
            questionNumber: qNum,
            itemId: item.id,
            unitId,
            unitType,
            selectedAnswer: ans,
            confidence: 'certain',
            flaggedForReview: false,
            timeSpentSeconds: 0,
            maxScore: item.score,
            knownErrorCauses: [],
            possibleErrorCauses: [],
            userNotes: '',
            highlights: [],
          };
        }
        try {
          return gradeObjectiveResponses(exam, formattedResponses);
        } catch (err) {
          console.error('Failed to grade responses in quick checker:', err);
          return null;
        }
      })()
    : null;

  // Handle single question input change (from typing or IME commit)
  const handleSingleAnswerChange = (qNum: number, rawValue: string) => {
    const entry = itemMap.get(qNum);
    if (!entry) return;
    const { item, unitType } = entry;
    const allowedKeys = getAllowedOptionKeys(item, unitType);
    const allowedSet = new Set(allowedKeys);

    const isMulti = item.answerMode === 'multi-choice';
    if (!isMulti) {
      // Single choice
      const letters = rawValue
        .toUpperCase()
        .split('')
        .filter((ch) => allowedSet.has(ch))
        .join('');
      const prevVal = userAnswers[qNum] || '';
      let candidate = '';
      if (letters.length > 0) {
        if (letters.length > 1) {
          // If already had 'A' and user typed 'b', take 'B'
          candidate = letters.replace(prevVal, '').slice(-1) || letters.slice(-1);
        } else {
          candidate = letters;
        }
      }
      setUserAnswers((prev) => ({ ...prev, [qNum]: candidate }));
      // If valid letter entered, auto advance to next question
      if (candidate) {
        focusNext(qNum);
      }
    } else {
      // Multi choice: letters aggregation
      const clean = normalizeChoiceAnswer(
        rawValue
          .toUpperCase()
          .split('')
          .filter((ch) => allowedSet.has(ch))
          .join(''),
        true
      );
      setUserAnswers((prev) => ({ ...prev, [qNum]: clean }));
      // If all 4 letters filled in ABCD, advance
      if (clean.length >= allowedKeys.length) {
        focusNext(qNum);
      }
    }
  };

  // Keyboard navigation & direct typing handler
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    qNum: number
  ) => {
    const entry = itemMap.get(qNum);
    if (!entry) return;
    const { item, unitType } = entry;

    const isMulti = item.answerMode === 'multi-choice';
    const key = e.key.toUpperCase();
    const allowedKeys = getAllowedOptionKeys(item, unitType);

    // Direct Letter typing (A-D, or A-G for Part B passage assembly)
    if (allowedKeys.includes(key)) {
      e.preventDefault();
      if (!isMulti) {
        // Single choice: set letter immediately and advance
        setUserAnswers((prev) => ({ ...prev, [qNum]: key }));
        focusNext(qNum);
      } else {
        // Multi choice: toggle letter in set
        setUserAnswers((prev) => {
          const current = prev[qNum] || '';
          const updated = current.includes(key)
            ? current.replace(key, '')
            : current + key;
          const sorted = normalizeChoiceAnswer(updated, true);
          return {
            ...prev,
            [qNum]: sorted,
          };
        });
      }
      return;
    }

    // Space, Enter, Tab, ArrowRight, ArrowDown: advance to next question
    if (
      e.key === 'Enter' ||
      e.key === ' ' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowDown'
    ) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
      }
      focusNext(qNum);
      return;
    }

    // Backspace: clear or jump to previous question
    if (e.key === 'Backspace') {
      const current = userAnswers[qNum] || '';
      if (!current) {
        e.preventDefault();
        focusPrev(qNum);
      } else if (isMulti && current.length > 0) {
        e.preventDefault();
        const updated = current.slice(0, -1);
        setUserAnswers((prev) => ({ ...prev, [qNum]: updated }));
      }
      return;
    }

    // ArrowLeft / ArrowUp: move to previous question
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusPrev(qNum);
      return;
    }
  };

  // Toggle option by clicking option pills
  const toggleOption = (qNum: number, letter: string) => {
    const item = itemMap.get(qNum)?.item;
    if (!item) return;

    const isMulti = item.answerMode === 'multi-choice';
    if (!isMulti) {
      setUserAnswers((prev) => ({
        ...prev,
        [qNum]: prev[qNum] === letter ? '' : letter,
      }));
      focusNext(qNum);
    } else {
      setUserAnswers((prev) => {
        const current = prev[qNum] || '';
        let updated = current.includes(letter)
          ? current.replace(letter, '')
          : current + letter;
        return {
          ...prev,
          [qNum]: normalizeChoiceAnswer(updated, true),
        };
      });
    }
  };

  // Smart Regex Parser for Pasted Answers
  const handleParseAndApplyPaste = () => {
    if (!pasteText.trim()) return;

    const text = pasteText;
    const parsed: Record<number, string> = { ...userAnswers };
    let matchCount = 0;
    const handledQNums = new Set<number>();

    // Pattern 1: Range format like "1-5: CADBA" or "1~5: C A D B A" or "17-20: ABCD AB BC ACD"
    const rangeRegex = /(\d+)\s*[-~至到]\s*(\d+)\s*[:：]\s*([A-Za-z\s,，]+)/g;
    let rangeMatch;

    while ((rangeMatch = rangeRegex.exec(text)) !== null) {
      const startNum = parseInt(rangeMatch[1], 10);
      const endNum = parseInt(rangeMatch[2], 10);
      const content = rangeMatch[3].trim();

      // Split content into tokens (by whitespace, comma, etc.)
      let tokens = content.split(/[\s,，]+/).filter(Boolean);

      // If a single token was written for multiple single-choice questions (e.g. "1-5: CADBA")
      if (tokens.length === 1 && endNum > startNum) {
        const rawToken = tokens[0];
        if (rawToken.length === endNum - startNum + 1) {
          tokens = rawToken.split('');
        }
      }

      let tIdx = 0;
      for (let q = startNum; q <= endNum; q++) {
        if (tIdx < tokens.length) {
          const item = itemMap.get(q)?.item;
          if (item) {
            const isMulti = item.answerMode === 'multi-choice';
            parsed[q] = normalizeChoiceAnswer(tokens[tIdx], isMulti);
            matchCount++;
            handledQNums.add(q);
          }
          tIdx++;
        }
      }
    }

    // Pattern 2: Explicit numbered format like "1.A 2.B 17.ABCD 41.E" or "1:A 2:B" or "1、A 2、B"
    const itemRegex =
      /(?:^|[^\d])(\d{1,2})\s*[\.、:：\s-]\s*([A-Ga-g]{1,4})(?=[^\w]|$)/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(text)) !== null) {
      const qNum = parseInt(itemMatch[1], 10);
      const letterToken = itemMatch[2];
      if (!handledQNums.has(qNum)) {
        const item = itemMap.get(qNum)?.item;
        if (item) {
          const isMulti = item.answerMode === 'multi-choice';
          parsed[qNum] = normalizeChoiceAnswer(letterToken, isMulti);
          matchCount++;
          handledQNums.add(qNum);
        }
      }
    }

    // Pattern 3: Fallback sequential stream if few matches
    if (matchCount < 5) {
      const pureLetters = text.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (pureLetters.length >= 10) {
        let cursor = 0;
        for (const { item } of objectiveItems) {
          if (cursor >= pureLetters.length) break;
          const isMulti = item.answerMode === 'multi-choice';
          if (!isMulti) {
            parsed[item.questionNumber] = pureLetters[cursor];
            cursor++;
            matchCount++;
          }
        }
      }
    }

    setUserAnswers(parsed);

    const totalFilled = Object.values(parsed).filter(Boolean).length;
    setPasteReport(
      `🎉 解析完成！成功匹配并录入 ${matchCount} 题答案（当前答题卡共计 ${totalFilled} / ${objectiveItems.length} 题已填）。`
    );
    setActiveTab('keyboard');
  };

  // Submit and apply to main exam session
  const handleFinalSubmit = () => {
    const finalResponses: Record<number, ObjectiveItemResponse> = {};
    for (const { item, unitId, unitType } of objectiveItems) {
      const qNum = item.questionNumber;
      const ans = userAnswers[qNum] || '';
      finalResponses[qNum] = {
        questionNumber: qNum,
        itemId: item.id,
        unitId,
        unitType,
        selectedAnswer: ans,
        confidence: 'certain',
        flaggedForReview: false,
        timeSpentSeconds: 0,
        maxScore: item.score,
        knownErrorCauses: [],
        possibleErrorCauses: [],
        userNotes: '',
        highlights: [],
      };
    }
    onConfirmApply(finalResponses);
    onClose();
  };

  const answeredCount = Object.values(userAnswers).filter(Boolean).length;
  const isFull = answeredCount === objectiveItems.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`纸卷极速核对 · ${formatExamTitle(exam.year, exam.subject)}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div className="relative w-full max-w-4xl h-[92vh] max-h-[880px] bg-white dark:bg-[#111C20] rounded-2xl shadow-2xl border border-stone-200 dark:border-[#223036] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-stone-200 dark:border-[#223036] flex items-center justify-between bg-stone-50/80 dark:bg-[#162327]/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#38849E]">
              <ClipboardPaste className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-stone-900 dark:text-[#E2E8E6]">
                  纸卷极速核对 · {formatExamTitle(exam.year, exam.subject)}
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#38849E]">
                  {exam.subject}
                </span>
              </div>
              <p className="text-xs text-stone-500 dark:text-[#889DA3] mt-0.5">
                支持键盘连打与文本一键粘贴识别，10秒内出分并展开官方权威解析
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-[#1A282D] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Mode Tabs & Progress */}
        <div className="px-5 py-2.5 border-b border-stone-100 dark:border-[#1F2C31] flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#111C20] shrink-0">
          <div className="flex items-center gap-1.5 p-1 bg-stone-100 dark:bg-[#19262B] rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('keyboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'keyboard'
                  ? 'bg-white dark:bg-[#203138] text-stone-900 dark:text-white shadow-xs font-semibold'
                  : 'text-stone-600 dark:text-[#889DA3] hover:text-stone-900'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>键盘连打答题卡 (极速盲填)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('paste')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'paste'
                  ? 'bg-white dark:bg-[#203138] text-stone-900 dark:text-white shadow-xs font-semibold'
                  : 'text-stone-600 dark:text-[#889DA3] hover:text-stone-900'
              }`}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>智能文本一键粘贴识别</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-stone-500 dark:text-[#889DA3]">
              已录入:{' '}
              <span className="font-bold text-[#174A5B] dark:text-[#38849E] font-mono">
                {answeredCount}
              </span>{' '}
              / {objectiveItems.length} 题
            </span>
            <div className="w-24 h-2 bg-stone-200 dark:bg-[#203138] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#174A5B] dark:bg-[#38849E] rounded-full transition-all duration-300"
                style={{
                  width: `${(answeredCount / (objectiveItems.length || 1)) * 100}%`,
                }}
              />
            </div>
            {isFull && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                <CheckCircle2 className="w-3.5 h-3.5" />
                已填满
              </span>
            )}
          </div>
        </div>

        {/* Main Body with Safe Min-Height for Internal Scrolling */}
        <div
          ref={bodyScrollRef}
          className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0 space-y-5"
        >
          {/* Top Graded Score Board (Only shown after grading) */}
          {isGraded && gradeSummary && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-[#174A5B]/10 via-emerald-500/10 to-teal-500/10 dark:from-[#174A5B]/25 dark:via-emerald-500/20 dark:to-teal-500/20 border border-[#174A5B]/25 flex flex-wrap items-center justify-between gap-4 animate-fade-in shadow-xs">
              <div className="flex items-center gap-3.5">
                <div className="p-3 bg-white dark:bg-[#162327] rounded-xl shadow-xs border border-stone-200/80 dark:border-[#24353C]">
                  <span className="text-2xl sm:text-3xl font-black font-mono text-[#174A5B] dark:text-[#489BB8]">
                    {gradeSummary.totalScoreEarned}
                  </span>
                  <span className="text-xs text-stone-500 ml-1 font-semibold">
                    / {gradeSummary.maxObjectiveScore} 分
                  </span>
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-stone-900 dark:text-[#E2E8E6] flex items-center gap-2">
                    <span>客观题核对出分</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                      正确率 {gradeSummary.accuracyPercent}%
                    </span>
                  </h4>
                  <p className="text-xs text-stone-600 dark:text-[#889DA3] mt-0.5">
                    做对{' '}
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {gradeSummary.correctCount}
                    </strong>{' '}
                    题 · 做错{' '}
                    <strong className="text-rose-600 dark:text-rose-400">
                      {gradeSummary.totalQuestions - gradeSummary.correctCount}
                    </strong>{' '}
                    题 · 点击下方题目卡片可原地展开官方解析
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOnlyShowMistakes((v) => !v)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                    onlyShowMistakes
                      ? 'bg-rose-500 text-white border-rose-600 shadow-2xs'
                      : 'bg-white dark:bg-[#1A282D] text-stone-700 dark:text-[#C5D5D8] border-stone-200 dark:border-[#2A3B42] hover:bg-stone-50'
                  }`}
                >
                  {onlyShowMistakes ? '显示全部题目' : '仅看做错题目'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsGraded(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-stone-600 dark:text-[#889DA3] bg-stone-100 dark:bg-[#19272C] hover:bg-stone-200"
                >
                  返回修改答案
                </button>
              </div>
            </div>
          )}

          {/* Paste Tab */}
          {activeTab === 'paste' && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-3.5 bg-amber-50/70 dark:bg-[#262013]/60 border border-amber-200/80 dark:border-amber-900/50 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    支持从微信、备忘录或文本中随意格式粘贴答案：
                  </p>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300/80 font-mono leading-relaxed">
                    例1（连写/空格）：1-5: CADBA 或 1-16: CADBABCDABBACDAB
                    <br />
                    例2（标号/顿号）：1.C 2.A 3.D 或 1、C 2、A 17、ABCD
                    <br />
                    例3（纯字母流）：CADBABCDABBA...
                  </p>
                </div>
              </div>

              <div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="在此直接粘贴或输入您的作答记录..."
                  rows={6}
                  className="w-full p-3.5 text-sm font-mono bg-stone-50 dark:bg-[#162327] border border-stone-200 dark:border-[#26373E] rounded-xl focus:outline-none focus:border-[#174A5B] dark:focus:border-[#38849E] text-stone-900 dark:text-[#E2E8E6] transition-colors"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setPasteText('')}
                  className="text-xs text-stone-500 hover:text-stone-700 dark:text-stone-400"
                >
                  清空文本
                </button>
                <button
                  type="button"
                  onClick={handleParseAndApplyPaste}
                  disabled={!pasteText.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] disabled:opacity-50 transition-all shadow-xs"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>智能识别并填入答题卡</span>
                </button>
              </div>

              {pasteReport && (
                <div className="p-3 bg-emerald-50 dark:bg-[#132A22] border border-emerald-200 dark:border-emerald-800/50 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                  <span>{pasteReport}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('keyboard')}
                    className="underline font-semibold ml-2"
                  >
                    前往查看答题卡
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Keyboard Blind-Typing Matrix Tab */}
          {activeTab === 'keyboard' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-3 bg-stone-50 dark:bg-[#162327] rounded-xl text-xs text-stone-600 dark:text-[#889DA3] flex flex-wrap items-center justify-between gap-2 border border-stone-200/60 dark:border-[#24353C]">
                <span className="flex items-center gap-1.5">
                  <Keyboard className="w-4 h-4 text-[#174A5B] dark:text-[#38849E] shrink-0" />
                  <span>
                    <strong>盲打提示</strong>：单选直接敲字母{' '}
                    <strong className="text-[#174A5B] dark:text-[#56AEC8]">
                      A/B/C/D
                    </strong>{' '}
                    自动跳题（支持中文输入法直接按键）；多选敲字母，按{' '}
                    <strong>空格 / 回车 / Tab</strong> 跳下一题。
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const empty: Record<number, string> = {};
                    for (const { item } of objectiveItems)
                      empty[item.questionNumber] = '';
                    setUserAnswers(empty);
                    setIsGraded(false);
                    if (objectiveItems[0]) {
                      inputRefs.current[objectiveItems[0].item.questionNumber]?.focus();
                    }
                  }}
                  className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  清空答题卡
                </button>
              </div>

              {/* Single Choice Section */}
              {singleChoiceItems.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-200 dark:border-[#223036] pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-[#E2E8E6] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#174A5B] dark:bg-[#38849E]" />
                      {isPoliticsExamYear(exam.year) || exam.subject === '考研政治'
                        ? `一、单项选择题 (第 1～${singleChoiceItems.length} 题 · 每题 1 分)`
                        : `一、客观单选题与新题型 (第 1～${singleChoiceItems.length} 题 · 完形 0.5分 / 阅读与新题型 2分)`}
                    </h4>
                    <span className="text-xs text-stone-500 font-mono">
                      {
                        singleChoiceItems.filter(
                          (i) => userAnswers[i.item.questionNumber]
                        ).length
                      }{' '}
                      / {singleChoiceItems.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5">
                    {singleChoiceItems
                      .filter(({ item }) => {
                        if (!isGraded || !onlyShowMistakes) return true;
                        const user = userAnswers[item.questionNumber] || '';
                        return user !== (item.correctAnswer || '');
                      })
                      .map(({ item, unitType }) => {
                        const qNum = item.questionNumber;
                        const val = userAnswers[qNum] || '';
                        const isFilled = Boolean(val);
                        const std = item.correctAnswer || '';
                        const isCorrect = isGraded && val && val === std;
                        const isWrong = isGraded && (!val || val !== std);
                        const isExpanded = expandedQuestionNumber === qNum;
                        const allowedKeys = getAllowedOptionKeys(item, unitType);

                        return (
                          <div
                            key={qNum}
                            className={`p-2 rounded-xl border transition-all text-center flex flex-col items-center justify-between gap-1.5 ${
                              isGraded
                                ? isCorrect
                                  ? 'bg-emerald-50 dark:bg-[#122B21] border-emerald-300 dark:border-emerald-700'
                                  : 'bg-rose-50 dark:bg-[#2B1414] border-rose-300 dark:border-rose-700'
                                : isFilled
                                ? 'bg-sky-50/70 dark:bg-[#16272F] border-[#38849E] dark:border-[#38849E]'
                                : 'bg-white dark:bg-[#152125] border-stone-200 dark:border-[#223036]'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full text-[11px] font-mono text-stone-500 dark:text-[#889DA3]">
                              <span className="font-bold text-stone-700 dark:text-[#C5D5D8]">
                                第 {qNum} 题
                              </span>
                              {item.knowledgeModule && (
                                <span className="text-[10px] text-stone-400">
                                  {item.knowledgeModule.slice(0, 2)}
                                </span>
                              )}
                            </div>

                            <input
                              ref={(el) => {
                                inputRefs.current[qNum] = el;
                              }}
                              type="text"
                              maxLength={2}
                              value={val}
                              onChange={(e) =>
                                handleSingleAnswerChange(qNum, e.target.value)
                              }
                              onKeyDown={(e) => handleKeyDown(e, qNum)}
                              className={`w-11 h-10 text-center text-lg font-bold font-mono uppercase rounded-lg focus:outline-none focus:ring-2 focus:ring-[#174A5B] dark:focus:ring-[#38849E] ${
                                isGraded
                                  ? isCorrect
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-400'
                                    : 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-400'
                                  : 'bg-white dark:bg-[#1A282D] border border-stone-300 dark:border-[#2D4048] text-stone-900 dark:text-white'
                              }`}
                              placeholder="·"
                            />

                            {/* Option pills or Diff badge */}
                            {!isGraded ? (
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {allowedKeys.map((opt) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => toggleOption(qNum, opt)}
                                    className={`w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${
                                      val === opt
                                        ? 'bg-[#174A5B] dark:bg-[#38849E] text-white shadow-2xs'
                                        : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 bg-stone-100 dark:bg-[#203138]'
                                    }`}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="w-full text-[10px] font-mono leading-tight">
                                {isCorrect ? (
                                  <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center justify-center gap-0.5">
                                    <Check className="w-3 h-3" /> 对 (+{item.score})
                                  </span>
                                ) : (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold block">
                                    标: {std}
                                  </span>
                                )}
                              </div>
                            )}

                            {isGraded && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedQuestionNumber(
                                    isExpanded ? null : qNum
                                  )
                                }
                                className="text-[10px] text-stone-500 hover:text-[#174A5B] dark:hover:text-[#56AEC8] flex items-center gap-0.5 mt-0.5"
                              >
                                {isExpanded ? (
                                  <>
                                    <span>收起</span>
                                    <ChevronUp className="w-2.5 h-2.5" />
                                  </>
                                ) : (
                                  <>
                                    <span>解析</span>
                                    <ChevronDown className="w-2.5 h-2.5" />
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Multi Choice Section */}
              {multiChoiceItems.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between border-b border-stone-200 dark:border-[#223036] pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-[#E2E8E6] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" />
                      二、多项选择题 (第 {singleChoiceItems.length + 1}～
                      {objectiveItems.length} 题 · 每题 2 分)
                    </h4>
                    <span className="text-xs text-stone-500 font-mono">
                      {
                        multiChoiceItems.filter(
                          (i) => userAnswers[i.item.questionNumber]
                        ).length
                      }{' '}
                      / {multiChoiceItems.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                    {multiChoiceItems
                      .filter(({ item }) => {
                        if (!isGraded || !onlyShowMistakes) return true;
                        const user = userAnswers[item.questionNumber] || '';
                        return user !== (item.correctAnswer || '');
                      })
                      .map(({ item }) => {
                        const qNum = item.questionNumber;
                        const val = userAnswers[qNum] || '';
                        const isFilled = Boolean(val);

                        const std = item.correctAnswer || '';
                        const isCorrect = isGraded && val && val === std;
                        const isPartial =
                          isGraded &&
                          val &&
                          val !== std &&
                          val.split('').every((l) => std.includes(l));
                        const isExpanded = expandedQuestionNumber === qNum;

                        return (
                          <div
                            key={qNum}
                            className={`p-2.5 rounded-xl border transition-all text-center flex flex-col items-center justify-between gap-2 ${
                              isGraded
                                ? isCorrect
                                  ? 'bg-emerald-50 dark:bg-[#122B21] border-emerald-300 dark:border-emerald-700'
                                  : isPartial
                                  ? 'bg-amber-50 dark:bg-[#2B2312] border-amber-300 dark:border-amber-700'
                                  : 'bg-rose-50 dark:bg-[#2B1414] border-rose-300 dark:border-rose-700'
                                : isFilled
                                ? 'bg-indigo-50/70 dark:bg-[#1B2032] border-indigo-400 dark:border-indigo-600'
                                : 'bg-white dark:bg-[#152125] border-stone-200 dark:border-[#223036]'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full text-[11px] font-mono text-stone-500 dark:text-[#889DA3]">
                              <span className="font-bold text-stone-700 dark:text-[#C5D5D8]">
                                第 {qNum} 题
                              </span>
                              {item.knowledgeModule && (
                                <span className="text-[10px] text-stone-400">
                                  {item.knowledgeModule.slice(0, 2)}
                                </span>
                              )}
                            </div>

                            <input
                              ref={(el) => {
                                inputRefs.current[qNum] = el;
                              }}
                              type="text"
                              maxLength={4}
                              value={val}
                              onChange={(e) =>
                                handleSingleAnswerChange(qNum, e.target.value)
                              }
                              onKeyDown={(e) => handleKeyDown(e, qNum)}
                              className={`w-20 h-10 text-center text-sm font-bold font-mono uppercase rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 tracking-widest ${
                                isGraded
                                  ? isCorrect
                                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-400'
                                    : isPartial
                                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-400'
                                    : 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-400'
                                  : 'bg-white dark:bg-[#1A282D] border border-stone-300 dark:border-[#2D4048] text-stone-900 dark:text-white'
                              }`}
                              placeholder="空"
                            />

                            {!isGraded ? (
                              <div className="flex items-center gap-1.5">
                                {['A', 'B', 'C', 'D'].map((opt) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => toggleOption(qNum, opt)}
                                    className={`w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center transition-colors ${
                                      val.includes(opt)
                                        ? 'bg-indigo-600 dark:bg-indigo-500 text-white shadow-2xs'
                                        : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 bg-stone-100 dark:bg-[#203138]'
                                    }`}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="w-full text-[10px] font-mono leading-tight">
                                {isCorrect ? (
                                  <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center justify-center gap-0.5">
                                    <Check className="w-3 h-3" /> 对 (+2)
                                  </span>
                                ) : isPartial ? (
                                  <span className="text-amber-700 dark:text-amber-400 font-bold block">
                                    标: {std} (漏)
                                  </span>
                                ) : (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold block">
                                    标: {std}
                                  </span>
                                )}
                              </div>
                            )}

                            {isGraded && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedQuestionNumber(
                                    isExpanded ? null : qNum
                                  )
                                }
                                className="text-[10px] text-stone-500 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-0.5 mt-0.5"
                              >
                                {isExpanded ? (
                                  <>
                                    <span>收起</span>
                                    <ChevronUp className="w-2.5 h-2.5" />
                                  </>
                                ) : (
                                  <>
                                    <span>解析</span>
                                    <ChevronDown className="w-2.5 h-2.5" />
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Expanded Question Details & Official Explanation Section (in-situ modal bottom view) */}
          {expandedQuestionNumber && (() => {
            const expItem = itemMap.get(expandedQuestionNumber)?.item;
            if (!expItem) return null;
            const qNum = expItem.questionNumber;
            const user = userAnswers[qNum] || '';
            const std = expItem.correctAnswer || '';
            const isCorrect = user === std;

            return (
              <div className="p-4 sm:p-5 rounded-2xl border border-stone-200 dark:border-[#2C3E46] bg-stone-50/80 dark:bg-[#162327] space-y-3.5 animate-fade-in shadow-xs">
                <div className="flex items-center justify-between border-b border-stone-200/80 dark:border-[#26373E] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[#174A5B] text-white">
                      第 {qNum} 题
                    </span>
                    {expItem.knowledgeModule && (
                      <span className="text-xs px-2 py-0.5 rounded bg-stone-200 dark:bg-[#203138] text-stone-700 dark:text-[#A8BCC2]">
                        {expItem.knowledgeModule}
                      </span>
                    )}
                    <span className="text-xs text-stone-500">
                      ({expItem.answerMode === 'multi-choice' ? `多选题 · ${expItem.score}分` : `单选题 · ${expItem.score}分`})
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span>
                      你的作答:{' '}
                      <strong className="font-mono text-sm font-bold text-stone-800 dark:text-white">
                        {user || '未填'}
                      </strong>
                    </span>
                    <span>
                      官方标准:{' '}
                      <strong className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {std}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedQuestionNumber(null)}
                      className="p-1 rounded text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Prompt */}
                <p className="text-sm font-medium text-stone-900 dark:text-[#E2E8E6] leading-relaxed">
                  {expItem.prompt}
                </p>

                {/* Options List */}
                {expItem.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {expItem.options.map((opt) => {
                      const isStd = std.includes(opt.key);
                      const isUser = user.includes(opt.key);
                      return (
                        <div
                          key={opt.key}
                          className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-2 transition-all ${
                            isStd
                              ? 'bg-emerald-50 dark:bg-[#122A20] border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold'
                              : isUser
                              ? 'bg-rose-50 dark:bg-[#281414] border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200'
                              : 'bg-white dark:bg-[#1B272C] border-stone-200 dark:border-[#28383F] text-stone-700 dark:text-[#A8BCC2]'
                          }`}
                        >
                          <span className="font-mono font-bold w-4">{opt.key}.</span>
                          <span className="leading-snug">{opt.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Official Explanation */}
                {expItem.officialExplanation && (
                  <div className="p-3.5 rounded-xl bg-stone-100/90 dark:bg-[#19272C] text-stone-800 dark:text-[#C5D5D8] space-y-1.5 border border-stone-200/60 dark:border-[#28383F]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#174A5B] dark:text-[#489BB8]">
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>官方权威解析及命题考点</span>
                    </div>
                    <p className="leading-relaxed whitespace-pre-wrap text-xs text-justify">
                      {expItem.officialExplanation}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3.5 border-t border-stone-200 dark:border-[#223036] bg-stone-50/90 dark:bg-[#152226] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {!isGraded ? (
              <button
                type="button"
                onClick={() => setIsGraded(true)}
                disabled={answeredCount === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>立即核对判分 (生成速览报告)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsGraded(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 dark:text-[#889DA3] bg-stone-100 dark:bg-[#1C2C31] hover:bg-stone-200"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>返回修改作答</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-stone-600 dark:text-[#889DA3] hover:bg-stone-200/60 dark:hover:bg-[#1C2C31] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={answeredCount === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] disabled:opacity-50 transition-all shadow-xs"
            >
              <Check className="w-4 h-4" />
              <span>保存记录并进入全卷复盘</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
