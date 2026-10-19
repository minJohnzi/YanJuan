import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPaperBuildPipeline } from '../src/pipeline/buildPipeline.ts';
import { parseMarkdownExam } from '../src/pipeline/markdownParser.ts';
import { mergeMultiSourceExamDrafts } from '../src/pipeline/multiSourceMerger.ts';
import {
  PAPER_2010_MARKDOWN,
  build2010InitialZipBuffer,
} from '../src/pipeline/paper2010Source.ts';
import { buildAndValidateExam } from '../src/pipeline/paperValidator.ts';
import {
  PipelineSecurityError,
  createZipArchive,
  extractZipSafely,
  validateSafeRelativePath,
} from '../src/pipeline/zipSecurity.ts';

test('2010英一.zip extraction and Markdown structural recognition (1-52, Q34 underline vs Q46-50 translation, Part B fixed E)', () => {
  const zipBuf = build2010InitialZipBuffer();
  const entries = extractZipSafely(zipBuf);
  assert.equal(entries.length, 2);

  const mdEntry = entries.find((e) => e.extension === 'md');
  const pngEntry = entries.find((e) => e.extension === 'png');
  assert.ok(mdEntry, 'ZIP 必须包含 2010 Markdown 文件');
  assert.ok(pngEntry, 'ZIP 必须包含 2010 写作 Part B PNG 插图');

  const draft = parseMarkdownExam(mdEntry.buffer.toString('utf8'), mdEntry.fileName);
  assert.equal(draft.year, 2010);
  assert.equal(draft.subject, '考研英语一');

  const allUnits = draft.sections.flatMap((s) => s.units);
  const allItems = allUnits.flatMap((u) => u.items);

  // 1-52 question numbers complete and in order
  assert.equal(allItems.length, 52);
  for (let i = 0; i < 52; i++) {
    assert.equal(allItems[i].questionNumber, i + 1);
  }

  // Cloze 1-20
  const clozeUnit = allUnits.find((u) => u.unitType === 'cloze');
  assert.ok(clozeUnit);
  assert.equal(clozeUnit.items.length, 20);
  for (const item of clozeUnit.items) {
    assert.equal(item.options?.length, 4);
  }

  // Reading Part A: 4 texts, 20 questions (21-40)
  const readingUnits = allUnits.filter((u) => u.unitType === 'reading');
  assert.equal(readingUnits.length, 4);
  const text3 = readingUnits[2];
  assert.ok(
    text3.materials[0].text.includes('<u>these people</u>'),
    '阅读 Text 3 第4段必须保留 <u>these people</u> 下划线格式'
  );
  const q34 = text3.items.find((i) => i.questionNumber === 34);
  assert.equal(q34?.readingMeta?.underlinedTarget, 'these people');

  // Part B: 41-45, candidates A-G, E fixed, 5 scored positions, 1 redundant
  const partBUnit = allUnits.find((u) => u.unitType === 'passage-assembly');
  assert.ok(partBUnit);
  const spec = partBUnit.materials[0].passageAssemblySpec;
  assert.ok(spec);
  assert.equal(spec.candidateParagraphs.length, 7);
  assert.deepEqual(
    spec.candidateParagraphs.map((c) => c.label),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  );
  assert.equal(spec.fixedPlacements.length, 1);
  assert.equal(spec.fixedPlacements[0].paragraphId, 'E');
  assert.equal(spec.scoredPositions.length, 5);
  assert.equal(spec.redundantCount, 1);

  // Part C Translation: 46-50 (must NOT include Q34 "these people")
  const transUnit = allUnits.find((u) => u.unitType === 'translation');
  assert.ok(transUnit);
  assert.equal(transUnit.items.length, 5);
  assert.deepEqual(
    transUnit.items.map((i) => i.questionNumber),
    [46, 47, 48, 49, 50]
  );
  for (const item of transUnit.items) {
    assert.ok(item.translationMeta?.underlinedEnglish.length! > 30);
    assert.equal(
      item.translationMeta?.underlinedEnglish.includes('these people'),
      false,
      '第34题下划线绝不能混入翻译题'
    );
  }

  // Writing Part A (51) & Part B (52) image path
  const pwUnit = allUnits.find((u) => u.unitType === 'practical-writing');
  const vwUnit = allUnits.find((u) => u.unitType === 'visual-writing');
  assert.equal(pwUnit?.items[0].questionNumber, 51);
  assert.equal(vwUnit?.items[0].questionNumber, 52);
  assert.deepEqual(draft.referencedAssets, ['2010年写作PartB.png']);
});

