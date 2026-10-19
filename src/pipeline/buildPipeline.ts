import fs from 'node:fs';
import path from 'node:path';
import type {
  Exam,
  ImportStatus,
  PapersManifest,
  UnitType,
  ValidationReport,
  YearManifestEntry,
} from '../shared/types.ts';
import { parseMarkdownExam, type ParsedExamDraft } from './markdownParser.ts';
import { mergeMultiSourceExamDrafts } from './multiSourceMerger.ts';
import { build2010InitialZipBuffer } from './paper2010Source.ts';
import { buildAndValidateExam } from './paperValidator.ts';
import { parseDocxExamBuffer, parsePdfExamBuffer } from './pdfAndDocxParser.ts';
import {
  type SafeArchiveEntry,
  computeSha256,
  extractZipSafely,
  verifyFileTypeAndMagicBytes,
} from './zipSecurity.ts';

export const EXPECTED_YEARS = Array.from({ length: 17 }, (_, i) => 2010 + i);

export interface BuildPapersResult {
  manifest: PapersManifest;
  builtExams: Exam[];
  reports: ValidationReport[];
}

/**
 * Ensures `/inputs/2010英一.zip` exists on disk so the pipeline reads the actual ZIP archive.
 */
export function ensureInitial2010ZipOnDisk(rootDir: string): string {
  const inputsDir = path.join(rootDir, 'inputs');
  fs.mkdirSync(inputsDir, { recursive: true });
  const zipPath = path.join(inputsDir, '2010英一.zip');
  if (!fs.existsSync(zipPath)) {
    const buf = build2010InitialZipBuffer();
    fs.writeFileSync(zipPath, buf);
  }
  return zipPath;
}

/**
 * Discovers all input files in `inputsDir` (.zip, .md, .pdf, .docx), groups them by year (2010–2026),
 * parses, merges, validates, and writes versioned static files without overwriting existing versions.
 */
