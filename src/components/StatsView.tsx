import React from 'react';
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
  PapersManifest,
  ReviewItem,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
} from '../shared/types';

interface StatsViewProps {
  manifest: PapersManifest;
  attempts: ExamAttempt[];
  subjectiveVersions: SubjectiveAnswerVersion[];
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  reviewItems: ReviewItem[];
}

export const StatsView: React.FC<StatsViewProps> = ({
  manifest,
  attempts,
  subjectiveVersions,
  subjectiveEvaluations,
  reviewItems,
}) => {
  const submittedAttempts = attempts.filter((a) => a.submittedAt);

  let totalAnswered = 0;
  let totalCorrect = 0;
  let totalScoreEarned = 0;
  let totalMaxScore = 0;

  for (const att of submittedAttempts) {
    if (att.totalObjectiveScore !== undefined) {
      totalScoreEarned += att.totalObjectiveScore;
      totalMaxScore += att.maxObjectiveScore || 60;
    }
    for (const resp of Object.values(att.objectiveResponses || {})) {
      if (resp.selectedAnswer) {
        totalAnswered++;
        if (resp.isCorrect) totalCorrect++;
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

  const masteredReviews = reviewItems.filter((r) => r.mastered).length;
  const dueReviews = reviewItems.filter((r) => !r.mastered).length;

  return (
    <div className="max-w-[1440px] w-full mx-auto space-y-6 py-2 sm:py-4">
      <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-8">
        <div className="space-y-1 border-b border-[#E8ECEA] dark:border-[#26373E] pb-5">
          <h1 className="text-xl sm:text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6]">
            学情诊断与学习表现
          </h1>
          <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
            数据均由已交卷的实际作答记录实时聚合计算，严格区分「用户自选确认错因」与「AI 证据推测」。
          </p>
        </div>

        {/* 4-Card KPI Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#FBFAF6] dark:bg-[#162226] border border-[#E8ECEA] dark:border-[#223036] space-y-2">
            <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3]">
              已交卷 / 题库规模
            </div>
            <div className="text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6] font-tabular-mono">
              {submittedAttempts.length}{' '}
              <span className="text-xs font-normal text-[#96A1A4] dark:text-[#657980]">
                次 / {manifest.availableYears.length} 套
              </span>
            </div>
            <div className="text-[11px] text-[#96A1A4] dark:text-[#657980]">
              草稿作答中：{attempts.length - submittedAttempts.length} 次
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#FBFAF6] dark:bg-[#162226] border border-[#E8ECEA] dark:border-[#223036] space-y-2">
            <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3]">
              客观题平均正确率
            </div>
            <div className="text-2xl font-bold text-[#3F7664] dark:text-[#4EA387] font-tabular-mono">
              {accuracyRate}%
            </div>
            <div className="text-[11px] text-[#96A1A4] dark:text-[#657980] font-tabular-mono">
              命中：{totalCorrect} / {totalAnswered} 题
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#FBFAF6] dark:bg-[#162226] border border-[#E8ECEA] dark:border-[#223036] space-y-2">
            <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3]">
              高危偏差 (确定但答错)
            </div>
            <div className="text-2xl font-bold text-[#A8544A] dark:text-[#CF695E] font-tabular-mono">
              {certainWrongCount}{' '}
              <span className="text-xs font-normal text-[#96A1A4] dark:text-[#657980]">
                题
              </span>
            </div>
            <div className="text-[11px] text-[#96A1A4] dark:text-[#657980] font-tabular-mono">
              猜测答对 {guessedCorrectCount} · 犹豫答错 {hesitantWrongCount}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#FBFAF6] dark:bg-[#162226] border border-[#E8ECEA] dark:border-[#223036] space-y-2">
            <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3]">
              主观题版本 / 攻克错题
            </div>
            <div className="text-2xl font-bold text-[#174A5B] dark:text-[#75B6CE] font-tabular-mono">
              {subjectiveVersions.length}{' '}
              <span className="text-xs font-normal text-[#96A1A4] dark:text-[#657980]">
                稿 / {masteredReviews} 项
              </span>
            </div>
            <div className="text-[11px] text-[#96A1A4] dark:text-[#657980]">
              待到期复习：{dueReviews} 项
            </div>
          </div>
        </div>

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
            {subjectiveVersions.length === 0 ? (
              <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] py-6 text-center">
                暂无主观题提交版本。在翻译或作文模块提交后，此处将记录各版本词数与用时轨迹。
              </p>
            ) : (
              <div className="space-y-3">
                {subjectiveVersions.slice(-5).map((ver) => {
                  const ev = ver.evaluationId
                    ? subjectiveEvaluations[ver.evaluationId]
                    : Object.values(subjectiveEvaluations).find(
                        (e) => e.answerVersionId === ver.id
                      );
                  return (
                    <div
                      key={ver.id}
                      className="p-3 bg-stone-50 dark:bg-[#1E2B30] rounded-lg border border-stone-100 dark:border-[#26373E] flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-1.5">
                          <span>
                            {ver.year}年 · Q{ver.questionNumber}
                          </span>
                          <span className="text-stone-300 dark:text-[#2C3E46]">·</span>
                          <span className="text-[#174A5B] dark:text-[#75B6CE] font-medium">
                            {ver.versionLabel}
                          </span>
                        </div>
                        <div className="text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono mt-0.5">
                          {ver.practiceMode === 'independent'
                            ? '独立作答'
                            : ver.practiceMode === 'guided'
                            ? '引导练习'
                            : '复盘改写'}{' '}
                          · {ver.wordCount}词 · {ver.durationSeconds}秒
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
    </div>
  );
};
