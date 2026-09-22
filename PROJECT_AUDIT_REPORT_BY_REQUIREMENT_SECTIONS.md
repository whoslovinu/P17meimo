# 项目功能审计报告（只读）

**审计范围**  
- 需求基准：
  - `H:\PROJECT\P17_H5meimo-demo\H5 000\goutong.md`
  - `H:\PROJECT\P17_H5meimo-demo\H5 000\live2D活动需求文档.html`
- 被审代码：
  - H5 主链路：`app/components/features/battle/*`、`app/api/game/*`、`app/api/action/attack/route.ts`、`app/api/battle/*`
  - 后台链路：`app/api/admin/*`、`app/admin/*`
  - 基础设施：`lib/redis.ts`、`lib/security/*`、`lib/supabaseAdmin.ts`、`lib/auth.ts`、`lib/sync.ts`

**审计方式**  
- 纯只读
- 需求板块逐段对照
- 结论分为：
  - `符合`
  - `部分符合`
  - `不符合 / 缺失`
  - `风险点`

---

## 一、需求文档板块结构识别

`live2D活动需求文档.html` 当前可识别的主板块为：

1. H5 加载页
2. H5 主战场
3. H5 每日任务
4. H5 进度奖励
5. H5 活动规则
6. 后台·活动管理
7. 后台·Banner 管理
8. 后台·活动配置
9. 后台·用户管理

本次审计按以上顺序展开。

---

# 1. H5 加载页

## 1.1 需求摘要
需求文档要求包含：
- 首次进入展示加载页
- 进度条分阶段推进
- 完成后淡出
- 重复进入不重复加载
- 加载失败有静态兜底
- 超时处理
- 活动未开始/结束时间态
- 移动端兼容

## 1.2 代码映射
主要实现位于：
- `app/components/features/battle/LoadingScreen.tsx`
- `app/components/features/battle/BattleLayout.tsx`
- `app/api/time/route.ts`
- `app/components/features/battle/ActivityEndPage.tsx`

## 1.3 审计结论
### 符合
- 有独立加载组件 `LoadingScreen.tsx`
- 存在“已加载标记”语义，项目中检索到 `battle_assets_primed` / session 级预热思路
- 有服务端时间接口 `app/api/time/route.ts`，用于倒计时校时
- 有活动结束页组件 `ActivityEndPage.tsx`

### 部分符合
- “重复进入不重复加载”能力看起来已有设计，但需要依赖实际状态管理是否统一由 `BattleLayout` 控制；从当前代码组织看是有基础，不算完全缺失
- 活动结束页存在，但“未开始页 / 倒计时页”能力没有看到明确独立组件，可能被主页面状态分支内联处理

### 不符合 / 缺失
- 需求明确要求“加载超时 > 15s 展示超时提示并提供重试按钮”，当前未看到稳定的超时 UI 闭环证据
- 需求要求“Live2D/模型加载失败时静态图兜底”，而当前项目核心渲染已转向 Spine；虽有降级思路，但“静态图兜底”不是清晰、完整、显式的产品级链路
- 需求文档写的是 Live2D，但项目已实装为 Spine 路线，这属于**需求实现偏移**，虽然 `goutong.md` 后续沟通里确实改成了 Spine 4.1

## 1.4 风险点
1. **需求文档与实现引擎不一致**  
   原需求文档是 Live2D / `pixi-live2d-display`，当前项目主实现是 SpineViewer。这不是功能 bug，但会导致验收口径偏差。
2. **超时恢复链路不完整**  
   若资源 CDN 卡死、Spine atlas/json 某个阶段长时间 pending，用户可能缺少明确 retry 路径。
3. **兜底形态偏工程级，不够产品级**  
   目前更像“失败后不崩”，未充分证明“失败后仍可稳定展示一个静态替身并继续主要流程”。

## 1.5 结论
**H5 加载页：部分符合**

---

# 2. H5 主战场

这是当前项目完成度最高、也是实现最重的板块。

## 2.1 顶部导航栏

### 需求
- 返回按钮
- 倒计时
- 规则按钮

### 代码映射
- `app/components/features/battle/TopNav.tsx`
- `BattleLayout.tsx`

