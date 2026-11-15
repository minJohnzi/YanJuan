import React, { useMemo, useState } from 'react';
import { GitCompare, History, Sparkles } from 'lucide-react';
import type {
  ExamUnit,
  HintRecord,
  SubjectiveAnswerVersion,
  SubjectiveEvaluationResult,
  SubjectivePracticeMode,
  WritingScaffoldResult,
} from '../../shared/types.ts';
import type { computeVersionDiff } from '../../shared/schemaValidator.ts';
import type { ReadingTypographyPrefs } from '../../services/storageAndSync.ts';
import { CulturalHotpotIllustration } from '../CulturalHotpotIllustration.tsx';
import { AnnotatedTextViewer } from '../ui/primitives.tsx';
import {
  FollowUpChatPanel,
  type FollowUpTurn,
} from './FollowUpChatPanel.tsx';

export interface EnglishSubjectiveStudioProps {
  examYear: number;
  currentUnit: ExamUnit;
  anyModelAvailable: boolean;
  activeProviderName: string | null;
  typographyPrefs: ReadingTypographyPrefs;
  practiceMode: SubjectivePracticeMode;
  onSelectPracticeMode: (mode: SubjectivePracticeMode) => void;
  translationInputs: Record<number, string>;
  onChangeTranslationInput: (qNum: number, value: string) => void;
  writingDraft: string;
  onChangeWritingDraft: (value: string) => void;
  unitVersions: SubjectiveAnswerVersion[];
  selectedVersion: SubjectiveAnswerVersion | null;
  compareBaseVersion: SubjectiveAnswerVersion | null;
  selectedEvaluation: SubjectiveEvaluationResult | null;
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
  versionDiffResult: ReturnType<typeof computeVersionDiff> | null;
  showDiffPanel: boolean;
  onToggleDiffPanel: () => void;
  onSelectVersionId: (id: string) => void;
  onSelectCompareBaseVersionId: (id: string) => void;
  evaluatingVersionId: string | null;
  onSaveVersion: (autoTriggerAi: boolean) => Promise<void>;
  onEvaluateExistingVersion: (
    version: SubjectiveAnswerVersion
  ) => Promise<void>;
  aiScaffolds: Record<string, WritingScaffoldResult>;
  loadingScaffold: boolean;
  onGenerateScaffold?: () => Promise<void>;
  practicalSpec?: ExamUnit['materials'][number]['practicalWritingSpec'];
  visualMat?: NonNullable<ExamUnit['materials'][number]['visualMaterials']>[number];
  visualMats: NonNullable<ExamUnit['materials'][number]['visualMaterials']>;
  subjectiveBaseSec: number;
  renderTimerReadout: (baseElapsedSeconds: number) => React.ReactNode;
  renderTextWithSafeUnderline: (rawText: string) => React.ReactNode;
  countEnglishWords: (text: string) => number;
  followUpHistory: FollowUpTurn[];
  isAskingFollowUp: boolean;
  onSendFollowUp: (questionText: string) => Promise<void>;
  onNavigateSettings: () => void;
  usedHints: HintRecord[];
}

