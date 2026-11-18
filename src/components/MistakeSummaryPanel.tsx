import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  Settings,
  Sparkles,
} from 'lucide-react';
import type {
  Exam,
  ExamAttempt,
  MistakeFilterMode,
  MistakeSummaryRecord,
  MistakeSummaryScope,
  ReviewItem,
  SubjectId,
} from '../shared/types';
import {
  formatExamTitle,
  resolveCanonicalPaperId,
  resolveSubjectId,
} from '../shared/types';
import { dedupeSubmittedAttemptsByPaper } from '../shared/scoringAndReview';
import {
  buildCombinedMistakeSummaryMarkdown,
  buildPrintableHtmlDocument,
  buildPureMistakeMarkdownExport,
  collectMistakeItemsForScope,
  computeMistakeSummaryCacheKeyAndHash,
  splitMistakeItemsIntoBatches,
} from '../domain/mistakeSummary';
import { buildLocalApiHeaders } from '../services/localApi';
import { Badge, SegmentedTabs } from './ui/primitives';
import { MarkdownArticle } from './MarkdownArticle';

interface MistakeSummaryPanelProps {
  attempts: ExamAttempt[];
  reviewItems: ReviewItem[];
  mistakeSummaries: Record<string, MistakeSummaryRecord>;
  onSaveMistakeSummary: (record: MistakeSummaryRecord) => void;
  anyModelAvailable: boolean;
  activeProviderName?: string | null;
  onNavigateSettings?: () => void;
}

