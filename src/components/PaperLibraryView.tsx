import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  ArrowLeft,
  Play,
  ShieldAlert,
  Layers,
  Calendar,
  ChevronRight,
  BookOpen,
  Check,
  RotateCcw,
} from 'lucide-react';
import type {
  Exam,
  ExamAttempt,
  ImportStatus,
  PapersManifest,
  UnitType,
  ValidationReport,
} from '../shared/types';
import { formatQuestionRanges } from '../pipeline/paperValidator';

interface PaperLibraryViewProps {
  manifest: PapersManifest;
  selectedYearOverview: Exam | null;
  activeReport: ValidationReport | null;
  activeCandidateExam?: Exam | null;
  attempts: ExamAttempt[];
  onSelectYearOverview: (year: number) => void;
  onCloseYearOverview: () => void;
  onOpenImportReport: (year: number, version: string) => void;
  onCloseImportReport: () => void;
  onStartUnit: (year: number, unitType: UnitType, unitId?: string) => void;
  onStartSimulation: (year: number, mode: 'strict-simulation' | 'free-simulation') => void;
  onAppend2010OfficialAnswers: () => Promise<void>;
  isImportingAnswers: boolean;
  onNavigateSettings: () => void;
}

export const PaperLibraryView: React.FC<PaperLibraryViewProps> = ({
  manifest,
  selectedYearOverview,
  activeReport,
  activeCandidateExam,
  attempts,
  onSelectYearOverview,
  onCloseYearOverview,
  onOpenImportReport,
  onCloseImportReport,
  onStartUnit,
  onStartSimulation,
  onAppend2010OfficialAnswers,
  isImportingAnswers,
  onNavigateSettings,
}) => {
  const [browseMode, setBrowseMode] = useState<'by-year' | 'by-type'>('by-year');
  const [yearFilter, setYearFilter] = useState<'all' | 'ready' | 'study'>('all');

  // Sub-view 1: Import Validation Report Inspector
  if (activeReport) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 py-2 sm:py-4">
        <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8ECEA] dark:border-[#223036] pb-5">
            <div className="space-y-1">
              <button
                type="button"
                onClick={onCloseImportReport}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] hover:underline mb-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回真题库</span>
              </button>
              <h1 className="text-xl sm:text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                {activeReport.year}年 考研英语一 题库解析校验报告
              </h1>
              <div className="text-xs text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono flex items-center gap-2">
                <span>版本：{activeReport.dataVersion}</span>
                <span aria-hidden="true">·</span>
                <span>生成时间：{new Date(activeReport.generatedAt).toLocaleString('zh-CN')}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onNavigateSettings}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] whitespace-nowrap transition-colors"
            >
              配置外部答案来源
            </button>
          </div>

          {/* Summary Status Strip */}
          <div
            className={`p-5 rounded-xl border ${
              activeReport.passedAllChecks
                ? 'bg-emerald-50/70 dark:bg-[#172E27]/70 border-emerald-200/80 dark:border-emerald-800/60'
                : 'bg-amber-50/70 dark:bg-[#2E2413]/70 border-amber-200/80 dark:border-amber-800/60'
            } space-y-2`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                {activeReport.passedAllChecks
                  ? '已通过全部 19 项双重校验，纳入官方计分题库'
                  : '未纳入官方计分题库（真题原文结构已完整解析）'}
              </div>
              <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                校验项：{activeReport.checks.filter((c) => c.passed).length} / {activeReport.checks.length}
              </span>
            </div>

            {activeReport.errorCodes.length > 0 && (
              <div className="text-xs space-y-1 pt-1 text-[#68777C] dark:text-[#9CAEB3]">
                <div>
                  状态标识：
                  <span className="font-tabular-mono font-medium text-amber-800 dark:text-[#E5B55E] ml-1">
                    {activeReport.errorCodes.join(', ')}
                  </span>
                </div>
                {activeReport.missingObjectiveQuestions.length > 0 && (
                  <div className="font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                    缺少官方答案的题号（共 {activeReport.missingObjectiveQuestions.length} 题）：
                    <span className="text-amber-800 dark:text-[#E5B55E] ml-1">
                      {formatQuestionRanges(activeReport.missingObjectiveQuestions)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Validation Checklist */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[#202B2F] dark:text-[#E2E8E6]">19 项流水线校验明细</h2>
            <div className="divide-y divide-[#E8ECEA] dark:divide-[#223036] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] overflow-hidden text-xs">
              {activeReport.checks.map((chk) => (
                <div key={chk.checkId} className="p-3.5 flex items-center justify-between bg-white dark:bg-[#1E2B30] hover:bg-stone-50 dark:hover:bg-[#162226] transition-colors">
                  <div className="space-y-0.5 pr-4">
                    <div className="font-medium text-[#202B2F] dark:text-[#E2E8E6]">{chk.name}</div>
                    <div className="text-[#68777C] dark:text-[#9CAEB3] text-[11px]">{chk.details}</div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 font-tabular-mono font-medium shrink-0 ${
                      chk.passed ? 'text-[#3F7664] dark:text-[#4EA387]' : 'text-[#B47B31] dark:text-[#CCA04B]'
                    }`}
                  >
                    {chk.passed ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>通过</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>待满足</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view 2: Annual Exam Page (年度试卷页 · 试卷封面与章节目录)
  if (selectedYearOverview) {
    const yearAttempts = attempts.filter(
      (a) =>
        a.year === selectedYearOverview.year &&
        a.dataVersion === selectedYearOverview.dataVersion
    );
    const latestSubmitted = yearAttempts.find((a) => a.status === 'submitted');
    const allUnits = selectedYearOverview.sections.flatMap((s) => s.units);

    return (
      <div className="max-w-4xl mx-auto space-y-6 py-2 sm:py-4">
        {/* Paper Cover Card */}
        <div className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-10 space-y-8">
          <div className="space-y-4">
            <button
              type="button"
              onClick={onCloseYearOverview}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回真题库</span>
            </button>

            <div className="space-y-2">
              <div className="text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] tracking-wide">
                全国硕士研究生入学统一考试 · 英语（一）
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#202B2F] dark:text-[#E2E8E6] tracking-tight">
                {selectedYearOverview.year} 年真题全卷
              </h1>
              <div className="text-xs sm:text-sm text-[#68777C] dark:text-[#9CAEB3] flex flex-wrap items-center gap-3 pt-1">
                <span>总分：{selectedYearOverview.totalScore} 分</span>
                <span aria-hidden="true">·</span>
                <span>考试时间：{selectedYearOverview.durationMinutes} 分钟</span>
                <span aria-hidden="true">·</span>
                <span>包含 8 个作答单元</span>
                <span aria-hidden="true">·</span>
                <span>共 52 题</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  onStartSimulation(selectedYearOverview.year, 'strict-simulation')
                }
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] shadow-xs transition-colors whitespace-nowrap min-h-[42px] w-full sm:w-auto"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>开始整卷严格模拟 (180分钟)</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onStartSimulation(selectedYearOverview.year, 'free-simulation')
                }
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] transition-colors whitespace-nowrap min-h-[42px] w-full sm:w-auto"
              >
                <span>自由模拟 (可随时暂停)</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onOpenImportReport(
                    selectedYearOverview.year,
                    selectedYearOverview.dataVersion
                  )
                }
                className="text-xs text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] sm:ml-auto whitespace-nowrap transition-colors py-1"
              >
                查看解析校验报告
              </button>
            </div>
          </div>

          {/* Unit Chapter Table of Contents */}
          <div className="space-y-4 pt-4 border-t border-[#E8ECEA] dark:border-[#223036]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">试卷作答单元目录</h2>
              <span className="text-xs text-[#68777C] dark:text-[#9CAEB3]">点击进入单项练习</span>
            </div>

            <div className="divide-y divide-[#E8ECEA] dark:divide-[#223036] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] overflow-hidden">
              {allUnits.map((unit, idx) => {
                const qStart = unit.items[0]?.questionNumber;
                const qEnd = unit.items[unit.items.length - 1]?.questionNumber;
                return (
                  <div
                    key={unit.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#1E2B30] hover:bg-stone-50 dark:hover:bg-[#162226] transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="text-xs text-[#96A1A4] dark:text-[#657980] font-tabular-mono uppercase">
                        {unit.sectionId} · 第 {qStart === qEnd ? qStart : `${qStart}–${qEnd}`} 题
                      </div>
                      <h3 className="text-base font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                        {unit.title}
                      </h3>
                      <div className="text-xs text-[#68777C] dark:text-[#9CAEB3] font-tabular-mono">
                        满分 {unit.score} 分 · 建议用时 {unit.suggestedMinutes} 分钟
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onStartUnit(
                          selectedYearOverview.year,
                          unit.unitType,
                          unit.id
                        )
                      }
                      className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold text-[#174A5B] dark:text-[#75B6CE] bg-[#174A5B]/10 dark:bg-[#38849E]/20 hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white transition-all self-start sm:self-center shrink-0"
                    >
                      <span>开始该单元</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default Sub-view: 2010–2026 Paper Shelf & Catalog (Cards over Tables)
  const yearsList = manifest.years || [];
  const filteredYears = yearsList.filter((row) => {
    if (yearFilter === 'ready') return row.status === 'ready' || row.year >= 2024;
    if (yearFilter === 'study') return row.status !== 'ready' && row.year < 2024;
    return true;
  });

  return (
    <div className="max-w-[1440px] w-full mx-auto space-y-6 sm:space-y-8 py-2 sm:py-4">
      {/* Header with Mode & Filter Segmented Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#DCE4E1] dark:border-[#2C3E46]">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6]">
            历年真题库（2010—2026）
          </h1>
          <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
            共收录 17 套考研英语一真题。各年均已完成 1–52 题全文结构解析与视觉插图关联。
          </p>
        </div>

        {/* View Switcher: By Year vs By Type */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#162226] rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setBrowseMode('by-year')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              browseMode === 'by-year'
                ? 'bg-white dark:bg-[#1E2B30] text-[#174A5B] dark:text-[#75B6CE] shadow-2xs font-semibold'
                : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>按年份试卷 ({yearsList.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setBrowseMode('by-type')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              browseMode === 'by-type'
                ? 'bg-white dark:bg-[#1E2B30] text-[#174A5B] dark:text-[#75B6CE] shadow-2xs font-semibold'
                : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>按题型专练 (6类)</span>
          </button>
        </div>
      </div>

      {browseMode === 'by-year' ? (
        <div className="space-y-6">
          {/* Sub-filter tabs */}
          <div className="flex items-center gap-2 text-xs overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setYearFilter('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors shrink-0 ${
                yearFilter === 'all'
                  ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                  : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46]'
              }`}
            >
              全部年份 ({yearsList.length})
            </button>
            <button
              type="button"
              onClick={() => setYearFilter('ready')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors shrink-0 ${
                yearFilter === 'ready'
                  ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                  : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46]'
              }`}
            >
              官方答案就绪 (2024–2026)
            </button>
            <button
              type="button"
              onClick={() => setYearFilter('study')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors shrink-0 ${
                yearFilter === 'study'
                  ? 'bg-[#174A5B] dark:bg-[#38849E] text-white'
                  : 'text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46]'
              }`}
            >
              经典研读卷 (2010–2023)
            </button>
          </div>

          {/* Academic Paper Card Grid (Fluid 1 to 6 columns based on container width) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3.5 sm:gap-4">
            {filteredYears.map((row) => {
              const isReady = row.status === 'ready' || row.year >= 2024;
              const hasAttempt = attempts.some((a) => a.year === row.year);

              return (
                <div
                  key={row.year}
                  className="bg-white dark:bg-[#1E2B30] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs hover:border-[#174A5B]/60 dark:hover:border-[#38849E]/70 hover:shadow-xs transition-all p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-tabular-mono text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                          {row.year}
                        </span>
                        <span className="text-xs text-[#68777C] dark:text-[#9CAEB3] ml-1">年真题</span>
                      </div>
                      <span className="text-[11px] font-tabular-mono text-[#96A1A4] dark:text-[#657980]">
                        {row.latestReadyVersion || row.latestCandidateVersion || 'v1'}
                      </span>
                    </div>

                    <div className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
                      考研英语（一）· 52 题 · 100 分 · 180 分钟
                    </div>

                    <div className="text-xs flex items-center gap-1.5 pt-1">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isReady ? 'bg-[#3F7664] dark:bg-[#4EA387]' : 'bg-[#96A1A4] dark:bg-[#657980]'
                        }`}
                      />
                      <span className="text-[#68777C] dark:text-[#9CAEB3]">
                        {isReady
                          ? '含官方客观答案 · 支持完整计分'
                          : '真题原文已解析 · 沉浸精读与练习'}
                      </span>
                    </div>

                    {hasAttempt && (
                      <div className="text-xs font-tabular-mono text-[#3F7664] dark:text-[#4EA387] bg-emerald-50/70 dark:bg-[#172E27]/70 px-2.5 py-1 rounded">
                        已在本地保存作答记录
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[#E8ECEA] dark:border-[#223036] flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectYearOverview(row.year)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] transition-colors whitespace-nowrap"
                    >
                      打开试卷
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onOpenImportReport(
                          row.year,
                          row.latestReadyVersion || row.latestCandidateVersion || 'v1'
                        )
                      }
                      className="text-xs text-[#68777C] dark:text-[#9CAEB3] hover:text-[#202B2F] dark:hover:text-[#E2E8E6] whitespace-nowrap transition-colors"
                    >
                      校验报告
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* By Question Type Index View */
        <div className="space-y-4">
          {[
            {
              type: 'cloze' as UnitType,
              unitId: 'unit-cloze',
              name: 'Section I · 完形填空 (Use of English)',
              range: '第 1–20 题',
              score: '10 分 (每题 0.5 分)',
              time: '建议 18 分钟',
              desc: '单选四选一，文内空位直选、词汇搭配辨析与上下文衔接。',
            },
            {
              type: 'reading' as UnitType,
              unitId: 'unit-reading-text-1',
              name: 'Section II Part A · 传统阅读理解 (Text 1–4)',
              range: '第 21–40 题',
              score: '40 分 (每题 2.0 分)',
              time: '建议 72 分钟',
              desc: '左文右题同屏精读、划词高亮、把握度评估、原文证据定位。',
            },
            {
              type: 'passage-assembly' as UnitType,
              unitId: 'unit-part-b',
              name: 'Section II Part B · 新题型篇章重组',
              range: '第 41–45 题',
              score: '10 分 (每题 2.0 分)',
              time: '建议 20 分钟',
              desc: '候选段落池 A–G、固定段锚点锁定、拖拽与点击快速填空。',
            },
            {
              type: 'translation' as UnitType,
              unitId: 'unit-part-c-translation',
              name: 'Section II Part C · 英译汉长难句翻译',
              range: '第 46–50 题',
              score: '10 分 (每题 2.0 分)',
              time: '建议 25 分钟',
              desc: '全文语境长难句、5 句独立作答、采分点精析与多版本修改。',
            },
            {
              type: 'practical-writing' as UnitType,
              unitId: 'unit-writing-part-a',
              name: 'Section III Part A · 应用文小作文',
              range: '第 51 题',
              score: '10 分',
              time: '约 100 词',
              desc: '审题要素核对、格式检查、字数监控与双阶段批改。',
            },
            {
              type: 'visual-writing' as UnitType,
              unitId: 'unit-writing-part-b',
              name: 'Section III Part B · 图画大作文',
              range: '第 52 题',
              score: '20 分',
              time: '160–200 词',
              desc: '高清插图检视、图画事实要素核验、独立作答与两阶段深度批改。',
            },
          ].map((item) => (
            <div
              key={item.type}
              className="bg-white dark:bg-[#1E2B30] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[#174A5B]/60 dark:hover:border-[#38849E]/70 hover:shadow-2xs transition-all"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-[#202B2F] dark:text-[#E2E8E6]">{item.name}</h3>
                  <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3]">
                    {item.range} · {item.score}
                  </span>
                </div>
                <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed max-w-2xl">
                  {item.desc}
                </p>
                <div className="text-xs text-[#96A1A4] dark:text-[#657980] font-tabular-mono">
                  用时：{item.time} · 覆盖全部 17 年题库
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onStartUnit(
                    manifest.availableYears[0] || 2024,
                    item.type,
                    `${manifest.availableYears[0] || 2024}-${item.unitId}`
                  )
                }
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold text-[#174A5B] dark:text-[#75B6CE] bg-[#174A5B]/10 dark:bg-[#38849E]/20 hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white transition-all self-start sm:self-center shrink-0"
              >
                <span>练 {manifest.availableYears[0] || 2024} 年真题</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
