import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Exam } from '../src/shared/types.ts';

const rootDir = process.cwd();
const rawDir = path.join(rootDir, 'data', 'exams', 'raw');
const genDir = path.join(rootDir, 'data', 'exams', 'generated');
const ALL_YEARS = Array.from({ length: 17 }, (_, i) => 2010 + i);
const MULTI_IMAGE_YEARS = [2014, 2016, 2017, 2020, 2024, 2026];

test('Full-Spectrum Verification 1: Raw directory structure, YAML frontmatter, and 29 PNG magic bytes', () => {
  // 1. Raw papers (17 markdown files)
  const paperFiles = fs.readdirSync(path.join(rawDir, 'papers')).filter((f) => f.endsWith('.md'));
  assert.equal(paperFiles.length, 17, '必须有17份原始试卷Markdown');
  for (const y of ALL_YEARS) {
    assert.ok(fs.existsSync(path.join(rawDir, 'papers', `${y}.md`)), `${y}.md 必须存在`);
  }

  // 2. Raw answers (17 markdown files: 2010–2026 from full answer supplement)
  const answerFiles = fs.readdirSync(path.join(rawDir, 'answers')).filter((f) => f.endsWith('.md'));
  assert.equal(answerFiles.length, 17, '必须有17份来源答案文件 (2010–2026)');
  for (const y of ALL_YEARS) {
    assert.equal(
      fs.existsSync(path.join(rawDir, 'answers', `${y}.md`)),
      true,
      `${y} 年来源答案文件必须存在`
    );
  }

  // 3. Raw reports (17 year reports + validation-summary.json + change-log.md + unresolved-issues.md)
  const reportFiles = fs.readdirSync(path.join(rawDir, 'reports')).filter((f) => /^20\d\d\.json$/.test(f));
  assert.equal(reportFiles.length, 17, '必须有17份分年报告');
  for (const y of ALL_YEARS) {
    const rep = JSON.parse(fs.readFileSync(path.join(rawDir, 'reports', `${y}.json`), 'utf8'));
    assert.equal(rep.year, y);
    assert.equal(rep.subject, 'english-i');
    assert.equal(rep.subject_code, 201);
    assert.equal(rep.question_count, 52);
    assert.equal(rep.question_range, '1-52');
    assert.equal(rep.validation_status, 'passed');
    assert.equal(rep.unresolved_issue_count, 0);
    assert.deepEqual(rep.cross_year_errors, []);
    assert.equal(rep.answer_status, 'source-provided');
  }
  assert.ok(fs.existsSync(path.join(rawDir, 'reports', 'validation-summary.json')));
  assert.ok(fs.existsSync(path.join(rawDir, 'reports', 'change-log.md')));
  assert.ok(fs.existsSync(path.join(rawDir, 'reports', 'unresolved-issues.md')));

  // 4. Raw visual assets: total 29 PNG files across 17 years, valid PNG header & dimensions > 0
  let totalVisualCount = 0;
  for (const y of ALL_YEARS) {
    const assetYearDir = path.join(rawDir, 'assets', String(y));
    assert.ok(fs.existsSync(assetYearDir), `assets/${y} 目录必须存在`);
    const assets = fs.readdirSync(assetYearDir).filter((f) => f.endsWith('.png')).sort();
    const expectedCount = MULTI_IMAGE_YEARS.includes(y) ? 3 : 1;
    assert.equal(assets.length, expectedCount, `${y} 年视觉材料数量应为 ${expectedCount}`);
    for (const a of assets) {
      const buf = fs.readFileSync(path.join(assetYearDir, a));
      assert.ok(buf.length > 100, `${y}/${a} 文件大小必须有效`);
      assert.equal(buf.subarray(0, 4).toString('hex'), '89504e47', `${y}/${a} 必须为真实 PNG 文件`);
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      assert.ok(width > 0 && height > 0, `${y}/${a} PNG 宽高必须大于 0`);
    }
    totalVisualCount += assets.length;
  }
  assert.equal(totalVisualCount, 29, '原始写作题视觉材料总数必须为29张');

  // 5. Raw manifest.json & import-state.json
  const manifest = JSON.parse(fs.readFileSync(path.join(rawDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.totalPapers, 17);
  assert.equal(manifest.totalVisualAssets, 29);
  assert.equal(manifest.totalSourcePages, 257);
  assert.deepEqual(manifest.expectedYears, ALL_YEARS);
  assert.deepEqual(manifest.sourceAnswerYears, ALL_YEARS);
  assert.deepEqual(manifest.cross_year_errors, []);

  const importState = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'data', 'exams', 'import-state.json'), 'utf8')
  );
  assert.deepEqual(importState.expectedYears, ALL_YEARS);
  assert.deepEqual(importState.importedYears, ALL_YEARS);
  assert.deepEqual(importState.pendingYears, []);
  assert.deepEqual(importState.answerAvailableYears, ALL_YEARS);
  assert.deepEqual(importState.failedYears, []);
});

