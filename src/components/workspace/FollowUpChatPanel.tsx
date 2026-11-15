import React, { useState } from 'react';
import { HelpCircle, Send } from 'lucide-react';
import { Button } from '../ui/primitives.tsx';

export interface FollowUpTurn {
  q: string;
  a: string;
}

export interface FollowUpChatPanelProps {
  title?: string;
  placeholder?: string;
  anyModelAvailable: boolean;
  isLoading: boolean;
  history: FollowUpTurn[];
  onSendQuestion: (questionText: string) => Promise<void>;
  compact?: boolean;
}

export const FollowUpChatPanel: React.FC<FollowUpChatPanelProps> = ({
  title = '针对当前题目的上下文追问',
  placeholder = '输入你的追问（不泄露未提交题目的标准答案）...',
  anyModelAvailable,
  isLoading,
  history,
  onSendQuestion,
  compact = false,
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !anyModelAvailable || isLoading) return;
    setInputValue('');
    await onSendQuestion(trimmed);
  };

  return (
    <div
      className={
        compact
          ? 'space-y-2.5'
          : 'bg-card rounded-2xl border border-subtle p-5 space-y-3 shadow-xs'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-ink flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-brand" />
          <span>{title}</span>
        </h3>
        {!anyModelAvailable && (
          <span className="text-[11px] text-secondary">需要配置模型</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 text-xs bg-card-subtle border border-subtle rounded-lg text-ink focus:bg-card focus:border-brand focus:outline-none"
        />
        <Button
          type="button"
          variant="primary"
          size="xs"
          disabled={!anyModelAvailable || isLoading || !inputValue.trim()}
          isLoading={isLoading}
          onClick={() => void handleSubmit()}
        >
          <Send className="w-3 h-3" />
          <span>{isLoading ? '思考中...' : '发送追问'}</span>
        </Button>
      </div>

      {history.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
          {history.map((entry, idx) => (
            <div
              key={idx}
              className="p-3 bg-card-subtle border border-subtle rounded-lg text-xs space-y-1"
            >
              <div className="font-semibold text-ink">问：{entry.q}</div>
              <div className="text-secondary whitespace-pre-wrap leading-relaxed">
                答（AI 助教）：{entry.a}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
