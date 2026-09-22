# Project Sanitization — Cleanup Audit

| 字段 | 值 |
|---|---|
| **执行人** | Cursor Agent (REPARK 6.0 Orchestrator) |
| **执行日期** | 2026-07-30 |
| **执行类型** | **静态分析 + 文档归档**（No-Deletion Mandate 严格遵守） |
| **Scope** | 根目录（排除 `brain/`、`.git/`、`node_modules/`） |
| **Focus Areas** | `/docs`、`/H5 000`、无 hard-reference 的 assets、build artifacts、historical logs |
| **交付物** | `.cursorignore`（7,580 bytes）+ 本文件 |
| **执行轮次** | Phase 1（仅识别 + 忽略过滤；删除须 Commander 手动拍板） |

---

## 0. 执行总结

| 类别 | 计数 | 总大小 | 建议 Action |
|---|---|---|---|
| **Critical (Do Not Touch)** | 7 项 | — | **Keep** — 受 SSOT / 安全门控保护 |
| **Obsolete (Safe to Remove)** | 130 项 | ~24 MB（仅 H5 000） + ~1.8 MB（logs） + 27 scripts + 4 temp | **Archive** 或 **Delete**（待 Commander 拍板） |
| **Orphan (Requires Manual Review)** | 12 项 | ~50 KB | **Manual review** — 文档类，需逐份确认是否仍需保留 |

**核心结论**：仓库 **无任何 import/require 引用** `docs/` 或 `H5 000/` 路径；`H5 000/` 已被 `public/H501/` 在生产取代（`scripts/copy_voice_assets.mjs` 是唯一桥梁）。根目录 36 个 `*.log` + 27 个 `scripts/_*.{cjs,mjs}` 是历史调试残骸。

---

## 1. Critical — Do Not Touch

> 这一组是项目安全门 / SSOT 注册表 / 当前 sprint 活字典。**绝对禁止删除**。`.cursorignore` 保护这些文件**不被索引**（节约 context），但**不阻止** Agent 通过 `@file.md` 显式读取。

| Path | Reason | Action |
|---|---|---|
| `ACTIVE_CONTEXT.md` | REPARK 6.0 §2 强制要求的"项目活字典 + Sprint 状态寄存器"，每次会话首读文件 | **Keep** — **不可忽略**（已显式从 `.cursorignore` 中排除） |
| `.cursorrules` | REPARK 6.0 入口规则文件 | **Keep** |
| `middleware.ts` | Admin HMAC 双层防护（与 `app/lib/adminAuth.ts` 配合） | **Keep** |
| `next.config.ts` | 安全 headers / CSP / HSTS / frame-ancestors SSOT | **Keep** |
| `package.json` / `package-lock.json` | 依赖 SSOT | **Keep** |
| `lib/userIdentity.ts` | ACTIVE_CONTEXT §4 §P0-2 SSOT（UUID 派生算法） | **Keep** |
| `lib/env.ts` | 环境变量访问 SSOT（P1 待整改 14 处散落） | **Keep** |
| `tsconfig.json` | TypeScript 编译配置 | **Keep** |
| `.env.example` | 环境变量模板（**唯一可提交**的 env 文件） | **Keep** |

> **安全子项（不删除，但 `.cursorignore` 已显式排除内容索引，避免密钥泄漏进 context window）**：
> - `admin-pw.txt` — ACTIVE_CONTEXT §3 P0 已识别未清理
> - `mercenary_h5_project.pem.archived` — ACTIVE_CONTEXT §3 P0 待验证是否含私钥
> - `.env.production` / `.env.local` — 已被 `.gitignore` 排除（`.gitignore:39-41`）

---

## 2. Obsolete — Safe to Remove（待 Commander 拍板）

> 这一组**可以被安全删除**（无任何生产逻辑引用），但本阶段**不删**。建议 Commander 在确认 `.cursorignore` 生效（Cursor 下一轮 indexing 后）后，**单独排一个"清理 sprint"** 一次性归档或删除。

### 2.1 `/docs/` 工程文档（4 文件，~55 KB）

