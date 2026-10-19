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
} from 'lucide-react';
import type { ReviewItem, ReviewItemType, UnitType } from '../shared/types';
import { formatReviewTypeLabel } from '../shared/scoringAndReview';

interface ReviewCenterViewProps {
  reviewItems: ReviewItem[];
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
  onJumpToUnit: (year: number, unitType: UnitType, unitId?: string) => void;
}

const FILTER_TYPES: ReviewItemType[] = [
  'objective-confident-error',
  'objective-error',
  'objective-hesitant-error',
  'objective-guessed-right',
  're-translate',
  'revise-essay',
  'fix-sentence',
  'objective-manual',
];

export const ReviewCenterView: React.FC<ReviewCenterViewProps> = ({
  reviewItems,
  onCompleteReview,
  onCreateCustomReviewItem,
  onJumpToUnit,
}) => {
  const [filterType, setFilterType] = useState<'all' | ReviewItemType>('all');
  const [statusTab, setStatusTab] = useState<'due' | 'all' | 'mastered'>('due');
  const [showAddForm, setShowAddForm] = useState(false);

  const [newType, setNewType] = useState<ReviewItemType>('fix-sentence');
  const [newTitle, setNewTitle] = useState('');
  const [newContext, setNewContext] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newTarget, setNewTarget] = useState('拆解主干从句并默写译文');

  const dueCount = reviewItems.filter(
    (item) => !item.mastered && new Date(item.nextDueAt).getTime() <= Date.now() + 86400 * 1000
  ).length;
  const masteredCount = reviewItems.filter((item) => item.mastered).length;

  const filteredItems = reviewItems.filter((item) => {
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
          <button
            type="button"
            onClick={() => setShowAddForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] whitespace-nowrap self-start sm:self-auto transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>收录难句 / 词汇</span>
          </button>
        </div>

        {/* Modal / Form for manual custom review item */}
        {showAddForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTitle.trim() || !newContext.trim()) return;
              onCreateCustomReviewItem({
                year: 2024,
                questionNumber: 34,
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
            className="p-5 bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                收录真题复习卡（自动进入 1/3/7/14/30 天排期队列）
              </span>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[#68777C] dark:text-[#9CAEB3]">复习卡类型</span>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ReviewItemType)}
                  className="w-full p-2 bg-white dark:bg-[#1A2529] rounded border border-[#DCE4E1] dark:border-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6]"
                >
                  <option value="fix-sentence">长难句精析</option>
                  <option value="objective-manual">核心词汇/短语</option>
                  <option value="re-translate">翻译二次盲译</option>
                  <option value="revise-essay">作文升格重写</option>
                </select>
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-[#68777C] dark:text-[#9CAEB3]">
                  标题（例如：2024 Text 1 艺术评论句型）
                </span>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="如：2024 Text 1 段首长难句"
                  className="w-full p-2 bg-white dark:bg-[#1A2529] rounded border border-[#DCE4E1] dark:border-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6]"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-[#68777C] dark:text-[#9CAEB3]">真题原句或语境摘录</span>
              <textarea
                rows={2}
                required
                value={newContext}
                onChange={(e) => setNewContext(e.target.value)}
                placeholder="粘贴英文句子..."
                className="w-full p-2 bg-white dark:bg-[#1A2529] rounded border border-[#DCE4E1] dark:border-[#2C3E46] font-english-serif text-[#202B2F] dark:text-[#E2E8E6]"
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

        {/* Status Switcher Tabs & Type Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#162226] rounded-lg overflow-x-auto max-w-full">
            {[
              { id: 'due' as const, label: `待复习 (${dueCount})` },
              { id: 'all' as const, label: `全部队列 (${reviewItems.length})` },
              { id: 'mastered' as const, label: `已攻克 (${masteredCount})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setStatusTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap min-h-[36px] flex-1 text-center shrink-0 ${
                  statusTab === t.id
                    ? 'bg-white dark:bg-[#1E2B30] text-[#174A5B] dark:text-[#75B6CE] shadow-2xs font-semibold'
                    : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
                }`}
              >
                {t.label}
              </button>
            ))}
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
        ) : (
          <div className="space-y-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="bg-white dark:bg-[#1A2529] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] hover:border-[#174A5B]/40 dark:hover:border-[#38849E]/50 transition-all p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-2 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-[#202B2F] dark:text-[#E2E8E6] text-sm">
                      {item.title}
                    </span>
                    <span className="text-[#96A1A4] dark:text-[#657980]">·</span>
                    <span className="text-[#68777C] dark:text-[#9CAEB3]">
                      {formatReviewTypeLabel(item.reviewType)}
                    </span>
                    <span className="text-[#96A1A4] dark:text-[#657980]">·</span>
                    <span className="font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                      间隔 {item.intervalDays} 天 (已连对 {item.repetitionCount} 次)
                    </span>
                  </div>

                  <p className="font-english-serif text-sm text-[#202B2F] dark:text-[#E2E8E6] bg-[#FBFAF6] dark:bg-[#162226] p-3.5 rounded-lg border border-[#E8ECEA] dark:border-[#223036] leading-relaxed">
                    {item.promptSnapshot}
                  </p>

                  <div className="text-xs text-[#68777C] dark:text-[#9CAEB3] flex flex-wrap items-center gap-3">
                    <span>你的作答：{item.previousUserAnswer}</span>
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
                    onClick={() => onJumpToUnit(item.year, item.unitType, item.unitId)}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
