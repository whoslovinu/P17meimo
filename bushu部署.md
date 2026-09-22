# P17-H5meimo 项目生产部署手册

> 本文件是 Agent 执行生产部署的标准操作规程。每次部署前必须阅读。
> 命名约定：`bushu-<功能名>.md`（如 `bushu-错误透传修复.md`），留存于 `.audit/` 目录供复盘查阅。

---

## 目录

1. [环境速查](#1-环境速查)
2. [部署流程总览](#2-部署流程总览)
3. [详细步骤](#3-详细步骤)
   - [3.1] 准备：本地修改 + 验证
   - [3.2] 上传：文件分发到服务器
   - [3.3] 构建：source-convergence 编译
   - [3.4] 验证：Gate 8/8 + bundle 检查
   - [3.5] 快照：回滚准备
   - [3.6] 切流：PM2 reload
   - [3.7] 健康检查
4. [回滚操作](#4-回滚操作)
5. [常见问题](#5-常见问题)
6. [绝对禁止事项](#6-绝对禁止事项)

---

## 1. 环境速查

| 项目 | 值 |
|---|---|
| SSH 用户 | `ubuntu` |
| SSH Key | `keys/mercenary_h5_project.pem` |
| 服务器 IP | `98.93.252.250` |
| SSH 连接命令 | `ssh -i keys/mercenary_h5_project.pem ubuntu@98.93.252.250` |
| SCP 上传目标 | `/home/ubuntu/` |
| 源码目录（构建用） | `/var/www/source-convergence/` |
| 生产运行目录 | `/var/www/app/` |
| PM2 应用名 | `repark-h5` |
| PM2 reload 命令 | `sudo -n pm2 reload repark-h5 --update-env` |
| 回滚快照目录 | `/var/www/app/.rollback/` |
| `.env.production` 位置 | `/var/www/source-convergence/.env.production` |
| `.next` 目录所有者（构建前） | `root:root` |
| 构建命令 | `npm run build:no-lint`（在 source-convergence 内执行） |
| TSC 命令 | `/var/www/source-convergence/node_modules/.bin/tsc -p /var/www/source-convergence/tsconfig.json --noEmit` |
| 构建脚本（参考） | `agent-tools/bug102r4-build.sh` |

---

## 2. 部署流程总览

```
┌─────────────────────────────────────────────────────────┐
│  本地修改文件（tsc --noEmit 通过）                      │
│         ↓                                               │
│  SCP 上传到 /home/ubuntu/                              │
│         ↓                                               │
│  sudo cp 到 source-convergence 正确路径                │
│         ↓                                               │
│  SHA256 对比（local vs served）                         │
│         ↓                                               │
│  source-convergence: tsc --noEmit                      │
│         ↓                                               │
│  source-convergence: npm run build:no-lint             │
│         ↓                                               │
│  验证 Gate 8/8 + bundle marker 检查                    │
│         ↓                                               │
│  生产快照（rsync .next → .rollback/）                  │
│         ↓                                               │
│  rsync source-convergence/.next → /var/www/app/.next   │
│         ↓                                               │
│  sudo pm2 reload repark-h5 --update-env                │
│         ↓                                               │
│  健康检查（/api/time + /admin/users redirect）         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 详细步骤

### 3.1 准备：本地修改 + 验证

#### 本地 TypeScript 验证

```powershell
# 在本地仓库根目录执行
cd H:\PROJECT\P17_H5meimo-demo
npx tsc --noEmit -p tsconfig.json
# 期望：Exit code 0
```

#### 确认修改文件 SHA（记录供对比）

```powershell
Get-FileHash .\app\admin\users\page.tsx -Algorithm SHA256
Get-FileHash .\app\lib\fetchWithTimeout.ts -Algorithm SHA256
Get-FileHash .\app\admin\lib\adminApi.ts -Algorithm SHA256
```

#### 写部署文档（bushu-*.md）

在 `.audit/` 目录保存本次部署说明，格式参考 `agent-tools/` 下的 `.sh` 脚本。

---

### 3.2 上传：文件分发到服务器

#### 方法 A：逐个 SCP 上传（推荐，一次一个文件确保成功）

```powershell
$key = 'H:\PROJECT\P17_H5meimo-demo\keys\mercenary_h5_project.pem'
$target = 'ubuntu@98.93.252.250'

# 上传每个修改的文件
scp -i $key -o BatchMode=yes -o IdentitiesOnly=yes file1.tsx "${target}:/home/ubuntu/file1.tsx"
scp -i $key -o BatchMode=yes -o IdentitiesOnly=yes file2.ts  "${target}:/home/ubuntu/file2.ts"
# ...
```

> **注意**：不要用大 heredoc 直接在 SSH 命令里写文件内容，会遇到 bash 引号转义问题。始终用 SCP 上传。

#### 方法 B：写部署脚本上传

写一个 `.sh` 脚本包含所有 SCP 命令，通过 SCP 上传脚本，再 SSH 执行脚本。

#### 验证上传成功

```bash
ssh -i keys/mercenary_h5_project.pem ubuntu@98.93.252.250 \
  'sha256sum /home/ubuntu/file1.tsx /home/ubuntu/file2.ts'
```

---

### 3.3 构建：source-convergence 编译

#### 第一步：分发文件到 source-convergence 正确路径

```bash
# 逐个复制 + 改 owner
sudo cp /home/ubuntu/page.tsx /var/www/source-convergence/app/admin/users/page.tsx
sudo cp /home/ubuntu/fetchWithTimeout.ts /var/www/source-convergence/app/lib/fetchWithTimeout.ts
sudo cp /home/ubuntu/adminApi.ts /var/www/source-convergence/app/admin/lib/adminApi.ts
sudo chown root:root /var/www/source-convergence/app/admin/users/page.tsx \
                          /var/www/source-convergence/app/lib/fetchWithTimeout.ts \
                          /var/www/source-convergence/app/admin/lib/adminApi.ts
sudo chmod 644 /var/www/source-convergence/app/admin/users/page.tsx \
                /var/www/source-convergence/app/lib/fetchWithTimeout.ts \
                /var/www/source-convergence/app/admin/lib/adminApi.ts
```

#### SHA 对比（上传文件 vs 服务端文件）

```bash
# 在服务器上执行
for f in page.tsx fetchWithTimeout.ts adminApi.ts; do
  echo "LOCAL=$(sha256sum /home/ubuntu/$f | awk '{print $1}')"
  echo "SRV=$(sudo sha256sum /var/www/source-convergence/app/.../$f | awk '{print $1}')"
done
```

**三对 SHA 必须完全一致，才继续。**

#### 第二步：TSC 类型检查

```bash
# 在 source-convergence 内，用绝对路径（root 执行避免 tsconfig.tsbuildinfo 权限问题）
sudo /var/www/source-convergence/node_modules/.bin/tsc \
  -p /var/www/source-convergence/tsconfig.json \
  --noEmit
# 期望：无编译错误，Exit code 0
```

> **重要**：不要用 `npx tsc`（root 下 npx PATH 不含 node_modules/.bin）；用绝对路径 `/var/www/source-convergence/node_modules/.bin/tsc`。

#### 第三步：npm build

```bash
cd /var/www/source-convergence
export NODE_ENV=production

# 确保 .next 和 .env.production ubuntu 可写（如果之前是 root 持有）
sudo chown -R ubuntu:ubuntu /var/www/source-convergence/.next
sudo chown ubuntu:ubuntu /var/www/source-convergence/.env.production

# 构建
npm run build:no-lint

# 检查 BUILD_ID
cat .next/BUILD_ID
# 期望：新 ID（与旧不同）

# 查看新 chunk
find .next/static/chunks/app/admin/users -type f -name 'page-*.js'
```

---

### 3.4 验证：Gate 8/8 + bundle 检查

#### 运行 R9 verify gate

```bash
# 假设 verify_bundle.py 在 source-convergence 根目录
cd /var/www/source-convergence
python3 verify_bundle.py
# 期望：8/8 PASS，RC=0
```

#### Bundle marker 手工检查

```bash
CHUNK=$(find .next/static/chunks/app/admin/users -type f -name 'page-*.js' | head -1)
SERVER=.next/server/app/admin/users/page.js

# 里程碑 ID 列应已移除
grep -c '#m[0-9]\{6,\}' "$CHUNK"   # 期望 0
grep -c '>里程碑<' "$CHUNK"         # 期望 0

# 按钮文案
grep -c '已结算' "$CHUNK"            # 期望 >=1
grep -c '手动解锁' "$CHUNK"          # 期望 >=1
grep -c '锁定奖励' "$CHUNK"          # 期望 >=1

# 新功能 marker
grep -c 'ENERGY' "$CHUNK"            # 期望 >=1
grep -c 'MEDAL' "$CHUNK"             # 期望 >=1
grep -c '确定要解锁奖励' "$CHUNK"     # 期望 >=1
grep -c '确定要锁定奖励' "$CHUNK"     # 期望 >=1

# Banner 新文案
grep -c '修改道具数量将直接影响用户可攻击次数，请谨慎操作' "$CHUNK"  # 期望 >=1
# Banner 旧文案（必须不存在）
grep -c '修改道具数量将直接影响用户可攻击次数，所有变更记录操作日志' "$CHUNK"  # 期望 0
```

---

### 3.5 快照：回滚准备

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
SNAP=/var/www/app/.rollback/bug-$(date +%Y%m%d)-$TS
mkdir -p "$SNAP"

# 快照当前生产 .next
sudo rsync -a --delete /var/www/app/.next/ "$SNAP/.next/"
sudo cp /var/www/app/.next/BUILD_ID "$SNAP/BUILD_ID"

echo "SNAP=$SNAP"
echo "SNAP_ID=$(cat $SNAP/BUILD_ID)"
```

---

### 3.6 切流：PM2 reload

```bash
# 记录旧 BUILD_ID
OLD_ID=$(cat /var/www/app/.next/BUILD_ID)
echo "OLD=$OLD_ID"

# 记录新 BUILD_ID
NEW_ID=$(cat /var/www/source-convergence/.next/BUILD_ID)
echo "NEW=$NEW_ID"

# rsync 构建产物到生产 .next
# 方案 A：原子 swap（推荐）
mkdir -p /var/www/app/.next_swap
sudo rsync -a --delete /var/www/source-convergence/.next/ /var/www/app/.next_swap/
sudo chown -R root:root /var/www/app/.next_swap

# 验证 swap 内容
SWAP_ID=$(cat /var/www/app/.next_swap/BUILD_ID)
test "$SWAP_ID" = "$NEW_ID" || { echo "MISMATCH: $SWAP_ID != $NEW_ID"; exit 1; }

# 原子切换
sudo mv /var/www/app/.next /var/www/app/.next_old.$(date -u +%Y%m%dT%H%M%SZ)
sudo mv /var/www/app/.next_swap /var/www/app/.next

# PM2 reload
sudo pm2 reload repark-h5 --update-env

# 等待服务启动
sleep 6

# 确认状态
sudo pm2 jlist | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); p=[x for x in d if x['name']=='repark-h5'][0]; print('pid=%s status=%s' % (p['pid'], p['pm2_env']['status']))"
# 期望：pid=新pid status=online
```

---

### 3.7 健康检查

```bash
# API 时间端点
curl -sS -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/api/time
# 期望：HTTP=200，JSON 含 ok:true

# Admin 未登录重定向
curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/admin/users
# 期望：HTTP=307，Location 含 /admin/login

# 确认新 BUILD_ID 在生产
cat /var/www/app/.next/BUILD_ID
# 期望：等于 NEW_ID

# 确认新 chunk 在生产
CHUNK=$(find /var/www/app/.next/static/chunks/app/admin/users -type f -name 'page-*.js' | head -1)
echo "CHUNK=$CHUNK"
```

---

## 4. 回滚操作

### 快速回滚（最近一次快照）

```bash
# 找到最新快照
SNAP=$(ls -dt /var/www/app/.rollback/bug-* | head -1)
echo "ROLLBACK_TO=$SNAP"
echo "ROLLBACK_ID=$(cat $SNAP/BUILD_ID)"

# 停止当前
sudo pm2 stop repark-h5

# 恢复快照
sudo rsync -a --delete "$SNAP/.next/" /var/www/app/.next/
sudo chown -R root:root /var/www/app/.next

# 重启
sudo pm2 start /var/www/app --name repark-h5 -- start
# 或 reload
sudo pm2 reload repark-h5

# 健康检查
curl -sS -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/api/time
```

### 回滚后必做

1. 确认 `cat /var/www/app/.next/BUILD_ID` 等于回滚前 ID
2. `/api/time` HTTP 200
3. PM2 status online
4. 在 `.audit/` 记录本次回滚原因

---

## 5. 常见问题

### Q1: `npx tsc` 在 root 下报 "Could not write file tsconfig.tsbuildinfo: EACCES"

**原因**：tsconfig.tsbuildinfo 权限问题。  
**解决**：用绝对路径 `sudo /var/www/source-convergence/node_modules/.bin/tsc`。

### Q2: `npm run build:no-lint` 报 `.env.production` 或 `.next/trace` 权限错误

**原因**：`.next` 和 `.env.production` 是 root 持有。  
**解决**：
```bash
sudo chown -R ubuntu:ubuntu /var/www/source-convergence/.next
sudo chown ubuntu:ubuntu /var/www/source-convergence/.env.production
```
构建完成后再 `sudo chown -R root:root /var/www/source-convergence/.next`（可选，不影响运行）。

### Q3: `npm run build:no-lint` BUILD_ID 不变

**原因**：`.next` 没有写权限，Next.js 没有实际重编译。  
**解决**：执行 Q2 的 chown 后重试。

### Q4: PM2 reload 后 pid 变了但 BUILD_ID 没变

**原因**：rsync 没有执行或 swap 没有切换成功。  
**解决**：检查 `/var/www/app/.next/BUILD_ID` 是否等于 source-convergence 的新 ID。

### Q5: SSH 连接 "Connection reset by ... port 22"

**原因**：服务器 SSH 连接数限制或偶发网络问题。  
**解决**：等待 3-5 秒后重试。长时间高频率操作加 `-o ServerAliveInterval=30`。

### Q6: SSH heredoc 引号转义问题

**原因**：在 PowerShell SSH 命令里写多行 bash 代码时，引号嵌套会出错。  
**解决**：始终用 SCP 上传文件 + 单行 SSH 命令执行，不要用 heredoc 写文件内容。

### Q7: `verify_bundle.py` RC=1

**原因**：bundle 中缺少某个必需 marker，或多出了旧 marker。  
**解决**：检查哪个 marker 失败，修正代码后重新构建。

### Q8: 切流后页面 500

**原因**：新构建有运行时错误（如引用了不存在的模块）。  
**解决**：立即回滚（见第 4 节），然后本地修复后重新部署。

---

## 6. 绝对禁止事项

> 以下操作在没有 Commander 明确授权的情况下 **绝对禁止** 执行：

| 禁止操作 | 原因 |
|---|---|
| 在生产环境直接修改 `/var/www/app/` 下的 `.ts/.tsx` 文件 | 不会触发 Next.js 重编译，且重启后丢失 |
| 直接 `pm2 restart` 而不是 `pm2 reload` | restart 会导致服务短暂下线，reload 是零停机 |
| 删除 `/var/www/app/.rollback/` 下的快照 | 快照是唯一回滚手段 |
| 在生产执行 `DROP`、`DELETE`、`UPDATE` SQL | 数据不可逆 |
| 把 `.env.production` 下载到本地 | 包含生产密钥 |
| 在生产环境执行 `npm run build`（带 lint） | lint 报错会中断构建 |
| 跳过 TSC 类型检查直接 build | 可能产生隐性编译错误 |
| 不做快照就切流 | 一旦出错无法回滚 |
| 合并多次不相关的功能到同一次部署 | 增加回滚粒度，降低部署可靠性 |
| 修改 `milestone_rewards` 或 `milestone_definitions` 的 DB schema | 影响生产数据模型，必须走独立变更管理 |

---

## 附录：完整部署脚本模板

```bash
#!/bin/bash
set -euo pipefail

KEY=/path/to/keys/mercenary_h5_project.pem
TGT=ubuntu@98.93.252.250
SC=/var/www/source-convergence
APP=/var/www/app
TS=$(date -u +%Y%m%dT%H%M%SZ)

echo "== 1. 上传文件 =="
# 上传每个文件: scp -i $KEY local.tsx ${TGT}:/home/ubuntu/local.tsx

echo "== 2. 同步到 source-convergence =="
# sudo cp /home/ubuntu/file.tsx $SC/path/to/file.tsx
# sudo chown root:root $SC/path/to/file.tsx
# sudo chmod 644 $SC/path/to/file.tsx

echo "== 3. SHA 对比 =="
# for f in file1.tsx file2.ts; do
#   LOCAL=$(sha256sum /home/ubuntu/$f | awk '{print $1}')
#   SERV=$(sudo sha256sum $SC/path/to/$f | awk '{print $1}')
#   [ "$LOCAL" = "$SERV" ] || { echo "SHA MISMATCH $f"; exit 1; }
# done

echo "== 4. TSC =="
# sudo /var/www/source-convergence/node_modules/.bin/tsc \
#   -p /var/www/source-convergence/tsconfig.json --noEmit

echo "== 5. Build =="
# sudo chown -R ubuntu:ubuntu $SC/.next $SC/.env.production
# cd $SC && NODE_ENV=production npm run build:no-lint

echo "== 6. Gate =="
# python3 $SC/verify_bundle.py

echo "== 7. 快照 =="
# SNAP=$APP/.rollback/deploy-$TS
# mkdir -p $SNAP
# sudo rsync -a --delete $APP/.next/ $SNAP/.next/
# sudo cp $APP/.next/BUILD_ID $SNAP/BUILD_ID

echo "== 8. 切流 =="
# sudo rsync -a --delete $SC/.next/ $APP/.next_swap/
# sudo mv $APP/.next $APP/.next_old.$TS
# sudo mv $APP/.next_swap $APP/.next
# sudo pm2 reload repark-h5 --update-env

echo "== 9. 健康检查 =="
# curl -sS -w 'HTTP=%{http_code}\n' http://127.0.0.1:3000/api/time
# cat $APP/.next/BUILD_ID
# sudo pm2 jlist | python3 -c "..."

echo "DONE TS=$TS"
```

---

*最后更新：2026-09-18（BUG-102 round-4 部署后整理）*
