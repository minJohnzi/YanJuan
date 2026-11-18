import React, { useState } from 'react';
import {
  RotateCcw,
  CheckCircle2,
  XCircle,
  Plus,
  BookOpen,
  Calendar,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
} from 'lucide-react';
import type {
  ExamAttempt,
  ReviewItem,
  ReviewItemType,
  SubjectId,
  UnitType,
} from '../shared/types';
import {
  formatExamTitle,
  isPoliticsExamYear,
  resolveSubjectId,
} from '../shared/types';
import {
  findLatestSubmittedAttemptForYear,
  formatReviewTypeLabel,
  groupReviewItemsByPaper,
} from '../shared/scoringAndReview';
import { Badge, SegmentedTabs } from './ui/primitives';

interface ReviewCenterViewProps {
  reviewItems: ReviewItem[];
  attempts?: ExamAttempt[];
  onCompleteReview: (id: string, passed: boolean) => void;
  onCreateCustomReviewItem: (params: {
    year: number;
    questionNumber: number;
    reviewType: ReviewItemType;
    title: string;
    promptSnapshot: string;
    previousUserAnswer: string;
    previousFeedbackSummary: string;
  }) => void;
  onOpenAttempt?: (
    attemptId: string,
    unitId?: string,
    questionNumber?: number
  ) => void;
  onJumpToUnit: (
    year: number,
    unitType: UnitType,
    unitId?: string,
    questionNumber?: number
  ) => void;
  onOpenMistakeSummary?: () => void;
}

const FILTER_TYPES: ReviewItemType[] = [
  'objective-confident-error',
  'objective-error',
  'objective-hesitant-error',
  'objective-guessed-right',
  're-translate',
  'revise-essay',
  're-analyze-politics',
  'fix-sentence',
  'objective-manual',
];

const CUSTOM_YEAR_OPTIONS = [
  ...Array.from({ length: 17 }, (_, idx) => {
    const year = 2026 - idx;
    return { year, label: `${year} 英语一` };
  }),
  ...Array.from({ length: 8 }, (_, idx) => {
    const num = idx + 1;
    const year = 2100 + num;
    return { year, label: `2027 肖八第 ${num} 套 (政治)` };
  }),
];

function resolveDefaultQuestionNumber(year: number, reviewType: ReviewItemType): number {
  if (isPoliticsExamYear(year) || reviewType === 're-analyze-politics') {
    return reviewType === 're-analyze-politics' ? 34 : 1;
  }
  if (reviewType === 're-translate') return 46;
  if (reviewType === 'revise-essay') return 51;
  return 31;
}