### 审计结论
### 符合
- 顶部导航结构已拆分为独立组件
- 倒计时使用服务端时间校准思路，避免端侧时钟漂移
- 规则入口存在，主战场可唤起规则子页面/弹层

### 风险点
- 需要最终真机确认顶部区在刘海屏/小屏 Android WebView 下是否稳定，不属于逻辑问题，属于布局验收问题

**结论：符合**

---

## 2.2 BOSS 血条（全服共享）

### 需求
- 全服共享血条
- 实时更新
- 血量不超扣、不为负
- 里程碑节点
- 血量归零后活动不提前结束
- 后台可手动干预

### 代码映射
- `app/components/features/battle/BossHPBar.tsx`
- `app/components/features/battle/FluidSegmentHP.tsx`
- `app/components/features/battle/HeartRingHP.tsx`
- `lib/redis.ts`
- `app/api/action/attack/route.ts`
- `app/api/game/init/route.ts`
- `app/api/admin/boss/update-hp/route.ts`

### 审计结论
### 符合
- Redis 原子扣血是本项目最强实现之一，之前已审过 Lua/原子路径，具备防超扣设计
- 前端 HP 展示组件较丰富，说明 UI 方案可切换
- 后台存在 `update-hp` 路由，支持运营干预
- “归零后继续攻击”此前逻辑审计中确认已考虑

### 部分符合
- 文档建议 3s 轮询；当前项目有 init + 攻击后同步，但是否严格固定为 3s 轮询需要看 `BattleLayout.tsx` 具体定时策略
- 阶段标记 UI 与形态联动能力存在，但是否与后台配置完全动态耦合，还要看配置来源是否统一

### 风险点
1. **前端实时同步策略可能混合**
   - 一部分依赖攻击后本地更新
   - 一部分依赖初始化/轮询刷新  
   若并发高，可能出现短时视觉延迟。
2. **多种 HPBar 实现并存**
   - `BossHPBar`
   - `FluidSegmentHP`
   - `HeartRingHP`
   - `FluidArcHP`
   - `StandardHPBar`  
   说明曾有多轮 UI 实验。若生产入口未统一，后期维护易分叉。

**结论：符合（带轻度同步策略风险）**

---

## 2.3 角色区域 / Live2D（实际已为 Spine）

### 需求
- 中央角色区域
- 受击反馈
- 形态切换动画
- 背景切换
- 后台上传模型与动作映射

### 代码映射
- `app/components/features/battle/SpineViewer.tsx`
- `BattleLayout.tsx`

### 关键审计结论
### 符合
- 已明确采用 Spine 多形态注册表
- 存在各阶段独立资源、idle/attack 动作、位移偏移、阶段切换
- 之前审计已确认有明确的 destroy / cleanup 思路，内存治理优于普通 H5 动效页
- `goutong.md` 中客户后续已明确“走 spine 4.1 版本”，因此虽然与 HTML 原型名义上不一致，但**与真实沟通演进一致**

### 部分符合
- 需求文档要求后台上传 Live2D 文件包；当前后端已存在 `app/api/admin/config/spine/route.ts`，说明项目已顺应实际沟通改造为 Spine 配置，而不是严格 Live2D 文件包
- 背景切换在产品逻辑上存在，但是否每个阶段都真正由后台动态控制，而非部分前端预置，需要再看配置源细节

### 风险点
1. **需求文档资产格式未更新**
   - HTML 原型仍写 Live2D `.model3.json`
   - 实际系统已是 Spine `.json + .atlas + .png`
   - 这会导致交付文档与代码口径不一致
2. **资源兼容风险**
   - Spine 资源包规范若不统一，仍可能出现 atlas/scale/命名错配
3. **多阶段偏移量依赖人工调参**
   - `yOffset` 等配置说明角色对位仍有“美术资源依赖型”风险

**结论：符合（但与原型文档格式口径不一致）**

---

## 2.4 形态选择栏（右侧）

### 需求
- 初始形态始终可用
- HP 阈值解锁新形态
- 用户手动切换已解锁形态
- 未解锁提示“消耗血量即可解锁”

### 代码映射
- `app/components/features/battle/FormSelector.tsx`
- `BattleLayout.tsx`

### 结论
### 符合
- `FormSelector` / `FormSelectorWithLock` 已经体现“已解锁集合 + HP 锁”的建模
- 存在 `unlockedForms` 与按 form.id 控制状态的实现
- 这是明显针对“右侧形态栏”需求而建的组件

