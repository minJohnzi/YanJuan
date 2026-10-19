import path from 'node:path';
import { runPaperBuildPipeline } from '../src/pipeline/buildPipeline.ts';
import { executeBuild } from './buildAllRawAndGeneratedExams.ts';

const rootDir = process.cwd();
console.log('[build:papers] 正在运行真题导入与版本化校验流水线...');

// 1. Run versioned pipeline for initial ZIP verification & source-manifest
runPaperBuildPipeline(rootDir);

// 2. Parse raw exams (2010–2026), sync 29 visual assets, 3 source answers, and generate runtime JSONs & manifests
executeBuild();

console.log(`[build:papers] 全部 17 份真题 (2010–2026) 构建完成，输出清单已写入: ${path.join(rootDir, 'data/exams/generated/papers-manifest.json')}`);
