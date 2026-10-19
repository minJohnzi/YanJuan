import React, { useState } from 'react';
import {
  BookOpen,
  FileWarning,
  ArrowRight,
  Clock,
  RotateCcw,
  PenTool,
  ChevronRight,
  ChevronDown,
  Layers,
  FileCheck,
  AlertCircle,
  X,
  Play,
  FileText,
} from 'lucide-react';
import type {
  ExamAttempt,
  PapersManifest,
  ReviewItem,
  SubjectiveAnswerVersion,
  UnitType,
} from '../shared/types';

interface HomeViewProps {
  manifest: PapersManifest;
  attempts: ExamAttempt[];
  subjectiveVersions: SubjectiveAnswerVersion[];
  reviewItems: ReviewItem[];
  onStartUnit: (year: number, unitType: UnitType, unitId?: string) => void;
  onStartSimulation: (year: number, mode: 'strict-simulation' | 'free-simulation') => void;
  onOpenImportReport: (year: number, version: string) => void;
  onNavigateTab: (tab: 'home' | 'library' | 'review' | 'stats' | 'settings') => void;
  onAppend2010OfficialAnswers: () => Promise<void>;
  isImportingAnswers: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
  manifest,
  attempts,
  subjectiveVersions,
  reviewItems,
  onStartUnit,
  onStartSimulation,
  onOpenImportReport,
  onNavigateTab,
  onAppend2010OfficialAnswers,
  isImportingAnswers,
}) => {
  const [unavailableModal, setUnavailableModal] = useState<{
    open: boolean;
    requestedLabel: string;
  }>({ open: false, requestedLabel: '' });

  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const availableYears = manifest.availableYears || [];
  const failedYears = manifest.failedYears || (manifest as any).needsAnswerSourceYears || [];
  const pendingYears = manifest.pendingYears || [];
  const latestReadyVersion = manifest.latestReadyVersion || {};

  const hasReadyPapers = availableYears.length > 0;
  // Default to 2024 or latest available ready year
  const primaryReadyYear = availableYears.includes(2024)
    ? 2024
    : availableYears[0] || 2024;
  const year2010Record = (manifest.years || []).find((y) => y.year === 2010);

  const dueReviews = reviewItems.filter(
    (item) => !item.mastered && new Date(item.nextDueAt).getTime() <= Date.now() + 86400 * 1000
  );

  const recentAttempts = [...attempts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const lastAttempt = recentAttempts[0] || null;

  const handleLaunchEntry = (
    label: string,
    action: () => void
  ) => {
    if (!hasReadyPapers) {
      setUnavailableModal({ open: true, requestedLabel: label });
      return;
    }
    action();
  };

  return (
    <div className="max-w-[1440px] w-full mx-auto space-y-8 sm:space-y-10 py-1 sm:py-3">
      {/* 1. First Screen: Primary Study Focus (Left 65%) + Today's Review (Right 35%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        {/* Left: Continue Study Hero (65% on desktop, full width on mobile) */}
        <section
          aria-label="研习主入口"
          className="lg:col-span-7 xl:col-span-8 bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-5 sm:p-8 flex flex-col justify-between space-y-6"
        >
          {lastAttempt ? (
            /* Scenario A: Resume Previous Study */
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] tracking-wide flex items-center gap-2">
                  <span>继续上次进度</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-tabular-mono">{lastAttempt.year} 年考研英语一</span>
                </div>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#202B2F] dark:text-[#E2E8E6] tracking-tight leading-snug">
                  {lastAttempt.year} 年考研英语一 ·{' '}
                  {lastAttempt.mode === 'strict-simulation'
                    ? '整卷严格模拟'
                    : lastAttempt.mode === 'free-simulation'
                    ? '整卷自由模拟'
                    : '专项训练'}
                </h1>
                <p className="text-xs sm:text-sm text-[#68777C] dark:text-[#9CAEB3] leading-relaxed max-w-2xl">
                  上次作答时间：{new Date(lastAttempt.updatedAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  <span className="mx-2 text-stone-300 dark:text-[#2C3E46]">|</span>
                  已完成客观题：{Object.keys(lastAttempt.objectiveResponses || {}).length} 题
                  {lastAttempt.totalObjectiveScore !== undefined && (
                    <>
                      <span className="mx-2 text-stone-300 dark:text-[#2C3E46]">|</span>
                      <span>得分：<strong className="text-[#3F7664] dark:text-[#4EA387]">{lastAttempt.totalObjectiveScore}</strong> / {lastAttempt.maxObjectiveScore} 分</span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onStartUnit(
                      lastAttempt.year,
                      'reading',
                      lastAttempt.unitIds?.[0] || `${lastAttempt.year}-unit-reading-1`
                    )
                  }
                  className="inline-flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] shadow-xs transition-all whitespace-nowrap min-h-[42px]"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>继续上次作答</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab('library')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-medium text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] hover:bg-stone-50 dark:hover:bg-[#162226] transition-colors whitespace-nowrap min-h-[42px]"
                >
                  <span>浏览全部真题</span>
                </button>
              </div>
            </div>
          ) : (
            /* Scenario B: Fresh Start (Recommended Reading Path) */
            <div className="space-y-5">
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] tracking-wide flex items-center gap-2">
                  <span>推荐研习路径</span>
                  <span aria-hidden="true">·</span>
                  <span>考研英语一精读</span>
                </div>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#202B2F] dark:text-[#E2E8E6] tracking-tight leading-snug">
                  真题精读与双阶段批改工作台
                </h1>
                <p className="text-xs sm:text-sm text-[#68777C] dark:text-[#9CAEB3] leading-relaxed max-w-2xl">
                  从原文证据定位、选项逻辑拆解到主观题版本化重写。不猜测答案，每次练习均沉淀为可回溯的错题链路。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    handleLaunchEntry('开始精读 (Reading Part A)', () =>
                      onStartUnit(primaryReadyYear, 'reading', `${primaryReadyYear}-unit-reading-1`)
                    )
                  }
                  className="inline-flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] shadow-xs transition-all whitespace-nowrap min-h-[42px]"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>开始精读 {primaryReadyYear} Text 1</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab('library')}
                  className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200/80 dark:hover:bg-[#203036] transition-colors whitespace-nowrap min-h-[42px]"
                >
                  <span>进入题库挑卷</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right: Today's Review & Task Card (35% on desktop, full width on mobile) */}
        <section
          aria-label="今日复习与任务"
          className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-5 sm:p-7 flex flex-col justify-between space-y-5"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#174A5B] dark:text-[#75B6CE] flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>今日复习排期</span>
              </span>
              <span className="text-[11px] font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                间隔复习队列
              </span>
            </div>
            {dueReviews.length > 0 ? (
              <div className="space-y-2">
                <div className="text-2xl sm:text-3xl font-bold font-tabular-mono text-amber-800 dark:text-[#E5B55E]">
                  {dueReviews.length}{' '}
                  <span className="text-xs font-normal text-[#68777C] dark:text-[#9CAEB3]">
                    项任务待完成
                  </span>
                </div>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
                  涵盖历年真题做题错因、高危盲猜项与重点长难句二次精析。
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-2xl sm:text-3xl font-bold font-tabular-mono text-[#3F7664] dark:text-[#4EA387]">
                  0{' '}
                  <span className="text-xs font-normal text-[#68777C] dark:text-[#9CAEB3]">
                    项到期
                  </span>
                </div>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
                  今日复习任务已全部清空。作答中标记的不确定题将自动纳入后续复习队列。
                </p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#E8ECEA] dark:border-[#26373E]">
            <button
              type="button"
              onClick={() => onNavigateTab('review')}
              className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[42px] ${
                dueReviews.length > 0
                  ? 'bg-amber-800 dark:bg-[#CCA04B] text-white hover:bg-amber-900 dark:hover:bg-[#B38739]'
                  : 'bg-stone-100 dark:bg-[#162226] text-[#202B2F] dark:text-[#E2E8E6] hover:bg-stone-200 dark:hover:bg-[#203036]'
              }`}
            >
              <span>{dueReviews.length > 0 ? '开始今日复习' : '查看完整复习库'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
      </div>

      {/* 3. Six Specialized Question Types (Clean Academic Cards) */}
      <section aria-label="六大题型专练" className="space-y-4">
        <div className="flex items-baseline justify-between px-1">
          <div>
            <h2 className="text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6]">按题型专练</h2>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] mt-0.5">涵盖完形、阅读、新题型、翻译与大小作文</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('library')}
            className="text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] hover:underline"
          >
            查看试卷目录
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              type: 'cloze' as UnitType,
              unitId: `${primaryReadyYear}-unit-cloze`,
              num: '01',
              title: '完形填空',
              sub: 'Section I · Use of English',
              meta: '第 1–20 题 · 10 分 · 建议 18 分钟',
              desc: '文内空位直选、词汇搭配辨析与上下文逻辑连贯精析。',
            },
            {
              type: 'reading' as UnitType,
              unitId: `${primaryReadyYear}-unit-reading-1`,
              num: '02',
              title: '传统阅读',
              sub: 'Section II Part A (Text 1–4)',
              meta: '第 21–40 题 · 40 分 · 建议 72 分钟',
              desc: '左文右题同屏精读、单题沉浸模式、把握度标记与证据句溯源。',
            },
            {
              type: 'passage-assembly' as UnitType,
              unitId: `${primaryReadyYear}-unit-part-b`,
              num: '03',
              title: '新题型篇章重组',
              sub: 'Section II Part B',
              meta: '第 41–45 题 · 10 分 · 建议 20 分钟',
              desc: '候选段落池 A–G、固定段锚点锁定与上下文逻辑链拼接。',
            },
            {
              type: 'translation' as UnitType,
              unitId: `${primaryReadyYear}-unit-part-c`,
              num: '04',
              title: '长难句翻译',
              sub: 'Section II Part C',
              meta: '第 46–50 题 · 10 分 · 建议 25 分钟',
              desc: '全文语境长难句、独立分句作答、得分点拆解与参考译文。',
            },
            {
              type: 'practical-writing' as UnitType,
              unitId: `${primaryReadyYear}-unit-writing-a`,
              num: '05',
              title: '应用文写作',
              sub: 'Section III Part A (小作文)',
              meta: '第 51 题 · 10 分 · 约 100 词',
              desc: '书信/告示格式要素、字数实时监控、双阶段多版本重写。',
            },
            {
              type: 'visual-writing' as UnitType,
              unitId: `${primaryReadyYear}-unit-writing-b`,
              num: '06',
              title: '视觉图画大作文',
              sub: 'Section III Part B (大作文)',
              meta: '第 52 题 · 20 分 · 160–200 词',
              desc: '高清插图检视、图画事实要素核对、立意展开与三阶修改。',
            },
          ].map((item) => (
            <div
              key={item.type}
              onClick={() =>
                handleLaunchEntry(item.title, () =>
                  onStartUnit(primaryReadyYear, item.type, item.unitId)
                )
              }
              className="group bg-white dark:bg-[#1E2B30] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] p-5 hover:border-[#174A5B]/60 dark:hover:border-[#38849E]/70 hover:shadow-2xs transition-all cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-tabular-mono text-xs font-semibold text-[#96A1A4] dark:text-[#657980] group-hover:text-[#174A5B] dark:group-hover:text-[#75B6CE] transition-colors">
                    {item.num}
                  </span>
                  <span className="text-[11px] text-[#96A1A4] dark:text-[#657980] font-tabular-mono">{item.meta.split('·')[0].trim()}</span>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#202B2F] dark:text-[#E2E8E6] group-hover:text-[#174A5B] dark:group-hover:text-[#75B6CE] transition-colors">
                    {item.title}
                  </h3>
                  <div className="text-xs text-[#68777C] dark:text-[#9CAEB3] mt-0.5">{item.sub}</div>
                </div>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed pt-1">
                  {item.desc}
                </p>
              </div>

              <div className="pt-2 border-t border-[#E8ECEA] dark:border-[#223036] flex items-center justify-between text-xs">
                <span className="text-[#96A1A4] dark:text-[#657980] font-tabular-mono">{item.meta.split('·').slice(1).join('·')}</span>
                <span className="font-medium text-[#174A5B] dark:text-[#75B6CE] flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  <span>开始</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Full Paper Simulation Card */}
      <section className="bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
            <h3 className="text-base font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
              整卷模拟考场（180 分钟）
            </h3>
          </div>
          <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] max-w-xl">
            完整模拟考研下午 14:00–17:00 真实节奏，支持「严格不可暂停模式」与「自由模拟模式」。
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() =>
              handleLaunchEntry('整卷模拟', () =>
                onStartSimulation(primaryReadyYear, 'strict-simulation')
              )
            }
            className="px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] shadow-xs transition-colors whitespace-nowrap"
          >
            开始整卷模考 ({primaryReadyYear})
          </button>
        </div>
      </section>

      {/* 5. Quiet Technical & Diagnostic Footnote Accordion (Separated from daily study flow) */}
      <section className="pt-4 border-t border-[#DCE4E1] dark:border-[#2C3E46]">
        <button
          type="button"
          onClick={() => setShowDiagnostics((prev) => !prev)}
          className="w-full flex items-center justify-between py-2 text-xs text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-[#96A1A4] dark:text-[#657980]" />
            <span>题库校验与版本诊断信息（2010—2026 共 17 套）</span>
          </span>
          <span className="flex items-center gap-1 font-tabular-mono text-[11px] text-[#96A1A4] dark:text-[#657980]">
            <span>就绪: {availableYears.length} / 待补充答案: {failedYears.length}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {showDiagnostics && (
          <div className="mt-3 p-4 bg-white dark:bg-[#1E2B30] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] text-xs space-y-3">
            <div className="text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
              题库严格遵循双重发布校验原则：所有试卷必须通过结构完整性与官方来源答案校验方可计入正式评分试卷。
              {failedYears.length > 0 && (
                <span className="text-[#202B2F] dark:text-[#E2E8E6] ml-1">
                  目前 {failedYears.join('、')} 年试卷已完成结构解析，暂无官方来源答案，绝不使用 AI 伪造或猜测答案。
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenImportReport(2010, year2010Record?.latestCandidateVersion || 'v1')}
                className="px-3 py-1.5 rounded text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] transition-colors"
              >
                查看 2010 导入校验报告
              </button>
              <button
                type="button"
                onClick={() => void onAppend2010OfficialAnswers()}
                className="px-3 py-1.5 rounded text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] border border-[#174A5B]/40 dark:border-[#38849E]/50 hover:bg-[#174A5B]/5 dark:hover:bg-[#38849E]/10 transition-colors"
              >
                导入外部答案来源 (构建 v2)
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Unavailable Ready Paper Diagnostic Modal */}
      {unavailableModal.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="当前暂无正式可评分试卷说明"
          className="fixed inset-0 z-50 bg-[#131B1E]/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setUnavailableModal({ open: false, requestedLabel: '' })}
        >
          <div
            className="bg-white dark:bg-[#1E2B30] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8ECEA] dark:border-[#223036] pb-3">
              <div className="flex items-center gap-2 text-base font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                <FileWarning className="w-5 h-5 text-amber-600 dark:text-[#CCA04B]" />
                <span>暂无法直接进入计分练习</span>
              </div>
              <button
                type="button"
                aria-label="关闭提示弹窗"
                onClick={() => setUnavailableModal({ open: false, requestedLabel: '' })}
                className="p-1 text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
              <p>
                您请求打开：<strong className="text-[#202B2F] dark:text-[#E2E8E6]">{unavailableModal.requestedLabel}</strong>
              </p>
              <p>
                系统严守「不生成 AI 猜测答案、未提供官方答案不降级上线」的底线。当前该卷尚在解析检验区，请先前往真题库浏览或导入官方答案源。
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8ECEA] dark:border-[#223036]">
              <button
                type="button"
                onClick={() => {
                  setUnavailableModal({ open: false, requestedLabel: '' });
                  onNavigateTab('library');
                }}
                className="px-4 py-2 rounded-lg text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] transition-colors"
              >
                进入题库目录
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