### 部分符合
- 未解锁提示文案是否完全等于需求文案，需要运行态确认
- “全平台同步解锁”的前提依赖后端 boss hp 与 form unlock 条件统一，而不是纯前端判断；目前看总体正确，但要以 `game/init` 返回配置为准

**结论：符合**

---

## 2.5 武器道具区

### 需求
- 两个道具
- A 对应消耗任务，B 对应充值任务
- 图标、名称、来源、余量
- 不足时引导去任务

### 代码映射
- `app/components/features/battle/WeaponBar.tsx`
- `BattleLayout.tsx`
- `app/api/game/init/route.ts`

### 审计结论
### 符合
- 两道具模型清晰
- 余量展示存在
- 不足时有回调引导任务弹层
- 图标已按客户沟通改成“手 / 肉棒”方向，不再是早期闪电/水滴

### 风险点
- 需求文档写“道具 A/B”，而当前项目内部命名已经转成 `item_hand` / `item_phallus`。逻辑上无问题，但若后台运营仍按旧术语操作，可能造成配置理解成本。

**结论：符合**

---

## 2.6 攻击流程

### 需求
- 立即消耗道具
- 后端计算伤害
- 前端播放受击动画、飘字、粒子
- 网络失败回滚
- 防重点击
- 并发无超扣

### 代码映射
- `app/api/action/attack/route.ts`
- `BattleLayout.tsx`
- `FloatingDamage.tsx`
- `ParticleEngine.tsx`
- `WeaponBar.tsx`

### 审计结论
### 符合
- 有前端点击防重
- 有网络异常快速拦截
- 有动画/粒子/飘字模块拆分
- 有 Redis 原子扣血
- 有失败回滚设计

### 风险点
1. **requestId 幂等口径**
   - 需求中提到前后端 requestId 幂等去重
   - 前端防重点按 `isAttacking` 没问题
   - 但后端是否对每次 attack 请求使用稳定 requestId 做幂等存储，需要比对完整实现口径  
   目前更强的是 Redis 原子扣血，不一定等于完整 requestId 幂等。
2. **动画成功块耦合**
   - 若动画严格绑定成功响应，网络慢时体验可能偏硬；但这属于交互风格取舍，不是缺陷。

**结论：符合，但“requestId 级幂等”证据不足，属于部分风险**

---

## 2.7 攻击伤害分布

### 需求
- A/B 伤害配置独立
- 后台可自由配置多段伤害值与概率
- 概率总和 100%

### 代码映射
- `app/api/game/init/route.ts`
- `app/api/admin/config/damage-weights/route.ts`
- 后台配置页对应数据结构
- `readDB()` 派生配置

### 审计结论
### 符合
- `game/init` 已返回 `propA` / `propB` 独立配置
- 后台也有专门 damage-weights 配置路由
- 与需求文档“道具 A 和 B 伤害独立配置”一致

### 风险点
- 默认 fallback 配置存在，说明当后台配置异常时，系统会回退默认值；这对可用性友好，但会让“后台配置失效”变成“静默偏差”，运营可能感知不到

**结论：符合**

---

## 2.8 底部操作按钮

### 需求
- 每日任务按钮
- 进度奖励按钮
- 红点提示

### 代码映射
- `ActionButtonBar.tsx`
- `BattleLayout.tsx`

### 审计结论
### 部分符合
- 两个主入口显然已存在
- 红点逻辑在设计上也有对应状态源
- 但要确认红点是否完全以“可领取”而非“仅有未达成任务”驱动，需要运行态或更细代码核查

**结论：部分符合**

---

# 3. H5 每日任务

## 3.1 需求
- 底部 Sheet
- 实时进度
- 消耗/充值两类任务
- 手动领取
- 次数限制
- 零点重置
- 未领取失效
- 领取防并发、防重复

### 代码映射
- `app/api/battle/task-claim/route.ts`
- `app/api/webhook/user-action/route.ts`
- `app/api/game/init/route.ts`
- `lib/mockUserDb.ts`
- 任务弹层：`SubPageModal.tsx` / `BattleLayout.tsx`

