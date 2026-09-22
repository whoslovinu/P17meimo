# REPARK v7.0 ACTIVE CONTEXT

## Current System State

| Attribute | Value |
|-----------|-------|
| **System Version** | REPARK v7.0 (7 Agent / Single Source of Truth) |
| **Phase Status** | Phase 2 Complete; Phase 2.5 SUPERSEDED by Production Baseline Recovery 2026-09-10 |
| **Operating Mode** | PRODUCTION (effective, reconciled — see Recovery section below) |
| **Repository State** | MIXED — REPARK OS + product co-resident (extraction planned) |
| **Architecture Standard** | 7 Agents + 4-Layer Memory + 3 Modes |
| **Authority** | Commander (you) |

## Active Components

### Core OS (Always Read First)
1. `park-os/CONSTITUTION.md` — 8 Articles, Three Laws, Agent Boundaries
2. `park-os/PRIORITY.md` — 5-level hierarchy + Veto Matrix
3. `park-os/MODES.md` — PROTOTYPE / PRODUCTION / ENTERPRISE rules

### Agents (7)
- `park-os/agents/00_market_agent.md` — Market Intelligence
- `park-os/agents/01_product_agent.md` — Product Architect
- `park-os/agents/02_system_agent.md` — System Architect
- `park-os/agents/03_engineer_agent.md` — Engineer
- `park-os/agents/04_quality_agent.md` — Quality Guardian
- `park-os/agents/05_deployment_agent.md` — Deployment Operator
- `park-os/agents/06_growth_agent.md` — Growth Operator

### Memory (4 Layers)
- `park-os/memory/ACTIVE_CONTEXT.md` — This file (shared writable)
- `park-os/memory/ARCHITECTURE_ADR.md` — System Architect only
- `park-os/memory/EXECUTION_LOG.md` — Engineer only
- `park-os/memory/CUSTOMER_MEMORY.md` — Growth only

### Workflows
- `park-os/workflows/agent_activation_rules.md` — Which Agent to activate

### Cursor Configuration (Auto-loaded by Cursor)
- `.cursorrules` — v7 root entry point
- `.cursor/ignore` — Allowlist for Cursor
- `.cursor/rules/01-code-integrity.mdc` — Blast radius, type safety
- `.cursor/rules/02-context-anchor.mdc` — Context management
- `.cursor/rules/03-tech-and-ui.mdc` — Design tokens, UI

### Legacy
- `archive/v6/` — v6 historical intelligence (read-only reference)

## Folder Roles (Who Reads What)

| Path | Read by Cursor? | Read by Architect AI? |
|------|-----------------|----------------------|
| `.cursorrules` | ✅ Auto-loaded | 📖 Reference |
| `.cursor/rules/*.mdc` | ✅ Auto-loaded | 📖 Reference |
| `.cursor/ignore` | ✅ Internal config | 📖 Reference |
| `brain/` | ❌ Blocked | ✅ Architect AI's reading room |
| `bootstrap/` | ❌ Blocked | ✅ Injection guide |
| `archive/` | ❌ Blocked | ✅ v6 historical reference |
| `park-os/CONSTITUTION.md` | ✅ Allowed | ✅ Reference |
| `park-os/PRIORITY.md` | ✅ Allowed | ✅ Reference |
| `park-os/MODES.md` | ✅ Allowed | ✅ Reference |
| `park-os/agents/*.md` | ✅ Allowed | ✅ Agent specs |
| `park-os/memory/*.md` | ✅ Allowed | ✅ 4-layer memory |
| `park-os/workflows/*.md` | ✅ Allowed | ✅ Activation rules |

**Architectural principle**: REPARK is an Agent Operating System, not a
project container. Projects live in their own repos and inject REPARK via
`bootstrap/` instructions.

## Boot Test Result (2026-09-06) — SUPERSEDED

> ⚠️  This result was based on an incomplete static scan and has been superseded.
> See: `## Production State Reconciliation — 2026-09-10`

| Check | Prior Status | Current Status (2026-09-10) |
|-------|-------------|----------------------------|
| Agent Registry (7 agents) | PASS | PASS |
| Memory Layer (4 files) | PASS | PASS |
| Cursor Rules (3 mdc + .cursorrules) | PASS | **FAIL** — .mdc files missing; see Recovery Report |
| Agent Boundary (park-os protected) | PASS | **PARTIAL** — product code co-resident with REPARK OS |
| Conflict Rules | NONE DETECTED | NONE DETECTED |
| State Drift | NOT ASSESSED | **CRITICAL DRIFT** — live production vs prior declaration |
| Working Tree | NOT ASSESSED | **DIRTY** — 25 files tracked-modified or deleted |
| Governance Artifacts | NOT ASSESSED | **GOVERNANCE DEBT** — no Product/System/Market specs |

