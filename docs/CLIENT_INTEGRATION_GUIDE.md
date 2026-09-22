# Repark H5 活动端集成与自定义返回 URL 对接说明

> 版本: 1.0  ·  更新日期: 2026-08-10  ·  对接方: 主站 / App / 第三方嵌入方

---

## 一、功能概述

为满足主站 / App 嵌入或跳转 H5 活动时的个性化回跳需求，H5 战斗端现已支持**客户端动态 URL 传参**。甲方技术团队在引导用户进入 H5 时，可自主指定用户点击 **“返回”** 按钮时跳转的目标页面。

支持范围：

| 位置 | 行为 |
| --- | --- |
| 页面顶部 TopNav 左上角 `<` 返回按钮 | 已接入动态回跳 |
| 活动结束结算页 (ActivityEndPage) “返回”按钮 | 已接入动态回跳 |

---

## 二、对接与传参方式

在唤起或嵌入 H5 战斗页（`/battle`）时，只需在请求 URL 后追加 `backUrl` 或 `returnUrl` 参数即可。

### 1. 参数规范

- **支持参数名**：`backUrl` 或 `returnUrl`（二选一即可，系统优先读取 `backUrl`）。
- **参数格式**：建议将目标跳转地址进行 **URL Encode 编码**（避免参数中包含 `?` 或 `&` 导致解析截断）。
- **协议限制**：仅支持 `http:` 与 `https:` 协议；任何其它协议（如 `javascript:` / `data:` / `vbscript:`）将被静默拦截并丢弃。

### 2. 使用示例

#### 场景 A：App / Web 网页 Banner 跳转

```text
# 原始回跳地址：https://main-station.example.com/activity/center
# 编码后追加到 H5 URL 后：
https://h5-domain.com/battle?activityId=1&backUrl=https%3A%2F%2Fmain-station.example.com%2Factivity%2Fcenter
```

#### 场景 B：主站 iframe 嵌入

```html
<iframe
  src="https://h5-domain.com/battle?activityId=1&backUrl=https%3A%2F%2Fmain-station.example.com%2Fhome"
  width="100%"
  height="100%"
  frameborder="0">
</iframe>
```

#### 场景 C：使用 `returnUrl` 备选参数

```text
# 当 backUrl 已用于其他业务时，可使用 returnUrl 作为等价回退
https://h5-domain.com/battle?activityId=1&returnUrl=https%3A%2F%2Fmain-station.example.com%2Fevent%2F42
```

---

## 三、安全校验与兜底机制

为防止参数被恶意篡改或注入，H5 端内置了三层安全与兜底逻辑：

| 层级 | 防护 |
| --- | --- |
| **协议安全校验** | 系统仅允许 `http:` 与 `https:` 协议的安全 URL，任何 `javascript:` 伪协议或非法的恶意协议将被静默拦截并丢弃 |
| **URL 解析容错** | 传入的目标 URL 无法被 `new URL()` 解析时，自动走兜底跳转 |
| **缺省/异常兜底** | 若用户直接打开 H5（未传参），或传入的参数被拦截，点击返回时将自动平滑返回主站官方首页（依据环境变量 `NEXT_PUBLIC_MAIN_STATION_URL` 配置的主站域名，剥离 `/login` 路径） |
| **全局 UI 覆盖** | 页面顶部的 `<` 返回按钮与活动结束结算页的 “返回”按钮均已统一同步该逻辑 |

---

## 四、环境变量配置

服务端需正确配置以下环境变量以确保兜底逻辑生效：

```bash
# 主站登录页 URL（用于剥离 /login 路径，提取主站首页 origin）
NEXT_PUBLIC_MAIN_STATION_URL=https://your-main-station.example.com/login
```

配置示例：`NEXT_PUBLIC_MAIN_STATION_URL=https://test.aidpzm.com/login`
兜底返回：`https://test.aidpzm.com`（自动剥离 `/login`）

> ⚠️ 若该环境变量未配置，则兜底返回 H5 站点根路径 `/`。

---

## 五、变更记录

| 日期 | 版本 | 变更说明 |
| --- | --- | --- |
| 2026-08-10 | 1.0 | 首版：新增 `backUrl` / `returnUrl` 动态返回 URL 参数支持，覆盖 TopNav 与 ActivityEndPage 两处入口；新增 `env.mainStationHomeUrl()` Helper 用于安全兜底跳转 |