export const EnglishSubjectiveStudio: React.FC<EnglishSubjectiveStudioProps> = ({
  examYear,
  currentUnit,
  anyModelAvailable,
  activeProviderName,
  typographyPrefs,
  practiceMode,
  onSelectPracticeMode,
  translationInputs,
  onChangeTranslationInput,
  writingDraft,
  onChangeWritingDraft,
  unitVersions,
  selectedVersion,
  compareBaseVersion,
  selectedEvaluation,
  subjectiveEvaluations,
  versionDiffResult,
  showDiffPanel,
  onToggleDiffPanel,
  onSelectVersionId,
  onSelectCompareBaseVersionId,
  evaluatingVersionId,
  onSaveVersion,
  onEvaluateExistingVersion,
  aiScaffolds,
  loadingScaffold,
  onGenerateScaffold,
  practicalSpec,
  visualMat,
  visualMats,
  subjectiveBaseSec,
  renderTimerReadout,
  renderTextWithSafeUnderline,
  countEnglishWords,
  followUpHistory,
  isAskingFollowUp,
  onSendFollowUp,
  onNavigateSettings,
}) => {
  const [activeAnnotationIdx, setActiveAnnotationIdx] = useState<number | null>(
    null
  );
  const [completedRewriteTasks, setCompletedRewriteTasks] = useState<
    Record<string, boolean>
  >({});

  const latestEvaluatedForUnit = useMemo(() => {
    for (let i = unitVersions.length - 1; i >= 0; i--) {
      const v = unitVersions[i];
      const ev = v.evaluationId
        ? subjectiveEvaluations[v.evaluationId] || null
        : Object.values(subjectiveEvaluations).find(
            (e) => e.answerVersionId === v.id
          ) || null;
      if (ev) return ev;
    }
    return null;
  }, [unitVersions, subjectiveEvaluations]);

  const handleLoadVersionIntoEditor = (ver: SubjectiveAnswerVersion) => {
    onSelectPracticeMode('rewrite');
    if (currentUnit.unitType === 'translation' && ver.subAnswers) {
      for (const [qStr, val] of Object.entries(ver.subAnswers)) {
        onChangeTranslationInput(Number(qStr), val);
      }
    } else {
      onChangeWritingDraft(ver.content);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column */}
      <div className="lg:col-span-6 bg-card rounded-2xl border border-subtle p-6 space-y-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
          <div>
            <h1 className="text-base font-bold text-ink">{currentUnit.title}</h1>
            <p className="text-xs text-secondary mt-0.5">
              {currentUnit.instructions}
            </p>
          </div>
        </div>

        {/* Three Practice Modes Switcher */}
        <div className="p-3 bg-card-subtle rounded-xl border border-subtle space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">
              主观题三阶训练模式：
            </span>
            <div className="flex items-center gap-1">
              {(
                [
                  { key: 'independent', label: '1. 独立作答' },
                  { key: 'guided', label: '2. 引导练习 (结构支架)' },
                  { key: 'rewrite', label: '3. 复盘改写 (V2/V3)' },
                ] as { key: SubjectivePracticeMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => onSelectPracticeMode(m.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                    practiceMode === m.key
                      ? 'bg-brand text-white border-brand'
                      : 'bg-card text-ink border-subtle'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {practiceMode === 'guided' && (
            <div className="p-3 bg-card rounded-lg border border-subtle text-xs space-y-2 text-ink">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-brand">
                  引导练习结构提示（作答提交前严禁泄露参考译文或完整范文 · 启用支架将记录独立度系数）：
                </div>
                {anyModelAvailable && onGenerateScaffold && (
                  <button
                    type="button"
                    disabled={loadingScaffold}
                    onClick={() => void onGenerateScaffold()}
                    className="px-2.5 py-1 text-[11px] font-medium rounded border border-brand text-brand hover:bg-brand hover:text-white disabled:opacity-50 transition-colors"
                  >
                    {loadingScaffold
                      ? '生成 AI 支架中...'
                      : aiScaffolds[currentUnit.id]
                      ? '重新生成 AI 定制结构支架'
                      : '生成 AI 定制三段式支架与词块'}
                  </button>
                )}
              </div>

              {aiScaffolds[currentUnit.id] ? (
                <div className="space-y-2 pt-1 border-t border-hairline">
                  <div className="grid grid-cols-1 gap-1.5">
                    {aiScaffolds[currentUnit.id].paragraphPurposes.map((p) => (
                      <div
                        key={p.paragraphIndex}
                        className="p-2 bg-card-subtle rounded border border-subtle"
                      >
                        <div className="font-semibold text-brand">
                          第 {p.paragraphIndex} 段（{p.title} ·{' '}
                          {p.recommendedWordCount}）：
                        </div>
                        <div className="text-secondary">写作目标：{p.purpose}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-secondary">
                    推荐核心表达词块：
                    <span className="font-english-serif text-ink ml-1">
                      {aiScaffolds[currentUnit.id].corePhraseBank
                        .map((cp) => `${cp.phrase} (${cp.usageNote})`)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
              ) : currentUnit.unitType === 'translation' ? (
                <ul className="list-disc pl-4 space-y-1 text-secondary">
                  <li>
                    (46) 句法重点：找到主干 scientists have a duty...，处理好以 because 引导的原因状语从句。
                  </li>
                  <li>
                    (47) 句法重点：Such a system 承接上文，注意 be based on 的被动转主动译法。
                  </li>
                  <li>
                    (48) 句法重点：拆解定语从句修饰关系，先译主干再顺译修饰成分。
                  </li>
                  <li>
                    (49) 句法重点：区分 bird species 与 the rest of the creatures 的并列对比结构。
                  </li>
                  <li>
                    (50) 句法重点：末句总结段意，确保代词指代与中文语序自然顺畅。
                  </li>
                </ul>
              ) : currentUnit.unitType === 'practical-writing' ? (
                <ul className="list-disc pl-4 space-y-1 text-secondary">
                  <li>
                    第一段（目的）：以研究生会名义直接表明招募国际学术会议志愿者的通知目的。
                  </li>
                  <li>
                    第二段（条件与职责）：简明列出英语流利、跨文化沟通能力、团队协作意识等核心要求。
                  </li>
                  <li>
                    第三段（报名方式）：交代报名截止时间与联系方式，礼貌收尾（控制在 100 词左右）。
                  </li>
                </ul>
              ) : (
                <ul className="list-disc pl-4 space-y-1 text-secondary">
                  <li>
                    第一段（图画描摹）：准确描述图画核心人物/数据特征及寓意标题。
                  </li>
                  <li>
                    第二段（象征意义论证）：阐明现象背后的社会文化动因与现实意义。
                  </li>
                  <li>
                    第三段（结论与升华）：提出务实平衡的建议与正面展望（160–200 词）。
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Translation Passage */}
        {currentUnit.unitType === 'translation' &&
          currentUnit.materials.map((mat) => {
            const paras =
              mat.paragraphs && mat.paragraphs.length > 0
                ? mat.paragraphs
                : mat.text.split(/\n{2,}/).filter(Boolean);
            return (
              <article
                key={mat.id}
                style={{
                  fontSize: `${typographyPrefs.fontSizePx}px`,
                  lineHeight: typographyPrefs.lineHeight,
                }}
                className="font-english-serif text-ink space-y-3"
              >
                {paras.map((pText, idx) => (
                  <p key={idx} className="leading-relaxed">
                    <span className="font-tabular-mono text-xs text-muted mr-2">
                      [P{idx + 1}]
                    </span>
                    {renderTextWithSafeUnderline(pText)}
                  </p>
                ))}
              </article>
            );
          })}

        {/* Practical Writing Prompt Spec (Q51) */}
        {currentUnit.unitType === 'practical-writing' && (
          <div className="space-y-3 text-xs">
            <div className="p-4 bg-card-subtle border border-subtle rounded-xl font-english-serif text-sm text-ink leading-relaxed">
              {currentUnit.items[0]?.prompt}
            </div>
            {practicalSpec && (
              <div className="p-4 bg-card rounded-xl border border-subtle space-y-2">
                <div className="font-semibold text-ink">
                  应用文审题必含要素核查清单：
                </div>
                <ul className="list-disc pl-4 space-y-1 text-secondary">
                  {practicalSpec.requiredPoints.map((pt, i) => (
                    <li key={i}>{pt}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Visual Writing Illustration & Prompt (Q52) */}
        {currentUnit.unitType === 'visual-writing' && visualMat && (
          <div className="space-y-4">
            <CulturalHotpotIllustration
              visualMaterial={visualMat}
              allVisualMaterials={visualMats}
            />
          </div>
        )}
      </div>

      {/* Right Column: Subjective Editor, Immutable Version History, Two-Stage Evaluation & Diff */}
      <div className="lg:col-span-6 space-y-5">
        <div className="bg-card rounded-2xl border border-subtle p-6 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
            <div>
              <h2 className="text-sm font-bold text-ink">
                主观题作答与不可变版本工作台
              </h2>
              <span className="text-xs text-secondary">
                每次保存均新增独立版本（V1 原稿 → V2 修改稿 → V3 延时重写），严禁覆盖历史稿件
              </span>
            </div>
            {renderTimerReadout(subjectiveBaseSec)}
          </div>

          {practiceMode === 'rewrite' &&
            latestEvaluatedForUnit &&
            latestEvaluatedForUnit.revisionTasks.length > 0 && (
              <div className="p-3 bg-brand-subtle/60 dark:bg-[#173038] border border-brand/30 rounded-xl space-y-1.5 text-xs">
                <div className="font-semibold text-brand flex items-center justify-between">
                  <span>
                    V{unitVersions.length + 1} 升格重写核查清单（边改边勾）
                  </span>
                  <span className="font-tabular-mono text-[11px]">
                    {
                      latestEvaluatedForUnit.revisionTasks.filter(
                        (rt) =>
                          completedRewriteTasks[
                            `${latestEvaluatedForUnit.id}:${rt.id}`
                          ]
                      ).length
                    }{' '}
                    / {latestEvaluatedForUnit.revisionTasks.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {latestEvaluatedForUnit.revisionTasks.map((rt) => {
                    const taskKey = `${latestEvaluatedForUnit.id}:${rt.id}`;
                    const checked = Boolean(completedRewriteTasks[taskKey]);
                    return (
                      <label
                        key={rt.id}
                        className="flex items-start gap-2 cursor-pointer text-ink"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setCompletedRewriteTasks((prev) => ({
                              ...prev,
                              [taskKey]: e.target.checked,
                            }))
                          }
                          className="mt-0.5 rounded border-subtle accent-[#174A5B]"
                        />
                        <span
                          className={checked ? 'line-through text-muted' : ''}
                        >
                          [P{rt.priority}] {rt.instruction}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

          {currentUnit.unitType === 'translation' ? (
            <div className="space-y-4">
              {currentUnit.items.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <label
                    htmlFor={`trans-input-${item.questionNumber}`}
                    className="block text-xs font-semibold text-ink"
                  >
                    <span className="font-tabular-mono text-brand mr-1.5">
                      ({item.questionNumber})
                    </span>
                    <span className="font-english-serif font-normal">
                      {item.translationMeta?.underlinedEnglish || item.prompt}
                    </span>
                  </label>
                  <textarea
                    id={`trans-input-${item.questionNumber}`}
                    rows={2}
                    value={translationInputs[item.questionNumber] || ''}
                    onChange={(e) =>
                      onChangeTranslationInput(
                        item.questionNumber,
                        e.target.value
                      )
                    }
                    placeholder={`请输入第 (${item.questionNumber}) 句的中文译文...`}
                    className="w-full p-2.5 text-sm bg-card-subtle border border-subtle rounded-lg text-ink focus:bg-card focus:border-brand focus:outline-none"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-secondary font-tabular-mono">
                <span>当前英文词数：{countEnglishWords(writingDraft)} 词</span>
                <span>
                  建议词数区间：
                  {currentUnit.unitType === 'practical-writing'
                    ? '90–120 词'
                    : '160–200 词'}
                </span>
              </div>
              <textarea
                rows={12}
                aria-label="英文作文输入框"
                value={writingDraft}
                onChange={(e) => onChangeWritingDraft(e.target.value)}
                placeholder="请在此处撰写英文作文（支持多版本保存与两阶段 AI 批改）..."
                className="w-full p-4 text-sm font-english-serif leading-relaxed bg-card-subtle border border-subtle rounded-xl text-ink focus:bg-card focus:border-brand focus:outline-none"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-hairline">
            <button
              type="button"
              onClick={() => void onSaveVersion(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-ink bg-card-subtle hover:bg-stone-200 dark:hover:bg-[#203036] border border-subtle rounded-lg transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              <span>仅保存新版本 (生成 V{unitVersions.length + 1})</span>
            </button>

            {anyModelAvailable ? (
              <button
                type="button"
                disabled={Boolean(evaluatingVersionId)}
                onClick={() => void onSaveVersion(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-brand hover:bg-brand-hover rounded-lg disabled:opacity-50 transition-colors shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {evaluatingVersionId
                    ? '正在执行两阶段 AI 批改...'
                    : `提交 V${unitVersions.length + 1} 并执行两阶段 AI 批改 (${activeProviderName || 'gemini'})`}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onNavigateSettings}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-secondary bg-card-subtle border border-subtle rounded-lg hover:text-ink transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>需要配置模型（前往设置页配置 API Key）</span>
              </button>
            )}
          </div>
        </div>

        {/* Immutable Version History & Diff Comparison Panel */}
        {unitVersions.length > 0 && (
          <div className="bg-card rounded-2xl border border-subtle p-6 space-y-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-brand" />
                <h3 className="text-sm font-bold text-ink">
                  历史版本库（共 {unitVersions.length} 稿 · 不可原地覆盖）
                </h3>
              </div>
              {unitVersions.length >= 2 && (
                <button
                  type="button"
                  onClick={onToggleDiffPanel}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-brand border border-brand hover:bg-brand hover:text-white rounded-md transition-colors"
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  <span>
                    {showDiffPanel ? '收起版本对比' : '对比版本差异 (Diff)'}
                  </span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {unitVersions.map((ver) => (
                <button
                  key={ver.id}
                  type="button"
                  onClick={() => {
                    onSelectVersionId(ver.id);
                    setActiveAnnotationIdx(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-tabular-mono rounded-md border transition-colors ${
                    selectedVersion?.id === ver.id
                      ? 'bg-brand text-white border-brand font-semibold'
                      : 'bg-card-subtle text-ink border-subtle'
                  }`}
                >
                  {ver.versionLabel} ({ver.wordCount}词)
                </button>
              ))}
            </div>

            {/* Version Diff Comparison Box */}
            {showDiffPanel &&
              selectedVersion &&
              compareBaseVersion &&
              versionDiffResult &&
              unitVersions.length >= 2 && (
                <div className="p-4 bg-card-subtle rounded-xl border border-subtle space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      版本对比：{compareBaseVersion.versionLabel} →{' '}
                      {selectedVersion.versionLabel}（新增{' '}
                      {versionDiffResult.addedCount} 处 / 删除{' '}
                      {versionDiffResult.removedCount} 处）
                    </span>
                    <select
                      aria-label="选择基准对比版本"
                      value={compareBaseVersion.id}
                      onChange={(e) =>
                        onSelectCompareBaseVersionId(e.target.value)
                      }
                      className="px-2 py-1 bg-card border border-subtle rounded text-xs text-ink"
                    >
                      {unitVersions.map((v) => (
                        <option key={v.id} value={v.id}>
                          基准: {v.versionLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="p-3 bg-card rounded-lg border border-subtle font-english-serif text-sm leading-relaxed text-ink">
                    {versionDiffResult.segments.map((seg, i) => {
                      if (seg.type === 'added') {
                        return (
                          <span
                            key={i}
                            className="bg-emerald-500/20 text-mastered font-semibold underline px-0.5 rounded"
                          >
                            {seg.text}
                          </span>
                        );
                      }
                      if (seg.type === 'removed') {
                        return (
                          <span
                            key={i}
                            className="bg-rose-500/20 text-danger line-through px-0.5 rounded"
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
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary font-tabular-mono">
                  <span>
                    版本时间：
                    {new Date(selectedVersion.createdAt).toLocaleString(
                      'zh-CN'
                    )}{' '}
                    · 模式：{selectedVersion.practiceMode}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleLoadVersionIntoEditor(selectedVersion)}
                      className="text-brand hover:underline font-sans font-medium"
                    >
                      基于此版本载入编辑器准备重写 →
                    </button>
                    {!selectedEvaluation && anyModelAvailable && (
                      <button
                        type="button"
                        disabled={evaluatingVersionId === selectedVersion.id}
                        onClick={() =>
                          void onEvaluateExistingVersion(selectedVersion)
                        }
                        className="px-2.5 py-1 bg-brand text-white rounded font-sans font-medium hover:bg-brand-hover"
                      >
                        {evaluatingVersionId === selectedVersion.id
                          ? '批改中...'
                          : '对此版本运行 AI 批改'}
                      </button>
                    )}
                  </div>
                </div>

                <AnnotatedTextViewer
                  content={selectedVersion.content}
                  annotations={selectedEvaluation?.annotations || []}
                  activeAnnotationIdx={activeAnnotationIdx}
                  onSelectAnnotation={setActiveAnnotationIdx}
                  isEnglishSerif={currentUnit.unitType !== 'translation'}
                />

                {/* Two-Stage Subjective Evaluation Report */}
                {selectedEvaluation && (
                  <div className="border border-brand bg-card-subtle rounded-xl p-4 space-y-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle pb-2">
                      <div className="space-y-0.5">
                        <div className="text-sm font-bold text-ink">
                          两阶段主观题 AI 批改报告（非官方内容 · 仅供学习参考）
                        </div>
                        <div className="text-[11px] text-secondary font-tabular-mono">
                          模型：{selectedEvaluation.modelProvider} (
                          {selectedEvaluation.modelName}) · 二阶段复核状态：
                          {selectedEvaluation.reviewerDecision}
                          {selectedEvaluation.reviewerAdjustments
                            ?.stabilityWarning
                            ? ' · 含分差稳定性提示'
                            : ''}
                        </div>
                      </div>
                      <div className="text-right font-tabular-mono">
                        <div className="text-lg font-bold text-brand">
                          参考中心分：{selectedEvaluation.centralScore} /{' '}
                          {selectedEvaluation.maxScore} 分
                        </div>
                        <div className="text-[11px] text-secondary">
                          建议区间：[{selectedEvaluation.scoreRangeMin},{' '}
                          {selectedEvaluation.scoreRangeMax}] · 置信度：
                          {selectedEvaluation.confidence}
                        </div>
                      </div>
                    </div>

                    {/* Dimension Scores Table */}
                    <div className="overflow-x-auto bg-card border border-subtle rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-subtle bg-stone-100 dark:bg-[#1E2B30] text-secondary">
                            <th className="py-2 px-3">评分维度</th>
                            <th className="py-2 px-3">得分</th>
                            <th className="py-2 px-3">诊断反馈</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DCE4E1] dark:divide-[#2C3E46]">
                          {selectedEvaluation.dimensionScores.map((d, i) => (
                            <tr key={i}>
                              <td className="py-2 px-3 font-semibold text-ink">
                                {d.name}
                              </td>
                              <td className="py-2 px-3 font-tabular-mono text-brand">
                                {d.score} / {d.maxScore}
                              </td>
                              <td className="py-2 px-3 text-secondary">
                                {d.rationale}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Quote-Verified Annotations with Interactive Viewer Sync */}
                    {selectedEvaluation.annotations.length > 0 && (
                      <div className="space-y-2">
                        <div className="font-semibold text-ink">
                          原文引用校验批注（点击或悬停卡片可与上方稿件高亮联动）：
                        </div>
                        {selectedEvaluation.annotations.map((ann, idx) => {
                          const isAnnActive = activeAnnotationIdx === idx;
                          return (
                            <div
                              key={idx}
                              onMouseEnter={() => setActiveAnnotationIdx(idx)}
                              onClick={() =>
                                setActiveAnnotationIdx(isAnnActive ? null : idx)
                              }
                              className={`p-3 rounded-lg border space-y-1 cursor-pointer transition-all ${
                                isAnnActive
                                  ? 'bg-brand-subtle border-brand ring-1 ring-brand/40'
                                  : 'bg-card border-subtle hover:border-brand/50'
                              }`}
                            >
                              <div className="flex items-center justify-between font-tabular-mono text-[11px]">
                                <span className="text-danger font-semibold">
                                  [{ann.issueType}] 偏移 [{ann.startOffset}:
                                  {ann.endOffset}]
                                </span>
                                <span className="text-mastered">
                                  ✓ 原文精确匹配
                                </span>
                              </div>
                              <div className="font-english-serif text-ink">
                                原句摘录：“{ann.quotedUserText}”
                              </div>
                              <div className="text-secondary">
                                诊断：{ann.explanation}
                              </div>
                              <div className="text-mastered font-english-serif">
                                建议改写：{ann.suggestion}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {selectedEvaluation.visionDegradedToText && (
                      <div className="p-2.5 bg-warning-subtle border border-amber-300 dark:border-amber-800 rounded-lg text-[11px] text-amber-900 dark:text-amber-200">
                        <span className="font-bold">视觉回退模式说明：</span>
                        <span>
                          当前模型未启用原图视觉直传，已降级为结构化图画要素描述核查，评分置信度相应下调。
                        </span>
                      </div>
                    )}

                    {selectedEvaluation.reviewerAdjustments?.notes?.length >
                      0 && (
                      <div className="p-2.5 bg-card border border-subtle rounded-lg text-[11px] text-secondary">
                        <span className="font-semibold text-brand">
                          Stage 2 审校结论：
                        </span>{' '}
                        {selectedEvaluation.reviewerAdjustments.notes.join('；')}
                      </div>
                    )}

                    {/* V1 -> V2 -> V3 Revision Verification Table */}
                    {selectedEvaluation.revisionVerification &&
                      selectedEvaluation.revisionVerification.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="font-semibold text-ink">
                            上一版本改进项落实核验（V
                            {Math.max(1, selectedVersion.versionNumber - 1)} → V
                            {selectedVersion.versionNumber}）：
                          </div>
                          <div className="grid grid-cols-1 gap-1.5">
                            {selectedEvaluation.revisionVerification.map(
                              (rv, idx) => (
                                <div
                                  key={idx}
                                  className="p-2.5 bg-card rounded-lg border border-subtle flex flex-wrap items-start justify-between gap-2"
                                >
                                  <div className="space-y-0.5">
                                    <div className="font-medium text-ink">
                                      {rv.instruction}
                                    </div>
                                    <div className="text-[11px] text-secondary">
                                      核验依据：{rv.evidence}（{rv.explanation}）
                                    </div>
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[11px] font-semibold font-tabular-mono ${
                                      rv.status === 'resolved'
                                        ? 'bg-mastered-subtle text-mastered'
                                        : rv.status === 'partially-resolved'
                                        ? 'bg-warning-subtle text-warning'
                                        : 'bg-danger-subtle text-danger'
                                    }`}
                                  >
                                    {rv.status === 'resolved'
                                      ? '✓ 已完成'
                                      : rv.status === 'partially-resolved'
                                      ? '△ 部分落实'
                                      : rv.status === 'regressed'
                                      ? '↓ 发生回退'
                                      : '✗ 未落实'}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                    {/* Executable Revision Tasks */}
                    {selectedEvaluation.revisionTasks.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="font-semibold text-ink">
                          下一次重写（V{selectedVersion.versionNumber + 1}
                          ）可执行改进清单：
                        </div>
                        <ul className="space-y-1">
                          {selectedEvaluation.revisionTasks.map((rt, i) => (
                            <li
                              key={i}
                              className="p-2 bg-card rounded border border-subtle flex items-start gap-2 text-ink"
                            >
                              <span className="font-tabular-mono text-brand font-semibold shrink-0">
                                [P{rt.priority}]
                              </span>
                              <span>{rt.instruction}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Non-Official AI Reference Text */}
                    {selectedEvaluation.referenceContent && (
                      <div className="p-3 bg-card rounded-lg border border-subtle space-y-1">
                        <div className="font-semibold text-brand">
                          {selectedEvaluation.taskType === 'translation'
                            ? 'AI参考译文（非官方）'
                            : 'AI生成示例（非官方范文）'}{' '}
                          · 仅在提交版本后提供对比参考：
                        </div>
                        <p className="font-english-serif text-xs text-ink whitespace-pre-wrap leading-relaxed">
                          {selectedEvaluation.referenceContent}
                        </p>
                      </div>
                    )}

                    {/* EvaluationRun Telemetry Footer */}
                    {selectedEvaluation.runId && (
                      <div className="pt-2 border-t border-subtle flex flex-wrap items-center justify-between gap-2 text-[10px] font-tabular-mono text-secondary">
                        <span>
                          Run ID: {selectedEvaluation.runId} · Stage1:{' '}
                          {selectedEvaluation.modelName}
                          {selectedEvaluation.stage2ModelName
                            ? ` · Stage2: ${selectedEvaluation.stage2ModelName}`
                            : ''}
                        </span>
                        <span>
                          耗时: {selectedEvaluation.latencyMs || 0}ms · 缓存:{' '}
                          {selectedEvaluation.cacheStatus || 'miss'} · 重试:{' '}
                          {selectedEvaluation.retryCount || 0}次
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Source-Provided Reference Translations (46-50) or Model Essays (51-52) */}
                {currentUnit.unitType === 'translation' &&
                  currentUnit.items.some(
                    (it) =>
                      it.translationMeta?.referenceTranslation ||
                      it.rubric?.referenceText
                  ) && (
                    <div className="p-4 bg-mastered-subtle/60 rounded-xl border border-emerald-200 dark:border-[#2B5446] space-y-2.5 text-xs">
                      <div className="font-bold text-mastered flex items-center justify-between">
                        <span>
                          来源参考译文（46–50题 · 题库收录标准参考答案）
                        </span>
                        <span className="font-tabular-mono text-[11px]">
                          Source: answers/{examYear}.md
                        </span>
                      </div>
                      <div className="space-y-2">
                        {currentUnit.items.map((it) => {
                          const refT =
                            it.translationMeta?.referenceTranslation ||
                            it.rubric?.referenceText;
                          if (!refT) return null;
                          return (
                            <div
                              key={it.id}
                              className="p-2.5 bg-card rounded-lg border border-subtle space-y-1"
                            >
                              <div className="font-tabular-mono font-semibold text-brand">
                                ({it.questionNumber}){' '}
                                <span className="font-english-serif font-normal text-secondary">
                                  {it.translationMeta?.underlinedEnglish}
                                </span>
                              </div>
                              <div className="text-ink leading-relaxed font-medium">
                                参考译文：{refT}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {(currentUnit.unitType === 'practical-writing' ||
                  currentUnit.unitType === 'visual-writing') &&
                  currentUnit.items[0]?.rubric?.referenceText && (
                    <div className="p-4 bg-mastered-subtle/60 rounded-xl border border-emerald-200 dark:border-[#2B5446] space-y-2 text-xs">
                      <div className="font-bold text-mastered flex items-center justify-between">
                        <span>
                          来源参考范文（第{' '}
                          {currentUnit.items[0].questionNumber} 题 ·
                          题库收录标准参考范文）
                        </span>
                        <span className="font-tabular-mono text-[11px]">
                          Source: answers/{examYear}.md
                        </span>
                      </div>
                      <pre className="p-3 bg-card rounded-lg border border-subtle font-english-serif text-xs text-ink whitespace-pre-wrap leading-relaxed">
                        {currentUnit.items[0].rubric.referenceText}
                      </pre>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}

        <FollowUpChatPanel
          title="针对当前单元的长难句或语法追问"
          placeholder="输入你的语法、词汇或审题疑问（不泄露未提交题目的标准答案）..."
          anyModelAvailable={anyModelAvailable}
          isLoading={isAskingFollowUp}
          history={followUpHistory}
          onSendQuestion={onSendFollowUp}
        />
      </div>
    </div>
  );
};