export const ReviewCenterView: React.FC<ReviewCenterViewProps> = ({
  reviewItems,
  attempts = [],
  onCompleteReview,
  onCreateCustomReviewItem,
  onOpenAttempt,
  onJumpToUnit,
  onOpenMistakeSummary,
}) => {
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectId>('all');
  const [filterType, setFilterType] = useState<'all' | ReviewItemType>('all');
  const [statusTab, setStatusTab] = useState<'due' | 'all' | 'mastered'>('due');
  const [viewMode, setViewMode] = useState<'by-paper' | 'flat'>('by-paper');
  const [collapsedPaperKeys, setCollapsedPaperKeys] = useState<
    Record<string, boolean>
  >({});
  const [showAddForm, setShowAddForm] = useState(false);

  const [newYear, setNewYear] = useState<number>(2024);
  const [newType, setNewType] = useState<ReviewItemType>('fix-sentence');
  const [newTitle, setNewTitle] = useState('');
  const [newContext, setNewContext] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newTarget, setNewTarget] = useState('拆解主干从句并默写译文');

  const subjectFilteredItems = reviewItems.filter(
    (item) =>
      subjectFilter === 'all' ||
      resolveSubjectId(item.year, item.subjectId) === subjectFilter
  );

  const dueCount = subjectFilteredItems.filter(
    (item) => !item.mastered && new Date(item.nextDueAt).getTime() <= Date.now() + 86400 * 1000
  ).length;
  const masteredCount = subjectFilteredItems.filter((item) => item.mastered).length;

  const filteredItems = subjectFilteredItems.filter((item) => {
    if (filterType !== 'all' && item.reviewType !== filterType) return false;
    if (statusTab === 'mastered') return item.mastered;
    if (statusTab === 'due') {
      return (
        !item.mastered &&
        new Date(item.nextDueAt).getTime() <= Date.now() + 86400 * 1000
      );
    }
    return true;
  });

  const paperGroups = groupReviewItemsByPaper(filteredItems);

  const handleInspectOrigin = (item: ReviewItem) => {
    if (onOpenAttempt) {
      const exactAttempt = item.attemptId
        ? attempts.find((a) => a.id === item.attemptId)
        : undefined;
      const fallbackAttempt =
        exactAttempt ||
        findLatestSubmittedAttemptForYear(attempts, item.year, item.dataVersion) ||
        findLatestSubmittedAttemptForYear(attempts, item.year);
      if (fallbackAttempt) {
        onOpenAttempt(fallbackAttempt.id, item.unitId, item.questionNumber);
        return;
      }
    }
    onJumpToUnit(item.year, item.unitType, item.unitId, item.questionNumber);
  };

  const handleOpenPaperReview = (year: number, firstItem?: ReviewItem) => {
    if (onOpenAttempt) {
      const latestAtt = findLatestSubmittedAttemptForYear(attempts, year);
      if (latestAtt) {
        onOpenAttempt(latestAtt.id, firstItem?.unitId);
        return;
      }
    }
    if (firstItem) {
      onJumpToUnit(year, firstItem.unitType, firstItem.unitId);
    }
  };

  const renderReviewCard = (item: ReviewItem, compactHeader = false) => {
    const isPolitics =
      resolveSubjectId(item.year, item.subjectId) === 'politics' ||
      isPoliticsExamYear(item.year);
    return (
      <div
        key={item.id}
        className="bg-card rounded-xl border border-subtle hover:border-brand/50 transition-all p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
      >
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {!compactHeader && (
              <Badge variant={isPolitics ? 'warning' : 'brand'}>
                {formatExamTitle(item.year, 'short')}
              </Badge>
            )}
            <span className="font-semibold text-ink text-sm">
              {item.title}
            </span>
            <span className="text-muted">·</span>
            <span className="text-secondary">
              {formatReviewTypeLabel(item.reviewType)}
            </span>
            <span className="text-muted">·</span>
            <span className="font-tabular-mono text-secondary">
              间隔 {item.intervalDays} 天 (已连对 {item.repetitionCount} 次)
            </span>
          </div>

          <p
            className={`${
              isPolitics ? 'font-sans' : 'font-english-serif'
            } text-sm text-ink bg-paper p-3 rounded-lg border border-hairline leading-relaxed`}
          >
            {item.promptSnapshot}
          </p>

          <div className="text-xs text-[#68777C] dark:text-[#9CAEB3] flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>你的作答：{item.previousUserAnswer}</span>
            {item.correctAnswerSnapshot && (
              <>
                <span>·</span>
                <span className="font-tabular-mono font-semibold text-emerald-700 dark:text-[#4EA387]">
                  标准答案：{item.correctAnswerSnapshot}
                </span>
              </>
            )}
            <span>·</span>
            <span className="text-[#202B2F] dark:text-[#E2E8E6]">
              复习要点：{item.previousFeedbackSummary}
            </span>
            <span>·</span>
            <span className="font-tabular-mono inline-flex items-center gap-1">
              <Calendar className="w-3 h-3 text-[#96A1A4] dark:text-[#657980]" />
              到期：{new Date(item.nextDueAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#E8ECEA] dark:border-[#223036]">
          <button
            type="button"
            onClick={() => handleInspectOrigin(item)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] border border-transparent dark:border-[#2C3E46] transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>查看原题</span>
          </button>

          {!item.mastered && (
            <>
              <button
                type="button"
                onClick={() => onCompleteReview(item.id, false)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-[#A8544A] dark:text-[#CF695E] bg-[#FDF4F3] dark:bg-[#351C1A] hover:bg-rose-100 dark:hover:bg-[#452220] border border-rose-200 dark:border-rose-900 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>仍需强化</span>
              </button>
              <button
                type="button"
                onClick={() => onCompleteReview(item.id, true)}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#3F7664] dark:bg-[#4EA387] hover:bg-[#346152] dark:hover:bg-[#428e75] transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>已掌握 · 延长周期</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-[1440px] w-full mx-auto space-y-6 py-2 sm:py-4">
      <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E8ECEA] dark:border-[#26373E] pb-5">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6]">
              错题与间隔复习中心
            </h1>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
              依据 1 / 3 / 7 / 14 / 30 天动态排期，自动聚合错题、自信答错题、猜对题与主观题重写任务。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {onOpenMistakeSummary && (
              <button
                type="button"
                onClick={onOpenMistakeSummary}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-[#174A5B] dark:text-[#56AEC8] bg-[#E8F0F1] dark:bg-[#1F3740] hover:opacity-90 whitespace-nowrap transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>错题整体总结 / 导出</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>收录难句 / 词汇</span>
            </button>
          </div>
        </div>

        {/* Modal / Form for manual custom review item */}
        {showAddForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTitle.trim() || !newContext.trim()) return;
              onCreateCustomReviewItem({
                year: newYear,
                questionNumber: resolveDefaultQuestionNumber(newYear, newType),
                reviewType: newType,
                title: newTitle.trim(),
                promptSnapshot: newContext.trim(),
                previousUserAnswer: newNote.trim() || '待首次盲译/复述',
                previousFeedbackSummary: newTarget.trim(),
              });
              setNewTitle('');
              setNewContext('');
              setNewNote('');
              setShowAddForm(false);
            }}
            className="p-5 bg-card-subtle rounded-xl border border-subtle space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">
                收录跨学科复习卡（自动进入 1/3/7/14/30 天排期队列）
              </span>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-muted hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="text-secondary">所属试卷 / 学科</span>
                <select
                  value={newYear}
                  onChange={(e) => {
                    const yr = Number(e.target.value);
                    setNewYear(yr);
                    if (isPoliticsExamYear(yr)) {
                      setNewType('re-analyze-politics');
                      setNewTarget('默写核心马原/新思想原理并对应材料踩点');
                    } else {
                      setNewType('fix-sentence');
                      setNewTarget('拆解主干从句并默写译文');
                    }
                  }}
                  className="w-full p-2 bg-card rounded border border-subtle text-ink"
                >
                  {CUSTOM_YEAR_OPTIONS.map((opt) => (
                    <option key={opt.year} value={opt.year}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-secondary">复习卡类型</span>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ReviewItemType)}
                  className="w-full p-2 bg-card rounded border border-subtle text-ink"
                >
                  <option value="fix-sentence">长难句精析</option>
                  <option value="objective-manual">核心词汇/原理笔记</option>
                  <option value="re-translate">翻译二次盲译</option>
                  <option value="revise-essay">作文升格重写</option>
                  <option value="re-analyze-politics">政治分析题原理复盘</option>
                </select>
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-secondary">
                  标题（例如：2024 Text 1 或 肖八一 Q34 对立统一原理）
                </span>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={isPoliticsExamYear(newYear) ? '如：肖八第1套 Q34 矛盾转化原理' : '如：2024 Text 1 段首长难句'}
                  className="w-full p-2 bg-card rounded border border-subtle text-ink"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-secondary">
                {isPoliticsExamYear(newYear) ? '核心原理或材料要点摘录' : '真题原句或语境摘录'}
              </span>
              <textarea
                rows={2}
                required
                value={newContext}
                onChange={(e) => setNewContext(e.target.value)}
                placeholder={isPoliticsExamYear(newYear) ? '粘贴原理陈述或材料设问...' : '粘贴英文句子...'}
                className={`w-full p-2 bg-card rounded border border-subtle text-ink ${
                  isPoliticsExamYear(newYear) ? 'font-sans' : 'font-english-serif'
                }`}
              />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[#68777C] dark:text-[#9CAEB3]">易错点或笔记</span>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="记录当时理解误区..."
                  className="w-full p-2 bg-white dark:bg-[#1A2529] rounded border border-[#DCE4E1] dark:border-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6]"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[#68777C] dark:text-[#9CAEB3]">目标复习动作</span>
                <input
                  type="text"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="w-full p-2 bg-white dark:bg-[#1A2529] rounded border border-[#DCE4E1] dark:border-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6]"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded text-[#68777C] dark:text-[#9CAEB3] hover:bg-stone-200/60 dark:hover:bg-[#203036]"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-md bg-[#174A5B] dark:bg-[#38849E] text-white text-xs font-medium hover:bg-[#123D4B] dark:hover:bg-[#489BB8]"
              >
                加入复习队列
              </button>
            </div>
          </form>
        )}

        {/* Subject, Status Switcher Tabs & Type Filters */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedTabs
              ariaLabel="按学科筛选复习任务"
              value={subjectFilter}
              onChange={setSubjectFilter}
              options={[
                { id: 'all', label: '全部学科', badge: reviewItems.length },
                {
                  id: 'english-i',
                  label: '考研英语一',
                  badge: reviewItems.filter(
                    (i) => resolveSubjectId(i.year, i.subjectId) === 'english-i'
                  ).length,
                },
                {
                  id: 'politics',
                  label: '考研政治',
                  badge: reviewItems.filter(
                    (i) => resolveSubjectId(i.year, i.subjectId) === 'politics'
                  ).length,
                },
              ]}
            />

            <div className="flex flex-wrap items-center gap-2.5">
              <SegmentedTabs
                ariaLabel="复习组织方式"
                size="xs"
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { id: 'by-paper', label: '按试卷分组' },
                  { id: 'flat', label: '全部错题列表' },
                ]}
              />

              <SegmentedTabs
                ariaLabel="按复习状态筛选"
                value={statusTab}
                onChange={setStatusTab}
                options={[
                  { id: 'due', label: '待复习', badge: dueCount },
                  { id: 'all', label: '全部队列', badge: subjectFilteredItems.length },
                  { id: 'mastered', label: '已攻克', badge: masteredCount },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs overflow-x-auto pb-1 max-w-full">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                filterType === 'all'
                  ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                  : 'bg-stone-100 dark:bg-[#162226] text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
              }`}
            >
              全部
            </button>
            {FILTER_TYPES.map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setFilterType(tp)}
                className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[32px] ${
                  filterType === tp
                    ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                    : 'bg-stone-100 dark:bg-[#162226] text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
                }`}
              >
                {formatReviewTypeLabel(tp)}
              </button>
            ))}
          </div>
        </div>

        {/* Review Items List */}
        {filteredItems.length === 0 ? (
          <div className="p-10 bg-stone-50 dark:bg-[#162226] rounded-xl text-center space-y-2 border border-[#DCE4E1] dark:border-[#2C3E46]">
            <RotateCcw className="w-6 h-6 text-[#96A1A4] dark:text-[#657980] mx-auto" />
            <div className="text-sm font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
              当前暂无符合条件的复习任务
            </div>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] max-w-md mx-auto">
              作答客观题产生错题、或完成主观题批改后，系统将自动安排复习；您也可以点击上方「收录难句」添加自定义卡片。
            </p>
          </div>
        ) : viewMode === 'by-paper' ? (
          <div className="space-y-4">
            {paperGroups.map((group) => {
              const isPolitics = group.subjectId === 'politics';
              const isExpanded = !collapsedPaperKeys[group.paperKey];
              const latestAtt = findLatestSubmittedAttemptForYear(
                attempts,
                group.year
              );
              return (
                <div
                  key={group.paperKey}
                  className="rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] bg-stone-50/50 dark:bg-[#162226] overflow-hidden"
                >
                  <div className="p-4 sm:px-5 bg-white dark:bg-[#1E2B30] flex flex-wrap items-center justify-between gap-3 border-b border-[#E8ECEA] dark:border-[#26373E]">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Badge variant={isPolitics ? 'warning' : 'brand'}>
                        {isPolitics ? '考研政治' : '考研英语一'}
                      </Badge>
                      <h2 className="text-sm sm:text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                        {formatExamTitle(group.year)}
                      </h2>
                      <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                        共 {group.items.length} 题
                        {group.dueCount > 0 ? ` · 待复习 ${group.dueCount}` : ''}
                        {group.masteredCount > 0
                          ? ` · 已攻克 ${group.masteredCount}`
                          : ''}
                      </span>
                      {latestAtt?.totalObjectiveScore !== undefined && (
                        <span className="text-xs font-tabular-mono text-[#3F7664] dark:text-[#4EA387] bg-emerald-50 dark:bg-[#172E27] px-2 py-0.5 rounded">
                          最近 {latestAtt.totalObjectiveScore}/
                          {latestAtt.maxObjectiveScore ?? 50} 分
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenPaperReview(group.year, group.items[0])
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] transition-colors"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>整卷原卷复盘</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedPaperKeys((prev) => ({
                            ...prev,
                            [group.paperKey]: isExpanded,
                          }))
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] bg-stone-100 dark:bg-[#162226] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>收起 ({group.items.length})</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>展开 ({group.items.length})</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-3 sm:p-4 space-y-3">
                      {group.items.map((item) => renderReviewCard(item, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredItems.map((item) => renderReviewCard(item, false))}
          </div>
        )}
      </div>
    </div>
  );
};