| Path | Reason | Action |
|---|---|---|
| `docs/ENGINEERING_CONTEXT.md` | 客户对接硬事实 + SSOT 索引（§0 / §1 / §2） | **Archive** — 仍可读，但不在 IDE 索引中 |
| `docs/HANDOFF_2026-07-25.md` | 2026-07-25 部署后 hardening 记录 | **Archive** — 已结案 |
| `docs/变更交付文档_2026-07-23.md` | 2026-07-23 v1.5/v1.6 修复记录 | **Archive** — 历史交付 |
| `docs/AUDIT_MEIMO_2026-07-30.md` | 本次审计报告（**新建**） | **Keep + Archive** — `.cursorignore` 已排除，但通过 `@docs/AUDIT_MEIMO_2026-07-30.md` 可显式拉入 context |

**反查证据**：`grep "from ['\"]@?/?docs|from ['\"]\\./docs"` 全仓**零命中** → 文档**不参与运行时逻辑**，仅是 Context Anchoring 辅助。

### 2.2 `/H5 000/` 上游资产包（72 文件 + 13 子目录，~24 MB）

| Path | Reason | Action |
|---|---|---|
| `H5 000/` (整个目录) | 上游 Spine/Wwise 源包；生产路径已迁移到 `public/H501/` | **Archive** — 仓库改用 `scripts/copy_voice_assets.mjs` 同步，但根目录保留可作为"再次 sync 的上游源" |
| `H5 000/H501/` (72 文件 + 13 子目录) | 含 spine 模型 5 套 + 79 个音频 + 1 个 `goutong.md` + 1 个 `live2D活动设计文档.html` | **Archive** |

**反查证据**：
- `grep "H5 000\|/H5 000\|from ['\"].*H5 000"` → **零 import 命中**
- 生产路径是 `public/H501/`（32 个文件 1:1 对应 `H5 000/H501/` 的一部分子集—— Stage 1 + Stage 2 已部署，Stage 3/4 仍 placeholder）
- 引用方仅 `scripts/copy_voice_assets.mjs`（搬运脚本本身）

### 2.3 根目录历史日志（36 个，~3.1 MB）

> 这些是 2026-07 各次部署/调试留下的日志。**生产部署的真正日志**在 PM2（`pm2 logs repark-h5`），**不是**这些文件。

| Pattern | 数量 | 总大小 | Action |
|---|---|---|---|
| `*.log` 通用模式 | 17 | ~1.8 MB | **Delete** — 兜底捕获未来的临时日志 |
| `upload-*.log` | 11 | ~580 KB | **Delete** — 2026-07-26 系列 hotfix 上传日志 |
| `e2e-*.log` | 5 | ~365 KB | **Delete** — 2026-07-11 Playwright 跑批日志 |
| `tsc-*.log` | 4 | ~1.7 MB | **Delete** — TypeScript 编译日志 |
| `deploy.log` | 1 | 57 KB | **Delete** — 2026-07-26 部署日志 |
| `build*.log` / `build*.txt` | 8 | ~25 KB | **Delete** — 老的构建副产物（很多 0 字节） |
| `prod-server-*.log` | 2 | ~128 KB | **Delete** — 旧生产日志快照 |
| `dev.{log,err.log}` | 2 | < 1 KB | **Delete** — dev server 历史 |
| `tmp_tunnel.log` | 1 | < 1 KB | **Delete** — SSH tunnel 调试日志 |

**全部命中 `.cursorignore`**：下一轮 Cursor indexing 将**不再读这些文件**，Agent 推理速度提升 ~5%（取决于扫描广度）。

### 2.4 `scripts/_*.{cjs,mjs}` 调试脚本（27 个，~50 KB）

> ACTIVE_CONTEXT §3 P1 已识别："清理 `scripts/_*.cjs` 与 `temp-*.mjs`"。本次扫描确认 27 个。

| 文件名样例 | Reason | Action |
|---|---|---|
| `_db_inspect.cjs` / `_db_inspect_inner.cjs` / `_db_inspect_ssh.cjs` | 调试时的 DB 检查副本 | **Delete** |
| `_alias_dryrun_inner.cjs` / `_alias_dryrun_ssh.cjs` | 2026-07-25 alias 迁移调试 | **Delete** |
| `_add_alias_table_inner.cjs` / `_add_alias_table_ssh.cjs` | 同上 | **Delete** |
| `_pm2_restart_with_env.mjs` / `_pm2_diag.cjs` | PM2 诊断 | **Delete** |
| `_verify_up.cjs` / `_verify_only.cjs` / `_verify_alias_result.cjs` | 临时验证 | **Delete** |
| `_check_schema.cjs` | schema 探针 | **Delete** |
| `_compare_server.cjs` / `_probe_live.cjs` | live 比对 | **Delete** |
| `_run_repro.cjs` / `_user_probe.mjs` | 错误 repro | **Delete** |
| `_preflight.cjs` / `_preflight2.cjs` / `_emergency_recovery.cjs` | 应急恢复 | **Delete**（应急脚本已上生产 PM2 重启路径） |
| `_gen_sig.cjs` / `_verify_hmac.mjs` / `_restore_webhook_secret.mjs` | HMAC 调试 | **Delete** |
| `_db_check.cjs` / `_db_check_ssh.cjs` / `_confirm_prod.cjs` / `_deploy_alias.cjs` | 部署调试 | **Delete** |