export const MistakeSummaryPanel: React.FC<MistakeSummaryPanelProps> = ({
  attempts,
  reviewItems,
  mistakeSummaries,
  onSaveMistakeSummary,
  anyModelAvailable,
  activeProviderName,
  onNavigateSettings,
}) => {
  const submittedDedupedAttempts = useMemo(() => {
    const submitted = attempts.filter(
      (a) => a.status === 'submitted' || Boolean(a.submittedAt)
    );
    return dedupeSubmittedAttemptsByPaper(submitted).sort(
      (a, b) => b.year - a.year
    );
  }, [attempts]);

  const [scope, setScope] = useState<MistakeSummaryScope>('by-subject');
  const [subjectId, setSubjectId] = useState<SubjectId>(() => {
    const hasPolitics = submittedDedupedAttempts.some(
      (a) => resolveSubjectId(a.year, a.subjectId) === 'politics'
    );
    const hasEnglish = submittedDedupedAttempts.some(
      (a) => resolveSubjectId(a.year, a.subjectId) === 'english-i'
    );
    if (!hasEnglish && hasPolitics) return 'politics';
    return 'english-i';
  });
  const [selectedPaperYear, setSelectedPaperYear] = useState<number>(
    () => submittedDedupedAttempts[0]?.year || 2024
  );
  const [filterMode, setFilterMode] = useState<MistakeFilterMode>('unmastered');
  const [selectedModuleKey, setSelectedModuleKey] = useState<string>('all');

  const [examsByYear, setExamsByYear] = useState<Record<number, Exam>>({});
  const [loadingExams, setLoadingExams] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [progressText, setProgressText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState(false);
  const [printFallbackHint, setPrintFallbackHint] = useState(false);
  const [includeRawAppendix, setIncludeRawAppendix] = useState(false);
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  const partialBatchCacheRef = useRef<{
    signature: string;
    completed: Record<number, { markdown: string; provider: string; model: string; promptVersion: string }>;
  }>({ signature: '', completed: {} });

  useEffect(() => {
    return () => {
      document.body.classList.remove('printing-mistake-summary');
    };
  }, []);

  // Keep selectedPaperYear valid when submitted papers change
  useEffect(() => {
    if (
      submittedDedupedAttempts.length > 0 &&
      !submittedDedupedAttempts.some((a) => a.year === selectedPaperYear)
    ) {
      setSelectedPaperYear(submittedDedupedAttempts[0].year);
    }
  }, [submittedDedupedAttempts, selectedPaperYear]);

  // Reset secondary module selection when changing scope or subject
  useEffect(() => {
    setSelectedModuleKey('all');
    setErrorMessage(null);
  }, [scope, subjectId, selectedPaperYear]);

  // Determine effective subject for the active view
  const effectiveSubjectId: SubjectId =
    scope === 'by-paper'
      ? resolveSubjectId(selectedPaperYear)
      : subjectId;

  const selectedPaperId =
    scope === 'by-paper' ? resolveCanonicalPaperId(selectedPaperYear) : undefined;

  // Fetch full exam payloads (cached in component state) for submitted attempts
  useEffect(() => {
    const relevantYears = Array.from(
      new Set(
        submittedDedupedAttempts
          .filter((a) =>
            scope === 'by-paper'
              ? a.year === selectedPaperYear
              : resolveSubjectId(a.year, a.subjectId) === effectiveSubjectId
          )
          .map((a) => a.year)
      )
    );
    const missingYears = relevantYears.filter((y) => !examsByYear[y]);
    if (missingYears.length === 0) return;

    let cancelled = false;
    setLoadingExams(true);
    void (async () => {
      try {
        const fetched: Record<number, Exam> = {};
        await Promise.all(
          missingYears.map(async (yr) => {
            try {
              const res = await fetch(
                `/api/v1/exams/generated/papers/${yr}?mode=study`,
                { headers: buildLocalApiHeaders() }
              );
              if (!res.ok) return;
              const body = await res.json();
              const examData = (body.data || body) as Exam;
              if (examData && examData.sections) {
                fetched[yr] = examData;
              }
            } catch {
              // ignore individual paper fetch failure
            }
          })
        );
        if (!cancelled && Object.keys(fetched).length > 0) {
          setExamsByYear((prev) => ({ ...prev, ...fetched }));
        }
      } finally {
        if (!cancelled) setLoadingExams(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [submittedDedupedAttempts, scope, selectedPaperYear, effectiveSubjectId, examsByYear]);

  const collected = useMemo(
    () =>
      collectMistakeItemsForScope({
        attempts,
        reviewItems,
        examsByYear,
        scope,
        subjectId: effectiveSubjectId,
        paperId: selectedPaperId,
        paperYear: scope === 'by-paper' ? selectedPaperYear : undefined,
        filterMode: scope === 'by-paper' ? 'all' : filterMode,
        moduleKey: scope === 'by-subject' ? selectedModuleKey : 'all',
      }),
    [
      attempts,
      reviewItems,
      examsByYear,
      scope,
      effectiveSubjectId,
      selectedPaperId,
      selectedPaperYear,
      filterMode,
      selectedModuleKey,
    ]
  );

  const effectiveModuleLabel = useMemo(() => {
    if (scope === 'by-paper') return '整卷错题';
    if (selectedModuleKey === 'all') return '全部模块';
    return (
      collected.availableModules.find((m) => m.moduleKey === selectedModuleKey)
        ?.moduleLabel || selectedModuleKey
    );
  }, [scope, selectedModuleKey, collected.availableModules]);

  const scopeTitle = useMemo(() => {
    if (scope === 'by-paper') {
      return `${formatExamTitle(selectedPaperYear)} · 单卷错题诊断与知识点总结`;
    }
    const subLabel =
      effectiveSubjectId === 'politics' ? '考研政治' : '考研英语一';
    const filterLabel =
      filterMode === 'unmastered' ? '未掌握错题' : '全部错题';
    return `${subLabel}跨卷汇总（${effectiveModuleLabel} · ${filterLabel}）`;
  }, [scope, selectedPaperYear, effectiveSubjectId, effectiveModuleLabel, filterMode]);

  const { cacheKey, inputHash } = useMemo(
    () =>
      computeMistakeSummaryCacheKeyAndHash({
        scope,
        subjectId: effectiveSubjectId,
        paperId: selectedPaperId,
        filterMode: scope === 'by-paper' ? 'all' : filterMode,
        moduleKey: scope === 'by-subject' ? selectedModuleKey : 'all',
        items: collected.items,
      }),
    [
      scope,
      effectiveSubjectId,
      selectedPaperId,
      filterMode,
      selectedModuleKey,
      collected.items,
    ]
  );

  const cachedRecord = mistakeSummaries[cacheKey];
  const isCacheExactHit =
    Boolean(cachedRecord) && cachedRecord.inputHash === inputHash;

  const batches = useMemo(
    () => splitMistakeItemsIntoBatches(collected.items, 25),
    [collected.items]
  );

  const exportableMarkdown = useMemo(() => {
    if (cachedRecord && cachedRecord.generatedByAi) {
      return buildCombinedMistakeSummaryMarkdown({
        title: scopeTitle,
        subjectId: effectiveSubjectId,
        stats: collected.stats,
        aiMarkdown: cachedRecord.markdownContent,
        modelLabel: cachedRecord.modelName
          ? `${cachedRecord.modelProvider}/${cachedRecord.modelName}`
          : undefined,
        generatedAt: new Date(cachedRecord.updatedAt).toLocaleString('zh-CN'),
        items: collected.items,
        includeRawAppendix,
      });
    }
    return buildPureMistakeMarkdownExport({
      title: scopeTitle,
      subjectId: effectiveSubjectId,
      stats: collected.stats,
      items: collected.items,
    });
  }, [cachedRecord, scopeTitle, effectiveSubjectId, collected.stats, collected.items, includeRawAppendix]);

  const handleGenerateAiSummary = async (forceRefresh = false) => {
    if (collected.items.length === 0) return;
    if (!forceRefresh && isCacheExactHit) return;

    setGenerating(true);
    setErrorMessage(null);
    setProgressText('');

    const batchSignature = `${cacheKey}::${inputHash}`;
    if (forceRefresh && partialBatchCacheRef.current.signature !== batchSignature) {
      partialBatchCacheRef.current = { signature: batchSignature, completed: {} };
    } else if (partialBatchCacheRef.current.signature !== batchSignature) {
      partialBatchCacheRef.current = { signature: batchSignature, completed: {} };
    }

    const inferredProvider = activeProviderName
      ? activeProviderName.split('/')[0]?.trim()
      : undefined;
    const explicitProvider =
      inferredProvider === 'gemini' ||
      inferredProvider === 'deepseek' ||
      inferredProvider === 'openai-compatible'
        ? inferredProvider
        : undefined;

    try {
      const headers = buildLocalApiHeaders({
        'Content-Type': 'application/json',
      });

      const batchMarkdowns: string[] = [];
      let lastProvider = '';
      let lastModel = '';
      let lastPromptVersion = '';

      for (const batch of batches) {
        const cachedBatch = partialBatchCacheRef.current.completed[batch.batchIndex];
        if (cachedBatch) {
          lastProvider = cachedBatch.provider;
          lastModel = cachedBatch.model;
          lastPromptVersion = cachedBatch.promptVersion;
          batchMarkdowns.push(
            batches.length > 1
              ? `# 模块分批报告 ${batch.batchIndex}/${batch.totalBatches}：${batch.moduleLabel}（${batch.items.length} 题）\n\n${cachedBatch.markdown}`
              : cachedBatch.markdown
          );
          continue;
        }

        if (batches.length > 1) {
          setProgressText(
            `正在分批总结 (${batch.batchIndex}/${batch.totalBatches})：${batch.moduleLabel}（${batch.items.length} 题）...`
          );
        } else {
          setProgressText(
            `正在由 AI 分析 ${batch.items.length} 道错题并提炼考前纠偏表...`
          );
        }

        const res = await fetch('/api/v1/mistake-summaries', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...(explicitProvider ? { provider: explicitProvider } : {}),
            subjectId: effectiveSubjectId,
            scope,
            scopeTitle,
            moduleLabel: batch.moduleLabel,
            batchIndex: batch.batchIndex,
            totalBatches: batch.totalBatches,
            deterministicStats: collected.stats,
            items: batch.items,
          }),
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            body.error?.message || `第 ${batch.batchIndex} 批总结请求失败`
          );
        }

        const data = body.data || body;
        const md = String(data.markdown || '').trim();
        if (!md || /^(none|null|undefined)$/i.test(md)) {
          throw new Error(
            `第 ${batch.batchIndex} 批返回空内容或无效响应（${md || 'empty'}），已跳过写入缓存，请重试。`
          );
        }

        lastProvider = String(data.modelProvider || '');
        lastModel = String(data.modelName || '');
        lastPromptVersion = String(data.promptVersion || 'yanjuan-mistake-summary-v1.0');

        partialBatchCacheRef.current.completed[batch.batchIndex] = {
          markdown: md,
          provider: lastProvider,
          model: lastModel,
          promptVersion: lastPromptVersion,
        };

        if (batches.length > 1) {
          batchMarkdowns.push(
            `# 模块分批报告 ${batch.batchIndex}/${batch.totalBatches}：${batch.moduleLabel}（${batch.items.length} 题）\n\n${md}`
          );
        } else {
          batchMarkdowns.push(md);
        }
      }

      partialBatchCacheRef.current = { signature: '', completed: {} };

      const nowIso = new Date().toISOString();
      const record: MistakeSummaryRecord = {
        id: `ms-${Date.now()}`,
        cacheKey,
        inputHash,
        scope,
        subjectId: effectiveSubjectId,
        paperId: selectedPaperId,
        paperYear: scope === 'by-paper' ? selectedPaperYear : undefined,
        paperTitle:
          scope === 'by-paper' ? formatExamTitle(selectedPaperYear) : undefined,
        filterMode: scope === 'by-paper' ? 'all' : filterMode,
        moduleKey: scope === 'by-subject' ? selectedModuleKey : 'all',
        moduleLabel: effectiveModuleLabel,
        stats: collected.stats,
        markdownContent: batchMarkdowns.join('\n\n---\n\n'),
        generatedByAi: true,
        modelProvider: lastProvider || undefined,
        modelName: lastModel || undefined,
        promptVersion: lastPromptVersion || undefined,
        itemCount: collected.items.length,
        batchCount: batches.length,
        createdAt: cachedRecord?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      onSaveMistakeSummary(record);
    } catch (err: any) {
      const finishedCount = Object.keys(partialBatchCacheRef.current.completed).length;
      const prefix =
        batches.length > 1 && finishedCount > 0
          ? `已完成 ${finishedCount}/${batches.length} 批（进度已暂存，点击生成可断点续传）；`
          : '';
      setErrorMessage(
        `${prefix}${err?.message || '生成错题总结失败，请检查模型配置或网络'}`
      );
    } finally {
      setGenerating(false);
      setProgressText('');
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportableMarkdown);
      } else {
        const ta = document.createElement('textarea');
        ta.value = exportableMarkdown;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedState(true);
      setTimeout(() => setCopiedState(false), 2000);
    } catch {
      setErrorMessage('剪贴板写入受限，请直接点击「下载 .md 文件」。');
    }
  };

  const handleDownloadMarkdown = () => {
    const slug =
      scope === 'by-paper'
        ? selectedPaperId || String(selectedPaperYear)
        : `${effectiveSubjectId}-${selectedModuleKey}`;
    const filename = `yanjuan-mistakes-${slug}-${new Date()
      .toISOString()
      .slice(0, 10)}.md`;
    const blob = new Blob([exportableMarkdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPrintableHtml = () => {
    const html = buildPrintableHtmlDocument({
      title: scopeTitle,
      markdownContent: exportableMarkdown,
    });
    const slug =
      scope === 'by-paper'
        ? selectedPaperId || String(selectedPaperYear)
        : `${effectiveSubjectId}-${selectedModuleKey}`;
    const filename = `yanjuan-print-${slug}-${new Date()
      .toISOString()
      .slice(0, 10)}.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPdfPrint = () => {
    setPrintFallbackHint(false);
    document.body.classList.add('printing-mistake-summary');

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      document.body.classList.remove('printing-mistake-summary');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    try {
      window.print();
      // In embedded iframes where print() is suppressed silently without firing afterprint,
      // show the HTML fallback hint without stripping print CSS prematurely during active preview.
      fallbackTimer = setTimeout(() => {
        setPrintFallbackHint(true);
      }, 1200);
    } catch {
      cleanup();
      // Fallback via hidden printable iframe
      try {
        const html = buildPrintableHtmlDocument({
          title: scopeTitle,
          markdownContent: exportableMarkdown,
        });
        const frame = printFrameRef.current;
        if (frame?.contentWindow) {
          frame.srcdoc = html;
          setTimeout(() => {
            try {
              frame.contentWindow?.focus();
              frame.contentWindow?.print();
            } catch {
              setPrintFallbackHint(true);
            }
          }, 250);
          return;
        }
      } catch {
        // ignore
      }
      setPrintFallbackHint(true);
    }
  };

  return (
    <section
      id="mistake-summary-section"
      className="scroll-mt-20 mistake-summary-print-root bg-card rounded-2xl border border-subtle shadow-2xs p-4 sm:p-8 space-y-6"
    >
      {/* Print-only title header */}
      <div className="hidden print-only-header">
        <h1 className="text-lg font-bold">{scopeTitle}</h1>
        <p className="text-[11px] text-secondary mt-0.5">
          错题 {collected.stats.totalWrong}/{collected.stats.totalAnswered} 题（正确率{' '}
          {collected.stats.accuracyRate}% · 失分 {collected.stats.totalScoreLost} 分）· 导出时间：
          {new Date().toLocaleString('zh-CN')}
        </p>
      </div>

      {/* Header + Export Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-hairline pb-5 no-print">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="w-5 h-5 text-brand shrink-0" />
            <h2 className="text-lg sm:text-xl font-bold text-ink">
              错题整体分析与知识点总结
            </h2>
            <Badge variant="brand">Markdown / PDF 导出</Badge>
          </div>
          <p className="text-xs text-secondary">
            数值统计由本地程序确定性计算，AI 仅负责跨题考点聚类、陷阱诊断与考前纠偏对照表提炼（严格学科隔离，政治忠实于官方解析原文）。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyMarkdown}
            disabled={submittedDedupedAttempts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-paper border border-subtle text-ink hover:border-brand transition-colors disabled:opacity-40"
          >
            {copiedState ? (
              <Check className="w-3.5 h-3.5 text-mastered" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-secondary" />
            )}
            <span>{copiedState ? '已复制 Markdown' : '复制 Markdown'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadMarkdown}
            disabled={submittedDedupedAttempts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-paper border border-subtle text-ink hover:border-brand transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-secondary" />
            <span>下载 .md 文件</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdfPrint}
            disabled={submittedDedupedAttempts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>导出 PDF</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPrintableHtml}
            disabled={submittedDedupedAttempts.length === 0}
            title="若嵌套窗口内浏览器的打印被拦截，可下载独立纯享打印页（打开即可另存为 PDF）"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card-subtle border border-subtle text-secondary hover:text-ink transition-colors disabled:opacity-40"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>纯享打印页 (.html)</span>
          </button>

          {cachedRecord?.generatedByAi && (
            <label
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-secondary bg-paper border border-subtle cursor-pointer select-none hover:text-ink"
              title="默认仅导出 1～2 页极简背诵讲义；勾选后会在导出或打印时附加完整原题与官方解析"
            >
              <input
                type="checkbox"
                checked={includeRawAppendix}
                onChange={(e) => setIncludeRawAppendix(e.target.checked)}
                className="accent-brand rounded"
              />
              <span>附带原题解析</span>
            </label>
          )}
        </div>
      </div>

      {printFallbackHint && (
        <div className="no-print p-3 rounded-xl bg-amber-50/80 dark:bg-[#2E2413] border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
          <span>
            若当前预览 iframe 环境下浏览器未弹出打印对话框，请点击「纯享打印页 (.html)」下载后直接在浏览器打开并选择“另存为 PDF”。
          </span>
          <button
            type="button"
            onClick={handleDownloadPrintableHtml}
            className="px-2.5 py-1 rounded bg-amber-700 text-white font-semibold shrink-0"
          >
            下载纯享打印页
          </button>
        </div>
      )}

      {/* Hidden iframe for print fallback */}
      <iframe
        ref={printFrameRef}
        title="mistake-summary-print-frame"
        className="hidden"
      />

      {submittedDedupedAttempts.length === 0 ? (
        <div className="p-10 rounded-xl bg-paper border border-hairline text-center space-y-2">
          <Layers className="w-6 h-6 text-muted mx-auto" />
          <div className="text-sm font-semibold text-ink">
            暂无已交卷的作答记录
          </div>
          <p className="text-xs text-secondary max-w-md mx-auto">
            在「真题」或「快速对答案」中完成并提交任意一套英语一或政治试卷后，即可在此按单卷或按学科生成错题知识点总结并导出 Markdown / PDF。
          </p>
        </div>
      ) : (
        <>
          {/* Scope & Isolation Controls */}
          <div className="no-print bg-card-subtle rounded-xl border border-subtle p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="max-w-full overflow-x-auto">
                <SegmentedTabs
                  ariaLabel="错题聚合视角"
                  value={scope}
                  onChange={setScope}
                  size="xs"
                  options={[
                    { id: 'by-subject', label: '按学科跨卷汇总' },
                    { id: 'by-paper', label: '按单套试卷' },
                  ]}
                />
              </div>

              {scope === 'by-subject' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedTabs
                    ariaLabel="严格学科隔离切换"
                    value={subjectId}
                    onChange={setSubjectId}
                    size="xs"
                    options={[
                      { id: 'english-i', label: '考研英语一' },
                      { id: 'politics', label: '考研政治' },
                    ]}
                  />
                  <SegmentedTabs
                    ariaLabel="错题掌握状态筛选"
                    value={filterMode}
                    onChange={setFilterMode}
                    size="xs"
                    options={[
                      { id: 'unmastered', label: '仅未掌握错题' },
                      { id: 'all', label: '全部错题' },
                    ]}
                  />
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 text-xs w-full md:w-auto min-w-0">
                  <span className="text-secondary font-medium shrink-0 whitespace-nowrap">
                    选择已交卷试卷：
                  </span>
                  <select
                    aria-label="选择已交卷试卷"
                    value={selectedPaperYear}
                    onChange={(e) => setSelectedPaperYear(Number(e.target.value))}
                    className="w-full sm:w-auto max-w-full min-w-0 px-3 py-1.5 rounded-lg bg-card border border-subtle text-ink font-medium"
                  >
                    {submittedDedupedAttempts.map((att) => (
                      <option key={att.id} value={att.year}>
                        [{resolveSubjectId(att.year, att.subjectId) === 'politics'
                          ? '政治'
                          : '英语一'}] {formatExamTitle(att.year)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Secondary Module Selector under By Subject */}
            {scope === 'by-subject' && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-hairline text-xs">
                <span className="text-secondary font-medium shrink-0">
                  {effectiveSubjectId === 'politics'
                    ? '知识模块筛选 (knowledgeModule)：'
                    : '题型模块筛选 (UnitType)：'}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedModuleKey('all')}
                  className={`px-2.5 py-1 rounded-md border transition-colors ${
                    selectedModuleKey === 'all'
                      ? 'bg-brand text-white border-brand font-semibold'
                      : 'bg-card text-secondary border-subtle hover:text-ink'
                  }`}
                >
                  全部模块 ({collected.allPaperWrongCount} 题
                  {collected.allPaperWrongCount > 25 ? ' · 自动拆批' : ''})
                </button>
                {collected.availableModules.map((mod) => (
                  <button
                    key={mod.moduleKey}
                    type="button"
                    onClick={() => setSelectedModuleKey(mod.moduleKey)}
                    className={`px-2.5 py-1 rounded-md border transition-colors ${
                      selectedModuleKey === mod.moduleKey
                        ? 'bg-brand text-white border-brand font-semibold'
                        : 'bg-card text-secondary border-subtle hover:text-ink'
                    }`}
                  >
                    {mod.moduleLabel} ({mod.wrongCount})
                  </button>
                ))}
                {loadingExams && (
                  <span className="inline-flex items-center gap-1 text-muted ml-auto">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在加载原卷考点与解析...
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Deterministic Summary Stats Strip (Printed + Visible) */}
          <div
            className={
              cachedRecord?.generatedByAi && !includeRawAppendix
                ? 'space-y-4 print-hide-when-ai'
                : 'space-y-4'
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-paper border border-hairline print-avoid-break">
                <div className="text-secondary">纳入分析错题数</div>
                <div className="text-xl font-bold text-danger font-tabular-mono mt-1">
                  {collected.stats.totalWrong}{' '}
                  <span className="text-xs font-normal text-muted">
                    / {collected.stats.totalAnswered} 题
                  </span>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-paper border border-hairline print-avoid-break">
                <div className="text-secondary">范围客观题正确率</div>
                <div className="text-xl font-bold text-mastered font-tabular-mono mt-1">
                  {collected.stats.accuracyRate}%
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-paper border border-hairline print-avoid-break">
                <div className="text-secondary">确定但答错（高危）</div>
                <div className="text-xl font-bold text-ink font-tabular-mono mt-1">
                  {collected.stats.certainWrongCount}{' '}
                  <span className="text-xs font-normal text-muted">
                    题 · 犹豫错 {collected.stats.hesitantWrongCount}
                  </span>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-paper border border-hairline print-avoid-break">
                <div className="text-secondary">
                  {effectiveSubjectId === 'politics'
                    ? '政治多选失分拆解'
                    : '覆盖已交卷试卷'}
                </div>
                {effectiveSubjectId === 'politics' ? (
                  <div className="text-sm font-bold text-ink font-tabular-mono mt-1.5">
                    漏选 {collected.stats.multiPartialMissOnly} · 误选{' '}
                    {collected.stats.multiWrongOptionSelected}
                  </div>
                ) : (
                  <div className="text-xl font-bold text-brand font-tabular-mono mt-1">
                    {collected.stats.sourcePapersCount}{' '}
                    <span className="text-xs font-normal text-muted">套</span>
                  </div>
                )}
              </div>
            </div>

            {/* Deterministic Module Breakdown Table */}
            {collected.stats.moduleBreakdown.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-subtle print-avoid-break">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-card-subtle border-b border-subtle text-secondary">
                      <th className="px-3.5 py-2.5 font-semibold">
                        {effectiveSubjectId === 'politics'
                          ? '政治知识模块'
                          : '英语一题型模块'}
                      </th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">
                        已作答
                      </th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">
                        错题数
                      </th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">
                        正确率
                      </th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">
                        失分
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {collected.stats.moduleBreakdown.map((m) => (
                      <tr key={m.moduleKey} className="bg-card">
                        <td className="px-3.5 py-2 font-medium text-ink">
                          {m.moduleLabel}
                        </td>
                        <td className="px-3.5 py-2 text-right font-tabular-mono">
                          {m.answeredCount}
                        </td>
                        <td className="px-3.5 py-2 text-right font-tabular-mono text-danger font-semibold">
                          {m.wrongCount}
                        </td>
                        <td className="px-3.5 py-2 text-right font-tabular-mono text-mastered">
                          {m.accuracyRate}%
                        </td>
                        <td className="px-3.5 py-2 text-right font-tabular-mono text-secondary">
                          {m.scoreLost} 分
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Mild sample size warning (<3 items) */}
          {collected.items.length > 0 && collected.items.length < 3 && (
            <div className="no-print p-3 rounded-xl bg-amber-50/70 dark:bg-[#2E2413] border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                当前范围内仅有 {collected.items.length} 道错题（少于 3 题），跨题聚类样本较少，但您仍可手动触发 AI 生成精简诊断，或直接导出错题清单。
              </span>
            </div>
          )}

          {/* AI Generation Controls & Graceful Degradation */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-paper border border-hairline">
            <div className="space-y-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">AI 跨题语义归纳与纠偏报告</span>
                {isCacheExactHit && (
                  <Badge variant="success">
                    已命中本地缓存 · 错题内容未变动，免重复调用
                  </Badge>
                )}
                {!isCacheExactHit && cachedRecord && (
                  <Badge variant="warning">
                    错题或笔记已更新 · 建议点击重新生成
                  </Badge>
                )}
                {batches.length > 1 && (
                  <Badge variant="brand">
                    超 25 题防超限拆批：将自动分 {batches.length} 批按模块生成
                  </Badge>
                )}
              </div>
              <div className="text-secondary">
                {anyModelAvailable ? (
                  <span>
                    当前可用模型：{activeProviderName || '默认绑定模型'} · 每次请求仅传必要题干/选项/错选/笔记
                    {effectiveSubjectId === 'politics'
                      ? '与官方解析原文（不传整篇无关文本）'
                      : '（不传整篇阅读全文，严防超限）'}
                  </span>
                ) : (
                  <span className="text-amber-800 dark:text-amber-300">
                    当前尚未配置可用的 AI 模型。您仍可使用上方确定性模块统计与「下载 .md / 导出 PDF」导出纯错题记录；配置模型后可解锁 AI 知识聚类与纠偏表。
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!anyModelAvailable ? (
                <button
                  type="button"
                  onClick={onNavigateSettings}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-brand text-brand hover:bg-brand-subtle transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>前往设置配置模型</span>
                </button>
              ) : isCacheExactHit ? (
                <button
                  type="button"
                  disabled={generating || collected.items.length === 0}
                  onClick={() => void handleGenerateAiSummary(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-paper border border-brand text-brand hover:bg-brand-subtle transition-colors disabled:opacity-40"
                >
                  {generating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>重新生成总结</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={generating || collected.items.length === 0}
                  onClick={() => void handleGenerateAiSummary(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40"
                >
                  {generating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {batches.length > 1
                      ? `整科一键生成 (共 ${batches.length} 批)`
                      : '生成 AI 错题总结'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {progressText && (
            <div className="no-print p-3 rounded-xl bg-brand-subtle/60 border border-brand/30 text-xs text-brand flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{progressText}</span>
            </div>
          )}

          {errorMessage && (
            <div className="no-print p-3 rounded-xl bg-danger-subtle border border-danger/40 text-xs text-danger flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Rendered Markdown Report (AI Summary OR Deterministic Raw Mistake Preview) */}
          {collected.items.length === 0 ? (
            <div className="p-8 rounded-xl bg-paper border border-hairline text-center text-xs text-secondary">
              当前筛选条件下没有错题记录（若开启了“仅未掌握错题”，说明该范围错题均已攻克或尚未作答出错）。
            </div>
          ) : cachedRecord && cachedRecord.generatedByAi ? (
            <div className="mistake-report-surface p-5 sm:p-6 rounded-xl bg-paper border border-hairline space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted border-b border-hairline pb-2.5 no-print">
                <span>
                  报告生成模型：{cachedRecord.modelProvider}/{cachedRecord.modelName} ·
                  共 {cachedRecord.itemCount} 道错题
                  {cachedRecord.batchCount > 1
                    ? `（已分 ${cachedRecord.batchCount} 批合并）`
                    : ''}
                  {cachedRecord.promptVersion
                    ? ` · ${cachedRecord.promptVersion}`
                    : ''}
                </span>
                <span>
                  更新时间：{new Date(cachedRecord.updatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <MarkdownArticle markdown={cachedRecord.markdownContent} />
            </div>
          ) : (
            <div className="p-5 sm:p-6 rounded-xl bg-paper border border-hairline space-y-3">
              <div className="flex items-center justify-between border-b border-hairline pb-2">
                <span className="text-xs font-bold text-ink">
                  错题原始明细预览（支持无 AI 直接导出 Markdown / PDF）
                </span>
                <span className="text-[11px] text-muted font-tabular-mono">
                  共 {collected.items.length} 题
                </span>
              </div>
              <div className="space-y-3">
                {collected.items.map((item) => (
                  <div
                    key={`${item.paperId}-${item.questionNumber}`}
                    className="p-3.5 rounded-lg bg-card border border-hairline text-xs space-y-1.5 print-avoid-break"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-ink">
                        {item.paperTitle} · 第 {item.questionNumber} 题
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="brand">{item.moduleLabel}</Badge>
                        {item.multiChoiceTag === 'partial-miss' && (
                          <Badge variant="warning">多选漏选</Badge>
                        )}
                        {item.multiChoiceTag === 'wrong-option' && (
                          <Badge variant="danger">误选干扰项</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-secondary leading-relaxed">{item.prompt}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-tabular-mono">
                      <span className="text-danger">
                        我的选择：{item.userSelectedAnswer || '—'}
                      </span>
                      <span className="text-mastered font-semibold">
                        官方答案：{item.correctAnswer || '—'}
                      </span>
                      {item.userNotes && (
                        <span className="text-ink font-sans">
                          笔记：{item.userNotes}
                        </span>
                      )}
                    </div>
                    {item.officialExplanation && (
                      <p className="text-[11px] text-secondary bg-card-subtle p-2 rounded border border-hairline">
                        官方解析：{item.officialExplanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
