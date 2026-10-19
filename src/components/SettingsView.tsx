import React, { useState } from 'react';
import {
  Cloud,
  CloudOff,
  KeyRound,
  Download,
  Upload,
  Trash2,
  Sliders,
  Database,
  X,
  Check,
  AlertCircle,
  ShieldCheck,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import type {
  ProviderCredentialStatus,
  SyncStatus,
} from '../shared/types';
import { ReadingTypographyPrefs } from '../services/storageAndSync';
import type { ThemeMode } from '../services/theme';

interface SettingsViewProps {
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
  onSaveProviderCredential: (params: {
    provider: 'gemini' | 'deepseek' | 'openai-compatible';
    apiKey: string;
    baseUrl?: string;
    model?: string;
  }) => Promise<void>;
  onTestProviderCredential: (params: {
    provider: 'gemini' | 'deepseek' | 'openai-compatible';
  }) => Promise<{ ok: boolean; latencyMs: number; model: string; message?: string }>;
  onDeleteProviderCredential: (
    provider: 'gemini' | 'deepseek' | 'openai-compatible'
  ) => Promise<void>;
  typographyPrefs: ReadingTypographyPrefs;
  onUpdateTypographyPrefs: (prefs: ReadingTypographyPrefs) => void;
  themeMode?: ThemeMode;
  onSelectThemeMode?: (mode: ThemeMode) => void;
  onSubmitSourceImport: (params: {
    year: number;
    fileName: string;
    markdownText?: string;
    contentBase64?: string;
  }) => Promise<{
    dataVersion: string;
    status: string;
    errorCodes: string[];
    missingObjectiveCount: number;
  }>;
  isImportingAnswers: boolean;
  onExportJson: () => string;
  onImportJson: (rawJson: string) => void;
  onClearAllData: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isFirebaseConfigured,
  currentUserEmail,
  syncStatus,
  isPrivateDevice,
  onTogglePrivateDevice,
  onSignInGoogle,
  onSignOut,
  anyModelAvailable,
  activeProviderName,
  credentialStatuses,
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
  const currentThemeMode: ThemeMode =
    themeMode || typographyPrefs.themeMode || 'system';

  const handleThemeChange = (mode: ThemeMode) => {
    if (onSelectThemeMode) {
      onSelectThemeMode(mode);
    } else {
      onUpdateTypographyPrefs({
        ...typographyPrefs,
        themeMode: mode,
      });
    }
  };

  const [selectedProvider, setSelectedProvider] = useState<
    'gemini' | 'deepseek' | 'openai-compatible'
  >('gemini');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [customBaseUrlInput, setCustomBaseUrlInput] = useState('');
  const [modelNameInput, setModelNameInput] = useState('');
  const [providerNotice, setProviderNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isSavingCred, setIsSavingCred] = useState(false);
  const [isTestingCred, setIsTestingCred] = useState(false);

  const [sourceYear, setSourceYear] = useState<number>(2010);
  const [sourceFileName, setSourceFileName] = useState<string>('2010-answer-source.md');
  const [sourceMarkdownText, setSourceMarkdownText] = useState<string>('');
  const [sourceNotice, setSourceNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [importText, setImportText] = useState('');
  const [dataNotice, setDataNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmClearModal, setConfirmClearModal] = useState(false);

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    setProviderNotice(null);
    if (!apiKeyInput.trim()) {
      setProviderNotice({
        type: 'error',
        message: '请输入有效的 API Key（加密保存于服务端，绝不暴露到客户端）',
      });
      return;
    }
    try {
      setIsSavingCred(true);
      await onSaveProviderCredential({
        provider: selectedProvider,
        apiKey: apiKeyInput.trim(),
        baseUrl:
          selectedProvider === 'openai-compatible'
            ? customBaseUrlInput.trim()
            : undefined,
        model: modelNameInput.trim() || undefined,
      });
      setApiKeyInput('');
      setProviderNotice({
        type: 'success',
        message: `已加密保存 ${selectedProvider} 凭证，前端输入框已清空。`,
      });
    } catch (err: any) {
      setProviderNotice({
        type: 'error',
        message: err?.message || '保存模型凭证失败',
      });
    } finally {
      setIsSavingCred(false);
    }
  };

  const handleTestCredential = async () => {
    setProviderNotice(null);
    try {
      setIsTestingCred(true);
      const res = await onTestProviderCredential({
        provider: selectedProvider,
      });
      setProviderNotice({
        type: 'success',
        message: `连接测试成功！模型：${res.model} · 延迟：${res.latencyMs}ms`,
      });
    } catch (err: any) {
      setProviderNotice({
        type: 'error',
        message: err?.message || '模型连接测试未通过',
      });
    } finally {
      setIsTestingCred(false);
    }
  };

  return (
    <div className="max-w-[1440px] w-full mx-auto space-y-6 py-2 sm:py-4">
      {/* 1. Theme Mode & Reading Typography Section */}
      <section className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E8ECEA] dark:border-[#26373E] pb-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-2">
              <Sun className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
              <span>界面外观与深色模式</span>
            </h2>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
              延续“学术期刊 × 纸质试卷 × 数字阅卷台”沉稳设计，支持浅色、深色与跟随系统，无缝即时切换。
            </p>
          </div>
          <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3] bg-stone-50 dark:bg-[#162226] px-2.5 py-1 rounded-md self-start sm:self-auto border border-[#E8ECEA] dark:border-[#2C3E46]">
            当前设置：{currentThemeMode === 'system' ? '跟随系统' : currentThemeMode === 'dark' ? '深色模式' : '浅色模式'}
          </span>
        </div>

        {/* 3 Theme Options Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              id: 'light' as ThemeMode,
              title: '浅色模式',
              sub: '日间象牙纸色',
              icon: Sun,
              desc: '温润试卷纸张浅背，适合日间或光线充足时专注答卷。',
            },
            {
              id: 'dark' as ThemeMode,
              title: '深色模式',
              sub: '夜间深墨蓝灰',
              icon: Moon,
              desc: '深蓝灰背景与深色纸张层，对比柔和，无刺眼纯黑纯白。',
            },
            {
              id: 'system' as ThemeMode,
              title: '跟随系统',
              sub: '自动匹配设备',
              icon: Laptop,
              desc: '根据操作系统或浏览器的外观偏好自动平滑切换。',
            },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = currentThemeMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleThemeChange(item.id)}
                className={`p-4 rounded-xl border text-left flex flex-col justify-between gap-3 transition-all ${
                  isSelected
                    ? 'bg-[#E8F0F1]/70 dark:bg-[#19313A] border-[#174A5B] dark:border-[#38849E] ring-1 ring-[#174A5B]/30'
                    : 'bg-stone-50/70 dark:bg-[#162226] border-[#DCE4E1] dark:border-[#2C3E46] hover:bg-stone-100 dark:hover:bg-[#203036]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`w-4 h-4 ${
                        isSelected
                          ? 'text-[#174A5B] dark:text-[#75B6CE]'
                          : 'text-[#68777C] dark:text-[#9CAEB3]'
                      }`}
                    />
                    <span className="font-semibold text-xs text-[#202B2F] dark:text-[#E2E8E6]">
                      {item.title}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-[#174A5B] dark:bg-[#38849E]" />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-[#174A5B] dark:text-[#75B6CE]">
                    {item.sub}
                  </div>
                  <p className="text-[11px] text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Typography Controls */}
        <div className="pt-2 border-t border-[#E8ECEA] dark:border-[#26373E] space-y-3">
          <div className="text-xs font-semibold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
            <span>英文长文排版参数</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <label className="space-y-1">
              <span className="font-medium text-[#68777C] dark:text-[#9CAEB3]">
                长文字号（当前 {typographyPrefs.fontSizePx}px）
              </span>
              <select
                value={typographyPrefs.fontSizePx}
                onChange={(e) =>
                  onUpdateTypographyPrefs({
                    ...typographyPrefs,
                    fontSizePx: Number(e.target.value),
                  })
                }
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6]"
              >
                <option value={16}>16px (紧凑)</option>
                <option value={18}>18px (舒适学术标准)</option>
                <option value={20}>20px (清晰大字)</option>
                <option value={22}>22px (护眼特大)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-medium text-[#68777C] dark:text-[#9CAEB3]">
                行高倍率（当前 {typographyPrefs.lineHeight}）
              </span>
              <select
                value={typographyPrefs.lineHeight}
                onChange={(e) =>
                  onUpdateTypographyPrefs({
                    ...typographyPrefs,
                    lineHeight: Number(e.target.value),
                  })
                }
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6]"
              >
                <option value={1.6}>1.6 (密集)</option>
                <option value={1.8}>1.8 (最佳舒适留白)</option>
                <option value={2.0}>2.0 (舒展宽阔)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-medium text-[#68777C] dark:text-[#9CAEB3]">
                扫视单行字符宽（ch）
              </span>
              <select
                value={typographyPrefs.measureCh}
                onChange={(e) =>
                  onUpdateTypographyPrefs({
                    ...typographyPrefs,
                    measureCh: Number(e.target.value),
                  })
                }
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6]"
              >
                <option value={66}>66ch (窄幅)</option>
                <option value={72}>72ch (推荐学术阅卷)</option>
                <option value={78}>78ch (宽幅)</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* 2. Account & Cloud Sync Section */}
      <section className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E8ECEA] dark:border-[#26373E] pb-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-2">
              {isFirebaseConfigured ? (
                <Cloud className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
              ) : (
                <CloudOff className="w-4 h-4 text-[#96A1A4] dark:text-[#657980]" />
              )}
              <span>账户与多端云同步</span>
            </h2>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
              历年真题内置于本地；个人作答进度、错题卡与主观题版本同步于云端或本地 IndexedDB。
            </p>
          </div>
          <span className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3] bg-stone-50 dark:bg-[#162226] px-2.5 py-1 rounded-md self-start sm:self-auto border border-[#E8ECEA] dark:border-[#2C3E46]">
            {syncStatus === 'synced' ? '已连接云端' : '本地存储模式'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2.5">
            <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
              云端账户连接：
            </div>
            {isFirebaseConfigured ? (
              <div className="space-y-2">
                <div className="text-emerald-800 dark:text-[#4EA387] font-medium flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>已连接 Firebase ({currentUserEmail || '未登录'})</span>
                </div>
                {currentUserEmail ? (
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="px-3 py-1.5 bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46] text-[#202B2F] dark:text-[#E2E8E6] rounded-lg hover:bg-stone-100 dark:hover:bg-[#203036] transition-colors"
                  >
                    退出登录
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSignInGoogle()}
                    className="px-3.5 py-1.5 bg-[#174A5B] dark:bg-[#38849E] text-white font-medium rounded-lg hover:bg-[#123D4B] dark:hover:bg-[#489BB8] transition-colors"
                  >
                    使用 Google 账号登录
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1 text-[#68777C] dark:text-[#9CAEB3]">
                <div className="font-medium text-[#202B2F] dark:text-[#E2E8E6]">
                  本地离线模式
                </div>
                <p>
                  当前未配置外部 Firebase 密钥，所有进度完整保存在当前浏览器 IndexedDB 中，安全无追踪。
                </p>
              </div>
            )}
          </div>

          <div className="p-4 bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] space-y-2">
            <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
              设备隐私模式：
            </div>
            <p className="text-[#68777C] dark:text-[#9CAEB3]">
              若在公共或共享电脑上学习，关闭「私人专属设备」可在退出时自动清理本地作答缓存。
            </p>
            <label className="inline-flex items-center gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivateDevice}
                onChange={(e) => onTogglePrivateDevice(e.target.checked)}
                className="accent-[#174A5B] dark:accent-[#38849E]"
              />
              <span className="font-medium text-[#202B2F] dark:text-[#E2E8E6]">
                当前为私人专属设备（保留本地离线完整题库副本）
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* 3. Model Provider Credentials */}
      <section className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E8ECEA] dark:border-[#26373E] pb-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
              <span>AI 辅助模型与加密凭证</span>
            </h2>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
              支持 Gemini、DeepSeek 或兼容 OpenAI 协议的模型。仅用于阅读证据句拆解与作文双阶段批改。API Key 经服务端 AES-256 加密保存。
            </p>
          </div>
          <span className="text-xs font-tabular-mono self-start sm:self-auto">
            {anyModelAvailable ? (
              <span className="text-emerald-800 dark:text-[#4EA387] font-semibold bg-emerald-50 dark:bg-[#172E27] px-2.5 py-1 rounded border border-emerald-200 dark:border-emerald-800">
                已配置 ({activeProviderName})
              </span>
            ) : (
              <span className="text-[#68777C] dark:text-[#9CAEB3] bg-stone-100 dark:bg-[#162226] px-2.5 py-1 rounded border border-[#DCE4E1] dark:border-[#2C3E46]">
                未配置模型
              </span>
            )}
          </span>
        </div>

        {/* Saved status list */}
        <div className="space-y-2">
          {credentialStatuses.map((cred) => (
            <div
              key={cred.provider}
              className="p-3 bg-stone-50 dark:bg-[#162226] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2.5">
                <span className="font-semibold text-[#202B2F] dark:text-[#E2E8E6] capitalize font-tabular-mono">
                  {cred.provider}
                </span>
                <span className="text-stone-400">·</span>
                {cred.configured ? (
                  <span className="text-emerald-800 dark:text-[#4EA387] font-medium">
                    已保存 ({cred.maskedKey})
                  </span>
                ) : (
                  <span className="text-[#96A1A4] dark:text-[#657980]">未保存</span>
                )}
              </div>

              {cred.configured && (
                <button
                  type="button"
                  onClick={() =>
                    void onDeleteProviderCredential(cred.provider as any)
                  }
                  className="text-stone-400 hover:text-rose-600 font-medium transition-colors"
                >
                  清除凭证
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSaveCredential} className="space-y-4 pt-2 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-[#68777C] dark:text-[#9CAEB3]">模型提供方</span>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as any)}
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6]"
              >
                <option value="gemini">Google Gemini</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai-compatible">OpenAI 兼容端点</option>
              </select>
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-[#68777C] dark:text-[#9CAEB3]">API Key</span>
              <input
                type="password"
                required
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-..."
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6] font-tabular-mono"
              />
            </label>
          </div>

          {selectedProvider === 'openai-compatible' && (
            <label className="block space-y-1">
              <span className="text-[#68777C] dark:text-[#9CAEB3]">
                自定义接口地址 (Base URL，需支持 HTTPS)
              </span>
              <input
                type="url"
                value={customBaseUrlInput}
                onChange={(e) => setCustomBaseUrlInput(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg text-[#202B2F] dark:text-[#E2E8E6] font-tabular-mono"
              />
            </label>
          )}

          {providerNotice && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                providerNotice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-[#172E27] border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-[#4EA387]'
                  : 'bg-rose-50 dark:bg-[#351C1A] border-rose-200 dark:border-rose-900 text-rose-800 dark:text-[#CF695E]'
              }`}
            >
              {providerNotice.message}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={isTestingCred}
              onClick={() => void handleTestCredential()}
              className="px-3.5 py-2 rounded-lg font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] border border-[#DCE4E1] dark:border-[#2C3E46] disabled:opacity-50 transition-colors"
            >
              {isTestingCred ? '正在测试...' : '测试当前连接'}
            </button>
            <button
              type="submit"
              disabled={isSavingCred}
              className="px-4 py-2 rounded-lg font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] disabled:opacity-50 transition-colors shadow-xs"
            >
              {isSavingCred ? '正在保存...' : '加密保存凭证'}
            </button>
          </div>
        </form>
      </section>

      {/* 4. External Answer Source Ingestion */}
      <section className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-4">
        <div className="border-b border-[#E8ECEA] dark:border-[#26373E] pb-3 space-y-1">
          <h2 className="text-base sm:text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-2">
            <Database className="w-4 h-4 text-[#174A5B] dark:text-[#75B6CE]" />
            <span>外部真题与官方答案来源录入</span>
          </h2>
          <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
            当补充 2010–2023 年历史客观题官方答案时，系统将执行确定性校验并生成新版本，决不破坏旧版本。
          </p>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSourceNotice(null);
            if (!sourceMarkdownText.trim()) {
              setSourceNotice({
                type: 'error',
                message: '请先粘贴包含 "## 参考答案" 的 Markdown 文本。',
              });
              return;
            }
            try {
              const job = await onSubmitSourceImport({
                year: sourceYear,
                fileName: sourceFileName.trim() || `${sourceYear}-source.md`,
                markdownText: sourceMarkdownText,
              });
              setSourceNotice({
                type: job.status === 'ready' ? 'success' : 'error',
                message: `版本 ${job.dataVersion} 构建完成 · 状态：${job.status}${
                  job.errorCodes.length > 0
                    ? ` · 提示：${job.errorCodes.join(', ')}`
                    : ' · 校验通过'
                }`,
              });
            } catch (err: any) {
              setSourceNotice({
                type: 'error',
                message: err?.message || '导入失败',
              });
            }
          }}
          className="space-y-4 text-xs"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-[#68777C] dark:text-[#9CAEB3]">
                目标年份 (2010–2026)
              </span>
              <select
                value={sourceYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setSourceYear(y);
                  setSourceFileName(`${y}-answer-source.md`);
                }}
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg font-tabular-mono text-[#202B2F] dark:text-[#E2E8E6]"
              >
                {Array.from({ length: 17 }, (_, i) => 2010 + i).map((y) => (
                  <option key={y} value={y}>
                    {y}年 考研英语一
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-medium text-[#68777C] dark:text-[#9CAEB3]">来源文件名</span>
              <input
                type="text"
                value={sourceFileName}
                onChange={(e) => setSourceFileName(e.target.value)}
                className="w-full p-2 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg font-tabular-mono text-[#202B2F] dark:text-[#E2E8E6]"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="font-medium text-[#68777C] dark:text-[#9CAEB3]">
              Markdown 文本（格式例如：`## 参考答案`，后接 `1. A 2. B ...`）
            </span>
            <textarea
              rows={3}
              value={sourceMarkdownText}
              onChange={(e) => setSourceMarkdownText(e.target.value)}
              placeholder={"## 参考答案\n1. A\n2. B\n..."}
              className="w-full p-3 bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg font-tabular-mono text-[#202B2F] dark:text-[#E2E8E6]"
            />
          </label>

          {sourceNotice && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                sourceNotice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-[#172E27] border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-[#4EA387]'
                  : 'bg-rose-50 dark:bg-[#351C1A] border-rose-200 dark:border-rose-900 text-rose-800 dark:text-[#CF695E]'
              }`}
            >
              {sourceNotice.message}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isImportingAnswers}
              className="px-4 py-2 rounded-lg font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] disabled:opacity-50 transition-colors shadow-xs"
            >
              {isImportingAnswers ? '正在合并校验...' : '提交来源并生成新版本'}
            </button>
          </div>
        </form>
      </section>

      {/* 5. Data Backup, Restore & Reset */}
      <section className="bg-white dark:bg-[#1E2B30] rounded-2xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-2xs p-6 sm:p-8 space-y-4">
        <div className="border-b border-[#E8ECEA] dark:border-[#26373E] pb-3 space-y-1">
          <h2 className="text-base sm:text-lg font-bold text-[#202B2F] dark:text-[#E2E8E6]">
            数据备份、恢复与重置
          </h2>
          <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
            可将个人客观题作答、主观题版本历史（V1/V2/V3）与复习任务导出为标准 JSON。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const jsonStr = onExportJson();
              setImportText(jsonStr);
              try {
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `yanjuan-desk-backup-${new Date()
                  .toISOString()
                  .slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {}
              setDataNotice({
                type: 'success',
                message: '已生成 JSON 备份并自动下载（同时填入下方文本框）。',
              });
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#174A5B] dark:bg-[#38849E] hover:bg-[#123D4B] dark:hover:bg-[#489BB8] transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出备份 (JSON)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!importText.trim()) {
                setDataNotice({
                  type: 'error',
                  message: '请先在下方文本框粘贴备份 JSON',
                });
                return;
              }
              try {
                onImportJson(importText);
                setDataNotice({
                  type: 'success',
                  message: '恢复成功！作答历史已无损合并。',
                });
              } catch (err: any) {
                setDataNotice({
                  type: 'error',
                  message: err?.message || 'JSON 格式解析失败',
                });
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] bg-stone-100 dark:bg-[#162226] hover:bg-stone-200 dark:hover:bg-[#203036] border border-[#DCE4E1] dark:border-[#2C3E46] transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>从下方 JSON 恢复</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmClearModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-rose-700 dark:text-[#CF695E] bg-rose-50 dark:bg-[#351C1A] hover:bg-rose-100 dark:hover:bg-[#452220] border border-rose-200 dark:border-rose-900 ml-auto transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清空本地记录</span>
          </button>
        </div>

        {dataNotice && (
          <div
            className={`p-3 rounded-lg border text-xs ${
              dataNotice.type === 'success'
                ? 'bg-emerald-50 dark:bg-[#172E27] border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-[#4EA387]'
                : 'bg-rose-50 dark:bg-[#351C1A] border-rose-200 dark:border-rose-900 text-rose-800 dark:text-[#CF695E]'
            }`}
          >
            {dataNotice.message}
          </div>
        )}

        <textarea
          rows={4}
          aria-label="学习数据JSON导出与导入文本框"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="导出的 JSON 备份将展示在此处；也可以在此粘贴备份 JSON 后点击恢复..."
          className="w-full p-3 text-xs font-tabular-mono bg-stone-50 dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-xl text-[#202B2F] dark:text-[#E2E8E6] focus:bg-white dark:focus:bg-[#1A2529] focus:border-[#174A5B] dark:focus:border-[#38849E] focus:outline-none"
        />
      </section>

      {/* Clear Data Confirmation Modal */}
      {confirmClearModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="确认清空本地学习数据"
          className="fixed inset-0 z-50 bg-[#131B1E]/75 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setConfirmClearModal(false)}
        >
          <div
            className="bg-white dark:bg-[#1E2B30] rounded-xl border border-[#DCE4E1] dark:border-[#2C3E46] shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8ECEA] dark:border-[#26373E] pb-3">
              <h3 className="text-base font-bold text-rose-700 dark:text-[#CF695E]">
                确认清空当前设备学习记录？
              </h3>
              <button
                type="button"
                aria-label="关闭确认窗口"
                onClick={() => setConfirmClearModal(false)}
              >
                <X className="w-4 h-4 text-[#96A1A4] dark:text-[#657980] hover:text-[#202B2F] dark:hover:text-[#E2E8E6]" />
              </button>
            </div>
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">
              此操作将清除当前浏览器本地的所有作答进度、错题卡与主观题版本草稿。内置真题库不受影响。建议操作前先导出备份。
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E8ECEA] dark:border-[#26373E]">
              <button
                type="button"
                onClick={() => setConfirmClearModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-[#68777C] dark:text-[#9CAEB3] hover:bg-stone-100 dark:hover:bg-[#162226]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onClearAllData();
                  setConfirmClearModal(false);
                  setDataNotice({
                    type: 'success',
                    message: '已清空当前设备的本地学习记录。',
                  });
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