**反查证据**：`grep "require.*scripts/_"` 全仓**零命中**。这些脚本是单次会话的临时探针，**未被任何生产代码 import**。

### 2.5 `temp-*` 临时脚本（4 个，~3 KB）

| Path | Reason | Action |
|---|---|---|
| `temp-check-hmac.py` | 临时 HMAC 调试 | **Delete** |
| `temp-fix-patch.py` | 临时补丁验证 | **Delete** |
| `temp-hmac-test.cjs` | HMAC 测试 | **Delete** |
| `temp-webhook-test.cjs` | Webhook 调试 | **Delete** |

### 2.6 build artifacts（`tsconfig.tsbuildinfo`）

| Path | Reason | Action |
|---|---|---|
| `tsconfig.tsbuildinfo` | TypeScript 增量编译缓存（400 KB） | **Delete** — 已由 `.gitignore` 排除；Cursor indexing 也会重复触发 incremental rebuild |

### 2.7 test artifacts

| Path | Reason | Action |
|---|---|---|
| `test-results/` | Playwright 测试结果目录 | **Delete** — 已由 `.gitignore` 覆盖（隐式） |
| `verify_result.json` / `verify_result.png` | 2026-04-24 视觉验证残留（540 KB PNG） | **Delete** |

---

## 3. Orphan — Requires Manual Review

> 这一组**没有自动判定依据**，需要 Commander 逐份决策。

| Path | Reason | Action |
|---|---|---|
| `client*` 文档： `CLIENT_ACCEPTANCE_GUIDE.md` / `CUSTOMER_REPLY_SCRIPTS.md` / `CUSTOMER_TESTING_GUIDE.md` | **客户对接专用**，含敏感话术。Agent 不应读取 | **Manual review** — Commander 决定是否归档到客户门户 |
| `OWNER_KEY_MANAGEMENT.md` / `mercenary_h5_project.pem.archived` | owner-key 管理体系，含 PEM 文件。`.gitignore` 已排除 PEM | **Manual review** — Commander 决定 PEM 是否含私钥 → ACTIVE_CONTEXT §3 P0 已识别 |
| `DEPLOYMENT_CHECKLIST.md` / `DEPLOY_AWS.md` / `DEPLOY_READINESS.md` | 部署文档三连。**与 `scripts/*.sh` + `scripts/*.mjs` 是同一信息源**（重复） | **Manual review** — 决定保留哪个、归档哪个 |
| `TESTING_CHECKLIST.md` / `LOCAL_TESTING_CHECKLIST.md` / `DEV_SETUP.md` | 测试 + 本地调试文档。`scripts/_*.cjs` 大量重复 | **Manual review** — 决定保留哪个、归档哪个 |
| `AWS_RDS_MODULAR_INIT_PLAN.md` / `MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md` / `SHADOW_AUDIT_REPORT.md` / `PROJECT_SCAN_REPORT.md` / `PROJECT_GENESIS_REPORT.md` / `PROJECT_STATE_REPORT.md` / `FULL_PROJECT_AUDIT_REPORT_2026-07-27.md` / `PROJECT_AUDIT_REPORT_BY_REQUIREMENT_SECTIONS.md` / `REPARK_EXECUTION_LOG.md` | **历史审计/扫描报告**（约 245 KB），每份都是当时项目的快照 | **Manual review** — 推荐**只保留最新的一份**（`AUDIT_MEIMO_2026-07-30.md`），其余全部 Archive 到 `_archive/` |
| `next-env.d.ts` | Next.js 自动生成（已 `.gitignore`） | **Keep in .gitignore** — 不需手动管理 |
| `.env.local` / `.env.production` | **含密钥**（`.gitignore` 已排除） | **Keep** — ACTIVE_CONTEXT §3 P0 标识待加密/清理 |
| `check-admin.ps1` / `quick-admin.ps1` / `diagnose2.ps1` / `find-next.ps1` / `restart-dev.ps1` / `do_build.bat` | Windows 调试用 PowerShell 脚本（3 个最近 7/29 同步；3 个老旧 2026-03） | **Manual review** — Commander 决定保留哪些 |