## 3.2 审计结论
### 符合
- 后端有独立 `task-claim` 路由
- 有 Redis 分布式锁防并发领取
- 有已领取态检查
- 有实时 webhook 任务累计链路
- 有 UTC+8 日期分片思路
- 手动领取的核心逻辑已存在

### 部分符合
- 需求文档写“任务完成后即时反映进度，非 T+1”，当前 webhook 实时推送链路是符合方向的，但是否覆盖所有业务源事件，要看主站联调是否完整
- 需求文档提到“未领取次日自动失效/策略可配置”，当前代码更偏“按日重置”，但“失效策略可配置”证据不强

### 风险点
1. **表结构口径存在历史包袱**
   - 注释中明确提到修正过 `task_progress` / `user_daily_tasks` 的理解
   - 说明这里是项目历史上较容易错的区块
2. **Webhook 是前置依赖**
   - 如果主站未稳定推送 consume/recharge 事件，前端任务看起来就像“没更新”
3. **活动结束后道具清零**
   - 需求有明确要求，需确认是否在结束时有统一清理任务，而不仅仅是前端显示为 0

**结论：符合，但存在“业务事件完整联调”风险**

---

# 4. H5 进度奖励

## 4.1 需求
- 展示个人累计伤害
- 展示下一奖励差值
- 展示时间线里程碑
- 电量/勋章两类奖励
- 手动领取
- 不可重复领取
- 活动结束自动发放未领奖励

### 代码映射
- `app/api/game/milestone/claim/route.ts`
- `app/api/game/init/route.ts`
- `app/admin/users/page.tsx`
- 前端奖励弹层：`BattleLayout.tsx` / `SubPageModal.tsx`

## 4.2 审计结论
### 符合
- `game/init` 返回 `milestones`
- 存在 milestone claim 路由
- 后台与用户页都能识别 `ENERGY | MEDAL`
- 已领取状态建模清晰
- 累计伤害与个人里程碑独立于全服 HP，这与需求一致

### 部分符合
- “距下一奖励还差 N 点”的前端文案能力存在可能性较高，但未直接看到独立计算块源码
- “全部完成提示”未直接核到实现文本

### 不符合 / 缺失
- **活动结束自动发放未领奖励**：这是需求里的关键点，但当前未看到明确的定时任务、收尾作业、或后台批处理链路证据  
  这是本板块最重要的缺口。

### 风险点
1. **自动发奖缺失是高风险**
   - 如果用户活动结束前未手动领取，将与需求不符
2. **勋章自动发放链路未见完整闭环**
   - 比电量更敏感，因为涉及 badge/medal 绑定与幂等

**结论：部分符合，且存在一个明显需求缺口：活动结束自动发放未领奖励**

---

# 5. H5 活动规则

## 需求
- 从主战场规则按钮弹出
- 内容由后台配置
- 支持图文/多行
- 内容为空时有空态
- 长内容可滚动

### 代码映射
- `SubPageModal.tsx`
- `BattleLayout.tsx`
- `app/api/admin/config/route.ts`
- `game/init` 活动基础信息

## 审计结论
### 符合
- 规则入口存在
- 活动基础信息中已有规则文本配置来源
- 前端具备模态/子页容器

### 部分符合
- 需求中写“支持富文本图文”，当前更像“多行文本/换行渲染”，并未看到完整富文本 schema 或安全渲染链路
- “内容为空时空态”未见明确证据

### 风险点
1. **富文本支持程度可能不足**
   - 需求写“支持图文”
   - 当前实现更接近纯文本/预排版文本
2. **空规则容错**
   - 若后台未配置，是否显示空态提示，证据不足

**结论：部分符合**

---

# 6. 后台·活动管理

## 需求
- 活动列表
- 新增活动
- 区分 Live2D/消耗类
- 编辑 / 删除 / 启用禁用
- 审计日志建议

### 代码映射
- `app/api/admin/activity/route.ts`
- `app/api/admin/activity/update/route.ts`
- `app/api/admin/activity/set-active/route.ts`

## 审计结论
### 符合
- 活动列表接口存在
- 更新接口存在
- set-active 接口存在，说明启用/禁用链路已考虑
- 支持多活动概念，而不是单活动写死

### 部分符合
- “新增活动-Live2D 类型跳转配置页”的前后端链路应具备基础，但是否完整前台页面已落地，需要后台 UI 页面文件进一步核验
- 删除操作是否有更严格二次确认，前端页需运行态确认

