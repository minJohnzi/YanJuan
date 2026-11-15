import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, Lock, RefreshCw, Sparkles, Unlock } from 'lucide-react';
import {
  buildLocalApiHeaders,
  getServerAiPin,
  setServerAiPin,
} from '../../services/localApi.ts';
import type {
  SystemCapabilitiesResponse,
  UserAIWorkspaceConfig,
} from '../../shared/types.ts';
import { Badge, Button } from './primitives.tsx';

export interface AiStatusPopoverProps {
  systemCapabilities: SystemCapabilitiesResponse | null;
  anyModelAvailable: boolean;
  activeModelSummary: string | null;
  aiWorkspace: UserAIWorkspaceConfig | null;
  onRefreshWorkspace: () => Promise<void>;
  onNavigateSettings: () => void;
}

export const AiStatusPopover: React.FC<AiStatusPopoverProps> = ({
  systemCapabilities,
  anyModelAvailable,
  activeModelSummary,
  aiWorkspace,
  onRefreshWorkspace,
  onNavigateSettings,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pinInput, setPinInput] = useState(() => getServerAiPin());
  const [busyAction, setBusyAction] = useState<'pin' | 'model' | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPinInput(getServerAiPin());
    setFeedback(null);

    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const savedPin = getServerAiPin();
  const isAiStudio = systemCapabilities?.deploymentTarget === 'google-aistudio';
  const profiles = aiWorkspace?.modelProfiles || [];
  const defaultProfileId = aiWorkspace?.defaultModelProfileId || profiles[0]?.id || '';

  const handleSavePin = async () => {
    setBusyAction('pin');
    setFeedback(null);
    try {
      setServerAiPin(pinInput.trim());
      await onRefreshWorkspace();
      setFeedback({
        type: 'ok',
        text: pinInput.trim()
          ? '已保存访问口令并刷新 AI 连接状态。'
          : '已清除口令并刷新状态。',
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || '刷新 AI 工作区失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSwitchDefaultModel = async (profileId: string) => {
    if (!profileId || profileId === defaultProfileId) return;
    setBusyAction('model');
    setFeedback(null);
    try {
      const headers = buildLocalApiHeaders({
        'Content-Type': 'application/json',
      });
      const res = await fetch('/api/v1/ai-workspace/default-model', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ profileId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error?.message || '切换默认模型失败');
      }
      await onRefreshWorkspace();
      setFeedback({
        type: 'ok',
        text: '已更新全局默认模型。',
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || '切换默认模型失败',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((p) => !p)}
        title="查看环境模式、PIN 解锁与默认 AI 模型"
        className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md border text-xs transition-colors whitespace-nowrap ${
          isOpen
            ? 'bg-brand-subtle border-brand text-brand'
            : 'bg-card-subtle hover:bg-stone-100 dark:hover:bg-[#25363D] border-subtle text-secondary hover:text-ink'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            anyModelAvailable
              ? 'bg-mastered'
              : systemCapabilities?.requiresServerPin && !savedPin
              ? 'bg-warning'
              : 'bg-muted'
          }`}
        />
        <span className="hidden sm:inline max-w-[190px] truncate">
          {systemCapabilities?.hasServerGeminiKey || isAiStudio
            ? 'AI Studio'
            : '本地优先'}{' '}
          · {anyModelAvailable ? activeModelSummary || 'AI就绪' : 'AI未配置'}
        </span>
        <span className="sm:hidden font-tabular-mono text-[11px]">
          {anyModelAvailable ? 'AI就绪' : 'AI'}
        </span>
        <ChevronDown
          className={`w-3 h-3 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="AI 环境与快速设置"
          className="absolute right-0 mt-2 w-80 sm:w-96 z-40 bg-card border border-subtle rounded-2xl shadow-xl p-4 space-y-3.5 text-xs"
        >
          <div className="flex items-start justify-between gap-2 border-b border-hairline pb-2.5">
            <div className="space-y-1">
              <div className="font-bold text-ink flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-brand" />
                <span>运行环境与 AI 状态</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={isAiStudio ? 'brand' : 'neutral'}>
                  {isAiStudio ? 'Google AI Studio 托管' : '本地优先 (Node)'}
                </Badge>
                <Badge variant="neutral">
                  {systemCapabilities?.storageEngine || 'node:sqlite'}
                </Badge>
                <Badge variant={anyModelAvailable ? 'success' : 'warning'}>
                  {anyModelAvailable ? 'AI 可用' : '待配置'}
                </Badge>
              </div>
            </div>
            <button
              type="button"
              aria-label="刷新环境与 AI 状态"
              disabled={busyAction !== null}
              onClick={async () => {
                setBusyAction('pin');
                try {
                  await onRefreshWorkspace();
                } finally {
                  setBusyAction(null);
                }
              }}
              className="p-1.5 rounded-md text-secondary hover:text-ink hover:bg-card-subtle transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  busyAction === 'pin' ? 'animate-spin' : ''
                }`}
              />
            </button>
          </div>

          {/* Server PIN quick unlock */}
          {(systemCapabilities?.requiresServerPin || Boolean(savedPin)) && (
            <div className="p-3 rounded-xl bg-card-subtle border border-subtle space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink flex items-center gap-1.5">
                  {savedPin ? (
                    <Unlock className="w-3.5 h-3.5 text-mastered" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-warning" />
                  )}
                  <span>服务端访问口令 (SERVER_AI_ACCESS_PIN)</span>
                </span>
                <span className="font-tabular-mono text-[10px] text-secondary">
                  {savedPin ? '已本地保存' : '需输入解锁'}
                </span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="输入 SERVER_AI_ACCESS_PIN..."
                  className="flex-1 px-2.5 py-1.5 bg-card border border-subtle rounded-lg text-xs text-ink font-mono focus:outline-none focus:border-brand"
                />
                <Button
                  type="button"
                  size="xs"
                  variant="primary"
                  disabled={busyAction !== null}
                  onClick={() => void handleSavePin()}
                >
                  保存
                </Button>
                {savedPin && (
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={busyAction !== null}
                    onClick={() => {
                      setPinInput('');
                      setServerAiPin('');
                      void onRefreshWorkspace();
                    }}
                  >
                    清除
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Quick Default Model Switcher */}
          <div className="space-y-1.5">
            <div className="font-semibold text-ink flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-brand" />
                <span>全局默认 AI 模型</span>
              </span>
              {systemCapabilities?.serverDefaultModel && (
                <span className="font-tabular-mono text-[10px] text-secondary">
                  托管默认：{systemCapabilities.serverDefaultModel}
                </span>
              )}
            </div>

            {profiles.length > 0 ? (
              <select
                aria-label="切换全局默认 AI 模型"
                value={defaultProfileId}
                disabled={busyAction !== null}
                onChange={(e) => void handleSwitchDefaultModel(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg bg-card-subtle border border-subtle text-xs font-mono text-ink focus:outline-none focus:border-brand"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.providerType}] {p.modelId}
                    {p.capabilities.vision ? ' (Vision)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-2.5 rounded-lg bg-card-subtle border border-subtle text-secondary">
                {systemCapabilities?.hasServerGeminiKey
                  ? '当前已接入服务端托管 Gemini Key；若需自定义模型路由，可前往完整设置页配置。'
                  : '尚未配置可用模型连接，点击下方前往设置页配置 Key 或本地端点。'}
              </div>
            )}
          </div>

          {feedback && (
            <div
              className={`px-2.5 py-1.5 rounded-lg border text-[11px] ${
                feedback.type === 'ok'
                  ? 'bg-mastered-subtle border-emerald-300 dark:border-emerald-800 text-mastered'
                  : 'bg-danger-subtle border-rose-300 dark:border-rose-800 text-danger'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="pt-2 border-t border-hairline flex justify-end">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNavigateSettings();
              }}
              className="text-brand font-semibold hover:underline"
            >
              打开完整 AI 与环境设置 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
