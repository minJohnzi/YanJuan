import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  GitCompare,
  History,
  Sparkles,
} from 'lucide-react';
import type {
  ExamItem,
  ExamUnit,
  HintRecord,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
  SubjectivePracticeMode,
  SubjectiveUnitType,
} from '../../shared/types.ts';
import { computeVersionDiff } from '../../shared/schemaValidator.ts';
import { AnnotatedTextViewer } from '../ui/primitives.tsx';

export interface PoliticsAnalysisStudioProps {
  year: number;
  dataVersion: string;
  currentUnit: ExamUnit;
  isSubmitted: boolean;
  isStrictSimulation: boolean;
  showAnswerSheet: boolean;
  anyModelAvailable: boolean;
  activeProviderName: string | null;
  unitVersions: SubjectiveAnswerVersion[];
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  drafts: Record<number, string>;
  onChangeDraft: (questionNumber: number, value: string) => void;
  getElapsedSeconds: () => number;
  onSubmitSubjectiveVersion: (params: {
    unitId: string;
    unitType: SubjectiveUnitType;
    questionNumber: number;
    practiceMode: SubjectivePracticeMode;
    content: string;
    durationSeconds: number;
    usedHints: HintRecord[];
  }) => SubjectiveAnswerVersion;
  onRequestSubjectiveEvaluation: (
    version: SubjectiveAnswerVersion,
    unit: ExamUnit
  ) => Promise<void>;
  onNavigateSettings: () => void;
}