### 风险点
- 需求建议审计日志；项目里之前迁移中有 `admin_audit_log` 相关基础，但是否所有关键后台操作都已覆盖，不完全确定

**结论：符合**

---

# 7. 后台·Banner 管理

## 需求
- Banner 总开关
- 单条 Banner 开关
- 倒计时展示开关
- 轮播开关和轮播间隔
- 删除、新增、排序、活动跳转

### 代码映射
- `app/api/banner/route.ts`
- `app/api/admin/banners/route.ts`
- `app/api/admin/banners/update/route.ts`
- `app/api/admin/activity/update/bannerDb.ts`
- 前台 Banner：`app/components/features/home/H5Banner.tsx`

## 审计结论
### 符合
- Banner 数据表与管理数据层存在
- 检索到 `show_countdown`
- 有 banner route + admin banners route + update route
- `bannerDb.ts` 对总开关、单条开关、排序、倒计时都已有映射模型

### 风险点
1. **存在弱口令回退**
   - `app/api/banner/route.ts` 中仍有：
     - `process.env.ADMIN_SECRET_KEY || 'activity_admin_secret'`
   - 这说明 Banner 接口还残留旧的安全 fallback
   - 这属于安全问题，不是纯功能问题，但会影响后台接口可信度
2. **Banner 前台展示链路需核对总开关与单条开关优先级**
   - 数据层看起来考虑了，但最终前台是否严格按该优先级渲染，需要运行态确认

**结论：功能基本符合，但接口安全仍有残留隐患**

---

# 8. 后台·活动配置

这是后台最核心板块，当前实现覆盖度较高，但也存在最容易“功能已做、校验不足”的问题。

## 8.1 需求覆盖面
- 活动总开关
- 基础信息（名称、开始结束时间、规则说明）
- 形态管理
- 动作映射
- BOSS 血量配置
- 道具配置与伤害权重
- 重置规则
- 个人进度里程碑
- 勋章 ID 回显
- 多项输入校验

## 8.2 代码映射
- `app/api/admin/config/route.ts`
- `app/api/admin/config/live2d/route.ts`
- `app/api/admin/config/spine/route.ts`
- `app/api/admin/config/damage-weights/route.ts`
- `app/api/admin/boss/update-hp/route.ts`
- `app/api/game/init/route.ts`

## 8.3 审计结论
### 符合
- 活动配置接口体系已基本齐全
- `game/init` 已能把活动配置下发到 H5
- 道具 A/B 独立配置、伤害 rows、任务阈值、每日上限均有数据结构
- milestones 支持 ENERGY / MEDAL
- 后台 boss hp 手动更新接口存在
- Spine 专用配置接口已经顺应真实资源形态

### 部分符合
- 需求文档中写大量输入校验：
  - 开始时间 < 结束时间
  - 总血量 > 0
  - 当前血量不能负数
  - 当前血量 <= 总血量
  - 概率和 = 100
  - 勋章 ID 存在性
  - 里程碑阈值不重复
  - 非 zip 文件拦截
- 这些校验中，一部分从结构看应有，但并未在本次只读抽查中全部确认到“服务端强校验”  
  很可能有部分仍停留在前端约束或默认值兜底层。

### 不符合 / 缺失
- 文档口径仍大量写 Live2D，但项目实际上配置路由已拆到 `spine`，属于文档层不一致
- “形态切换动作”在需求中有明确项，但当前已明确看到 idle / attack_a / attack_b，是否每形态都有独立“transition/morph action”配置，证据不足

### 风险点
1. **配置校验可能不全在服务端**
   - 若只靠前端页校验，直接调 admin API 可能写入非法配置
2. **默认 fallback 过多**
   - `game/init` 存在默认 propA/propB 回退  
   - 有利于开发，但可能掩盖后台配置错误
3. **文档仍写 Live2D**
   - 运营和外包继续按 `.model3.json` 理解时会出错

**结论：大体符合，但“服务端强校验完整性”需要进一步专项审计**

---

# 9. 后台·用户管理

虽然你这次没有特别点名，但它在需求总结构中是独立板块，且当前项目确实已有实现。

