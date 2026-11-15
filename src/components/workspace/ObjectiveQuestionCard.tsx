import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  LocateFixed,
  Sparkles,
} from 'lucide-react';
import type {
  ConfidenceLevel,
  ExamItem,
  ExamUnit,
  ObjectiveAIAnalysis,
  ObjectiveItemResponse,
} from '../../shared/types.ts';
import { SegmentedTabs } from '../ui/primitives.tsx';
import {
  FollowUpChatPanel,
  type FollowUpTurn,
} from './FollowUpChatPanel.tsx';

export interface ObjectiveQuestionCardProps {
  item: ExamItem;
  unit: ExamUnit;
  resp?: ObjectiveItemResponse;
  isActive: boolean;
  isSubmitted: boolean;
  compactReview?: boolean;
  anyModelAvailable: boolean;
  isAnalyzing: boolean;
  aiAnalysis?: ObjectiveAIAnalysis;
  showSingleNav: boolean;
  currentIndex: number;
  totalCountInUnit: number;
  knownErrorCauseOptions: string[];
  followUpHistory: FollowUpTurn[];
  isAskingFollowUp: boolean;
  renderTextWithSafeUnderline: (rawText: string) => React.ReactNode;
  onActivate: (qNum: number) => void;
  onSelectOption: (qNum: number, optionKey: string) => void;
  onSelectConfidence: (qNum: number, confidence: ConfidenceLevel) => void;
  onToggleFlag: (qNum: number) => void;
  onToggleKnownErrorCause: (qNum: number, cause: string) => void;
  onUpdateUserNotes?: (qNum: number, notes: string) => void;
  onNavigateQuestion: (direction: 'prev' | 'next') => void;
  onRequestAnalysis: (
    item: ExamItem,
    unit: ExamUnit,
    selectedAns: string,
    confidence: ConfidenceLevel
  ) => Promise<void>;
  onLocateEvidenceQuote: (quote: string) => void;
  onAskFollowUp: (qNum: number, questionText: string) => Promise<void>;
}

type PostSubmitTab = 'result' | 'ai' | 'followup';