---

## Production State Reconciliation — 2026-09-10

**Recovery Audit Conducted By:** Quality Guardian (Agent 4)
**Authority:** Commander explicit authorization, Phase 2.5 Boot Test Recovery
**Deployment Freeze:** ACTIVE

```text
REPARK_VERSION:              v7.0
EFFECTIVE OPERATIONAL MODE:  PRODUCTION
REASON:                      live application is serving real production traffic
                              on 98.93.252.250 since at least 2026-08-26
                              (BUILD_ID Lt46VLBzna8WzR9Kp-rHC, built 2026-09-04)
                              Active customer sessions logged 2026-09-10
                              Active webhook traffic 2026-09-10

Repository State:            MIXED — REPARK OS files and product application
                              co-resident at workspace root
                              (violates .cursorrules design intent)
                              Repository extraction plan drafted; pending execution

Phase 2.5:                   FAIL — multiple critical issues block deployment readiness
Phase 2.5 Recovery:          IN PROGRESS

Current Agent:               Quality Guardian (Agent 4)
Next Gate:                   Production Baseline Recovery — AS-BUILT System Spec required
Next Agent:                  System Architect (Agent 2) — to document AS-BUILT architecture
                              then Engineer (Agent 3) — to classify dirty tree and freeze release candidate
```

### Production System Identity

| Field | Value |
|-------|-------|
| Application | H5 魅魔来袭 (repark-h5) |
| Host | `ip-172-31-80-84` (AWS EC2) |
| BUILD_ID | `Lt46VLBzna8WzR9Kp-rHC` |
| Built | 2026-09-04 20:57 UTC |
| Process | `next-server (v15.5.20)`, PID 1091224, PM2 online 5D |
| Runtime | Node.js 20.20.2, Next.js 15.5.20, React 18.3.1 |
| Database | AWS RDS PostgreSQL (us-east-1) |
| Redis | AWS ElastiCache (TLS, rediss://) |
| Git on prod | **NOT a Git checkout** — deployed via SCP without version control |

### Known Production Baseline (Source of Truth = Git HEAD 75acab5)

| Artifact | Status |
|----------|--------|
| Production vs Git HEAD | **ZERO files match** — every checked file has different SHA |
| Git HEAD | `75acab5c294c9c0957201e893c580b7a3b620bf2` (badge-phase2-release) |
| Production build | Built from non-git SCP-deployed files, not from any git commit |
| Source of Truth | **Git HEAD** — last clean deployable state with known SHA |
| Local working tree | 25 tracked files modified or deleted vs HEAD |

### Critical Findings

1. **P1-41 NOT deployed** — `retryOrFatal` / `STAGE1_RETRY_MAX` absent from production .next/
2. **P1-42 NOT deployed** — `firstFrameWatchdogRef` / `FIRST_FRAME_WATCHDOG_MS` absent from production .next/
3. **Customer stuck at 100% loading screen** — running production code without fixes
4. **No formal System Spec** — AS-BUILT documentation created during this audit
5. **No formal Quality Gate** — no Quality Guardian approval for any production release
6. **No CI/CD** — manual `pm2 reload` via SSH only

### Next Steps (Commander-Authorized)

1. **System Architect (Agent 2)** → document AS-BUILT architecture
2. **Engineer (Agent 3)** → classify 25 dirty files; identify release candidate
3. **Quality Guardian (Agent 4)** → run Quality Gate on frozen release candidate
4. **Commander** → approve/reject deployment of candidate after Quality PASS
5. **After stabilization** → execute Repository Extraction Plan (REPARK OS → separate repo)

### Commander Decision Queue (G1–G5)

| ID | Item | Status |
|----|------|--------|
| G1 | Market `OPPUNITY_SPEC` typo (00_market_agent.md) | Pending Commander resolution |
| G2 | EXECUTION_LOG append ownership ambiguity | Pending Commander resolution |
| G3 | System Architect park-os scope mismatch | Pending Commander resolution |
| G4 | Modern Cursor rule architecture | Deferred to REPARK extraction phase |
| G5 | REPARK → product injection mechanism | Deferred |

---

## Last Updated
- **By**: Quality Guardian (Agent 4) — Production Baseline Recovery Audit
- **Date**: 2026-09-10
- **Change**: Superseded prior Boot Test result; reconciled operational mode to PRODUCTION;
  added production identity, source-of-truth analysis, and governance debt inventory