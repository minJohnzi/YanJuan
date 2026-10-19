# 研卷台｜考研英语一真题学习系统 (Yanjuan Desk)

以考研英语一历年真题（2010—2026 规划题库）为核心的结构化精读、整卷模拟、两阶段主观题 AI 批改与间隔复习系统。

---

## 一、核心原则与系统特性

1. **绝不伪造答案或虚构年份**：
   - 客观题（1–45 题）答案必须来自已验证的官方来源文件。
   - 初始 `inputs/2010英一.zip` 仅包含 2010 年真题 Markdown 与写作 Part B 插图 PNG，不含客观题答案。
   - 构建流水线自动完成 1–52 题完整结构解析（完形 1–20、阅读 Part A 21–40、新题型 Part B 41–45 含固定段 E、翻译 Part C 46–50、小作文 51、大作文 52，并精确区分第 34 题 `<u>one</u>` 与第 46–50 题翻译划线句），生成 `data/papers/2010/v1.json` 与 `data/import-reports/2010/v1.json`。
   - 因缺少客观题答案，`2010/v1` 状态标记为 `needs-answer-source`（稳定错误码 `OBJECTIVE_ANSWER_MISSING`），不进入 `ready` 正式可评分清单。
   - 当补充同一年官方客观题答案来源后，流水线自动创建全新版本 `v2`（状态 `ready`），绝不原地覆盖 `v1`。
2. **主观题不可变版本对比（V1 原稿 → V2 修改稿 → V3 延时重写）**：
   - 翻译（46–50）、应用文（51）与图画作文（52）支持「独立作答」「引导练习」「复盘改写」三种训练模式。
   - 每次提交均创建不可变版本，支持版本间词级 Diff 对比。
3. **两阶段主观题 AI 批改与引用偏移核验**：
   - 第一阶段 Analyzer 生成中心参考分、分数区间、维度诊断、原文字符偏移批注与改进清单；第二阶段 Reviewer 复核遗漏、引用真实性与分差稳定性。
   - 服务端强制校验每条批注的 `quotedUserText` 与 `[startOffset, endOffset]` 是否真实存在于用户提交文本中。
4. **缺少外部配置时的诚实降级**：
   - 未配置 Firebase 时自动运行于「访客本地模式（IndexedDB 持久化）」，明确标注「云同步未配置」。
   - 未配置模型密钥时所有非 AI 功能照常运行，AI 按钮明确显示「需要配置模型」。

---

## 二、目录结构

- `inputs/`：真题原始输入目录（含 `2010英一.zip`；后续放入 `2011英一.zip`—`2026英一.zip` 即可无需改代码自动构建）
- `scripts/buildPapers.ts`：命令行真题构建入口（`npm run build:papers`）
- `src/pipeline/`：
  - `zipSecurity.ts`：防路径穿越、防 ZIP 炸弹、扩展名/魔数校验、重复文件哈希拦截、文档提示词注入清洗
  - `markdownParser.ts`：考研英语一 Markdown 结构化解析器（1–52 题、Part B 固定段 E、Q34 下划线消歧、答案区分离）
  - `pdfAndDocxParser.ts`：PDF 页面级提取（含中文乱码检测与页眉页脚剥离）与 DOCX OOXML 解析器
  - `multiSourceMerger.ts`：同一年多来源（MD/PDF/DOCX）合并与客观题答案冲突拦截（`OBJECTIVE_ANSWER_CONFLICT`）
  - `paperValidator.ts`：19 项发布前自动校验器与验证报告生成器
  - `buildPipeline.ts`：版本化题库发布与 `papers-manifest.json` 生成器
- `data/` & `public/data/`：静态版本化题库 JSON、导入验证报告与题库清单
- `public/assets/papers/`：真题静态插图资源（如 `/assets/papers/2010/2010年考研英语一真题_PartB_Illustration.png`）
- `src/server/`：
  - `securityAndCrypto.ts`：AES-256-GCM 密钥加密（绑定 UID 与 Provider AAD）、SSRF 校验器（仅限 HTTPS + 拦截私有/回环/元数据 IP 与 DNS 重绑定）、`OWNER_UIDS` 权限守卫、敏感日志脱敏
  - `modelProviders.ts`：统一 `ModelProvider` 接口及 Gemini、DeepSeek、OpenAI-Compatible 适配器
  - `aiEvaluators.ts`：两阶段主观题批改器、客观题证据句拆解器、上下文追问器
  - `apiRouter.ts`：`/api/v1/*` REST API 路由（含速率限制与幂等键支持）
- `tests/`：基于 `node:test` 的自动化测试套件

---

## 三、常用命令

```bash
# 1. 运行真题导入与版本化校验流水线
npm run build:papers

# 2. 运行全部自动化测试
npm test

# 3. 类型检查与代码校验
npm run lint

# 4. 构建生产版本（先执行 build:papers 再执行 vite build）
npm run build

# 5. 启动全栈开发服务器（端口 3000）
npm run dev
```