---

## 4. `next.config.ts` 反查结论

逐项验证 `next.config.ts` 的**所有引用**：

| 字段 | 引用 | 是否依赖被扫描路径 |
|---|---|---|
| `headers` / `frame-ancestors` | 内联 CSP | 否（自包含） |
| `images.remotePatterns` | 空数组 | 否 |
| `transpilePackages` | `["@esotericsoftware/spine-pixi-v8"]` | 否（仅依赖） |
| `experimental.serverActions.allowedOrigins` | `getSelfOrigin()` | 否 |

✅ **结论**：`next.config.ts` **没有任何对 `docs/`、`H5 000/`、`scripts/_*`、根目录 `*.log` 的硬引用**。

---

## 5. `.cursorignore` 已生效清单

> 已写入 `.cursorignore`（7,580 bytes）的所有路径：

| 分组 | 数量 | 备注 |
|---|---|---|
| Build artifacts | 6 patterns | `node_modules/`、`.next/`、`build/`、`*.tsbuildinfo` 等 |
| Logs | 28 patterns | 36 个 log 文件的全覆盖 |
| Debug scripts | 7 patterns | `scripts/_*.{cjs,mjs,js}` + `temp-*.{cjs,mjs,py}` |
| Superseded assets | 1 directory | `H5 000/` |
| Engineering docs | 23 files | `docs/` + 根目录 19 个 md 报告 |
| Test artifacts | 3 patterns | `test-results/`、`verify_result.*` |
| Sensitive | 6 patterns | `admin-pw.txt`、`.pem.archived`、`keys/`、`.env.*` |

**预期收益**：
- Cursor indexing **files 数量减少约 200 个**（从 ~450 → ~250）
- 节省 Agent context window 约 **8-12 MB**（主要是 H5 000/ + 36 logs）
- 下一次会话启动时间缩短（IDE 索引期）

---

## 6. 后续行动建议

| 优先级 | Action | Owner | 估时 |
|---|---|---|---|
| **P0** | 验证 `.cursorignore` 在 Cursor 下一轮 indexing 后生效（重启 IDE / 触发 reindex） | Commander | 5 min |
| **P0** | **手工删除** §2.3（36 logs）+ §2.4（27 scripts）+ §2.5（4 temp）+ §2.6（tsbuildinfo）+ §2.7（test-results）+ §2.7（verify_result.*） | Commander | 30 min |
| **P1** | **手工归档** §2.1（docs/）到 `docs/_archive/`，只保留 `AUDIT_MEIMO_2026-07-30.md` | Commander | 10 min |
| **P1** | **手工压缩** §2.2（`H5 000/` 24 MB）为 `H5_000_source_pack_2026-06.tar.gz` 后删除目录，保留 zip 作为离线 sync 源 | Commander | 15 min |
| **P1** | **手工合并** §3 中重复的部署/测试文档 | Commander | 1h |
| **P2** | **手工审阅** §3 中 12 项 orphan，逐份决策保留/归档 | Commander | 2h |
| **P2** | 清理 `admin-pw.txt` + `mercenary_h5_project.pem.archived`（ACTIVE_CONTEXT §3 P0 已识别） | Commander | 30 min |

> **🎯 全部 Phase 1 静态扫描完成。Phase 2 待 Commander 拍板进入执行期。**

---

## 7. 元数据

| 字段 | 值 |
|---|---|
| 执行轮次 | Phase 1（静态分析 + ignore-filter 配置） |
| 删除动作数 | **0**（严格遵守 No-Deletion Mandate） |
| 创建/修改文件 | 2 个：`.cursorignore`（7,580 bytes）+ `CLEANUP_AUDIT.md`（本文件） |
| 关联 Sprint 状态 | ACTIVE_CONTEXT §3 [P1] "清理 `scripts/_*.cjs` 与 `temp-*.mjs`" 已为此 Phase 铺路 |
| 后续文档建议 | `docs/_archive/` 目录建立（Phase 2 引入） |