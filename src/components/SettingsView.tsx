import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  Download,
  FileUp,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sliders,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { buildApiAuthHeaders } from '../services/firebaseClient.ts';
import type { ReadingTypographyPrefs, ThemeMode } from '../services/storageAndSync.ts';
import type {
  AITaskType,
  DiscoveredModelItem,
  EvaluationRun,
  ModelProfile,
  MultiLayerTestResponse,
  ProviderCredentialStatus,
  ProviderType,
  SyncStatus,
  TaskBindingConfig,
  UserAIWorkspaceConfig,
} from '../shared/types.ts';

export interface SettingsViewProps {
  isFirebaseConfigured: boolean;
  currentUserEmail: string | null;
  syncStatus: SyncStatus;
  isPrivateDevice: boolean;
  onTogglePrivateDevice: (val: boolean) => void;
  onSignInGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  anyModelAvailable: boolean;
  activeProviderName: string | null;
  credentialStatuses: ProviderCredentialStatus[];
  aiWorkspace?: UserAIWorkspaceConfig | null;
  onRefreshWorkspace?: () => Promise<void>;
  onSaveProviderCredential: (params: {
    connectionId?: string;
    displayName?: string;
    provider: ProviderType;
    apiKey?: string;
    baseUrl?: string;
    model: string;
    modelSource?: 'provider-list' | 'manual';
    storageMode: 'session-cookie' | 'encrypted-firestore';
    setAsDefault?: boolean;
    verifiedCapabilities?: Partial<ModelProfile['capabilities']>;
    capabilitySource?: Partial<ModelProfile['capabilitySource']>;
  }) => Promise<void>;
  onTestProviderCredential: (params: {
    provider: ProviderType;
    connectionId?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    layers?: ('basic' | 'structured' | 'vision' | 'sample')[];
  }) => Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    multiLayerReport?: MultiLayerTestResponse;
  }>;
  onDeleteProviderCredential: (providerOrConnId: string) => Promise<void>;
  typographyPrefs: ReadingTypographyPrefs;
  onUpdateTypographyPrefs: (prefs: ReadingTypographyPrefs) => void;
  themeMode: ThemeMode;
  onSelectThemeMode: (mode: ThemeMode) => void;
  onSubmitSourceImport: (params: {
    year: number;
    fileName: string;
    markdownText?: string;
    contentBase64?: string;
  }) => Promise<any>;
  isImportingAnswers: boolean;
  onExportJson: () => string;
  onImportJson: (raw: string) => void;
  onClearAllData: () => Promise<void>;
}

const PROVIDERS: Array<{
  id: ProviderType;
  label: string;
  defaultBaseUrl: string;
  sampleModel: string;
  desc: string;
}> = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    sampleModel: 'gemini-2.5-flash',
    desc: '支持官方模型列表拉取、结构化 JSON Schema 输出及图画作文多模态输入。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (深度求索)',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    sampleModel: 'deepseek-chat',
    desc: '高性价比中文逻辑推理，适合客观题证据句精析、长难句切分与主观题复核。',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI Compatible (自定义网关)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    sampleModel: 'gpt-4o-mini',
    desc: '支持任意兼容 OpenAI Chat Completions 协议的 HTTPS 服务端或私有模型网关。',
  },
];