export const ObjectiveQuestionCard: React.FC<ObjectiveQuestionCardProps> =
  React.memo(
    ({
      item,
      unit,
      resp,
      isActive,
      isSubmitted,
      compactReview = false,
      anyModelAvailable,
      isAnalyzing,
      aiAnalysis,
      showSingleNav,
      currentIndex,
      totalCountInUnit,
      knownErrorCauseOptions,
      followUpHistory,
      isAskingFollowUp,
      renderTextWithSafeUnderline,
      onActivate,
      onSelectOption,
      onSelectConfidence,
      onToggleFlag,
      onToggleKnownErrorCause,
      onUpdateUserNotes,
      onNavigateQuestion,
      onRequestAnalysis,
      onLocateEvidenceQuote,
      onAskFollowUp,
    }) => {
      const [postSubmitTab, setPostSubmitTab] = useState<PostSubmitTab>('result');
      const isCompact = isSubmitted && compactReview;

      const qNum = item.questionNumber;
      const selectedAns = resp?.selectedAnswer || '';
      const confidence: ConfidenceLevel = resp?.confidence || 'certain';
      const officialAns = item.correctAnswer;
      const isCorrect =
        isSubmitted && Boolean(officialAns) && selectedAns === officialAns;
      const isWrong =
        isSubmitted && Boolean(officialAns) && selectedAns !== officialAns;

      const handleTriggerAnalysis = async () => {
        setPostSubmitTab('ai');
        await onRequestAnalysis(
          item,
          unit,
          selectedAns || '未作答',
          confidence
        );
      };

      return (
        <div
          id={`question-card-${qNum}`}
          onClick={() => onActivate(qNum)}
          className={`bg-card rounded-2xl border transition-all shadow-xs ${
            isCompact ? 'p-3.5 sm:p-4 space-y-2.5' : 'p-5 sm:p-6 space-y-4'
          } ${
            isActive
              ? 'border-brand ring-1 ring-brand/20'
              : 'border-subtle'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold text-ink leading-snug">
              <span
                className={`font-tabular-mono text-brand font-bold mr-2 ${
                  isCompact ? 'text-sm' : 'text-base'
                }`}
              >
                #{qNum}
              </span>
              <span
                className={`font-english-serif ${
                  isCompact ? 'text-sm' : 'text-base'
                }`}
              >
                {renderTextWithSafeUnderline(item.prompt)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-tabular-mono text-muted">
                {item.score}分
              </span>
              <button
                type="button"
                aria-label={`标记第${qNum}题待复查`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFlag(qNum);
                }}
                className={`p-1.5 rounded-md border transition-colors ${
                  resp?.flaggedForReview
                    ? 'bg-danger-subtle border-rose-300 dark:border-rose-800 text-danger'
                    : 'bg-card-subtle border-subtle text-muted hover:text-ink'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Options List */}
          <div className={isCompact ? 'grid grid-cols-1 gap-1.5' : 'grid grid-cols-1 gap-2.5'}>
            {(item.options || []).map((opt) => {
              const isSelected = selectedAns === opt.key;
              const isOfficialCorrect = isSubmitted && officialAns === opt.key;
              const isSelectedWrong =
                isSubmitted && isSelected && officialAns !== opt.key;

              const badgeStyle = isOfficialCorrect
                ? 'bg-emerald-600 text-white'
                : isSelectedWrong
                ? 'bg-rose-600 text-white'
                : isSelected && !isSubmitted
                ? 'bg-white/20 text-white'
                : 'bg-stone-200/70 dark:bg-[#2C3E46] text-ink';

              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={isSubmitted}
                  onClick={() => onSelectOption(qNum, opt.key)}
                  className={`w-full text-left rounded-xl border flex items-start gap-2.5 transition-all ${
                    isCompact
                      ? 'px-3 py-1.5 text-xs sm:text-sm min-h-[38px]'
                      : 'px-4 py-3 text-sm min-h-[48px]'
                  } ${
                    isOfficialCorrect
                      ? 'bg-mastered-subtle border-emerald-500 dark:border-[#4EA387] text-ink font-medium'
                      : isSelectedWrong
                      ? 'bg-danger-subtle border-rose-400 dark:border-[#CF695E] text-ink'
                      : isSelected
                      ? 'bg-brand text-white border-brand shadow-2xs'
                      : 'bg-card-subtle text-ink border-subtle hover:bg-stone-100 dark:hover:bg-[#203036] hover:border-stone-300 dark:hover:border-[#3B515B]'
                  }`}
                >
                  <span
                    className={`font-tabular-mono font-bold shrink-0 px-1.5 py-0.5 rounded text-xs ${badgeStyle}`}
                  >
                    {opt.key}
                  </span>
                  <span
                    className={`font-english-serif flex-1 ${
                      isCompact ? 'text-xs sm:text-sm leading-snug pt-0.5' : 'text-sm leading-relaxed pt-0.5'
                    }`}
                  >
                    {opt.text}
                  </span>
                  {isSubmitted && (isOfficialCorrect || isSelectedWrong) && (
                    <span
                      className={`shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
                        isOfficialCorrect
                          ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-[#7CE0BE]'
                          : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-[#F39990]'
                      }`}
                    >
                      {isOfficialCorrect && isSelected
                        ? '✓ 选对'
                        : isOfficialCorrect
                        ? '+ 应选'
                        : '✕ 错选'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Confidence Selector */}
          <div className="pt-3 border-t border-hairline flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-secondary">做题把握度：</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'certain', label: '确定 (Certain)' },
                  { key: 'hesitant', label: '犹豫 (Hesitant)' },
                  { key: 'guessed', label: '猜测 (Guessed)' },
                ] as { key: ConfidenceLevel; label: string }[]
              ).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={isSubmitted}
                  onClick={() => onSelectConfidence(qNum, c.key)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    confidence === c.key
                      ? 'bg-brand text-white'
                      : 'bg-card-subtle text-secondary hover:text-ink'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Single Mode Navigation Footer */}
          {showSingleNav && (
            <div className="pt-4 border-t border-hairline flex items-center justify-between">
              <button
                type="button"
                disabled={currentIndex <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateQuestion('prev');
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-ink bg-card-subtle hover:bg-stone-200 dark:hover:bg-[#203036] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>上一题</span>
              </button>

              <span className="text-xs font-tabular-mono text-muted">
                {currentIndex + 1} / {totalCountInUnit} 题
              </span>

              <button
                type="button"
                disabled={currentIndex >= totalCountInUnit - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateQuestion('next');
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-ink bg-card-subtle hover:bg-stone-200 dark:hover:bg-[#203036] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <span>下一题</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Post-Submission Result, AI Analysis & Follow-Up */}
          {isSubmitted && (
            <div
              className={`border-t border-hairline text-xs bg-card-subtle rounded-xl ${
                isCompact ? 'p-2.5 space-y-2' : 'pt-3 space-y-3 p-3.5'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-tabular-mono font-semibold">
                  {!officialAns ? (
                    <span className="text-secondary">
                      暂无来源答案 · 你的作答: {selectedAns || '未作答'} · 不计客观分
                    </span>
                  ) : isCorrect ? (
                    <span className="text-mastered">
                      ✓ 回答正确 · 你的答案: {selectedAns} · 官方答案:{' '}
                      {officialAns}
                    </span>
                  ) : (
                    <span className="text-danger">
                      ✗ 回答错误 · 你的答案: {selectedAns || '未作答'} · 官方答案:{' '}
                      {officialAns}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!anyModelAvailable || isAnalyzing}
                  onClick={() => void handleTriggerAnalysis()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-brand text-brand hover:bg-brand hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {!anyModelAvailable
                      ? '需配置模型'
                      : isAnalyzing
                      ? '正在解析...'
                      : aiAnalysis
                      ? '刷新 AI 精析'
                      : 'AI 证据句精析'}
                  </span>
                </button>
              </div>

              <SegmentedTabs
                size="xs"
                ariaLabel={`第 ${qNum} 题交卷解析标签`}
                value={postSubmitTab}
                onChange={setPostSubmitTab}
                options={[
                  { id: 'result', label: '结果与错因' },
                  {
                    id: 'ai',
                    label: 'AI 证据精析',
                    badge: aiAnalysis ? '已就绪' : undefined,
                  },
                  {
                    id: 'followup',
                    label: '追问助教',
                    badge:
                      followUpHistory.length > 0
                        ? followUpHistory.length
                        : undefined,
                  },
                ]}
              />

              {postSubmitTab === 'result' && (
                <div className="space-y-2 pt-1">
                  {isWrong ? (
                    <div className="space-y-1.5">
                      <div className="font-medium text-ink">
                        标记已知错因（记入错题库）：
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {knownErrorCauseOptions.map((cause) => {
                          const active = (resp?.knownErrorCauses || []).includes(
                            cause
                          );
                          return (
                            <button
                              key={cause}
                              type="button"
                              onClick={() => onToggleKnownErrorCause(qNum, cause)}
                              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                active
                                  ? 'bg-danger text-white font-medium'
                                  : 'bg-card text-secondary border border-subtle hover:border-brand/50'
                              }`}
                            >
                              {cause}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-secondary leading-relaxed">
                      本题作答正确（把握度：{confidence}）。若对选项干扰逻辑或长难句仍有疑问，可切换至「AI 证据精析」或「追问助教」。
                    </div>
                  )}

                  {onUpdateUserNotes && (
                    <div className="pt-2 border-t border-hairline space-y-1">
                      <label className="block text-[11px] font-medium text-secondary">
                        我的复盘笔记（随时记录避坑要点）：
                      </label>
                      <textarea
                        rows={2}
                        value={resp?.userNotes || ''}
                        onChange={(e) => onUpdateUserNotes(qNum, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="记录本题定位线索、错因或干扰项辨析..."
                        className="w-full px-2.5 py-1.5 text-xs bg-card text-ink rounded-lg border border-subtle focus:outline-none focus:border-brand resize-y"
                      />
                    </div>
                  )}
                </div>
              )}

              {postSubmitTab === 'ai' && (
                <div className="pt-1">
                  {aiAnalysis ? (
                    <div className="p-3 bg-card rounded-lg border border-subtle space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-secondary border-b border-hairline pb-1.5">
                        <span className="font-semibold text-brand">
                          AI 辅助证据分析（非官方，仅供参考）
                        </span>
                        <span className="font-tabular-mono">
                          {aiAnalysis.modelProvider} ({aiAnalysis.modelName})
                        </span>
                      </div>

                      {aiAnalysis.dataQualityWarning && (
                        <div className="p-2.5 bg-warning-subtle border border-amber-300 dark:border-amber-800 rounded-md text-[11px] space-y-1 text-amber-900 dark:text-amber-200">
                          <div className="font-bold">
                            ⚠ 数据源与原文语义争议提示（已与 AI 模型错误隔离）
                          </div>
                          <div className="leading-relaxed">
                            {aiAnalysis.dataQualityWarning}
                          </div>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-ink">
                            原文证据句定位：
                          </span>
                          {aiAnalysis.evidenceQuote && (
                            <button
                              type="button"
                              onClick={() =>
                                onLocateEvidenceQuote(aiAnalysis.evidenceQuote)
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-brand-subtle text-brand hover:bg-brand hover:text-white transition-colors"
                            >
                              <LocateFixed className="w-3 h-3" />
                              <span>在原文中定位证据句</span>
                            </button>
                          )}
                        </div>
                        <div className="p-2 rounded bg-card-subtle border border-hairline font-english-serif text-ink leading-relaxed">
                          “{aiAnalysis.evidenceQuote}”
                        </div>
                      </div>

                      <div>
                        <span className="font-semibold text-ink">
                          解题思路结论：
                        </span>
                        <span className="text-ink ml-1">
                          {aiAnalysis.transferableConclusion}
                        </span>
                      </div>

                      {aiAnalysis.possibleErrorCauses.length > 0 && (
                        <div>
                          <span className="font-semibold text-danger">
                            干扰项与错因推测：
                          </span>
                          <span className="text-secondary ml-1">
                            {aiAnalysis.possibleErrorCauses.join('；')}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-card rounded-lg border border-subtle flex flex-wrap items-center justify-between gap-2 text-secondary">
                      <span>尚未生成本题的 AI 原文证据分析。</span>
                      <button
                        type="button"
                        disabled={!anyModelAvailable || isAnalyzing}
                        onClick={() => void handleTriggerAnalysis()}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-brand text-white disabled:opacity-50"
                      >
                        {isAnalyzing ? '解析中...' : '立即生成'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {postSubmitTab === 'followup' && (
                <div className="pt-1">
                  <FollowUpChatPanel
                    compact
                    title={`围绕第 #${qNum} 题向 AI 助教追问`}
                    placeholder="例如：为什么该干扰项属于偷换概念？定位区间如何缩窄..."
                    anyModelAvailable={anyModelAvailable}
                    isLoading={isAskingFollowUp}
                    history={followUpHistory}
                    onSendQuestion={(qText) => onAskFollowUp(qNum, qText)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
  );