test('Full-Spectrum Verification 2: Markdown structure, YAML metadata & image reference integrity (1-52 questions)', () => {
  for (const y of ALL_YEARS) {
    const mdContent = fs.readFileSync(path.join(rawDir, 'papers', `${y}.md`), 'utf8');

    // YAML Frontmatter check
    assert.ok(mdContent.includes(`year: ${y}`), `${y}.md 缺少 year`);
    assert.ok(mdContent.includes('subject: english-i'), `${y}.md 缺少 subject: english-i`);
    assert.ok(mdContent.includes('subject_code: 201'), `${y}.md 缺少 subject_code: 201`);
    assert.ok(mdContent.includes('total_score: 100'), `${y}.md 缺少 total_score: 100`);
    assert.ok(mdContent.includes('duration_minutes: 180'), `${y}.md 缺少 duration_minutes: 180`);
    assert.ok(mdContent.includes('question_range: 1-52'), `${y}.md 缺少 question_range: 1-52`);

    // Section I, II, III check
    assert.ok(mdContent.includes('## Section I Use of English'), `${y} 年缺少 Section I`);
    assert.ok(mdContent.includes('## Section II Reading Comprehension'), `${y} 年缺少 Section II`);
    assert.ok(mdContent.includes('## Section III Writing'), `${y} 年缺少 Section III`);

    // Cloze blanks [1]..[20]
    for (let b = 1; b <= 20; b++) {
      assert.ok(mdContent.includes(`[${b}]`), `${y} 年完形填空正文缺少空位 [${b}]`);
    }

    // Questions 1-52 check
    for (let q = 1; q <= 52; q++) {
      const qPattern = new RegExp(`(?:^|\\s|\\()${q}[.、:：)]`, 'm');
      assert.ok(qPattern.test(mdContent), `${y} 年缺少题号 ${q}`);
    }

    // Translation 46-50 <u data-question="46">..</u> check
    for (let q = 46; q <= 50; q++) {
      assert.ok(
        mdContent.includes(`<u data-question="${q}">`),
        `${y} 年翻译缺少 <u data-question="${q}">`
      );
    }

    // Verify all referenced images exist on disk and are non-empty PNGs
    const imgRegex = /!\[.*?\]\((\.\.\/assets\/\d{4}\/[^)]+)\)/g;
    let match: RegExpExecArray | null;
    let imgCount = 0;
    while ((match = imgRegex.exec(mdContent)) !== null) {
      imgCount++;
      const relPath = match[1];
      const resolvedPath = path.resolve(path.join(rawDir, 'papers'), relPath);
      assert.ok(fs.existsSync(resolvedPath), `${y} 年引用图片不存在: ${relPath}`);
      const stats = fs.statSync(resolvedPath);
      assert.ok(stats.size > 100, `${y} 年图片文件不可读或为空: ${relPath}`);
    }
    assert.equal(
      imgCount,
      MULTI_IMAGE_YEARS.includes(y) ? 3 : 1,
      `${y} 年 Markdown 图片引用数不匹配`
    );
  }
});

