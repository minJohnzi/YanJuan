import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { EvaluationAnnotation } from '../../domain/learning';
import { buildAnnotationRenderSlices } from '../../domain/quoteVerifier';

export interface SurfaceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'card' | 'paper' | 'subtle';
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  variant = 'card',
  className = '',
  children,
  ...rest
}) => {
  const variantClasses =
    variant === 'paper'
      ? 'bg-paper border-subtle'
      : variant === 'subtle'
      ? 'bg-card-subtle border-hairline'
      : 'bg-card border-subtle';
  return (
    <div
      className={`rounded-2xl border shadow-2xs ${variantClasses} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'xs' | 'sm' | 'md';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'sm',
  isLoading = false,
  disabled,
  className = '',
  type = 'button',
  children,
  ...rest
}) => {
  const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-brand hover:bg-brand-hover text-white shadow-xs border border-transparent',
    secondary:
      'bg-card-subtle hover:bg-stone-200/70 dark:hover:bg-[#203036] text-ink border border-subtle',
    ghost:
      'bg-transparent hover:bg-stone-100 dark:hover:bg-[#1E2B30] text-secondary hover:text-ink border border-transparent',
    danger:
      'bg-danger-subtle hover:bg-rose-100 dark:hover:bg-[#452220] text-danger border border-rose-200 dark:border-rose-900',
    outline:
      'bg-transparent hover:bg-brand hover:text-white text-brand border border-brand',
  };

  const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
    xs: 'px-2.5 py-1 text-xs rounded-md',
    sm: 'px-3.5 py-1.5 text-xs rounded-lg',
    md: 'px-5 py-2.5 text-xs sm:text-sm rounded-lg min-h-[42px]',
  };

  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  className = '',
  children,
  ...rest
}) => {
  const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
    neutral: 'bg-card-subtle text-secondary border border-subtle',
    brand: 'bg-brand-subtle text-brand border border-brand/25',
    success:
      'bg-mastered-subtle text-mastered border border-emerald-300/70 dark:border-emerald-800/70',
    warning:
      'bg-warning-subtle text-warning border border-amber-300/70 dark:border-amber-800/70',
    danger:
      'bg-danger-subtle text-danger border border-rose-300/70 dark:border-rose-900/70',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
};

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: string;
  badge?: string | number;
}

export interface SegmentedTabsProps<T extends string> {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (val: T) => void;
  size?: 'xs' | 'sm';
  className?: string;
  ariaLabel?: string;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className = '',
  ariaLabel,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#162226] rounded-lg border border-hairline overflow-x-auto max-w-full ${className}`}
    >
      {options.map((opt) => {
        const isActive = opt.id === value;
        return (
          <button
            key={opt.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(opt.id)}
            className={`${
              size === 'xs' ? 'px-2.5 py-1 text-[11px] min-h-[28px]' : 'px-3 py-1.5 text-xs min-h-[34px]'
            } rounded-md font-medium transition-all whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
              isActive
                ? 'bg-card text-brand shadow-2xs font-semibold'
                : 'text-secondary hover:text-ink'
            }`}
          >
            <span>{opt.label}</span>
            {opt.badge !== undefined && (
              <span
                className={`font-tabular-mono text-[10px] px-1.5 py-0.2 rounded ${
                  isActive
                    ? 'bg-brand-subtle text-brand'
                    : 'bg-stone-200/70 dark:bg-[#223036] text-secondary'
                }`}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  maxWidthClass?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  title,
  maxWidthClass = 'max-w-2xl',
  ariaLabel,
  children,
  footer,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || (typeof title === 'string' ? title : '对话框')}
      className="fixed inset-0 z-50 bg-[#131B1E]/75 dark:bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-card border border-subtle rounded-2xl ${maxWidthClass} w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline pb-3 gap-3">
          <div className="text-base font-bold text-ink">{title}</div>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="p-1 text-muted hover:text-ink rounded-md transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 pt-3 border-t border-hairline">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export interface AnnotatedTextViewerProps {
  content: string;
  annotations: EvaluationAnnotation[];
  activeAnnotationIdx: number | null;
  onSelectAnnotation?: (idx: number | null) => void;
  isEnglishSerif?: boolean;
}

export const AnnotatedTextViewer: React.FC<AnnotatedTextViewerProps> = ({
  content,
  annotations,
  activeAnnotationIdx,
  onSelectAnnotation,
  isEnglishSerif = true,
}) => {
  const slices = React.useMemo(
    () => buildAnnotationRenderSlices(content, annotations),
    [content, annotations]
  );

  const activeAnn =
    activeAnnotationIdx !== null ? annotations[activeAnnotationIdx] || null : null;

  return (
    <div
      className={`p-3.5 bg-card-subtle border border-subtle rounded-xl text-xs whitespace-pre-wrap text-ink leading-relaxed ${
        isEnglishSerif ? 'font-english-serif text-sm' : 'font-sans'
      }`}
    >
      {slices.map((slice) => {
        if (slice.annotations.length === 0) {
          return <span key={slice.sliceId}>{slice.text}</span>;
        }
        const primaryAnn = slice.annotations[0];
        const primaryIdx = annotations.findIndex(
          (a) =>
            (a.id && primaryAnn.id && a.id === primaryAnn.id) ||
            (a.startOffset === primaryAnn.startOffset &&
              a.endOffset === primaryAnn.endOffset &&
              a.quotedUserText === primaryAnn.quotedUserText)
        );
        const isActive =
          activeAnn !== null &&
          slice.annotations.some(
            (sa) =>
              (sa.id && activeAnn.id && sa.id === activeAnn.id) ||
              (sa.startOffset === activeAnn.startOffset &&
                sa.endOffset === activeAnn.endOffset &&
                sa.quotedUserText === activeAnn.quotedUserText)
          );

        const toneClass =
          slice.highestSeverity === 'high'
            ? isActive
              ? 'bg-rose-500/35 dark:bg-rose-500/40 ring-2 ring-rose-500/60'
              : 'bg-rose-500/15 dark:bg-rose-500/20 border-b-2 border-rose-500/70 hover:bg-rose-500/25'
            : slice.highestSeverity === 'medium'
            ? isActive
              ? 'bg-amber-500/35 dark:bg-amber-500/40 ring-2 ring-amber-500/60'
              : 'bg-amber-500/15 dark:bg-amber-500/20 border-b-2 border-amber-500/70 hover:bg-amber-500/25'
            : isActive
            ? 'bg-brand-subtle ring-2 ring-brand/60'
            : 'bg-brand/10 dark:bg-brand/20 border-b-2 border-brand/60 hover:bg-brand/20';

        return (
          <mark
            key={slice.sliceId}
            role={onSelectAnnotation ? 'button' : undefined}
            tabIndex={onSelectAnnotation ? 0 : undefined}
            title={slice.annotations
              .map((a) => `[${a.issueType}] ${a.explanation}`)
              .join(' | ')}
            onClick={() => {
              if (!onSelectAnnotation || primaryIdx < 0) return;
              onSelectAnnotation(isActive ? null : primaryIdx);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (onSelectAnnotation && primaryIdx >= 0) {
                  onSelectAnnotation(isActive ? null : primaryIdx);
                }
              }
            }}
            className={`text-inherit rounded-xs px-0.5 cursor-pointer transition-all ${toneClass}`}
          >
            {slice.text}
          </mark>
        );
      })}
    </div>
  );
};
