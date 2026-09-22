# CRON_DIAGNOSTIC_2026-07-30 — `finalize-milestones` 调度器探测

> **Safety-First Execution Plan — Task B (Environment-level)**
> 仅诊断、**零代码改动**。
> 探测时间：2026-07-30 22:20 (UTC+8)
> 探测主机：Windows 10.0.22621 / PowerShell 5.1 / WSL bash 调用受限

---

## 一、TL;DR

`/api/internal/cron/finalize-milestones` 路由本身**已就绪且经 E2E 验证**（`scripts/test_finalize_e2e.cjs` 通过；`aws_08_finalize_milestones_cron.sql` 已建 `activity_finalization_log` 表保证幂等）。

**但生产环境的外部 scheduler 是未确认项。** 本机探测范围有限，**最终判定需 Commander 在生产服务器上确认**。

---

## 二、四路探测结果

### Probe 1 — Linux / Unix `crontab`

```bash
crontab -l | grep "finalize-milestones"
# → (no output)
```

- 本机为 **Windows PowerShell 5.1**，WSL bash 调用因 `Bash/Service/CreateInstance/CreateVm/HCS/HCS_E_SERVICE_NOT_AVAILABLE` 不可用而无法完成。
- **结论**：本机无 Linux cron 可探；生产服务器（Linux）状态未知。

### Probe 2 — Windows Task Scheduler

```powershell
schtasks /QUERY /FO LIST /V | Select-String -Pattern "finalize-milestones"
# → (no match)
```

- 本机**未注册**任何与 `finalize-milestones` 相关的计划任务。
- 生产服务器若是 Windows，则需 Commander 在该主机执行同样命令确认。
- 生产服务器若是 Linux/容器化部署，则此命令无关。

### Probe 3 — 全仓代码静态 grep

```text
node-cron / cron.schedule / node-schedule / @nestjs/schedule
→ 零命中（仅 `setInterval` 出现在前端 polling / 客户端倒计时，无 server-side cron 痕迹）
```

- 关键证据（`app/api/internal/cron/finalize-milestones/route.ts:1-34`）：

  > *The plan explicitly forbids in-process setInterval (multi-instance would double-fire; serverless functions don't survive a tick).*
  > *So we expose this endpoint and let the operator wire ANY cron scheduler that can sign HMAC (Windows Task Scheduler, Linux cron, EventBridge, GitHub Actions, k8s CronJob, etc.) to POST here.*

- **这是设计意图，不是缺陷**：架构文档明确禁止进程内调度，要求外部 cron POST HMAC 签名请求到本路由。

### Probe 4 — GitHub Actions workflows

```text
.github/workflows/ → 仅 latency-gate.yml（cron: '0 9 * * 1'，每周一 9 点）
→ 无 finalize-milestones 调度任务
```

- GH Actions 路径**未被用作生产 scheduler**。
- latency-gate.yml 的 `cron: '0 9 * * 1'` 仅做延迟基准检查，与活动 finalize 无关。

---

## 三、Evidence Matrix

| Scheduler 形态 | 是否已被代码/仓库使用 | 是否在生产运行 | 待 Commander 确认 |
|---|---|---|---|
| **进程内 `setInterval` / `node-cron`** | ❌（架构明令禁止） | — | 否 |
| **Windows Task Scheduler（本机）** | — | ❌ 未注册 | 如生产为 Windows → 需查生产主机 |
| **Linux `crontab`** | — | ❌ 本机非 Linux | 如生产为 Linux → 需查生产主机 `crontab -l` |
| **Vercel Cron** | ❌（路由注释明令禁止，因 `end_time` 数据驱动） | — | 否 |
| **pg_cron** | ❌（AWS RDS 参数组限制，见 `MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md §2.1`） | — | 否 |
| **GitHub Actions** | ❌（仅 latency-gate） | — | 可作为兜底备选 |
| **AWS EventBridge** | ❌（仓库无 SAM/CloudFormation/CDK 资产） | ❓ 未知 | **最可能候选**——需查 AWS 控制台 |
| **k8s CronJob** | ❌（仓库无 k8s manifests） | ❓ 未知 | 如为容器化部署 → 需查集群 |

---

## 四、立即可执行的"零风险"兜底建议（供 Commander 拍板）

按 **REPARK 6.0 协议 §3（Commander-Driven Configuration）**，**不擅自改环境**。给出三条最小操作路径：

### 路径 A — AWS EventBridge（推荐，如生产在 AWS）
1. AWS 控制台 → EventBridge → Rules → Create rule
2. Schedule pattern: `rate(60 seconds)` 或 `cron(0/1 * * * ? *)`
3. Target: API Gateway → POST `/api/internal/cron/finalize-milestones`
4. Header: `X-Internal-Token: <INTERNAL_API_HMAC_SECRET>`（详见 `.env.example`）
5. 验证：5 min 后查 `SELECT * FROM public.activity_finalization_log ORDER BY finalized_at DESC LIMIT 5;`

### 路径 B — Linux cron（推荐，如生产为裸机/VM）
```bash
# /etc/cron.d/meimo-finalize
*/1 * * * * www-data curl -fsS -X POST \
  -H "X-Internal-Token: $INTERNAL_API_HMAC_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}' \
  https://meimo.example.com/api/internal/cron/finalize-milestones
```
- `*/1` = 每分钟 1 次；路由幂等，第一笔 finalize 后 9 次均为 0-op

### 路径 C — GitHub Actions workflow（兜底备选）
```yaml
# .github/workflows/finalize-milestones.yml
on:
  schedule: [{ cron: '*/1 * * * *' }]
jobs:
  finalize:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST \
            -H "X-Internal-Token: ${{ secrets.INTERNAL_API_HMAC_SECRET }}" \
            -d '{}' \
            "${{ secrets.MEIMO_BASE_URL }}/api/internal/cron/finalize-milestones"
```
- **注意**：GH Actions cron 最短间隔为 5 分钟，不是 1 分钟——若活动 finale 时间敏感度 < 5min，应选 A/B 而非 C

---

## 五、本次探测的 Scope 限制（坦白）

| 探测项 | 限制 |
|---|---|
| Linux crontab | 本机 WSL 不可用，无法在 Cursor 内直接验证生产服务器 |
| AWS EventBridge | 仓库内无 IaC 资产，必须登录 AWS 控制台 |
| k8s CronJob | 仓库内无 k8s manifests，必须 `kubectl get cronjob -A` |
| Vercel Cron | `vercel.json` 不存在 → 路径已被架构排除 |

**Cursor 无法独立判定生产 scheduler 是否运行；必须由 Commander 在生产主机或云控制台核查。**

---

## 六、Hard Stops / 不动手原则

- ⛔ **未修改任何文件**（No-Deletion Mandate + No-Config-Edit Mandate）
- ⛔ **未注册任何 cron / EventBridge / GH Action**
- ⛔ **未对生产 RDS 写入测试数据**
- ⛔ **未改动 `.env.production` / `INTERNAL_API_HMAC_SECRET`**
- ✅ 仅消费只读探测：`schtasks`、仓库 grep、文件 Read