# 研卷台｜考研公共课真题与冲刺研习系统 (Yanjuan Desk)

**研卷台 (Yanjuan Desk)** 是一套以全国硕士研究生入学统一考试**公共课（英语一 2010—2026 共 17 年全套真题 + 2027 考研政治冲刺 8 套卷 `pol-2027-xiao8-01..08`）**为核心的 **Local-First（本地优先）** 全栈研习系统，原生支持 **Google AI Studio 单容器全栈部署**（`0.0.0.0:$PORT`，内置 `/healthz` 与 `GEMINI_API_KEY` 只读环境变量检测）。

---

## 一、核心架构与工程特性

### 1. Local-First 双端本地持久化架构（零外部云账号依赖）
- **服务端 (`node:sqlite` WAL + AES-256-GCM)**：
  - 使用 Node.js 原生内置 `node:sqlite` (`WAL` 模式) 持久化 AI Workspace、加密 API Key 凭证、多连接配置、`EvaluationRun` 审计、幂等响应缓存与服务端交卷记录，按 `X-Workspace-Id` 隔离多本地工作区。
  - 从旧版 `.json` 持久化文件无缝事务迁移并备份为 `.migrated.bak`。
- **客户端 (`IndexedDB v2` 多 Store + 外部时钟存储)**：
  - `yanjuan_desk_idb_v2` 拆分为 `meta`、`attempts`、`subjective_versions`、`subjective_evaluations`、`objective_analyses`、`review_items`、`conflicts` 7 个对象仓库，支持自动从 `v1` 单体数据迁入与历史 `paperId`/`subjectId` 字段补全，并提供 JSON 全量导入/导出备份。
  - 基于 `useSyncExternalStore` 的独立计时器 Store (`src/hooks/useTimerStore.ts`)，将 1 秒时钟跳变与正文工作区渲染彻底解耦，并采用节流写入与 `pagehide` 落盘保护。

### 2. Google AI Studio 单容器全栈部署与安全边界
- **环境自适应虚拟连接**：当部署环境注入 `GEMINI_API_KEY` 时，后端自动注册只读虚拟连接 `conn-google-aistudio-env`（`storageMode: 'server-env'`），禁止客户端覆盖或删除。
- **可选口令门禁**：配置 `SERVER_AI_ACCESS_PIN` 后，凡调用服务端内置 `GEMINI_API_KEY` 的 `/api/v1/*` AI 推理与探测请求均校验 `X-Server-AI-Pin` 请求头。
- **SSRF 与防泄题防线**：自定义 OpenAI 兼容网关强制 `HTTPS` 与 DNS 公网校验；模考模式下 `?mode=exam` 与 `/follow-up-analyses` 严格按服务端权威交卷状态拦截未交卷答案泄露。

### 3. 双学科题库与规范化主键 (`paperId` / `SubjectRegistry`)
- **规范化主键 + 向后兼容**：`src/domain/subjects.ts` 注册 `english-i`（`en1-2010`..`en1-2026`，对应传统 `2010..2026`）与 `politics`（`pol-2027-xiao8-01`..`08`，对应 `2101..2108`），同时构建 `.exam.json`（脱敏题卷）与 `.key.json`（独立答案键值）以及传统 `{year}.json`。
- **政治分析题（34–38 题）完整版控制与两阶段 AI 批改**：通过 `PoliticsAnalysisStudio` 支持 V1 原稿 → V2 修改稿 → V3 延时重写不可变版本树、词级 Diff 与政治主观题踩点批改。

---

## 二、快速开始 (Quick Start)

### 1. 环境要求
- **Node.js**：`>= 22.5.0`（推荐 Node 22 LTS / Node 24 LTS，使用原生内置 `node:sqlite`）

### 2. 安装与启动
```bash
npm install
cp .env.example .env   # 可选：填写 GEMINI_API_KEY 等环境变量
npm run dev            # 启动 Express + Vite 全栈服务，默认端口 3000
```

访问 `http://localhost:3000`，健康检查接口为 `GET /healthz`，运行环境能力探测接口为 `GET /api/v1/system/capabilities`。

---

## 三、环境变量说明 (`.env`)

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `3000` | 服务监听端口（自动绑定 `0.0.0.0:$PORT`） |
| `GEMINI_API_KEY` | - | Google AI Studio 服务端环境变量 Gemini Key（只读 `server-env` 连接） |
| `GEMINI_DEFAULT_MODEL` | `gemini-2.5-flash` | 服务端默认 Gemini 模型 ID |
| `SERVER_AI_ACCESS_PIN` | - | 可选：保护服务端 `GEMINI_API_KEY` 的访问口令（前端通过 `X-Server-AI-Pin` 传入） |
| `SQLITE_DB_PATH` | `.yanjuan/yanjuan.sqlite` | SQLite 持久化数据库文件路径 |
| `AI_KEY_ENCRYPTION_SECRET` | - | 用户个人 API Key 的 AES-256-GCM 加密主密钥（可选，支持本地自动派生持久化） |

---

## 四、目录结构概要

```text
├── data/exams/
│   ├── raw/                  # 原始 Markdown/文本试卷与答案源
│   └── generated/papers/     # {year}.json, {paperId}.exam.json, {paperId}.key.json
├── public/assets/papers/     # 历年英语写作插图资源
├── scripts/                  # buildPapers.ts / buildAllRawAndGeneratedExams.ts
├── src/
│   ├── domain/               # 零 I/O 纯领域模型：subjects / paper / ai / learning / quoteVerifier / scoringEngine / reviewScheduler
│   ├── pipeline/             # 题库解析、合并、19 项校验与版本构建流水线
│   ├── server/               # Express 路由、node:sqlite 存储、AES-GCM 安全加密、两阶段 AI 批改器
│   ├── hooks/                # useTimerStore (useSyncExternalStore 独立计时器)
│   ├── services/             # idbDatabase (IndexedDB v2), storageAndSync, localApi, theme
│   ├── components/           # 工作台、PoliticsAnalysisStudio、版本对比、复习与设置面板
│   └── shared/               # 向后兼容的 domain 导出层
├── tests/                    # node:test 题库校验、安全加固、学习规则回归测试
├── server.ts                 # Node.js + Express + Vite 单容器全栈入口
├── metadata.json             # Google AI Studio 应用能力清单
└── package.json
```

---

## 五、常用命令

```bash
npm run build:papers   # 重新构建英语一 (2010–2026) + 政治冲刺卷 (8套) 与拆分产物
npm run lint           # TypeScript 类型检查 (tsc --noEmit)
npm test               # 运行 node:test 全量自动化测试
npm run build          # 构建题库并打包前端静态资源
npm start              # 启动生产环境单容器全栈服务
```
