# 研卷台｜考研英语一真题学习系统 (Yanjuan Desk)

**研卷台 (Yanjuan Desk)** 是一套以全国硕士研究生入学统一考试**英语（一）历年真题（2010—2026 共 17 年全套题库）**为核心的结构化精读、180 分钟整卷全真模考、主观题不可变版本对比、两阶段 AI 深度批改与艾宾浩斯间隔复习系统。

---

## 一、核心特性与工程亮点

### 1. 2010—2026 全量 17 年真题题库（100% `ready` 状态）
- **完整覆盖 17 套真题（每套 52 题 / 100 分）**：
  - **Section I 完形填空（1–20 题，10 分）**：正文挖空联动高亮、词义辨析与语境证据拆解。
  - **Section II Part A 传统阅读（21–40 题，40 分）**：4 篇学术长文双栏对照，精确区分第 34 题词汇指代下划线（如 `<u>one</u>`）与翻译划线句。
  - **Section II Part B 新题型（41–45 题，10 分）**：支持七选五、段落排序（自动渲染固定段落锚点，如 2010 年固定段 `E`、2011 年固定段 `E, G` 等）与小标题匹配。
  - **Section II Part C 英译汉（46–50 题，10 分）**：全文语境高亮划线长难句，内置官方参考译文与逐句分步作答。
  - **Section III 写作 Part A（51 题，10 分）& Part B（52 题，20 分）**：完整收录小作文审题指令、大作文 **29 张原版高清图画/图表插图**（含双图及合成视图）与精品参考范文。
- **确定性题库构建与 19 项发布前校验**：
  - 所有题库均经 `paperValidator` 执行题号连续性、分值守恒、选项完备性、固定段落冲突检测、插图路径核验及客观题答案完备性校验，生成可追溯的 `papers-manifest.json` 与逐年验证报告。

### 2. 主观题不可变版本树（V1 原稿 → V2 修改稿 → V3 延时重写）
- 翻译（46–50）、应用文（51）与图画作文（52）支持 **「独立作答」「引导练习」「复盘改写」** 三种训练模式。
- 每次提交均生成不可变版本节点，支持任意两个版本之间的 **词级 Diff 增删对比**，清晰追踪从初稿、根据批改清单润色到隔日重写的提分轨迹。

### 3. 两阶段主观题 AI 批改与原文字符偏移核验
- **Stage 1 Analyzer（初评分析器）**：输出中心参考分、分数区间、分维度诊断、原文字符偏移批注（`[startOffset, endOffset]`）与优先级修改清单。
- **Stage 2 Reviewer（复核把关器）**：独立审查初评是否存在幻觉引用、评分畸高/畸低或漏判要点；若 Stage 2 超时或异常，系统自动保留 Stage 1 结果并标注 `provisional-stage2-failed`。
- **服务端强校验**：后端强制验证每条批注的 `quotedUserText` 与 `[startOffset, endOffset]` 切片是否严格匹配用户原文，拒绝任何伪造引用。

### 4. 安全防线与无外部依赖的诚实降级
- **API 密钥安全（AES-256-GCM + AAD）**：用户个人模型密钥使用 `AES-256-GCM` 加密存储，并将 `uid` 与 `provider` 绑定为附加认证数据（AAD），接口响应永远只返回掩码（如 `sk-••••••••9876`）。
- **SSRF 纵深防御**：自定义 OpenAI 兼容接口强制校验 `HTTPS`，拦截 `localhost`、回环地址、RFC1918 私网网段、云元数据地址（`169.254.169.254`）及 DNS 重绑定攻击。
- **全局密钥权限隔离**：服务端环境变量中的全局模型密钥严格限制在 `OWNER_UIDS` 白名单内，普通用户越权调用立即返回 `403 OWNER_KEY_FORBIDDEN`。
- **开箱即用的本地降级模式**：
  - 未配置 Firebase 时自动运行于 **「访客本地模式（浏览器本地持久化）」**，支持全量学习记录 JSON 一键导出与导入备份。
  - 未配置 AI 模型密钥时，所有真题刷题、180 分钟整卷计时模考、客观题自动判分、官方参考译文/范文对照、错题本与艾宾浩斯间隔复习功能 **100% 正常运行**。