test('Missing objective answers rejects ready release with OBJECTIVE_ANSWER_MISSING and never generates guessed answers', () => {
  const draft = parseMarkdownExam(PAPER_2010_MARKDOWN, '2010年考研英语一真题.md', 2010);
  const merged = mergeMultiSourceExamDrafts([draft]);
  const exam = buildAndValidateExam(merged, {
    dataVersion: 'v1',
    sourceHashes: {
      '2010年考研英语一真题.md': 'hash1',
      '2010年写作PartB.png': 'hash2',
    },
    availableAssetNames: ['2010年写作PartB.png'],
  });

  assert.equal(exam.importStatus, 'needs-answer-source');
  assert.equal(exam.validationReport.passedAllChecks, false);
  assert.ok(exam.validationReport.errorCodes.includes('OBJECTIVE_ANSWER_MISSING'));
  assert.equal(exam.validationReport.missingObjectiveQuestions.length, 45);

  // Verify zero guessed answers
  const objectiveItems = exam.sections
    .flatMap((s) => s.units)
    .flatMap((u) => u.items)
    .filter((i) => i.questionNumber <= 45);
  assert.equal(objectiveItems.length, 45);
  for (const item of objectiveItems) {
    assert.equal(item.correctAnswer, null);
    assert.equal(item.answerSource, 'unavailable');
  }
});

test('Multi-source objective answer conflict fails validation with OBJECTIVE_ANSWER_CONFLICT', () => {
  const md1 = `${PAPER_2010_MARKDOWN}\n\n## 参考答案\n1. B\n2. A\n`;
  const md2 = `${PAPER_2010_MARKDOWN}\n\n## 参考答案\n1. D\n2. A\n`;
  const draft1 = parseMarkdownExam(md1, 'source1.md', 2010);
  const draft2 = parseMarkdownExam(md2, 'source2.docx', 2010);
  draft2.sourceFormat = 'docx';

  const merged = mergeMultiSourceExamDrafts([draft1, draft2]);
  assert.deepEqual(merged.conflictingObjectiveQuestions, [1]);

  const exam = buildAndValidateExam(merged, {
    dataVersion: 'v1',
    sourceHashes: { a: '1', b: '2' },
    availableAssetNames: ['2010年写作PartB.png'],
  });
  assert.equal(exam.importStatus, 'failed');
  assert.ok(exam.validationReport.errorCodes.includes('OBJECTIVE_ANSWER_CONFLICT'));
});

test('ZIP security blocks path traversal, duplicate file hashes, spoofed extensions, and external URLs', () => {
  // 1. Path traversal
  assert.throws(
    () => validateSafeRelativePath('../etc/passwd'),
    (err: any) => err instanceof PipelineSecurityError && err.code === 'ZIP_PATH_TRAVERSAL'
  );
  assert.throws(
    () => validateSafeRelativePath('/absolute/path.png'),
    (err: any) => err instanceof PipelineSecurityError && err.code === 'ZIP_PATH_TRAVERSAL'
  );

  // 2. External resource URL blocked
  assert.throws(
    () => validateSafeRelativePath('https://evil.example.com/chart.png'),
    (err: any) =>
      err instanceof PipelineSecurityError && err.code === 'UNSUPPORTED_EXTERNAL_RESOURCE'
  );

  // 3. Duplicate file detection in ZIP
  const dupZip = createZipArchive([
    { fileName: 'a.md', data: Buffer.from('# Same content', 'utf8') },
    { fileName: 'b.md', data: Buffer.from('# Same content', 'utf8') },
  ]);
  assert.throws(
    () => extractZipSafely(dupZip),
    (err: any) => err instanceof PipelineSecurityError && err.code === 'DUPLICATE_FILE_HASH'
  );

  // 4. Spoofed extension (.png with text bytes)
  const spoofZip = createZipArchive([
    { fileName: 'fake.png', data: Buffer.from('not a real png', 'utf8') },
  ]);
  assert.throws(
    () => extractZipSafely(spoofZip),
    (err: any) => err instanceof PipelineSecurityError && err.code === 'SPOOFED_EXTENSION'
  );
});

test('Versioned pipeline: 2010 v1 is isolated as needs-answer-source and re-import creates v2 without overwriting v1', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yanjuan-pipeline-test-'));
  try {
    // Run 1: initial 2010英一.zip only -> must be isolated as needs-answer-source, never in availableYears
    const res1 = runPaperBuildPipeline(tmpRoot);
    assert.deepEqual(res1.manifest.availableYears, []);
    assert.deepEqual(res1.manifest.failedYears, [2010]);
    assert.equal(res1.manifest.pendingYears.length, 16);
    assert.ok(fs.existsSync(path.join(tmpRoot, 'data/papers/2010/v1.json')));

    // Run 2: forced re-run creates a new immutable version (v2) without overwriting v1
    const res2 = runPaperBuildPipeline(tmpRoot, {
      forceNewVersionForYear: 2010,
    });

    assert.deepEqual(res2.manifest.availableYears, []);
    assert.deepEqual(res2.manifest.failedYears, [2010]);
    assert.ok(fs.existsSync(path.join(tmpRoot, 'data/papers/2010/v1.json')), 'v1 绝不能被覆盖删除');
    assert.ok(fs.existsSync(path.join(tmpRoot, 'data/papers/2010/v2.json')), 'v2 已生成');

    const v1Exam = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, 'data/papers/2010/v1.json'), 'utf8')
    );
    const v2Exam = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, 'data/papers/2010/v2.json'), 'utf8')
    );
    assert.equal(v1Exam.importStatus, 'needs-answer-source');
    assert.equal(v2Exam.importStatus, 'needs-answer-source');
    assert.ok(v2Exam.validationReport.errorCodes.includes('OBJECTIVE_ANSWER_MISSING'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
