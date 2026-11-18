import React, { useState } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  History,
  PenTool,
} from 'lucide-react';
import type {
  ExamAttempt,
  MistakeSummaryRecord,
  PapersManifest,
  ReviewItem,
  SubjectId,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
  UnitType,
} from '../shared/types';
import {
  formatExamTitle,
  isPoliticsExamYear,
  resolveSubjectId,
} from '../shared/types';
import {
  countUniquePapers,
  dedupeSubmittedAttemptsByPaper,
} from '../shared/scoringAndReview';
import { Badge, SegmentedTabs } from './ui/primitives';
import { MistakeSummaryPanel } from './MistakeSummaryPanel';

interface StatsViewProps {
  manifest: PapersManifest;
  attempts: ExamAttempt[];
  subjectiveVersions: SubjectiveAnswerVersion[];
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  reviewItems: ReviewItem[];
  mistakeSummaries?: Record<string, MistakeSummaryRecord>;
  onSaveMistakeSummary?: (record: MistakeSummaryRecord) => void;
  anyModelAvailable?: boolean;
  activeProviderName?: string | null;
  onNavigateSettings?: () => void;
}

const UNIT_TYPE_LABELS: Partial<Record<UnitType, string>> = {
  cloze: '英语完形填空',
  reading: '英语传统阅读',
  'passage-assembly': '英语新题型',
  'politics-single': '政治单选 (1–16)',
  'politics-multi': '政治多选 (17–33)',
};