---

## 二、2010—2026 真题题库一览

| 年份 | 试卷标题 | 状态 | 客观题 (1–45) | 翻译与写作 (46–52) | Part B 类型 / 固定段 | 大作文插图 |
| :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| **2010** | 2010年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `E`） | 1 张 |
| **2011** | 2011年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `E, G`） | 1 张 |
| **2012** | 2012年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 七选五完形填句 | 1 张 |
| **2013** | 2013年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 七选五完形填句 | 1 张 |
| **2014** | 2014年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `A, E`） | 3 张 |
| **2015** | 2015年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 七选五完形填句 | 1 张 |
| **2016** | 2016年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 小标题匹配 | 3 张 |
| **2017** | 2017年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `B, D`） | 3 张 |
| **2018** | 2018年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `C, F`） | 1 张 |
| **2019** | 2019年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `B, E`） | 1 张 |
| **2020** | 2020年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 小标题匹配 | 3 张 |
| **2021** | 2021年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 七选五完形填句 | 1 张 |
| **2022** | 2022年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `A, E`） | 1 张 |
| **2023** | 2023年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 段落排序（固定段 `D, G`） | 1 张 |
| **2024** | 2024年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 小标题匹配 | 3 张 |
| **2025** | 2025年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 七选五完形填句 | 1 张 |
| **2026** | 2026年考研英语（一）试题 | `ready` | 45 / 45 | 完整参考译文 + 范文 | 七选五完形填句 | 3 张 |

---

## 三、快速开始 (Quick Start)

### 1. 环境要求
- **Node.js**：`>= 20.0.0`（推荐使用 Node 20 LTS 或 Node 22 LTS）
- **包管理器**：`npm` 或 `bun`

### 2. 克隆与安装依赖
```bash
git clone <your-github-repo-url>
cd YANJUAN
npm install
```

### 3. 配置环境变量（可选）
复制环境变量模板并根据需要填写（即使不填写任何密钥，系统也可直接以本地模式启动并完整使用 2010–2026 真题库）：
```bash
cp .env.example .env
```

### 4. 启动全栈开发服务器
```bash
npm run dev
```
启动后访问 `http://localhost:3000`。

---

## 四、环境变量配置说明 (`.env`)

| 变量名 | 必填 | 默认值 / 示例 | 说明 |
| :--- | :---: | :--- | :--- |
| `APP_URL` | 否 | `http://localhost:3000` | 应用访问地址 |
| `GEMINI_API_KEY` | 否 | - | 服务端默认 Gemini API Key（仅限 `OWNER_UIDS` 站长账号可用） |
| `GEMINI_MODEL` | 否 | `gemini-3.8-flash` | 默认 Gemini 模型名称 |
| `DEEPSEEK_API_KEY` | 否 | - | 可选服务端 DeepSeek API Key |
| `DEEPSEEK_MODEL` | 否 | `deepseek-chat` | 默认 DeepSeek 模型名称 |
| `CUSTOM_OPENAI_API_KEY` | 否 | - | 可选服务端 OpenAI 兼容接口密钥 |
| `CUSTOM_OPENAI_BASE_URL` | 否 | `https://api.openai.com/v1` | 自定义 OpenAI 兼容接口地址（必须为公网 `HTTPS`） |
| `CUSTOM_OPENAI_MODEL` | 否 | `gpt-4o-mini` | 默认自定义模型名称 |
| `OWNER_UIDS` | 否 | `uid1,uid2` | 允许调用服务端全局密钥的 Firebase UID 列表（逗号分隔） |
| `CREDENTIAL_ENCRYPTION_KEY` | 否 | 64 位 Hex / 32 字节 Base64 | 加密用户个人 API Key 的服务端主密钥 |
| `VITE_FIREBASE_*` | 否 | - | 可选 Firebase 客户端配置（未配置时自动降级为访客本地模式） |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 否 | - | 可选 Firebase Admin 服务端凭证 JSON |

> **提示**：普通访客或个人学习者可直接在系统 **「设置 → AI 模型与接口配置」** 页面中填入自己的 API Key（支持仅保存在当前浏览器会话或加密存储），无需修改服务端环境变量。