## 代码映射
- `app/admin/users/page.tsx`
- `app/api/admin/user/route.ts`
- `app/api/admin/user/update/route.ts`
- `app/api/admin/user/milestone/route.ts`
- `app/api/admin/user/inventory/route.ts`
- `app/api/admin/user/reset/route.ts`
- `app/api/admin/user/force-unlock/route.ts`
- `app/api/admin/user/export/route.ts`

## 审计结论
### 符合
- 用户管理不是空壳，已具备较细粒度能力
- 能处理里程碑状态、强制发放/解锁、导出等
- 对运营人工干预支持较强

### 风险点
- 能力较多，越权风险也更高；依赖 admin 鉴权链完全可靠
- 若 `ADMIN_SECRET_KEY` / cookie guard 在某些旁路接口未统一使用，会出现后台面板强、接口弱的问题

**结论：符合，但安全边界必须专项复核**

---

# 10. 与 `goutong.md` 的交叉核验补充

## 已对齐项
### 1) Spine 4.1 路线
`goutong.md` 后续沟通已明确从 Live2D 变更为 Spine 4.1，这与当前 `SpineViewer.tsx` 实现一致。

### 2) 动作命名 `idle / attack_a / attack_b`
当前项目围绕动作映射实现的方向与沟通记录一致，尤其武器 A/B 与攻击动作绑定是主线设计之一。

### 3) 默认静音开关
此前审计已经确认默认静音机制存在，且后续临时需求“右上角声音开关默认关闭”已体现在系统设计里。

### 4) 武器图标换成“手 / 肉棒”
当前 `WeaponBar.tsx` 已按沟通迭代过，不再停留在早期闪电/水滴。

## 未完全对齐项
### 1) 原型文档仍写 Live2D
业务沟通已经变更，但静态需求文档未同步，造成验收基线分裂。

### 2) 活动结束自动发奖
沟通与 HTML 需求都强调该能力，但代码里未看到明确自动发放作业链路，是本次最值得警惕的功能缺口。

---

# 11. 总体问题清单

## A. 明确缺口
1. **活动结束后，已达标未领取的进度奖励自动发放链路未见明确实现**
2. **加载超时后的 retry 交互证据不足**
3. **规则页“富文本图文支持”证据不足，更像纯文本/多行文本**
4. **部分配置校验是否服务端强校验，证据不足**

## B. 中高风险点
1. **需求文档仍是 Live2D，代码已是 Spine**
2. **Banner 接口仍残留弱 fallback**
3. **配置默认值过多，可能掩盖后台配置错误**
4. **多版 HP 组件并存，后续维护可能混乱**

## C. 低风险但建议关注
1. 红点提示是否精确以“可领取”驱动
2. 未开始页与结束页的状态分支是否都已产品化
3. 小屏 WebView 真机布局还需一次最终验收

---

# 12. 最终审计评级

| 板块 | 结论 |
|---|---|
| H5 加载页 | 部分符合 |
| H5 主战场 | 符合 |
| H5 每日任务 | 符合 |
| H5 进度奖励 | 部分符合 |
| H5 活动规则 | 部分符合 |
| 后台·活动管理 | 符合 |
| 后台·Banner 管理 | 功能符合，但接口安全有残留风险 |
| 后台·活动配置 | 大体符合，服务端校验完整性待复核 |
| 后台·用户管理 | 符合，但依赖鉴权边界完整 |

---

# 13. 总结结论

**总体判断：当前项目已经不是“原型期”代码，而是接近可交付的完整活动系统；其中主战场、攻击、任务领取、里程碑配置、后台多模块已经具备真实业务系统特征。**

但从“严格按需求文档验收”的角度，当前最重要的三个问题是：

1. **需求文档基线与代码实现基线不一致**
   - 文档：Live2D
   - 实现：Spine  
   这需要在验收前统一口径，否则会被误判为“未按文档实现”。

2. **活动结束自动发放未领奖励**
   - 这是最明确、最实质的功能缺口嫌疑项
   - 若未补齐，会直接影响最终业务规则正确性

3. **后台配置与 Banner 等接口的服务端安全/校验完整性**
   - 功能上多数存在
   - 但仍有个别接口残留旧 fallback / 旧逻辑痕迹
   - 上线前建议再做一次“后台接口强校验 + 鉴权一致性”专项扫描