test('Full-Spectrum Verification 3: Special checks for 2010 Part B, multi-image years, 2026 Part B multiple fixed paragraphs, and answer isolation', () => {
  // 2010 Part B
  const md2010 = fs.readFileSync(path.join(rawDir, 'papers', '2010.md'), 'utf8');
  assert.ok(md2010.includes('fixed_paragraphs: E'), '2010 Part B 必须标记固定段落 E');
  assert.ok(md2010.includes('41. → 42. → [E] → 43. → 44. → 45.'), '2010 Part B 必须按五个计分位置与固定E段排序');

  // Multi-image years (2014, 2016, 2017, 2020, 2024, 2026): 2 standalone + 1 composite
  for (const y of MULTI_IMAGE_YEARS) {
    const assets = fs.readdirSync(path.join(rawDir, 'assets', String(y))).sort();
    assert.deepEqual(
      assets,
      ['writing-part-b-01.png', 'writing-part-b-02.png', 'writing-part-b-composite.png'],
      `${y} 年必须同时保留独立图 01、02 与组合图 composite`
    );
  }

  // 2026 Part B multiple fixed paragraphs (D, E)
  const md2026 = fs.readFileSync(path.join(rawDir, 'papers', '2026.md'), 'utf8');
  assert.ok(md2026.includes('fixed_paragraphs: D, E'), '2026 Part B 必须包含多个固定段落 D, E');
  assert.ok(md2026.includes('[D] → 41. → 42. → [E] → 43. → 44. → 45.'), '2026 Part B 排序结构正确');

  // Answers isolation check: papers/*.md must NEVER contain answer tables
  for (const y of ALL_YEARS) {
    const md = fs.readFileSync(path.join(rawDir, 'papers', `${y}.md`), 'utf8');
    assert.equal(md.includes('来源参考答案'), false, `${y}.md 绝不能混入参考答案正文`);
    assert.equal(md.includes('官方参考答案'), false, `${y}.md 绝不能混入官方参考答案正文`);
  }
});

