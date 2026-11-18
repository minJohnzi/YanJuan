import React from 'react';

interface MarkdownArticleProps {
  markdown: string;
  className?: string;
}

function renderInlineNodes(text: string, keyPrefix: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((tok, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
      return (
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-[#223238] text-[#174A5B] dark:text-[#7CC4DA] font-mono text-[12px]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length >= 2) {
      return (
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={key}>{tok}</React.Fragment>;
  });
}

export const MarkdownArticle: React.FC<MarkdownArticleProps> = ({
  markdown,
  className = '',
}) => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      elements.push(
        <hr
          key={`hr-${blockIndex++}`}
          className="border-t border-hairline my-4"
        />
      );
      i++;
      continue;
    }

    // Markdown table
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      const parseCells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseCells(lines[i]));
        i++;
      }

      const tblKey = `tbl-${blockIndex++}`;
      elements.push(
        <div
          key={tblKey}
          className="overflow-x-auto my-4 rounded-lg border border-subtle print-avoid-break"
        >
          <table className="w-full text-xs sm:text-sm border-collapse text-left">
            <thead>
              <tr className="bg-card-subtle border-b border-subtle">
                {headers.map((h, hIdx) => (
                  <th
                    key={`${tblKey}-h-${hIdx}`}
                    className="px-3 py-2.5 font-semibold text-ink border-r last:border-r-0 border-hairline"
                  >
                    {renderInlineNodes(h, `${tblKey}-h-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row, rIdx) => (
                <tr
                  key={`${tblKey}-r-${rIdx}`}
                  className="bg-card hover:bg-paper/60 transition-colors"
                >
                  {headers.map((_, cIdx) => (
                    <td
                      key={`${tblKey}-r-${rIdx}-c-${cIdx}`}
                      className="px-3 py-2 text-secondary border-r last:border-r-0 border-hairline leading-relaxed align-top"
                    >
                      {renderInlineNodes(row[cIdx] || '', `${tblKey}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const hKey = `h-${blockIndex++}`;
      if (level === 1) {
        elements.push(
          <h1
            key={hKey}
            className="text-lg sm:text-xl font-bold text-ink border-b border-hairline pb-2 mt-2 mb-3"
          >
            {renderInlineNodes(content, hKey)}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2
            key={hKey}
            className="text-base font-bold text-brand border-l-3 border-brand pl-2.5 mt-6 mb-2.5"
          >
            {renderInlineNodes(content, hKey)}
          </h2>
        );
      } else if (level === 3) {
        elements.push(
          <h3 key={hKey} className="text-sm font-bold text-ink mt-4 mb-1.5">
            {renderInlineNodes(content, hKey)}
          </h3>
        );
      } else {
        elements.push(
          <h4 key={hKey} className="text-xs font-bold text-secondary mt-3 mb-1">
            {renderInlineNodes(content, hKey)}
          </h4>
        );
      }
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      const qKey = `q-${blockIndex++}`;
      elements.push(
        <blockquote
          key={qKey}
          className="my-3 px-3.5 py-2.5 rounded-r-lg border-l-3 border-brand/60 bg-paper text-xs sm:text-sm text-secondary leading-relaxed"
        >
          {renderInlineNodes(quoteLines.join(' '), qKey)}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      const ulKey = `ul-${blockIndex++}`;
      elements.push(
        <ul
          key={ulKey}
          className="my-2.5 pl-5 space-y-1.5 list-disc text-xs sm:text-sm text-ink leading-relaxed"
        >
          {listItems.map((li, lIdx) => (
            <li key={`${ulKey}-${lIdx}`} className="print-avoid-break">
              {renderInlineNodes(li, `${ulKey}-${lIdx}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      const olKey = `ol-${blockIndex++}`;
      elements.push(
        <ol
          key={olKey}
          className="my-2.5 pl-5 space-y-1.5 list-decimal text-xs sm:text-sm text-ink leading-relaxed"
        >
          {listItems.map((li, lIdx) => (
            <li key={`${olKey}-${lIdx}`} className="print-avoid-break">
              {renderInlineNodes(li, `${olKey}-${lIdx}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const pKey = `p-${blockIndex++}`;
    elements.push(
      <p
        key={pKey}
        className="my-2 text-xs sm:text-sm text-ink leading-relaxed"
      >
        {renderInlineNodes(trimmed, pKey)}
      </p>
    );
    i++;
  }

  return <div className={`space-y-1 ${className}`}>{elements}</div>;
};