---

## 五、项目目录结构

```text
├── data/
│   ├── exams/
│   │   ├── raw/
│   │   │   ├── papers/          # 2010–2026 原始结构化真题 Markdown (2010.md - 2026.md)
│   │   │   ├── answers/         # 2010–2026 官方标准答案、参考译文与高分范文 (2010.md - 2026.md)
│   │   │   └── reports/         # 逐年题库结构与答案校验报告
│   │   └── generated/           # 运行时标准试卷 JSON 与 papers-manifest.json
│   ├── papers/                  # 版本化试卷存储 (2010/v1.json - 2026/v1.json)
│   └── import-reports/          # 版本化导入核验报告
├── public/
│   ├── assets/
│   │   └── papers/              # 2010–2026 历年写作 Part B 高清原版插图资源 (共 29 张)
│   └── data/                    # 前端静态回退题库与 papers-manifest.json
├── scripts/
│   ├── buildAllRawAndGeneratedExams.ts # 2010–2026 全量真题与答案同步构建脚本
│   └── buildPapers.ts                  # 版本化真题构建 CLI 入口 (npm run build:papers)
├── src/
│   ├── components/
│   │   ├── HomeView.tsx                # 备考工作台首页（年份快速入口、待复习提醒、继续学习）
│   │   ├── PaperLibraryView.tsx        # 2010–2026 真题卷库（年份筛选、题型导航、整卷模考入口）
│   │   ├── StudyWorkspaceView.tsx      # 沉浸式精读与整卷模考工作台（双栏阅读、主观题多版本工作区）
│   │   ├── ReviewCenterView.tsx        # 错题本与艾宾浩斯间隔复习中心
│   │   ├── StatsView.tsx               # 学习诊断与能力雷达统计视图
│   │   └── SettingsView.tsx            # AI 模型配置、本地数据备份导入/导出与题库校验面板
│   ├── pipeline/
│   │   ├── zipSecurity.ts              # 压缩包防路径穿越、防 ZIP 炸弹、魔数校验与提示词注入清洗
│   │   ├── markdownParser.ts           # 考研英语一 Markdown 结构化解析器
│   │   ├── pdfAndDocxParser.ts         # PDF/DOCX 解析与乱码检测器
│   │   ├── multiSourceMerger.ts        # 多源合并与客观题答案冲突拦截器
│   │   ├── paperValidator.ts           # 19 项发布前自动校验器
│   │   └── buildPipeline.ts            # 不可变版本化题库发布流水线
│   ├── server/
│   │   ├── securityAndCrypto.ts        # AES-256-GCM 密钥加解密、SSRF 校验器、权限守卫与日志脱敏
│   │   ├── modelProviders.ts           # Gemini / DeepSeek / OpenAI-Compatible 统一适配器
│   │   ├── aiEvaluators.ts             # 两阶段主观题批改器、客观题证据句拆解与上下文追问器
│   │   └── apiRouter.ts                # /api/v1/* REST API 路由（含速率限制与幂等控制）
│   ├── services/
│   │   └── localStorageRepo.ts         # 本地持久化仓库、间隔复习调度与词级 Diff 算法
│   └── shared/
│       ├── types.ts                    # 前后端共享领域模型与 Schema 定义
│       └── schemaValidator.ts          # 运行时 JSON Schema 与批注原文偏移校验器
├── tests/                              # 基于 node:test 的全链路单元测试与安全回归测试
├── server.ts                           # Express + Vite 全栈服务入口（默认端口 3000）
└── package.json
```

---

## 六、常用命令

```bash
# 1. 启动全栈开发服务器（端口 3000）
npm run dev

# 2. 重新构建 2010–2026 全量真题题库与校验报告
npm run build:papers

# 3. 运行全量自动化测试（覆盖 17 年真题结构校验、解析流水线、加密与 SSRF 防护、API 鉴权）
npm test

# 4. TypeScript 静态类型检查
npm run lint

# 5. 构建生产环境产物（自动执行 build:papers + vite build）
npm run build

# 6. 启动生产服务器
npm start
```