export const StatsView: React.FC<StatsViewProps> = ({
  manifest,
  attempts,
  subjectiveVersions,
  subjectiveEvaluations,
  reviewItems,
  mistakeSummaries = {},
  onSaveMistakeSummary = () => {},
  anyModelAvailable = false,
  activeProviderName = null,
  onNavigateSettings,
}) => {
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectId>('all');
  const [aggregationMode, setAggregationMode] = useState<
    'latest-per-paper' | 'all-attempts'
  >('latest-per-paper');

  const matchesSubject = (year: number, subjectId?: SubjectId) =>
    subjectFilter === 'all' || resolveSubjectId(year, subjectId) === subjectFilter;

  const filteredAttempts = attempts.filter((a) =>
    matchesSubject(a.year, a.subjectId)
  );
  const allSubmittedAttempts = filteredAttempts.filter(
    (a) => a.status === 'submitted' || Boolean(a.submittedAt)
  );
  const dedupedSubmittedAttempts =
    dedupeSubmittedAttemptsByPaper(allSubmittedAttempts);
  const uniqueSubmittedPaperCount = countUniquePapers(allSubmittedAttempts);
  const submittedAttempts =
    aggregationMode === 'latest-per-paper'
      ? dedupedSubmittedAttempts
      : allSubmittedAttempts;
  const filteredVersions = subjectiveVersions.filter((v) =>
    matchesSubject(v.year, v.subjectId)
  );
  const filteredReviews = reviewItems.filter((r) =>
    matchesSubject(r.year, r.subjectId)
  );

  const readyYears =
    manifest.years && manifest.years.length > 0
      ? Array.from(
          new Set(
            manifest.years
              .filter((entry) => entry.status === 'ready')
              .map((entry) => entry.year)
          )
        )
      : manifest.availableYears;
  const readyPaperCount = readyYears.filter(
    (y) => subjectFilter === 'all' || resolveSubjectId(y) === subjectFilter
  ).length;

  let totalAnswered = 0;
  let totalCorrect = 0;
  let totalScoreEarned = 0;
  let totalMaxScore = 0;

  const unitStats: Record<
    string,
    { answered: number; correct: number; scoreEarned: number; maxScore: number }
  > = {};
  let multiTotalWrong = 0;
  let multiPartialMissOnly = 0;
  let multiWrongOptionSelected = 0;

  for (const att of submittedAttempts) {
    if (att.totalObjectiveScore !== undefined) {
      totalScoreEarned += att.totalObjectiveScore;
      totalMaxScore +=
        att.maxObjectiveScore || (isPoliticsExamYear(att.year) ? 50 : 60);
    }
    for (const resp of Object.values(att.objectiveResponses || {})) {
      if (resp.selectedAnswer) {
        totalAnswered++;
        if (resp.isCorrect) totalCorrect++;

        const ut = resp.unitType || 'reading';
        if (!unitStats[ut]) {
          unitStats[ut] = { answered: 0, correct: 0, scoreEarned: 0, maxScore: 0 };
        }
        unitStats[ut].answered++;
        if (resp.isCorrect) unitStats[ut].correct++;
        unitStats[ut].scoreEarned += resp.scoreEarned ?? (resp.isCorrect ? resp.maxScore : 0);
        unitStats[ut].maxScore += resp.maxScore || 0;

        if (ut === 'politics-multi' && resp.isCorrect === false) {
          multiTotalWrong++;
          const sel = (resp.selectedAnswer || '').trim();
          const off = (resp.correctAnswer || '').trim();
          if (off) {
            const hasWrong = sel.split('').some((c) => !off.includes(c));
            if (!hasWrong && sel.length < off.length) {
              multiPartialMissOnly++;
            } else {
              multiWrongOptionSelected++;
            }
          }
        }
      }
    }
  }

  const accuracyRate =
    totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const allResponses = submittedAttempts.flatMap((a) =>
    Object.values(a.objectiveResponses || {})
  );

  const certainWrongCount = allResponses.filter(
    (r) => r.confidence === 'certain' && r.isCorrect === false
  ).length;

  const guessedCorrectCount = allResponses.filter(
    (r) => r.confidence === 'guessed' && r.isCorrect === true
  ).length;

  const hesitantWrongCount = allResponses.filter(
    (r) => r.confidence === 'hesitant' && r.isCorrect === false
  ).length;

  const knownCauseCounts: Record<string, number> = {};
  for (const r of allResponses) {
    for (const c of r.knownErrorCauses || []) {
      knownCauseCounts[c] = (knownCauseCounts[c] || 0) + 1;
    }
  }

  const masteredReviews = filteredReviews.filter((r) => r.mastered).length;
  const dueReviews = filteredReviews.filter((r) => !r.mastered).length;

  return (
    <div className="max-w-[1440px] w-full mx-auto space-y-6 py-2 sm:py-4">
      <div className="stats-overview-section bg-card rounded-2xl border border-subtle shadow-2xs p-6 sm:p-8 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-5">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">
              学情诊断与学习表现
            </h1>
            <p className="text-xs text-secondary">
              数据均由已交卷的实际作答记录实时聚合计算，严格区分「用户自选确认错因」与「AI 证据推测」。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <SegmentedTabs
              ariaLabel="统计去重口径"
              value={aggregationMode}
              onChange={setAggregationMode}
              size="xs"
              options={[
                { id: 'latest-per-paper', label: '每套最新成绩（去重）' },
                { id: 'all-attempts', label: '全部交卷（含二刷）' },
              ]}
            />
            <SegmentedTabs
              ariaLabel="统计学科切换"
              value={subjectFilter}
              onChange={setSubjectFilter}
              options={[
                { id: 'all', label: '全学科' },
                { id: 'english-i', label: '考研英语一' },
                { id: 'politics', label: '考研政治' },
              ]}
            />
          </div>
        </div>

        {/* 4-Card KPI Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-paper border border-hairline space-y-2">
            <div className="text-xs font-medium text-secondary">
              已完成试卷 / 题库规模
            </div>
            <div className="text-2xl font-bold text-ink font-tabular-mono">
              {uniqueSubmittedPaperCount}{' '}
              <span className="text-xs font-normal text-muted">
                套 / {readyPaperCount} 套
              </span>
            </div>
            <div className="text-[11px] text-muted font-tabular-mono">
              累计交卷 {allSubmittedAttempts.length} 次 · 草稿作答中：
              {filteredAttempts.length - allSubmittedAttempts.length} 次
            </div>
          </div>

          <div className="p-4 rounded-xl bg-paper border border-hairline space-y-2">
            <div className="text-xs font-medium text-secondary">
              客观题平均正确率
            </div>
            <div className="text-2xl font-bold text-mastered font-tabular-mono">
              {accuracyRate}%
            </div>
            <div className="text-[11px] text-muted font-tabular-mono">
              命中：{totalCorrect} / {totalAnswered} 题 · 总得 {totalScoreEarned}/{totalMaxScore} 分
            </div>
          </div>

          <div className="p-4 rounded-xl bg-paper border border-hairline space-y-2">
            <div className="text-xs font-medium text-secondary">
              高危偏差 (确定但答错)
            </div>
            <div className="text-2xl font-bold text-danger font-tabular-mono">
              {certainWrongCount}{' '}
              <span className="text-xs font-normal text-muted">题</span>
            </div>
            <div className="text-[11px] text-muted font-tabular-mono">
              猜测答对 {guessedCorrectCount} · 犹豫答错 {hesitantWrongCount}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-paper border border-hairline space-y-2">
            <div className="text-xs font-medium text-secondary">
              主观题版本 / 攻克错题
            </div>
            <div className="text-2xl font-bold text-brand font-tabular-mono">
              {filteredVersions.length}{' '}
              <span className="text-xs font-normal text-muted">
                稿 / {masteredReviews} 项
              </span>
            </div>
            <div className="text-[11px] text-muted">
              待到期复习：{dueReviews} 项
            </div>
          </div>
        </div>

        {/* Unit-Type Breakdown & Politics Multi-Choice Error Structure */}
        {Object.keys(unitStats).length > 0 && (
          <div className="bg-card-subtle rounded-xl border border-subtle p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-brand" />
                <h2 className="text-sm font-bold text-ink">
                  分题型正确率与多选失分结构诊断
                </h2>
              </div>
              {multiTotalWrong > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="warning">多选漏选（少选0分）：{multiPartialMissOnly} 题</Badge>
                  <Badge variant="danger">多选误选干扰项：{multiWrongOptionSelected} 题</Badge>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {Object.entries(unitStats).map(([ut, st]) => {
                const pct =
                  st.answered > 0 ? Math.round((st.correct / st.answered) * 100) : 0;
                return (
                  <div
                    key={ut}
                    className="p-3.5 bg-card rounded-lg border border-subtle space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">
                        {UNIT_TYPE_LABELS[ut as UnitType] || ut}
                      </span>
                      <span className="font-tabular-mono font-bold text-brand">
                        {pct}% ({st.correct}/{st.answered})
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-stone-100 dark:bg-[#25363D] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2-Column Diagnostic Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
          {/* Left: Known Error Causes Ranking */}
          <div className="bg-white dark:bg-[#162226] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-100 dark:border-[#26373E] pb-3">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-[#CF695E]" />
              <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                薄弱错因排行（用户确认）
              </h2>
            </div>
            {Object.keys(knownCauseCounts).length === 0 ? (
              <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] py-6 text-center">
                尚未标记错因。交卷后点击题目下方的错因标签即可在此归纳弱项。
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                {Object.entries(knownCauseCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cause, count]) => {
                    const maxVal = Math.max(...Object.values(knownCauseCounts), 1);
                    const pct = Math.round((count / maxVal) * 100);
                    return (
                      <div key={cause} className="space-y-1">
                        <div className="flex items-center justify-between text-[#202B2F] dark:text-[#E2E8E6]">
                          <span>{cause}</span>
                          <span className="font-tabular-mono font-semibold text-rose-700 dark:text-[#CF695E]">
                            {count} 次
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-stone-100 dark:bg-[#25363D] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-rose-600 dark:bg-[#CF695E] rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Right: Subjective Version Progression */}
          <div className="bg-white dark:bg-[#162226] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-100 dark:border-[#26373E] pb-3">
              <PenTool className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
              <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                主观题不可变版本轨迹 (V1 → V2 → V3)
              </h2>
            </div>
            {filteredVersions.length === 0 ? (
              <p className="text-xs text-secondary py-6 text-center">
                暂无主观题提交版本。在翻译、作文或政治分析题模块提交后，此处将记录各版本字数与用时轨迹。
              </p>
            ) : (
              <div className="space-y-3">
                {filteredVersions.slice(-5).map((ver) => {
                  const ev = ver.evaluationId
                    ? subjectiveEvaluations[ver.evaluationId]
                    : Object.values(subjectiveEvaluations).find(
                        (e) => e.answerVersionId === ver.id
                      );
                  return (
                    <div
                      key={ver.id}
                      className="p-3 bg-card-subtle rounded-lg border border-hairline flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-ink flex items-center gap-1.5">
                          <span>
                            {formatExamTitle(ver.year, 'short')} · Q{ver.questionNumber}
                          </span>
                          <span className="text-subtle">·</span>
                          <span className="text-brand font-medium">
                            {ver.versionLabel}
                          </span>
                        </div>
                        <div className="text-secondary font-tabular-mono mt-0.5">
                          {ver.practiceMode === 'independent'
                            ? '独立作答'
                            : ver.practiceMode === 'guided'
                            ? '引导练习'
                            : '复盘改写'}{' '}
                          · {ver.wordCount}
                          {isPoliticsExamYear(ver.year) ? '字' : '词'} ·{' '}
                          {ver.durationSeconds}秒
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {ev ? (
                          <span className="font-tabular-mono font-semibold text-emerald-800 dark:text-[#4EA387]">
                            {ev.centralScore} 分
                          </span>
                        ) : (
                          <span className="text-[#96A1A4] dark:text-[#657980]">未评分</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overall Mistake Analysis & Knowledge Summary Section */}
      <MistakeSummaryPanel
        attempts={attempts}
        reviewItems={reviewItems}
        mistakeSummaries={mistakeSummaries}
        onSaveMistakeSummary={onSaveMistakeSummary}
        anyModelAvailable={anyModelAvailable}
        activeProviderName={activeProviderName}
        onNavigateSettings={onNavigateSettings}
      />
    </div>
  );
};
