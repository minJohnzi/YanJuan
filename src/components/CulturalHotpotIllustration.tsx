import React, { useState } from 'react';
import { ZoomIn, X, FileText } from 'lucide-react';
import type { VisualMaterial } from '../shared/types';

interface Props {
  visualMaterial: VisualMaterial;
  allVisualMaterials?: VisualMaterial[];
}

/**
 * Renders the Writing Part B visual material(s) with static PNG asset(s) (`<img>` from `/assets/papers/{year}/...`),
 * editorial illustration preview, zoom modal (Esc-closable), and accessible structured text facts.
 * Supports single-image years as well as multi-image years (e.g., 2014, 2016, 2017, 2020, 2024, 2026 with
 * writing-part-b-01.png, writing-part-b-02.png, and writing-part-b-composite.png).
 */
export const CulturalHotpotIllustration: React.FC<Props> = ({
  visualMaterial,
  allVisualMaterials,
}) => {
  const [zoomed, setZoomed] = useState(false);
  const materialsList =
    allVisualMaterials && allVisualMaterials.length > 0
      ? allVisualMaterials
      : [visualMaterial];

  React.useEffect(() => {
    if (!zoomed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomed]);

  const renderDiagramSvg = (large: boolean = false) => (
    <svg
      viewBox="0 0 640 420"
      role="img"
      aria-label={visualMaterial.title || '考研英语一写作Part B插图'}
      className={`w-full h-auto bg-[#FBFAF6] dark:bg-[#1B262A] border border-[#DCE4E1] dark:border-[#2C3E46] rounded-lg ${
        large ? 'max-h-[75vh]' : 'max-h-[340px]'
      }`}
    >
      <title>{visualMaterial.title}</title>
      <desc>{visualMaterial.caption}</desc>
      {/* Double editorial frame */}
      <rect x="10" y="10" width="620" height="400" className="fill-[#FBFAF6] dark:fill-[#1B262A] stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="2" />
      <rect x="16" y="16" width="608" height="388" fill="none" className="stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="0.75" />

      {/* Rising steam lines */}
      <path d="M220 95 C210 70, 235 55, 220 32" className="stroke-[#68777C] dark:stroke-[#9CAEB3]" strokeWidth="2" fill="none" strokeDasharray="4 3" />
      <path d="M320 75 C310 50, 335 40, 320 24" className="stroke-[#68777C] dark:stroke-[#9CAEB3]" strokeWidth="2" fill="none" strokeDasharray="4 3" />
      <path d="M420 95 C410 70, 435 55, 420 32" className="stroke-[#68777C] dark:stroke-[#9CAEB3]" strokeWidth="2" fill="none" strokeDasharray="4 3" />

      {/* Hotpot outer rim & bowl */}
      <ellipse cx="320" cy="210" rx="215" ry="78" className="fill-[#F1F5F3] dark:fill-[#162226] stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="3" />
      <path d="M105 210 C115 315, 525 315, 535 210" className="fill-[#E8F0F1] dark:fill-[#19313A] stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="3" />
      {/* Handles */}
      <path d="M105 205 C72 195, 72 235, 110 230" fill="none" className="stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="3" />
      <path d="M535 205 C568 195, 568 235, 530 230" fill="none" className="stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="3" />
      {/* Base stand */}
      <path d="M230 286 L210 325 L430 325 L410 286 Z" className="fill-[#DCE4E1] dark:fill-[#25363D] stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="2.5" />

      {/* Central Hotpot Chimney */}
      <path d="M298 105 L284 215 L356 215 L342 105 Z" className="fill-white dark:fill-[#223036] stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="2.5" />
      <ellipse cx="320" cy="105" rx="22" ry="8" className="fill-[#202B2F] dark:fill-[#9CAEB3]" />

      {/* Cultural ingredients labels inside the simmering broth */}
      <g fontFamily="Noto Sans SC, sans-serif" fontSize="14" fontWeight="600" className="fill-[#202B2F] dark:fill-[#E2E8E6]">
        <text x="160" y="175">孔子 · 道家</text>
        <text x="145" y="205">京剧 · 功夫</text>
        <text x="175" y="235">梁祝 · 剪纸</text>
        <text x="235" y="255">礼仪 · 仁爱</text>

        <text x="375" y="175">莎士比亚 · 毕加索</text>
        <text x="385" y="205">爱因斯坦 · 歌剧</text>
        <text x="375" y="235">芭蕾 · 天鹅湖</text>
        <text x="345" y="258">现代科技 · 启蒙</text>
      </g>

      {/* Caption Banner at bottom */}
      <rect x="130" y="344" width="380" height="42" className="fill-white dark:fill-[#1A2529] stroke-[#202B2F] dark:stroke-[#9CAEB3]" strokeWidth="2" />
      <text
        x="320"
        y="371"
        textAnchor="middle"
        fontFamily="Noto Sans SC, sans-serif"
        fontSize="16"
        fontWeight="700"
        className="fill-[#202B2F] dark:fill-[#E2E8E6]"
      >
        {visualMaterial.title || '文化“火锅”既美味又营养'}
      </text>
    </svg>
  );

  return (
    <div className="border border-[#DCE4E1] dark:border-[#2C3E46] bg-white dark:bg-[#1E2B30] p-4 space-y-3 rounded-xl">
      <div className="flex items-center justify-between border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-2">
        <div>
          <span className="text-sm font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
            写作视觉材料（共 {materialsList.length} 张）· {visualMaterial.title}
          </span>
          <span className="mx-2 text-[#68777C] dark:text-[#9CAEB3]" aria-hidden="true">
            ·
          </span>
          <span className="text-xs text-[#68777C] dark:text-[#9CAEB3]">
            来源文件：{visualMaterial.sourceLocator.sourceFile}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label="放大查看写作插图"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#174A5B] dark:text-[#75B6CE] border border-[#174A5B] dark:border-[#38849E] hover:bg-[#174A5B] hover:text-white dark:hover:bg-[#38849E] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 rounded-md"
        >
          <ZoomIn className="w-3.5 h-3.5" />
          <span>放大检视原图</span>
        </button>
      </div>

      {/* Static PNG resources from /assets/papers/{year}/... */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {materialsList.map((vm, i) => (
          <div
            key={vm.id || i}
            className="border border-[#DCE4E1] dark:border-[#2C3E46] p-2 bg-[#F1F5F3] dark:bg-[#162226] space-y-1 rounded-lg"
          >
            <div className="text-[11px] font-tabular-mono text-[#68777C] dark:text-[#9CAEB3] truncate">
              {vm.title || `图 ${i + 1}`} ({vm.imagePath})
            </div>
            <img
              src={vm.imagePath}
              alt={vm.title || `写作视觉材料 ${i + 1}`}
              referrerPolicy="no-referrer"
              className="w-full h-32 object-contain bg-white dark:bg-[#1B262A] border border-[#DCE4E1] dark:border-[#2C3E46] rounded"
            />
          </div>
        ))}
      </div>

      {/* Editorial vector diagram + structured text facts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center pt-1">
        <div className="lg:col-span-7">{renderDiagramSvg(false)}</div>
        <div className="lg:col-span-5 space-y-2 text-xs text-[#202B2F] dark:text-[#E2E8E6]">
          <div className="p-3 bg-[#F1F5F3] dark:bg-[#162226] border border-[#DCE4E1] dark:border-[#2C3E46] space-y-1.5 rounded-lg">
            <div className="font-semibold text-[#202B2F] dark:text-[#E2E8E6] flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#174A5B] dark:text-[#75B6CE]" />
              <span>图画要素与无障碍文字说明</span>
            </div>
            <p className="text-[#68777C] dark:text-[#9CAEB3] leading-relaxed">{visualMaterial.caption}</p>
            <div className="pt-1 border-t border-[#DCE4E1] dark:border-[#2C3E46]">
              <div className="font-medium text-[#202B2F] dark:text-[#E2E8E6] mb-1">审题必写事实要点：</div>
              <ul className="list-disc pl-4 space-y-1 text-[#68777C] dark:text-[#9CAEB3]">
                {(visualMaterial.requiredFacts || []).map((fact, idx) => (
                  <li key={idx}>{fact}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Accessible Zoom Modal */}
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="写作插图高清放大检视"
          className="fixed inset-0 z-50 bg-[#131B1E]/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setZoomed(false)}
        >
          <div
            className="bg-white dark:bg-[#1E2B30] border border-[#DCE4E1] dark:border-[#2C3E46] max-w-4xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto rounded-xl shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#DCE4E1] dark:border-[#2C3E46] pb-3">
              <h3 className="text-base font-semibold text-[#202B2F] dark:text-[#E2E8E6]">
                {visualMaterial.title}（按 Esc 关闭）
              </h3>
              <button
                type="button"
                onClick={() => setZoomed(false)}
                aria-label="关闭大图预览"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#202B2F] dark:text-[#E2E8E6] border border-[#DCE4E1] dark:border-[#2C3E46] hover:bg-[#F1F5F3] dark:hover:bg-[#162226] rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
                <span>关闭</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {materialsList.map((vm, i) => (
                <div key={vm.id || i} className="border border-[#DCE4E1] dark:border-[#2C3E46] p-2 bg-[#F1F5F3] dark:bg-[#162226] rounded-lg">
                  <div className="text-xs font-tabular-mono text-[#68777C] dark:text-[#9CAEB3] mb-1">
                    {vm.imagePath}
                  </div>
                  <img
                    src={vm.imagePath}
                    alt={vm.title}
                    className="w-full max-h-60 object-contain bg-white dark:bg-[#1B262A] rounded"
                  />
                </div>
              ))}
            </div>
            {renderDiagramSvg(true)}
            <p className="text-xs text-[#68777C] dark:text-[#9CAEB3]">{visualMaterial.caption}</p>
          </div>
        </div>
      )}
    </div>
  );
};