const TASK_DEFINITIONS: Array<{
  taskType: AITaskType;
  title: string;
  subtitle: string;
  isVisionTask?: boolean;
}> = [
  {
    taskType: 'objective_explanation',
    title: '客观题证据句精析与干扰项拆解',
    subtitle: '完形/阅读/新题型定位句核验、六维错因诊断与题源争议说明',
  },
  {
    taskType: 'subjective_stage1',
    title: '主观题第一阶段：初评与逐句批注',
    subtitle: '英译汉与小作文分项评分、原文精确锚定批注、V1->V2->V3 增量复盘',
  },
  {
    taskType: 'subjective_stage2',
    title: '主观题第二阶段：独立复核与分项校准',
    subtitle: '独立校验总分与分项维度一致性（绑定同模型时自动合并省去冗余请求）',
  },
  {
    taskType: 'visual_writing',
    title: '图画大作文多模态批改 (Visual Writing)',
    subtitle: '优先向已验证 Vision 能力的模型传入真题原图；否则按策略降级或拦截',
    isVisionTask: true,
  },
  {
    taskType: 'followup_chat',
    title: '批改后多轮上下文追问导师',
    subtitle: '自动携带当前篇章、题干选项、考生作答与最新批改报告进行多轮答疑',
  },
  {
    taskType: 'writing_scaffold',
    title: '动笔前审题与三段式写作支架',
    subtitle: '生成审题立意、段落推进框架与留白句型骨架，严禁替学生代写全文',
  },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  isFirebaseConfigured,
  currentUserEmail,
  syncStatus,
  isPrivateDevice,
  onTogglePrivateDevice,
  onSignInGoogle,
  onSignOut,
  credentialStatuses,
  aiWorkspace,
  onRefreshWorkspace,
  onSaveProviderCredential,
  onTestProviderCredential,
  onDeleteProviderCredential,
  typographyPrefs,
  onUpdateTypographyPrefs,
  themeMode,
  onSelectThemeMode,
  onSubmitSourceImport,
  isImportingAnswers,
  onExportJson,
  onImportJson,
  onClearAllData,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>('deepseek');
  const [connectionName, setConnectionName] = useState<string>('我的 DeepSeek');
  const [baseUrlInput, setBaseUrlInput] = useState<string>('https://api.deepseek.com/v1');
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [storageMode, setStorageMode] = useState<'encrypted-firestore' | 'session-cookie'>(
    'encrypted-firestore'
  );
  const [setAsDefault, setSetAsDefault] = useState<boolean>(true);

  // Dual-mode Model Configuration: 'provider-list' (Mode A) | 'manual' (Mode B)
  const [modelSourceMode, setModelSourceMode] = useState<'provider-list' | 'manual'>('manual');
  const [modelInput, setModelInput] = useState<string>('deepseek-chat');
  const [modelSearch, setModelSearch] = useState<string>('');
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModelItem[]>([]);
  const [discoveryMeta, setDiscoveryMeta] = useState<{
    source: string;
    fetchedAt: string;
    warning?: string;
  } | null>(null);
  const [fetchingModels, setFetchingModels] = useState<boolean>(false);

  // Multi-layer capability probe state
  const [probeVisionLayer, setProbeVisionLayer] = useState<boolean>(false);
  const [probeSampleLayer, setProbeSampleLayer] = useState<boolean>(false);
  const [testingConnection, setTestingConnection] = useState<boolean>(false);
  const [lastProbeReport, setLastProbeReport] = useState<MultiLayerTestResponse | null>(null);
  const [verifiedConfigSignature, setVerifiedConfigSignature] = useState<string>('');

  const [savingCredential, setSavingCredential] = useState<boolean>(false);
  const [updatingBindings, setUpdatingBindings] = useState<boolean>(false);
  const [recentRuns, setRecentRuns] = useState<EvaluationRun[]>([]);
  const [importYear, setImportYear] = useState<number>(2010);
  const [importMarkdown, setImportMarkdown] = useState<string>('');

  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const currentSignature = `${selectedProvider}|${baseUrlInput.trim()}|${apiKeyInput.trim()}|${modelInput.trim()}`;
  const isCurrentFormVerified =
    Boolean(lastProbeReport?.ok) && verifiedConfigSignature === currentSignature;

  // Sync form fields when switching provider tab
  const handleSelectProvider = (provider: ProviderType) => {
    setSelectedProvider(provider);
    const meta = PROVIDERS.find((p) => p.id === provider)!;
    const status = credentialStatuses.find((c) => c.provider === provider);
    const conn = aiWorkspace?.connections.find((c) => c.providerType === provider);
    const prof = aiWorkspace?.modelProfiles.find((p) => p.providerType === provider);

    setConnectionName(conn?.displayName || `我的 ${meta.label}`);
    setBaseUrlInput(conn?.baseUrl || status?.baseUrl || meta.defaultBaseUrl);
    setModelInput(prof?.modelId || status?.model || meta.sampleModel);
    setModelSourceMode(prof?.source === 'provider-list' ? 'provider-list' : 'manual');
    setDiscoveredModels([]);
    setDiscoveryMeta(null);
    setLastProbeReport(null);
  };

  // Load workspace & telemetry runs
  useEffect(() => {
    void (async () => {
      try {
        const headers = await buildApiAuthHeaders();
        const res = await fetch('/api/v1/ai-workspace', { headers });
        if (res.ok) {
          const body = await res.json();
          if (Array.isArray(body.data?.runs)) {
            setRecentRuns(body.data.runs);
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [aiWorkspace?.updatedAt, credentialStatuses]);

  // Mode A: Fetch model list from provider via server proxy
  const handleFetchModelList = async (forceRefresh: boolean = false) => {
    setFetchingModels(true);
    setBanner(null);
    try {
      const headers = await buildApiAuthHeaders();
      const existingConn = aiWorkspace?.connections.find(
        (c) => c.providerType === selectedProvider
      );
      const res = await fetch('/api/v1/provider-models', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider: selectedProvider,
          connectionId: existingConn?.id,
          apiKey: apiKeyInput.trim() || undefined,
          baseUrl: baseUrlInput.trim() || undefined,
          forceRefresh,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || '拉取模型列表失败');
      }

      const data = body.data || body;
      const models: DiscoveredModelItem[] = Array.isArray(data.models) ? data.models : [];
      setDiscoveredModels(models);
      setDiscoveryMeta({
        source: data.source === 'cached-provider-api' ? '服务端缓存 (TTL 5m)' : '供应商官方接口 (/models)',
        fetchedAt: data.fetchedAt || new Date().toISOString(),
        warning: data.warningMessage,
      });

      if (models.length > 0) {
        setModelSourceMode('provider-list');
        if (!modelInput.trim() || !models.some((m) => m.modelId === modelInput.trim())) {
          setModelInput(models[0].modelId);
        }
        setBanner({
          type: 'success',
          message: `已获取 ${models.length} 个模型（来源：${data.source === 'cached-provider-api' ? '缓存' : '实时接口'}）。`,
        });
      } else {
        setModelSourceMode('manual');
        setBanner({
          type: 'info',
          message:
            data.warningMessage ||
            '该供应商未返回模型列表，已自动切换至「手动填写模型 ID」。这不代表 API Key 无效。',
        });
      }
    } catch (err: any) {
      setModelSourceMode('manual');
      setBanner({
        type: 'error',
        message: err?.message || '获取模型列表失败，请使用手动填写模型 ID',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  // Run Multi-Layer Capability Test on current form values (without requiring prior save)
  const handleTestCurrentForm = async () => {
    if (!modelInput.trim()) {
      setBanner({
        type: 'error',
        message: '请先从列表选择模型或手动填写模型 ID（请求中的 model 字段）后再测试。',
      });
      return;
    }

    setTestingConnection(true);
    setBanner(null);
    try {
      const existingConn = aiWorkspace?.connections.find(
        (c) => c.providerType === selectedProvider
      );
      const layers: ('basic' | 'structured' | 'vision' | 'sample')[] = [
        'basic',
        'structured',
      ];
      if (probeVisionLayer) layers.push('vision');
      if (probeSampleLayer) layers.push('sample');

      const result = await onTestProviderCredential({
        provider: selectedProvider,
        connectionId: existingConn?.id,
        apiKey: apiKeyInput.trim() || undefined,
        baseUrl: baseUrlInput.trim() || undefined,
        model: modelInput.trim(),
        layers,
      });

      if (result.multiLayerReport) {
        setLastProbeReport(result.multiLayerReport);
      }

      if (result.ok) {
        setVerifiedConfigSignature(currentSignature);
        setBanner({
          type: 'success',
          message: `测试通过 (${result.latencyMs}ms)：${result.message}`,
        });
        if (onRefreshWorkspace) await onRefreshWorkspace();
      } else {
        setBanner({
          type: 'error',
          message: `测试未完全通过：${result.message}`,
        });
      }
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err?.message || '连接测试失败',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  // Save Connection & Model Profile
  const handleSaveConfig = async () => {
    if (!modelInput.trim()) {
      setBanner({
        type: 'error',
        message: '模型 ID 不能为空，请选择或手动填写目标接口实际接受的 model 值。',
      });
      return;
    }

    setSavingCredential(true);
    setBanner(null);
    try {
      const existingConn = aiWorkspace?.connections.find(
        (c) => c.providerType === selectedProvider
      );
      await onSaveProviderCredential({
        connectionId: existingConn?.id,
        displayName: connectionName.trim() || undefined,
        provider: selectedProvider,
        apiKey: apiKeyInput.trim() || undefined,
        baseUrl: baseUrlInput.trim() || undefined,
        model: modelInput.trim(),
        modelSource: modelSourceMode,
        storageMode,
        setAsDefault,
        verifiedCapabilities: isCurrentFormVerified
          ? lastProbeReport?.verifiedCapabilities
          : undefined,
        capabilitySource: isCurrentFormVerified
          ? lastProbeReport?.capabilitySources
          : undefined,
      });

      setApiKeyInput('');
      if (onRefreshWorkspace) await onRefreshWorkspace();
      setBanner({
        type: 'success',
        message: `已保存连接「${connectionName}」与模型「${modelInput.trim()}」（来源：${
          modelSourceMode === 'provider-list' ? '列表选择' : 'manual 手动填写'
        }）${setAsDefault ? '，并设为当前全局默认模型' : ''}。`,
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err?.message || '保存配置失败',
      });
    } finally {
      setSavingCredential(false);
    }
  };

  const handleSetDefaultModelProfile = async (profileId: string) => {
    setBanner(null);
    try {
      const headers = await buildApiAuthHeaders();
      const res = await fetch('/api/v1/ai-workspace/default-model', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ profileId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || '切换默认模型失败');
      }
      if (onRefreshWorkspace) await onRefreshWorkspace();
      setBanner({
        type: 'success',
        message: '已明确切换当前全局默认模型。',
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err?.message || '设置默认模型失败',
      });
    }
  };

  const handleUpdateTaskBinding = async (
    taskType: AITaskType,
    patch: Partial<TaskBindingConfig>
  ) => {
    setUpdatingBindings(true);
    setBanner(null);
    try {
      const headers = await buildApiAuthHeaders();
      const res = await fetch('/api/v1/ai-workspace/task-bindings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          bindings: {
            [taskType]: patch,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || '更新任务模型绑定失败');
      }
      if (onRefreshWorkspace) await onRefreshWorkspace();
      setBanner({
        type: 'success',
        message: `已更新任务「${
          TASK_DEFINITIONS.find((t) => t.taskType === taskType)?.title || taskType
        }」的模型绑定配置。`,
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err?.message || '更新任务绑定失败',
      });
    } finally {
      setUpdatingBindings(false);
    }
  };

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return discoveredModels;
    return discoveredModels.filter(
      (m) =>
        m.modelId.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q)
    );
  }, [discoveredModels, modelSearch]);

  const savedProfiles = aiWorkspace?.modelProfiles || [];
  const defaultProfileId = aiWorkspace?.defaultModelProfileId || null;

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Page Title */}
      <div className="border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#202B2F] dark:text-[#E2E8E6]">
            AI 架构路由、模型配置与系统安全设置
          </h1>
          <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] mt-1">
            四层解耦模型架构：API 连接 (Connection) → 模型能力档案 (ModelProfile) → 六大教学任务绑定 (TaskBinding) → 调用审计 (EvaluationRun)
          </p>
        </div>
        <div className="text-xs px-3 py-1.5 rounded-sm bg-[#E8F0F1] dark:bg-[#1F3740] text-[#174A5B] dark:text-[#56AEC8] font-medium flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" />
          <span>AES-256-GCM 持久化加密 · SSRF 防护已启用</span>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-sm border text-xs flex items-center justify-between gap-3 ${
            banner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : banner.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="underline shrink-0 opacity-80 hover:opacity-100"
          >
            关闭
          </button>
        </div>
      )}

      {/* 1. Saved Model Profiles & Explicit Global Default Selector */}
      <section className="bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#174A5B] dark:text-[#56AEC8]" />
            <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
              1. 已保存模型池与全局默认模型 (Explicit Default Model Selection)
            </h2>
          </div>
          <span className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
            共 {savedProfiles.length} 个已配置模型
          </span>
        </div>

        {savedProfiles.length === 0 ? (
          <div className="p-4 bg-[#F1F5F3] dark:bg-[#131B1E] text-xs text-[#68777C] dark:text-[#9CAEB3]">
            尚未配置任何 AI 模型。未配置时您仍可完整进行历年真题计时作答、客观题自动判分与本地错题复盘；在下方添加连接后即可解锁两阶段主观题精批与证据句精析。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {savedProfiles.map((prof) => {
              const isDefault = prof.id === defaultProfileId;
              const conn = aiWorkspace?.connections.find((c) => c.id === prof.connectionId);
              return (
                <div
                  key={prof.id}
                  className={`p-4 border flex flex-col justify-between gap-3 ${
                    isDefault
                      ? 'border-[#174A5B] dark:border-[#56AEC8] bg-[#E8F0F1]/30 dark:bg-[#1F3740]/30'
                      : 'border-[#DCE4E1] dark:border-[#2C3E46]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-[#202B2F] dark:text-[#E2E8E6]">
                          {prof.modelId}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 bg-stone-100 dark:bg-[#25363D] text-[#68777C] dark:text-[#9CAEB3]">
                          {prof.providerType}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 bg-stone-100 dark:bg-[#25363D] font-mono text-[#68777C] dark:text-[#9CAEB3]">
                          source: {prof.source}
                        </span>
                      </div>
                      {isDefault && (
                        <span className="text-[11px] font-bold px-2 py-0.5 bg-[#174A5B] text-white">
                          当前默认模型
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-[#68777C] dark:text-[#9CAEB3] flex flex-wrap gap-3">
                      <span>连接: {conn?.displayName || prof.providerType}</span>
                      {conn?.maskedKey && <span className="font-mono">{conn.maskedKey}</span>}
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                      <span className="px-1.5 py-0.5 border border-[#DCE4E1] dark:border-[#2C3E46]">
                        JSON: {prof.capabilities.structuredOutput ? '已支持' : '待验证'} (
                        {prof.capabilitySource.structuredOutput})
                      </span>
                      <span className="px-1.5 py-0.5 border border-[#DCE4E1] dark:border-[#2C3E46]">
                        Vision看图: {prof.capabilities.vision ? '已验证支持' : '不支持/未验证'} (
                        {prof.capabilitySource.vision})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#DCE4E1] dark:border-[#2C3E46]">
                    {!isDefault ? (
                      <button
                        type="button"
                        onClick={() => handleSetDefaultModelProfile(prof.id)}
                        className="text-xs font-semibold text-[#174A5B] dark:text-[#56AEC8] hover:underline"
                      >
                        设为全局默认模型
                      </button>
                    ) : (
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        已作为全局默认模型生效
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteProviderCredential(conn?.id || prof.providerType)}
                      className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除连接
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Add / Edit API Connection + Dual-Mode Model Selection */}
      <section className="bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] p-5 space-y-5">
        <div className="flex items-center justify-between border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#174A5B] dark:text-[#56AEC8]" />
            <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
              2. 配置 API 连接与模型（支持「获取模型列表」与「手动填写模型 ID」双方式）
            </h2>
          </div>
        </div>

        {/* Provider Selector Tabs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const active = selectedProvider === p.id;
            const st = credentialStatuses.find((c) => c.provider === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProvider(p.id)}
                className={`p-3.5 border text-left transition-colors ${
                  active
                    ? 'bg-[#174A5B] text-white border-[#174A5B]'
                    : 'bg-[#F1F5F3] dark:bg-[#131B1E] border-[#DCE4E1] dark:border-[#2C3E46]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs">{p.label}</span>
                  {st?.configured && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 ${
                        active
                          ? 'bg-emerald-700 text-white'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      已配置 ({st.model})
                    </span>
                  )}
                </div>
                <p className={`text-[11px] ${active ? 'text-stone-200' : 'text-[#68777C]'}`}>
                  {p.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* Connection & Model Form */}
        <div className="p-4 bg-[#F1F5F3]/60 dark:bg-[#131B1E]/60 border border-[#DCE4E1] dark:border-[#2C3E46] space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">
                连接名称 (Connection Name)
              </label>
              <input
                type="text"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
                placeholder="例如：我的 DeepSeek"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Base URL (自动标准化路径，防止 /v1/v1/models 重复拼接)
              </label>
              <input
                type="url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://api.deepseek.com"
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">
                API Key（临时测试不落盘、不写日志；留空则使用当前连接已保存密钥）
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                凭证存储方式
              </label>
              <select
                value={storageMode}
                onChange={(e) =>
                  setStorageMode(e.target.value as 'encrypted-firestore' | 'session-cookie')
                }
                className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46]"
              >
                <option value="encrypted-firestore">
                  持久化加密存储 (AES-256-GCM 落盘，服务重启后依然保留)
                </option>
                <option value="session-cookie">
                  仅当前进程会话内存 (Session-Only，重启服务即清除)
                </option>
              </select>
            </div>
          </div>

          {/* Model Selection Dual-Mode Block */}
          <div className="border-t border-[#DCE4E1] dark:border-[#2C3E46] pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#174A5B] dark:text-[#56AEC8]" />
                <span className="text-xs font-bold">
                  模型配置（方式 A：获取模型列表 ｜ 方式 B：手动填写模型 ID）
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleFetchModelList(true)}
                  disabled={fetchingModels}
                  className="px-3 py-1.5 text-xs bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] hover:border-[#174A5B] flex items-center gap-1.5"
                >
                  {fetchingModels ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  刷新模型列表
                </button>

                <div className="inline-flex border border-[#DCE4E1] dark:border-[#2C3E46] text-xs">
                  <button
                    type="button"
                    onClick={() => setModelSourceMode('provider-list')}
                    className={`px-2.5 py-1 ${
                      modelSourceMode === 'provider-list'
                        ? 'bg-[#174A5B] text-white'
                        : 'bg-white dark:bg-[#1A2529]'
                    }`}
                  >
                    方式 A：列表选择
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelSourceMode('manual')}
                    className={`px-2.5 py-1 ${
                      modelSourceMode === 'manual'
                        ? 'bg-[#174A5B] text-white'
                        : 'bg-white dark:bg-[#1A2529]'
                    }`}
                  >
                    方式 B：手动填写模型 ID
                  </button>
                </div>
              </div>
            </div>

            {discoveryMeta?.warning && (
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{discoveryMeta.warning}</span>
              </div>
            )}

            {modelSourceMode === 'provider-list' ? (
              <div className="p-3 bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-[#68777C]">
                  <span>
                    列表来源：{discoveryMeta?.source || '未获取（请点击“刷新模型列表”）'}
                  </span>
                  {discoveryMeta?.fetchedAt && (
                    <span>
                      获取时间：{new Date(discoveryMeta.fetchedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>

                {discoveredModels.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#68777C] absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="搜索模型 ID 或名称..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#DCE4E1] dark:border-[#2C3E46] bg-[#F1F5F3] dark:bg-[#131B1E]"
                      />
                    </div>
                    <select
                      value={modelInput}
                      onChange={(e) => {
                        if (e.target.value === '__manual__') {
                          setModelSourceMode('manual');
                        } else {
                          setModelInput(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-1.5 text-xs font-mono border border-[#DCE4E1] dark:border-[#2C3E46] bg-[#F1F5F3] dark:bg-[#131B1E]"
                    >
                      {filteredModels.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.displayName} [{m.modelId}]
                        </option>
                      ))}
                      <option value="__manual__">── 手动填写模型 ID ──</option>
                    </select>
                  </div>
                ) : (
                  <div className="text-xs text-[#68777C] flex items-center justify-between">
                    <span>
                      当前尚未加载远程模型列表，请点击「刷新模型列表」或切换至「手动填写模型 ID」。
                    </span>
                    <button
                      type="button"
                      onClick={() => setModelSourceMode('manual')}
                      className="underline text-[#174A5B] dark:text-[#56AEC8] font-semibold"
                    >
                      切换手动填写
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold">
                    模型 ID（提示：请填写目标接口实际接受的 model 字段）
                  </label>
                  <span className="text-[11px] font-mono px-2 py-0.5 bg-stone-100 dark:bg-[#25363D]">
                    source: manual
                  </span>
                </div>
                <input
                  type="text"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  placeholder="例如：deepseek-chat / gemini-2.5-flash / gpt-4o-mini"
                  className="w-full px-3 py-2 text-xs font-mono border border-[#DCE4E1] dark:border-[#2C3E46] bg-[#F1F5F3] dark:bg-[#131B1E]"
                />
                <p className="text-[11px] text-[#68777C]">
                  即使模型不在远程列表中也可直接测试并保存；手动填写的模型不会仅凭名称假定支持视觉，请勾选下方探测项实测验证。
                </p>
              </div>
            )}

            {/* Multi-Layer Probe Options & Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={probeVisionLayer}
                    onChange={(e) => setProbeVisionLayer(e.target.checked)}
                  />
                  <span>探测看图能力 (Layer 3: Vision)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={probeSampleLayer}
                    onChange={(e) => setProbeSampleLayer(e.target.checked)}
                  />
                  <span>探测最小批改样例 (Layer 4: Sample)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setAsDefault}
                    onChange={(e) => setSetAsDefault(e.target.checked)}
                  />
                  <span>保存后设为全局默认模型</span>
                </label>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleTestCurrentForm}
                  disabled={testingConnection}
                  className="px-3.5 py-2 text-xs font-medium border border-[#174A5B] text-[#174A5B] dark:text-[#56AEC8] bg-white dark:bg-[#1A2529] flex items-center gap-1.5"
                >
                  {testingConnection ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Activity className="w-3.5 h-3.5" />
                  )}
                  测试当前配置
                </button>

                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={savingCredential}
                  className="px-4 py-2 text-xs font-semibold bg-[#174A5B] text-white hover:bg-[#123A47] flex items-center gap-1.5"
                >
                  {savingCredential ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  保存连接
                </button>
              </div>
            </div>

            {lastProbeReport && verifiedConfigSignature === currentSignature && (
              <div className="p-3 bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] text-xs space-y-1.5">
                <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                  四层能力探测结果（总耗时 {lastProbeReport.totalLatencyMs}ms · 配置指纹{' '}
                  <span className="font-mono">{lastProbeReport.configurationHash}</span>）：
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {lastProbeReport.layers.map((l) => (
                    <div
                      key={l.layer}
                      className={`p-2 border text-[11px] ${
                        l.ok
                          ? 'bg-emerald-50/60 border-emerald-300 text-emerald-900'
                          : 'bg-amber-50/60 border-amber-300 text-amber-900'
                      }`}
                    >
                      <strong>[{l.layer.toUpperCase()}]</strong> {l.ok ? '✓ 通过' : '✕ 未通过'} (
                      {l.latencyMs}ms) — {l.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3. Six-Task Model Routing Matrix */}
      <section className="bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#174A5B] dark:text-[#56AEC8]" />
            <h2 className="text-sm font-bold text-[#202B2F] dark:text-[#E2E8E6]">
              3. 六大教学任务模型路由矩阵 (Task-Level Model Routing)
            </h2>
          </div>
        </div>

        <div className="divide-y divide-[#DCE4E1] dark:divide-[#2C3E46] border border-[#DCE4E1] dark:border-[#2C3E46]">
          {TASK_DEFINITIONS.map((task) => {
            const binding = aiWorkspace?.taskBindings?.[task.taskType];
            const boundId = binding?.primaryModelProfileId || '';

            return (
              <div
                key={task.taskType}
                className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{task.title}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 bg-stone-100 dark:bg-[#25363D] text-[#68777C]">
                      {task.taskType}
                    </span>
                  </div>
                  <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">{task.subtitle}</p>
                  {task.isVisionTask && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[#68777C] pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={binding?.allowTextFallbackForVision !== false}
                        onChange={(e) =>
                          handleUpdateTaskBinding(task.taskType, {
                            allowTextFallbackForVision: e.target.checked,
                          })
                        }
                      />
                      <span>
                        当所选模型未验证 Vision 能力时，允许显式降级为「图画文字要素（requiredFacts）描述评分」并向考生展示降级提示
                      </span>
                    </label>
                  )}
                </div>

                <select
                  value={boundId}
                  disabled={updatingBindings}
                  onChange={(e) =>
                    handleUpdateTaskBinding(task.taskType, {
                      primaryModelProfileId: e.target.value ? e.target.value : null,
                    })
                  }
                  className="px-3 py-1.5 text-xs font-mono border border-[#DCE4E1] dark:border-[#2C3E46] bg-[#F1F5F3] dark:bg-[#131B1E]"
                >
                  <option value="">
                    跟随全局默认模型 (
                    {savedProfiles.find((p) => p.id === defaultProfileId)?.modelId || '未设置'})
                  </option>
                  {savedProfiles.map((prof) => (
                    <option key={prof.id} value={prof.id}>
                      [{prof.providerType}] {prof.modelId}
                      {prof.capabilities.vision ? ' (Vision)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Typography, Cloud Sync, Source Import & Backup */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-2.5">
            <Type className="w-4 h-4 text-[#174A5B]" />
            <h2 className="text-sm font-bold">阅读排版与深浅主题偏好</h2>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span>界面主题模式</span>
              <div className="inline-flex border border-[#DCE4E1] dark:border-[#2C3E46]">
                {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onSelectThemeMode(m)}
                    className={`px-2.5 py-1 ${
                      themeMode === m ? 'bg-[#174A5B] text-white' : ''
                    }`}
                  >
                    {m === 'light' ? '浅色' : m === 'dark' ? '深色' : '跟随系统'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>阅读字号 ({typographyPrefs.fontSizePx}px)</span>
              <input
                type="range"
                min={15}
                max={22}
                value={typographyPrefs.fontSizePx}
                onChange={(e) =>
                  onUpdateTypographyPrefs({
                    ...typographyPrefs,
                    fontSizePx: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-[#1A2529] border border-[#DCE4E1] dark:border-[#2C3E46] p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-2.5">
            <Database className="w-4 h-4 text-[#174A5B]" />
            <h2 className="text-sm font-bold">本地学习数据备份与恢复</h2>
          </div>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                const jsonStr = onExportJson();
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `yanjuan-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-3 py-1.5 text-xs bg-[#174A5B] text-white flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              导出 JSON 备份
            </button>

            <label className="px-3 py-1.5 text-xs border border-[#DCE4E1] dark:border-[#2C3E46] cursor-pointer flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>导入 JSON 恢复</span>
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const text = await file.text();
                    onImportJson(text);
                    setBanner({ type: 'success', message: '本地学习档案已成功合并恢复。' });
                  }
                }}
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};