test('Full-Spectrum Verification 4: Generated runtime exams (17 JSONs, authentic parsed content, no placeholder options, strict answer isolation)', () => {
  const genManifestPath = path.join(genDir, 'papers-manifest.json');
  assert.ok(fs.existsSync(genManifestPath), 'generated/papers-manifest.json 必须存在');

  const genManifest = JSON.parse(fs.readFileSync(genManifestPath, 'utf8'));
  assert.equal(genManifest.totalPapers, 17);
  assert.equal(genManifest.totalVisualAssets, 29);
  assert.deepEqual(genManifest.availableYears, ALL_YEARS);
  assert.deepEqual(genManifest.failedYears, []);
  assert.deepEqual(genManifest.pendingYears, []);

  for (const y of ALL_YEARS) {
    const examFilePath = path.join(genDir, 'papers', `${y}.json`);
    assert.ok(fs.existsSync(examFilePath), `generated/papers/${y}.json 必须生成`);

    const exam: Exam = JSON.parse(fs.readFileSync(examFilePath, 'utf8'));
    assert.equal(exam.year, y);
    assert.equal(exam.totalScore, 100);
    assert.equal(exam.durationMinutes, 180);
    assert.equal(exam.sections.length, 3, `${y} 年必须包含完整的 Section I, II, III`);

    const allUnits = exam.sections.flatMap((s) => s.units);
    const allItems = allUnits.flatMap((u) => u.items);

    // 1-52 complete in order
    assert.equal(allItems.length, 52, `${y} 年题目总数必须为 52`);
    for (let i = 0; i < 52; i++) {
      assert.equal(allItems[i].questionNumber, i + 1, `${y} 年题号必须连续且从 1 到 52`);
    }

    // 1-20 Cloze: verify real passage blanks and real parsed options (never "Option A")
    const clozeUnit = allUnits.find((u) => u.unitType === 'cloze')!;
    assert.ok(clozeUnit);
    assert.equal(clozeUnit.items.length, 20);
    assert.ok(clozeUnit.materials[0].text.includes('[1]') && clozeUnit.materials[0].text.includes('[20]'));
    for (const item of clozeUnit.items) {
      assert.equal(item.options?.length, 4);
      for (const opt of item.options!) {
        assert.notEqual(opt.text, 'Option A', `${y} 年完形填空第 ${item.questionNumber} 题严禁使用占位符 Option A`);
      }
    }

    // 21-40 Reading Part A: 4 texts, real passages & options
    const readingUnits = allUnits.filter((u) => u.unitType === 'reading');
    assert.equal(readingUnits.length, 4);
    const readingItems = readingUnits.flatMap((u) => u.items);
    assert.equal(readingItems.length, 20);
    for (const item of readingItems) {
      assert.equal(item.options?.length, 4);
      assert.equal(item.prompt.startsWith('Question '), false, `${y} 年第 ${item.questionNumber} 题必须为真实题干`);
      for (const opt of item.options!) {
        assert.notEqual(opt.text, 'Option A', `${y} 年阅读第 ${item.questionNumber} 题严禁使用占位符 Option A`);
      }
    }

    // 41-45 Part B: real candidateParagraphs & sequenceSlots
    const partBUnit = allUnits.find((u) => u.unitType === 'passage-assembly')!;
    assert.ok(partBUnit);
    const spec = partBUnit.materials[0].passageAssemblySpec!;
    assert.ok(spec);
    assert.equal(spec.candidateParagraphs.length, 7);
    assert.notEqual(spec.candidateParagraphs[0].text, 'Candidate paragraph A text content.');
    assert.ok(spec.sequenceSlots.length >= 5, `${y} 年 Part B sequenceSlots 必须非空`);
    if (y === 2010) {
      assert.deepEqual(spec.fixedPlacements.map((f) => f.paragraphId), ['E']);
    } else if (y === 2026) {
      assert.deepEqual(spec.fixedPlacements.map((f) => f.paragraphId), ['D', 'E']);
    }

    // 46-50 Translation: real underlined sentences from Part C and source-provided reference translations
    const transUnit = allUnits.find((u) => u.unitType === 'translation')!;
    assert.ok(transUnit);
    assert.equal(transUnit.items.length, 5);
    for (const item of transUnit.items) {
      assert.ok((item.translationMeta?.underlinedEnglish.length || 0) > 40);
      assert.ok(
        (item.translationMeta?.referenceTranslation?.length || 0) > 10,
        `${y} 年第 ${item.questionNumber} 题必须包含来源参考译文`
      );
      assert.equal(item.translationMeta?.referenceSource, 'source-provided');
    }

    // 51 & 52 Writing: verify source-provided model essays are populated
    const pwUnit = allUnits.find((u) => u.unitType === 'practical-writing')!;
    const vwUnit = allUnits.find((u) => u.unitType === 'visual-writing')!;
    assert.equal(pwUnit.items[0].questionNumber, 51);
    assert.ok(
      (pwUnit.items[0].rubric?.referenceText?.length || 0) > 100,
      `${y} 年小作文 51 题必须包含来源参考范文`
    );
    assert.equal(vwUnit.items[0].questionNumber, 52);
    assert.ok(
      (vwUnit.items[0].rubric?.referenceText?.length || 0) > 200,
      `${y} 年大作文 52 题必须包含来源参考范文`
    );

    // All 17 years (2010–2026) must have complete source-provided objective answers (1–45)
    assert.equal(exam.answerSourceStatus, 'source-provided');
    assert.equal(exam.objectiveAnswerCount, 45);
    for (let i = 0; i < 45; i++) {
      assert.ok(
        /^[A-G]$/.test(allItems[i].correctAnswer || ''),
        `${y} 年第 ${i + 1} 题必须关联来源官方答案`
      );
      assert.equal(allItems[i].answerSource, 'source-provided');
    }

    // Visual materials in public/assets/papers/{y}
    const visualMats = vwUnit.materials[0].visualMaterials || [];
    assert.equal(
      visualMats.length,
      MULTI_IMAGE_YEARS.includes(y) ? 3 : 1,
      `${y} 年生成 JSON 视觉材料数量必须与原始资源一致`
    );
    for (const vm of visualMats) {
      assert.ok(vm.imagePath.startsWith(`/assets/papers/${y}/`));
      const diskPath = path.join(rootDir, 'public', vm.imagePath.slice(1));
      assert.ok(fs.existsSync(diskPath), `公开图片资源在磁盘中不存在: ${diskPath}`);
    }
  }
});