export function runPaperBuildPipeline(
  rootDir: string,
  options: {
    forceNewVersionForYear?: number;
    supplementFiles?: { year: number; fileName: string; buffer: Buffer }[];
  } = {}
): BuildPapersResult {
  ensureInitial2010ZipOnDisk(rootDir);

  const inputsDir = path.join(rootDir, 'inputs');
  const dataDir = path.join(rootDir, 'data');
  const publicDataDir = path.join(rootDir, 'public', 'data');
  const publicAssetsDir = path.join(rootDir, 'public', 'assets', 'papers');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(publicDataDir, { recursive: true });
  fs.mkdirSync(publicAssetsDir, { recursive: true });

  // Group discovered archive entries by year
  const entriesByYear = new Map<number, SafeArchiveEntry[]>();
  const sourceManifestEntries: {
    year: number;
    containerFile: string;
    entryFile: string;
    sha256: string;
    sizeBytes: number;
    mimeType: string;
  }[] = [];

  const inputFiles = fs.existsSync(inputsDir)
    ? fs.readdirSync(inputsDir).sort()
    : [];

  for (const file of inputFiles) {
    const fullPath = path.join(inputsDir, file);
    if (!fs.statSync(fullPath).isFile()) continue;

    const yearMatch = file.match(/(201\d|202\d)/);
    const detectedYear = yearMatch ? Number(yearMatch[1]) : 2010;
    const rawBuf = fs.readFileSync(fullPath);

    if (file.toLowerCase().endsWith('.zip')) {
      const extracted = extractZipSafely(rawBuf);
      const list = entriesByYear.get(detectedYear) || [];
      for (const e of extracted) {
        list.push(e);
        sourceManifestEntries.push({
          year: detectedYear,
          containerFile: file,
          entryFile: e.fileName,
          sha256: e.sha256,
          sizeBytes: e.sizeBytes,
          mimeType: e.mimeType,
        });
      }
      entriesByYear.set(detectedYear, list);
    } else {
      const { extension, mimeType } = verifyFileTypeAndMagicBytes(file, rawBuf);
      const sha256 = computeSha256(rawBuf);
      const list = entriesByYear.get(detectedYear) || [];
      list.push({
        fileName: file,
        extension,
        mimeType,
        sizeBytes: rawBuf.length,
        sha256,
        buffer: rawBuf,
      });
      sourceManifestEntries.push({
        year: detectedYear,
        containerFile: file,
        entryFile: file,
        sha256,
        sizeBytes: rawBuf.length,
        mimeType,
      });
      entriesByYear.set(detectedYear, list);
    }
  }

  // Append any runtime supplement files (e.g., official answer source uploaded in Settings)
  if (options.supplementFiles) {
    for (const sup of options.supplementFiles) {
      const { extension, mimeType } = verifyFileTypeAndMagicBytes(
        sup.fileName,
        sup.buffer
      );
      const sha256 = computeSha256(sup.buffer);
      const list = entriesByYear.get(sup.year) || [];
      list.push({
        fileName: sup.fileName,
        extension,
        mimeType,
        sizeBytes: sup.buffer.length,
        sha256,
        buffer: sup.buffer,
      });
      sourceManifestEntries.push({
        year: sup.year,
        containerFile: sup.fileName,
        entryFile: sup.fileName,
        sha256,
        sizeBytes: sup.buffer.length,
        mimeType,
      });
      entriesByYear.set(sup.year, list);
    }
  }

  const builtExams: Exam[] = [];
  const reports: ValidationReport[] = [];

  for (const [year, entries] of entriesByYear.entries()) {
    // Check existing versions on disk so we NEVER overwrite an existing version if hashes changed or forceNewVersionForYear is set
    const yearPaperDir = path.join(dataDir, 'papers', String(year));
    const yearReportDir = path.join(dataDir, 'import-reports', String(year));
    fs.mkdirSync(yearPaperDir, { recursive: true });
    fs.mkdirSync(yearReportDir, { recursive: true });

    const existingVersionFiles = fs
      .readdirSync(yearPaperDir)
      .filter((f) => /^v\d+\.json$/.test(f))
      .sort((a, b) => {
        const na = Number(a.replace(/\D/g, ''));
        const nb = Number(b.replace(/\D/g, ''));
        return na - nb;
      });

    const sourceHashes: Record<string, string> = {};
    for (const e of entries) {
      sourceHashes[e.fileName] = e.sha256;
    }

    // Check if an identical sourceHashes version already exists
    let targetVersion = 'v1';
    let reuseExistingExam: Exam | null = null;

    if (existingVersionFiles.length > 0) {
      const latestFile = existingVersionFiles[existingVersionFiles.length - 1];
      const latestExam = JSON.parse(
        fs.readFileSync(path.join(yearPaperDir, latestFile), 'utf8')
      ) as Exam;

      const sameHashes =
        JSON.stringify(latestExam.sourceHashes) === JSON.stringify(sourceHashes);

      if (sameHashes && options.forceNewVersionForYear !== year) {
        reuseExistingExam = latestExam;
        targetVersion = latestExam.dataVersion;
      } else {
        const nextNum =
          Number(latestFile.replace(/\D/g, '')) + 1;
        targetVersion = `v${nextNum}`;
      }
    }

    if (reuseExistingExam) {
      builtExams.push(reuseExistingExam);
      reports.push(reuseExistingExam.validationReport);
      continue;
    }

    // Parse all document entries & collect image assets
    const drafts: ParsedExamDraft[] = [];
    const imageAssets: SafeArchiveEntry[] = [];
    let consistencyMatched = true;

    for (const entry of entries) {
      if (entry.extension === 'png' || entry.extension === 'jpg' || entry.extension === 'jpeg') {
        imageAssets.push(entry);
      } else if (entry.extension === 'md') {
        const text = entry.buffer.toString('utf8');
        const run1 = parseMarkdownExam(text, entry.fileName, year);
        const run2 = parseMarkdownExam(text, entry.fileName, year);
        if (JSON.stringify(run1.sections) !== JSON.stringify(run2.sections)) {
          consistencyMatched = false;
        }
        drafts.push(run1);
      } else if (entry.extension === 'pdf') {
        const { draft } = parsePdfExamBuffer(entry.buffer, entry.fileName, year);
        drafts.push(draft);
      } else if (entry.extension === 'docx') {
        const { draft } = parseDocxExamBuffer(entry.buffer, entry.fileName, year);
        drafts.push(draft);
      }
    }

    if (drafts.length === 0) continue;

    const mergeResult = mergeMultiSourceExamDrafts(drafts);

    // Copy image assets to /public/assets/papers/{year}/{dataVersion}/
    const assetOutDir = path.join(publicAssetsDir, String(year), targetVersion);
    fs.mkdirSync(assetOutDir, { recursive: true });
    const availableAssetNames: string[] = [];
    for (const img of imageAssets) {
      const baseName = path.posix.basename(img.fileName);
      fs.writeFileSync(path.join(assetOutDir, baseName), img.buffer);
      availableAssetNames.push(baseName);
    }

    const exam = buildAndValidateExam(mergeResult, {
      dataVersion: targetVersion,
      sourceHashes,
      availableAssetNames,
      consistencyCheckRuns: 2,
      consistencyMatched,
    });

    // Write paper JSON and validation report JSON to /data and mirror to /public/data
    const paperJsonStr = JSON.stringify(exam, null, 2);
    const reportJsonStr = JSON.stringify(exam.validationReport, null, 2);

    fs.writeFileSync(path.join(yearPaperDir, `${targetVersion}.json`), paperJsonStr);
    fs.writeFileSync(path.join(yearReportDir, `${targetVersion}.json`), reportJsonStr);

    const pubYearPaperDir = path.join(publicDataDir, 'papers', String(year));
    const pubYearReportDir = path.join(publicDataDir, 'import-reports', String(year));
    fs.mkdirSync(pubYearPaperDir, { recursive: true });
    fs.mkdirSync(pubYearReportDir, { recursive: true });
    fs.writeFileSync(path.join(pubYearPaperDir, `${targetVersion}.json`), paperJsonStr);
    fs.writeFileSync(path.join(pubYearReportDir, `${targetVersion}.json`), reportJsonStr);

    builtExams.push(exam);
    reports.push(exam.validationReport);
  }

  // Build overall papers-manifest.json across all expected years (2010–2026)
  const availableYears: number[] = [];
  const pendingYears: number[] = [];
  const failedYears: number[] = [];
  const latestReadyVersion: Record<string, string> = {};
  const sourceFormatsMap: Record<string, ('md' | 'pdf' | 'docx')[]> = {};
  const unitTypesMap: Record<string, UnitType[]> = {};
  const validationStatusMap: Record<string, ImportStatus> = {};
  const yearRecords: YearManifestEntry[] = [];

  for (const year of EXPECTED_YEARS) {
    const yearPaperDir = path.join(dataDir, 'papers', String(year));
    const versionFiles = fs.existsSync(yearPaperDir)
      ? fs
          .readdirSync(yearPaperDir)
          .filter((f) => /^v\d+\.json$/.test(f))
          .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
      : [];

    if (versionFiles.length === 0) {
      pendingYears.push(year);
      validationStatusMap[String(year)] = 'pending';
      yearRecords.push({
        year,
        status: 'pending',
        latestReadyVersion: null,
        latestCandidateVersion: null,
        availableVersions: [],
        sourceFormats: [],
        unitTypes: [],
        validationStatus: 'pending',
        errorCodes: [],
        missingObjectiveCount: 0,
        hasNewerCandidate: false,
        updatedAt: null,
      });
      continue;
    }

    const versionExams = versionFiles.map(
      (f) => JSON.parse(fs.readFileSync(path.join(yearPaperDir, f), 'utf8')) as Exam
    );
    const latestExam = versionExams[versionExams.length - 1];
    const readyExams = versionExams.filter((e) => e.importStatus === 'ready');
    const latestReady = readyExams.length > 0 ? readyExams[readyExams.length - 1] : null;

    const unitTypes = Array.from(
      new Set(latestExam.sections.flatMap((s) => s.units.map((u) => u.unitType)))
    );

    sourceFormatsMap[String(year)] = latestExam.sourceFormats;
    unitTypesMap[String(year)] = unitTypes;

    if (latestReady) {
      availableYears.push(year);
      latestReadyVersion[String(year)] = latestReady.dataVersion;
      validationStatusMap[String(year)] = 'ready';
      yearRecords.push({
        year,
        status: 'ready',
        latestReadyVersion: latestReady.dataVersion,
        latestCandidateVersion: latestExam.dataVersion,
        availableVersions: versionExams.map((e) => e.dataVersion),
        sourceFormats: latestReady.sourceFormats,
        unitTypes,
        validationStatus: latestExam.importStatus,
        errorCodes: latestExam.validationReport.errorCodes,
        missingObjectiveCount: latestExam.validationReport.missingObjectiveQuestions.length,
        hasNewerCandidate: latestExam.dataVersion !== latestReady.dataVersion,
        updatedAt: latestExam.updatedAt,
      });
    } else {
      failedYears.push(year);
      validationStatusMap[String(year)] = latestExam.importStatus;
      yearRecords.push({
        year,
        status: latestExam.importStatus,
        latestReadyVersion: null,
        latestCandidateVersion: latestExam.dataVersion,
        availableVersions: versionExams.map((e) => e.dataVersion),
        sourceFormats: latestExam.sourceFormats,
        unitTypes,
        validationStatus: latestExam.importStatus,
        errorCodes: latestExam.validationReport.errorCodes,
        missingObjectiveCount: latestExam.validationReport.missingObjectiveQuestions.length,
        hasNewerCandidate: false,
        updatedAt: latestExam.updatedAt,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const manifest: PapersManifest = {
    schemaVersion: '1.0.0',
    buildTime: nowIso,
    expectedYears: EXPECTED_YEARS,
    availableYears,
    pendingYears,
    failedYears,
    latestReadyVersion,
    sourceFormats: sourceFormatsMap,
    unitTypes: unitTypesMap,
    validationStatus: validationStatusMap,
    years: yearRecords,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(dataDir, 'papers-manifest.json'), manifestJson);
  fs.writeFileSync(path.join(publicDataDir, 'papers-manifest.json'), manifestJson);

  const sourceManifestJson = JSON.stringify(
    {
      schemaVersion: '1.0.0',
      generatedAt: nowIso,
      files: sourceManifestEntries,
    },
    null,
    2
  );
  fs.writeFileSync(path.join(dataDir, 'source-manifest.json'), sourceManifestJson);
  fs.writeFileSync(path.join(publicDataDir, 'source-manifest.json'), sourceManifestJson);

  return { manifest, builtExams, reports };
}
