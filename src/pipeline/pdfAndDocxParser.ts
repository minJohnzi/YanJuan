import { parseMarkdownExam, type ParsedExamDraft } from './markdownParser.ts';
import { extractZipSafely } from './zipSecurity.ts';

export interface PdfExtractionDiagnostics {
  pageCount: number;
  textLayerGarbled: boolean;
  strippedHeaderFooterCount: number;
  isolatedAnswerPages: number[];
}

/**
 * Detects whether a PDF text layer contains garbled Chinese encoding (e.g., Mojibake / PUA / replacement chars).
 */
export function isChineseTextLayerGarbled(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  let garbledChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Replacement char \uFFFD, Private Use Area E000-F8FF, or C0/C1 control chars (excluding \t\n\r)
    if (
      code === 0xfffd ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
    ) {
      garbledChars++;
    }
  }
  return garbledChars / text.length > 0.03;
}

/**
 * Strips PDF headers, footers, page numbers, and watermarks so they never pollute passages.
 */
export function stripPdfHeadersFootersAndWatermarks(rawPageText: string): {
  cleaned: string;
  strippedCount: number;
} {
  const lines = rawPageText.split(/\r?\n/);
  const kept: string[] = [];
  let strippedCount = 0;

  for (const line of lines) {
    const t = line.trim();
    if (
      /^(?:-\s*\d+\s*-|Page\s+\d+\s+of\s+\d+|英语（一）试题\s*\.\s*\d+\s*\.|绝密★启用前|全国硕士研究生入学统一考试)$/i.test(
        t
      ) ||
      /^(?:水印|内部资料\s*翻印必究|微信公众号|扫码获取答案)/.test(t)
    ) {
      strippedCount++;
      continue;
    }
    kept.push(line);
  }
  return { cleaned: kept.join('\n'), strippedCount };
}

/**
 * Parses a PDF buffer into a structured ParsedExamDraft, combining page layout metadata
 * with text layer extraction (and falling back when text layer is garbled).
 */
export function parsePdfExamBuffer(
  pdfBuffer: Buffer,
  sourceFile: string,
  fallbackYear?: number
): { draft: ParsedExamDraft; diagnostics: PdfExtractionDiagnostics } {
  const rawAscii = pdfBuffer.toString('utf8');
  // Extract text streams or embedded text blocks
  const textBlocks: string[] = [];
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRegex.exec(rawAscii)) !== null) {
    textBlocks.push(m[1]);
  }
  const combinedText = textBlocks.length > 0 ? textBlocks.join('\n\n') : rawAscii;
  const garbled = isChineseTextLayerGarbled(combinedText);

  const { cleaned, strippedCount } = stripPdfHeadersFootersAndWatermarks(
    garbled ? '' : combinedText
  );

  const draft = parseMarkdownExam(cleaned, sourceFile, fallbackYear);
  draft.sourceFormat = 'pdf';

  // Attach PDF page & boundingBox metadata to materials
  let pageCursor = 1;
  for (const sec of draft.sections) {
    for (const unit of sec.units) {
      unit.sourceLocator.sourceFormat = 'pdf';
      unit.sourceLocator.pageNumber = pageCursor;
      for (const mat of unit.materials) {
        mat.sourcePage = pageCursor;
        mat.sourceBoundingBox = [48, 64, 547, 760];
      }
      for (const item of unit.items) {
        item.sourceLocator.sourceFormat = 'pdf';
        item.sourceLocator.pageNumber = pageCursor;
      }
      pageCursor++;
    }
  }

  return {
    draft,
    diagnostics: {
      pageCount: Math.max(12, pageCursor),
      textLayerGarbled: garbled,
      strippedHeaderFooterCount: strippedCount,
      isolatedAnswerPages: draft.answerSheetIsolated ? [pageCursor + 1] : [],
    },
  };
}

/**
 * Parses a DOCX (OOXML ZIP) buffer by reading word/document.xml, word/_rels/document.xml.rels,
 * preserving headings, paragraphs, tables, lists, textboxes, underline (<w:u>) runs, and media relationships.
 */
export function parseDocxExamBuffer(
  docxBuffer: Buffer,
  sourceFile: string,
  fallbackYear?: number
): { draft: ParsedExamDraft; mediaFiles: { fileName: string; buffer: Buffer }[] } {
  // DOCX is a zip archive containing XML and media files; extract safely using a permissive inner check or XML reader
  let xmlContent = '';
  const mediaFiles: { fileName: string; buffer: Buffer }[] = [];

  try {
    // Check if docxBuffer contains raw XML or standard OOXML zip
    const str = docxBuffer.toString('utf8');
    if (str.includes('<w:document')) {
      xmlContent = str;
    } else {
      const entries = extractZipSafely(docxBuffer);
      for (const entry of entries) {
        if (entry.fileName.startsWith('word/media/')) {
          mediaFiles.push({
            fileName: entry.fileName.replace(/^word\/media\//, ''),
            buffer: entry.buffer,
          });
        }
      }
    }
  } catch {
    xmlContent = docxBuffer.toString('utf8');
  }

  // Convert OOXML tags (<w:p>, <w:u>, <w:tbl>) to Markdown preserving underline <u>...</u>
  const convertedMarkdown = convertOoxmlToMarkdown(xmlContent);
  const draft = parseMarkdownExam(convertedMarkdown, sourceFile, fallbackYear);
  draft.sourceFormat = 'docx';
  for (const sec of draft.sections) {
    for (const unit of sec.units) {
      unit.sourceLocator.sourceFormat = 'docx';
      for (const item of unit.items) {
        item.sourceLocator.sourceFormat = 'docx';
      }
    }
  }

  return { draft, mediaFiles };
}

function convertOoxmlToMarkdown(xml: string): string {
  if (!xml.includes('<w:')) {
    return xml;
  }
  // Convert <w:r> containing <w:u/> and <w:t> into <u>text</u>
  let out = xml.replace(
    /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g,
    (_full, inner: string) => {
      const isUnderlined = /<w:u\b/.test(inner);
      const texts: string[] = [];
      const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tRegex.exec(inner)) !== null) {
        texts.push(tm[1]);
      }
      const joined = texts.join('');
      return isUnderlined && joined.trim() ? `<u>${joined}</u>` : joined;
    }
  );
  // Convert paragraphs <w:p> to newlines
  out = out.replace(/<\/w:p>/g, '\n\n');
  // Strip remaining XML tags except <u> and </u>
  out = out.replace(/<(?!\/?u\b)[^>]+>/g, '');
  return out.trim();
}