export const PoliticsAnalysisStudio: React.FC<PoliticsAnalysisStudioProps> = ({
  year,
  dataVersion,
  currentUnit,
  isSubmitted,
  isStrictSimulation,
  showAnswerSheet,
  anyModelAvailable,
  activeProviderName,
  unitVersions,
  subjectiveEvaluations,
  drafts,
  onChangeDraft,
  getElapsedSeconds,
  onSubmitSubjectiveVersion,
  onRequestSubjectiveEvaluation,
  onNavigateSettings,
}) => {
  const [practiceModeByQuestion, setPracticeModeByQuestion] = useState<
    Record<number, SubjectivePracticeMode>
  >({});
  const [selectedVersionByQuestion, setSelectedVersionByQuestion] = useState<
    Record<number, string>
  >({});
  const [compareBaseByQuestion, setCompareBaseByQuestion] = useState<
    Record<number, string>
  >({});
  const [showDiffByQuestion, setShowDiffByQuestion] = useState<
    Record<number, boolean>
  >({});
  const [showRefByQuestion, setShowRefByQuestion] = useState<
    Record<number, boolean>
  >({});
  const [evaluatingVersionId, setEvaluatingVersionId] = useState<string | null>(
    null
  );
  const [errorByQuestion, setErrorByQuestion] = useState<Record<number, string>>(
    {}
  );
  const [activeAnnotationByQuestion, setActiveAnnotationByQuestion] = useState<
    Record<number, number | null>
  >({});
  const [completedTasksByQuestion, setCompletedTasksByQuestion] = useState<
    Record<string, boolean>
  >({});

  const versionsByQuestion = useMemo(() => {
    const grouped: Record<number, SubjectiveAnswerVersion[]> = {};
    for (const ver of unitVersions) {
      if (ver.year === year && ver.dataVersion === dataVersion) {
        if (!grouped[ver.questionNumber]) grouped[ver.questionNumber] = [];
        grouped[ver.questionNumber].push(ver);
      }
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => a.versionNumber - b.versionNumber);
    }
    return grouped;
  }, [unitVersions, year, dataVersion]);

  const handleSaveOrEvaluate = async (
    item: ExamItem,
    autoTriggerAi: boolean
  ) => {
    const qNum = item.questionNumber;
    const content = (drafts[qNum] || '').trim();
    if (!content) {
      setErrorByQuestion((prev) => ({
        ...prev,
        [qNum]: '请先输入作答要点后再保存版本',
      }));
      return;
    }

    setErrorByQuestion((prev) => ({ ...prev, [qNum]: '' }));
    const mode = practiceModeByQuestion[qNum] || 'independent';
    const created = onSubmitSubjectiveVersion({
      unitId: currentUnit.id,
      unitType: 'politics-analysis',
      questionNumber: qNum,
      practiceMode: mode,
      content,
      durationSeconds: getElapsedSeconds(),
      usedHints: [],
    });

    setSelectedVersionByQuestion((prev) => ({
      ...prev,
      [qNum]: created.id,
    }));

    if (autoTriggerAi && anyModelAvailable) {
      try {
        setEvaluatingVersionId(created.id);
        await onRequestSubjectiveEvaluation(created, currentUnit);
      } catch (err: any) {
        setErrorByQuestion((prev) => ({
          ...prev,
          [qNum]: err?.message || '主观题 AI 批改请求失败',
        }));
      } finally {
        setEvaluatingVersionId(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      {currentUnit.items.map((item) => {
        const qNum = item.questionNumber;
        const rawDraft = drafts[qNum] || '';
        const charCount = rawDraft.replace(/\s+/g, '').length;
        const qVersions = versionsByQuestion[qNum] || [];
        const selectedVerId =
          selectedVersionByQuestion[qNum] ||
          qVersions[qVersions.length - 1]?.id ||
          null;
        const selectedVersion =
          qVersions.find((v) => v.id === selectedVerId) ||
          qVersions[qVersions.length - 1] ||
          null;
        const compareBaseId =
          compareBaseByQuestion[qNum] ||
          (qVersions.length >= 2
            ? qVersions[qVersions.length - 2].id
            : qVersions[0]?.id) ||
          null;
        const compareBaseVersion =
          qVersions.find((v) => v.id === compareBaseId) || null;
        const diffResult =
          showDiffByQuestion[qNum] &&
          selectedVersion &&
          compareBaseVersion &&
          qVersions.length >= 2
            ? computeVersionDiff(
                compareBaseVersion.content,
                selectedVersion.content
              )
            : null;

        const selectedEvaluation = selectedVersion?.evaluationId
          ? subjectiveEvaluations[selectedVersion.evaluationId] || null
          : selectedVersion
          ? Object.values(subjectiveEvaluations).find(
              (ev) => ev.answerVersionId === selectedVersion.id
            ) || null
          : null;

        let latestEvaluatedForQ: SubjectiveEvaluationResult | null = null;
        for (let i = qVersions.length - 1; i >= 0; i--) {
          const v = qVersions[i];
          const ev = v.evaluationId
            ? subjectiveEvaluations[v.evaluationId] || null
            : Object.values(subjectiveEvaluations).find(
                (e) => e.answerVersionId === v.id
              ) || null;
          if (ev) {
            latestEvaluatedForQ = ev;
            break;
          }
        }

        const itemMaterials =
          currentUnit.materials.find((m) =>
            m.relatedItemIds?.includes(item.id)
          )?.paragraphs ||
          (item as any).materials ||
          [];

        const canShowReference =
          isSubmitted ||
          showAnswerSheet ||
          (!isStrictSimulation && Boolean(showRefByQuestion[qNum]));

        return (
          <div
            key={item.id}
            id={`question-card-${qNum}`}
            className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-stone-200/80 dark:border-[#2C3E46] p-5 sm:p-7 space-y-6 shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 dark:border-[#26373E] pb-3">
              <div className="flex items-center gap-2">
                <span className="font-tabular-mono font-bold text-lg text-[#174A5B] dark:text-[#75B6CE]">
                  第 {qNum} 题
                </span>
                {item.knowledgeModule && (
                  <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-[#174A5B]/10 dark:bg-[#38849E]/20 text-[#174A5B] dark:text-[#75B6CE]">
                    {item.knowledgeModule}
                  </span>
                )}
                <span className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                  (10分)
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <div className="inline-flex border border-[#DCE4E1] dark:border-[#2C3E46] rounded-md overflow-hidden">
                  {(['independent', 'rewrite'] as SubjectivePracticeMode[]).map(
                    (mode) => {
                      const active =
                        (practiceModeByQuestion[qNum] || 'independent') ===
                        mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            setPracticeModeByQuestion((prev) => ({
                              ...prev,
                              [qNum]: mode,
                            }))
                          }
                          className={`px-2.5 py-1 ${
                            active
                              ? 'bg-[#174A5B] text-white font-semibold'
                              : 'bg-stone-50 dark:bg-[#162226] text-[#68777C] dark:text-[#9CAEB3]'
                          }`}
                        >
                          {mode === 'independent' ? '独立作答' : '对照改写'}
                        </button>
                      );
                    }
                  )}
                </div>

                {!isStrictSimulation && !isSubmitted && !showAnswerSheet && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowRefByQuestion((prev) => ({
                        ...prev,
                        [qNum]: !prev[qNum],
                      }))
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-[#DCE4E1] dark:border-[#2C3E46] rounded-md text-[#174A5B] dark:text-[#75B6CE] hover:bg-stone-50 dark:hover:bg-[#162226]"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>
                      {showRefByQuestion[qNum] ? '隐藏要点' : '参考要点'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Materials */}
            {itemMaterials.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-bold text-stone-500 dark:text-[#9CAEB3]">
                  【阅读材料】
                </div>
                <div className="bg-[#FBFAF6] dark:bg-[#162226] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] p-4 sm:p-5 space-y-3 text-sm sm:text-base leading-relaxed text-[#202B2F] dark:text-[#E2E8E6] text-justify">
                  {itemMaterials.map((mText: string, mIdx: number) => (
                    <div key={mIdx} className="whitespace-pre-wrap">
                      {mText}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prompts */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-stone-500 dark:text-[#9CAEB3]">
                【问答题目要求】
              </div>
              <div className="p-4 bg-stone-50 dark:bg-[#1B262A] rounded-xl border border-stone-200/80 dark:border-[#2C3E46] text-sm sm:text-base font-medium text-[#202B2F] dark:text-[#E2E8E6] space-y-2">
                {item.subQuestions && item.subQuestions.length > 0 ? (
                  item.subQuestions.map((sq, sqIdx) => (
                    <div key={sqIdx} className="leading-relaxed">
                      {sq}
                    </div>
                  ))
                ) : (
                  <div className="leading-relaxed whitespace-pre-wrap">
                    {item.prompt}
                  </div>
                )}
              </div>
            </div>

            {/* Student Drafting Area */}
            <div className="space-y-2">
              {(practiceModeByQuestion[qNum] || 'independent') === 'rewrite' &&
                latestEvaluatedForQ &&
                latestEvaluatedForQ.revisionTasks.length > 0 && (
                  <div className="p-3 bg-brand-subtle/60 dark:bg-[#173038] border border-brand/30 rounded-xl space-y-1.5 text-xs">
                    <div className="font-semibold text-brand flex items-center justify-between">
                      <span>本轮升格重写目标清单（边改边勾）</span>
                      <span className="font-tabular-mono text-[11px]">
                        {
                          latestEvaluatedForQ.revisionTasks.filter(
                            (rt) => completedTasksByQuestion[`${qNum}:${rt.id}`]
                          ).length
                        }{' '}
                        / {latestEvaluatedForQ.revisionTasks.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {latestEvaluatedForQ.revisionTasks.map((rt) => {
                        const taskKey = `${qNum}:${rt.id}`;
                        const checked = Boolean(completedTasksByQuestion[taskKey]);
                        return (
                          <label
                            key={rt.id}
                            className="flex items-start gap-2 cursor-pointer text-ink"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setCompletedTasksByQuestion((prev) => ({
                                  ...prev,
                                  [taskKey]: e.target.checked,
                                }))
                              }
                              className="mt-0.5 rounded border-subtle accent-[#174A5B]"
                            />
                            <span className={checked ? 'line-through text-muted' : ''}>
                              {rt.instruction}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              <label className="text-xs font-semibold text-[#68777C] dark:text-[#9CAEB3] flex items-center justify-between">
                <span>作答要点与材料分析（支持 V1 → V2 → V3 不可变版本迭代）：</span>
                <span className="font-tabular-mono text-[11px]">
                  {charCount} 字
                </span>
              </label>
              <textarea
                rows={5}
                value={rawDraft}
                onChange={(e) => onChangeDraft(qNum, e.target.value)}
                placeholder="在此分条输入（1）理论原理依据与采分关键词；（2）紧扣材料主旨与现实意义的结合论述..."
                className="w-full p-4 text-sm bg-white dark:bg-[#162226] border border-stone-200 dark:border-[#2C3E46] rounded-xl focus:outline-none focus:border-[#174A5B] dark:focus:border-[#38849E] text-[#202B2F] dark:text-[#E2E8E6] leading-relaxed"
              />
            </div>

            {errorByQuestion[qNum] && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 rounded-lg text-xs text-rose-800 dark:text-rose-200">
                {errorByQuestion[qNum]}
              </div>
            )}

            {/* Version Submit & AI Evaluation Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E8ECEA] dark:border-[#26373E]">
              <button
                type="button"
                onClick={() => void handleSaveOrEvaluate(item, false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span>仅保存新版本 (生成 V{qVersions.length + 1})</span>
              </button>

              {anyModelAvailable ? (
                <button
                  type="button"
                  disabled={Boolean(evaluatingVersionId)}
                  onClick={() => void handleSaveOrEvaluate(item, true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] rounded-lg disabled:opacity-50 transition-colors shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {evaluatingVersionId
                      ? '正在执行政治分析题两阶段 AI 批改...'
                      : `提交 V${qVersions.length + 1} 并执行两阶段 AI 批改 (${
                          activeProviderName || 'gemini'
                        })`}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onNavigateSettings}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] bg-stone-100 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg hover:text-[#202B2F] dark:hover:text-[#E2E8E6] transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>配置 AI 模型以启用踩点批改</span>
                </button>
              )}
            </div>

            {/* Version History & Two-Stage AI Evaluation Report */}
            {qVersions.length > 0 && (
              <div className="bg-stone-50/70 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-2.5">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
                    <span className="text-xs font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                      第 {qNum} 题历史版本库（共 {qVersions.length} 稿 · 不可覆盖）
                    </span>
                  </div>
                  {qVersions.length >= 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowDiffByQuestion((prev) => ({
                          ...prev,
                          [qNum]: !prev[qNum],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] border border-[#174A5B] dark:border-[#38849E] rounded-md"
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      <span>
                        {showDiffByQuestion[qNum] ? '收起对比' : '版本差异 (Diff)'}
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {qVersions.map((ver) => (
                    <button
                      key={ver.id}
                      type="button"
                      onClick={() =>
                        setSelectedVersionByQuestion((prev) => ({
                          ...prev,
                          [qNum]: ver.id,
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-tabular-mono rounded-md border transition-colors ${
                        selectedVersion?.id === ver.id
                          ? 'bg-[#174A5B] dark:bg-[#38849E] text-white border-[#174A5B] dark:border-[#38849E] font-semibold'
                          : 'bg-white dark:bg-[#1E2B30] text-[#202B2F] dark:text-[#E2E8E6] border-[#DCE4E1] dark:border-[#2C3E46]'
                      }`}
                    >
                      {ver.versionLabel} ({ver.wordCount}字)
                    </button>
                  ))}
                </div>

                {diffResult && selectedVersion && compareBaseVersion && (
                  <div className="p-3 bg-white dark:bg-[#1A2529] rounded-lg border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        对比：{compareBaseVersion.versionLabel} →{' '}
                        {selectedVersion.versionLabel}（+{diffResult.addedCount} / -
                        {diffResult.removedCount}）
                      </span>
                      <select
                        aria-label={`选择第 ${qNum} 题基准对比版本`}
                        value={compareBaseVersion.id}
                        onChange={(e) =>
                          setCompareBaseByQuestion((prev) => ({
                            ...prev,
                            [qNum]: e.target.value,
                          }))
                        }
                        className="px-2 py-1 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded text-xs"
                      >
                        {qVersions.map((v) => (
                          <option key={v.id} value={v.id}>
                            基准: {v.versionLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="leading-relaxed">
                      {diffResult.segments.map((seg, i) => {
                        if (seg.type === 'added') {
                          return (
                            <span
                              key={i}
                              className="bg-emerald-500/20 text-emerald-800 dark:text-[#4EA387] font-semibold underline px-0.5 rounded"
                            >
                              {seg.text}
                            </span>
                          );
                        }
                        if (seg.type === 'removed') {
                          return (
                            <span
                              key={i}
                              className="bg-rose-500/20 text-rose-800 dark:text-[#CF695E] line-through px-0.5 rounded"
                            >
                              {seg.text}
                            </span>
                          );
                        }
                        return <span key={i}>{seg.text}</span>;
                      })}
                    </div>
                  </div>
                )}

                {selectedVersion && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono">
                      <span>
                        保存时间：
                        {new Date(selectedVersion.createdAt).toLocaleString(
                          'zh-CN'
                        )}{' '}
                        · 模式：{selectedVersion.practiceMode}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPracticeModeByQuestion((prev) => ({
                              ...prev,
                              [qNum]: 'rewrite',
                            }));
                            onChangeDraft(qNum, selectedVersion.content);
                          }}
                          className="text-[#174A5B] dark:text-[#75B6CE] hover:underline font-sans font-medium"
                        >
                          载入编辑器准备升格重写 →
                        </button>
                        {!selectedEvaluation && anyModelAvailable && (
                          <button
                            type="button"
                            disabled={evaluatingVersionId === selectedVersion.id}
                            onClick={async () => {
                              try {
                                setEvaluatingVersionId(selectedVersion.id);
                                await onRequestSubjectiveEvaluation(
                                  selectedVersion,
                                  currentUnit
                                );
                              } catch (err: any) {
                                setErrorByQuestion((prev) => ({
                                  ...prev,
                                  [qNum]: err?.message || 'AI 批改失败',
                                }));
                              } finally {
                                setEvaluatingVersionId(null);
                              }
                            }}
                            className="px-2.5 py-1 bg-[#174A5B] dark:bg-[#38849E] text-white rounded font-sans font-medium"
                          >
                            {evaluatingVersionId === selectedVersion.id
                              ? '批改中...'
                              : '运行 AI 批改'}
                          </button>
                        )}
                      </div>
                    </div>

                    <AnnotatedTextViewer
                      content={selectedVersion.content}
                      annotations={selectedEvaluation?.annotations || []}
                      activeAnnotationIdx={activeAnnotationByQuestion[qNum] ?? null}
                      onSelectAnnotation={(idx) =>
                        setActiveAnnotationByQuestion((prev) => ({
                          ...prev,
                          [qNum]: idx,
                        }))
                      }
                      isEnglishSerif={false}
                    />

                    {selectedEvaluation && (
                      <div className="border border-[#174A5B] dark:border-[#38849E] bg-white dark:bg-[#1E2B30] rounded-xl p-4 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-2">
                          <div>
                            <div className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                              政治分析题两阶段 AI 踩点批改报告（仅供参考）
                            </div>
                            <div className="text-[11px] text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono">
                              模型：{selectedEvaluation.modelProvider} (
                              {selectedEvaluation.modelName}) · 复核：
                              {selectedEvaluation.reviewerDecision}
                            </div>
                          </div>
                          <div className="text-right font-tabular-mono">
                            <div className="text-base font-bold text-[#174A5B] dark:text-[#75B6CE]">
                              参考得分：{selectedEvaluation.centralScore} /{' '}
                              {selectedEvaluation.maxScore} 分
                            </div>
                            <div className="text-[11px] text-[#68777C] dark:text-[#9CAEB3]">
                              区间 [{selectedEvaluation.scoreRangeMin},{' '}
                              {selectedEvaluation.scoreRangeMax}] · 置信度：
                              {selectedEvaluation.confidence}
                            </div>
                          </div>
                        </div>

                        {selectedEvaluation.dimensionScores.length > 0 && (
                          <div className="overflow-x-auto border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-stone-100 dark:bg-[#162226] border-b border-[#DCE4E1] dark:border-[#2C3E46] text-[#68777C] dark:text-[#9CAEB3]">
                                  <th className="py-1.5 px-3">采分维度</th>
                                  <th className="py-1.5 px-3">得分</th>
                                  <th className="py-1.5 px-3">原理与材料诊断</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#DCE4E1] dark:divide-[#2C3E46]">
                                {selectedEvaluation.dimensionScores.map(
                                  (d, idx) => (
                                    <tr key={idx}>
                                      <td className="py-1.5 px-3 font-semibold">
                                        {d.name}
                                      </td>
                                      <td className="py-1.5 px-3 font-tabular-mono text-[#174A5B] dark:text-[#75B6CE]">
                                        {d.score} / {d.maxScore}
                                      </td>
                                      <td className="py-1.5 px-3 text-[#68777C] dark:text-[#9CAEB3]">
                                        {d.rationale}
                                      </td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {selectedEvaluation.annotations.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="font-semibold">
                              逐句批注与采分建议：
                            </div>
                            {selectedEvaluation.annotations.map((ann, idx) => {
                              const isAnnActive =
                                (activeAnnotationByQuestion[qNum] ?? null) === idx;
                              return (
                                <div
                                  key={idx}
                                  onMouseEnter={() =>
                                    setActiveAnnotationByQuestion((prev) => ({
                                      ...prev,
                                      [qNum]: idx,
                                    }))
                                  }
                                  onClick={() =>
                                    setActiveAnnotationByQuestion((prev) => ({
                                      ...prev,
                                      [qNum]: isAnnActive ? null : idx,
                                    }))
                                  }
                                  className={`p-2.5 rounded border space-y-1 cursor-pointer transition-all ${
                                    isAnnActive
                                      ? 'bg-brand-subtle border-brand ring-1 ring-brand/40'
                                      : 'bg-stone-50 dark:bg-[#162226] border-[#DCE4E1] dark:border-[#2C3E46] hover:border-brand/50'
                                  }`}
                                >
                                  <div className="text-[11px] font-semibold text-[#174A5B] dark:text-[#75B6CE]">
                                    [{ann.severity}] {ann.issueType} — “
                                    {ann.quotedUserText}”
                                  </div>
                                  <div>{ann.explanation}</div>
                                  <div className="text-emerald-700 dark:text-[#4EA387]">
                                    建议改写：{ann.suggestion}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {selectedEvaluation.revisionTasks.length > 0 && (
                          <div className="space-y-1">
                            <div className="font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-[#4EA387]" />
                              <span>下一步升格清单：</span>
                            </div>
                            <ul className="list-disc pl-5 space-y-0.5 text-[#68777C] dark:text-[#9CAEB3]">
                              {selectedEvaluation.revisionTasks.map((rt) => (
                                <li key={rt.id}>{rt.instruction}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Official Reference Answer */}
            {canShowReference && (
              <div className="space-y-4 pt-4 border-t border-stone-100 dark:border-[#26373E]">
                <div className="p-5 bg-emerald-50/60 dark:bg-[#172E27]/60 rounded-xl border border-emerald-300 dark:border-emerald-800 space-y-3">
                  <div className="font-bold text-sm text-emerald-900 dark:text-[#4EA387] flex items-center justify-between">
                    <span>【官方参考答案要点与采分标准】</span>
                    <span className="text-xs font-tabular-mono">
                      参考得分：10分
                    </span>
                  </div>
                  <div className="text-xs sm:text-sm text-[#202B2F] dark:text-[#E2E8E6] whitespace-pre-wrap leading-relaxed font-sans">
                    {item.answerKeyPoints ||
                      item.rubric?.referenceText ||
                      item.officialExplanation}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
