# 全云端微信小程序改造方案（技术设计）

> **状态：待确认。本文件只描述方案，不含任何已实施的代码改动。**
> 现状数据于 **2026-11-22** 按真实工作树实测，基线：版本 `1.31.13`，`HEAD = a2dbc89`（与 `origin/main` 一致），`node _selftest.js` **818 项全绿**，`node _packtest.js` **27 项全绿**。
> 配套维护中的主线文档是 `docs/superpowers/plans/2026-10-16-current-state-permission-completion.md`；本文件是**另一个主题的新方案**，两者不冲突。

---

## 0. 一句话结论

**保留 `server.js` 里 6500 行业务逻辑和三层权限模型不动，只把「JSON 文件落盘」换成「云数据库 + 云存储」，把 `public/` 里的 8900 行 Web 前端重写为小程序前端；后端跑在微信云托管（Docker 容器），小程序用 `wx.cloud.callContainer` 走内网调用。**

这样做的直接收益：`server.js` 的 89 条接口分支、三层权限、`canDoSensitive()` 敏感动作门、原子写入与防抖落盘逻辑**一行都不用重写**，回归测试 `_selftest.js` 的 818 项可以在云端继续跑同一套断言。

---

## 1. 背景与目标

### 1.1 为什么现在做

家庭菜单目前是**局域网单机部署**：家里人在同一个 Wi-Fi 下用浏览器访问 `http://192.168.1.3:8787`。这带来三个绕不开的限制：

1. **出了家门就点不了餐** —— 在外面想告诉家里「今晚吃宫保鸡丁」必须等回家。
2. **必须有一台机器长期开着** —— 笔记本关机、断电、换网络，整个菜单就不可用。
3. **手机体验是「缩小版网页」** —— 浏览器里的 `confirm()`、文件选择、表单焦点，在手机上都很别扭。

### 1.2 本方案要交付什么

- 一个**全云端**的微信小程序：家里任何人在任何网络下，打开微信就能看菜单、点餐、改库存。
- **零第三方运行时依赖**的传统要保留：后端仍然只用 Node 原生 `http` + 原生 `crypto`，不引入 npm 包（容器镜像因此不需要 `npm install`，构建秒级完成）。
- 现有本地版**继续可用**，不强制迁移，云端与本地并行运行。

### 1.3 明确的非目标

- 不做 PWA，不做「家端服务 + 内网穿透」。
- 不改写三层权限模型的语义（超管 / 家庭管理员 / 普通成员）。
- 不引入第三方 npm 依赖到后端。
- 本方案不含 UI 设计稿，也不含 AppID、密钥等真实凭据。

---

## 2. 现状盘点（2026-11-22 实测）

### 2.1 代码规模

| 文件 | 行数 | 大小 | 角色 |
|---|---|---|---|
| `server.js` | 6534 | 305 KB | 单文件 HTTP 服务 + 全部业务逻辑 + 权限 |
| `public/app.js` | 8946 | 387 KB | 单文件 Web 前端（含 8 个视图渲染） |
| `public/index.html` | 80 | 3.5 KB | SPA 外壳 |
| `public/styles.css` | 1538 | 64 KB | 全部样式 |
| `_selftest.js` | 2884 | 189 KB | 服务端回归（818 项） |

### 2.2 接口清单

路由是 `route[0]` / `route[1]` 的 if 链（`handleAPI`，`server.js:3736`）。实测：

- **28 个一级路由组**：`account` `auth` `claim` `verify-pin` `households` `export` `backups` `ai` `dishes` `categories` `orders` `join-requests` `version` `pantry-categories` `ingredients` `state` `ingredient-presets` `my-dishes` `my-categories` `plans` `pantry` `shopping-status` `notes` `dish-votes` `upload` `settings` `import` `summary`
- **89 条「方法 × 路径」分支**
- **全部是普通 request/response**：`text/event-stream` / `EventSource` / `WebSocket` / `upgrade` 关键字在后端出现 **0 次**，前端也 **0 次**。

> **这是本方案最关键的一条事实**：没有长连接、没有 SSE、没有长轮询，意味着后端可以**原封不动**跑在容器里，小程序用 `wx.request` / `wx.cloud.callContainer` 一比一映射，不需要任何协议改造。

权限守卫分两层，写在 `server.js:4039` 起：

```js
const SUPER_ONLY = new Set(['settings', 'import', 'upload']);
const needsSuper = route[0] === 'export' || route[0] === 'backups' || route[0] === 'ai'
  || (method !== 'GET' && method !== 'HEAD' && SUPER_ONLY.has(route[0]));
const needsAdmin = (route[0] === 'households' && ...) || route[0] === 'dishes'
  || route[0] === 'categories'
  || (route[0] === 'orders' && method !== 'GET' && !(method === 'POST' && !route[1]))
  || (route[0] === 'join-requests' && method !== 'GET' && !!route[1]);
```

### 2.3 数据模型

13 个 JSON 文件（`FILES`，`server.js:781`），加 2 个不在 `FILES` 里的特殊文件：

| 文件 | 内容 | 当前实测规模 |
|---|---|---|
| `categories.json` | 分类 | 7 条 |
| `dishes.json` | 菜品（含做法、调料、图片） | 6 道 |
| `orders.json` | 点餐 | 6 条 |
| `settings.json` | 全局设置（含 `adminPin`） | — |
| `households.json` | 家庭 + 成员 | 3 个家庭 |
| `pantry.json` | 库存 | 有数据 |
| `ingredients.json` | 食材 | 有数据 |
| `pantry-categories.json` | 库存分类 | 2 条 |
| `plans.json` | 本周计划 | 有数据 |
| `shopping.json` | 采购勾选状态 | — |
| `notes.json` | 留言 + 菜品投票 `{notes, votes}` | — |
| `access.json` | 加入申请 `{requests}` | 0 条 |
| `users.json` | 全局账户 | 2 个 |
| `devices.json` | 设备令牌（**不在 `FILES`，永不进备份**） | — |
| `ai.json` | AI 配置（**含 API Key，绝不进备份**） | — |

写盘机制（`server.js:2362`）：`writeFileSync(tmp)` + `renameSync(tmp, file)` 原子替换，配合 `scheduleSave()` 防抖。

### 2.4 身份与令牌

四类会话头，**必须分开**，不能合并：

| 请求头 | 含义 | 生命周期 |
|---|---|---|
| `X-Auth-Token` | 超级管理员会话 | 会话级 |
| `X-House-Token` | 家庭管理员会话 | 会话级 |
| `X-Device-Token` | 成员设备令牌 | 30 天 |
| `X-Verified-Token` | 危险动作二次凭证 | 5 分钟 |

危险动作（`canDoSensitive()`）放行顺序：超管会话 → 本家会话 → 5 分钟内刚验过成员密码 → **这一家谁都没设密码则放行**。

### 2.5 前端 Web 专属依赖（`public/app.js` 实测计数）

| Web API | 出现次数 | 小程序替代 |
|---|---|---|
| `localStorage` | 33 | `wx.getStorageSync` / `wx.setStorageSync` |
| `document.` | 49 | 模板数据绑定 + `setData` |
| `window.` | 30 | `Page()` 生命周期 / `getCurrentPages()` |
| `innerHTML` | 29 | `{{ }}` 插值 + `<rich-text>`（少量富文本） |
| `confirm(` | 24 | `wx.showModal` |
| `addEventListener` | 14 | `bindtap` / `catchtap` |
| `setTimeout` | 4 | `setTimeout`（小程序有） |
| `type="file"` | 4 | `wx.chooseMedia` |
| `fetch(` | 2 | `wx.request` / `wx.cloud.callContainer` |
| `createObjectURL` | 2 | `wx.cloud.uploadFile` → fileID |
| `FileReader` | 1 | `wx.getFileSystemManager().readFile` |
| `navigator.` | 1 | `wx.getSystemInfoSync` |

后端 Node 专属落盘点只有 3 处 `fs.writeFileSync`（状态落盘 / `devices.json` / uploads 图片），加上 `fs.mkdirSync` 建目录 4 处。**这 7 处就是持久化层改造的全部战场。**

---

## 3. 为什么现有项目不能直接部署成小程序

| 障碍 | 说明 |
|---|---|
| 无小程序运行时 | Node 原生 `http` + `fs` 在小程序里不存在，小程序没有文件系统、没有 `http.createServer` |
| HTML/DOM 前端不可用 | `public/` 是 DOM 单页应用，小程序没有 `document`、没有 `innerHTML` |
| `wx.setStorage` 不能当数据库 | 上限 10 MB，且在**用户手机本地**，不是服务端；换个手机数据就没了 |
| 只能请求公网 HTTPS 域名 | 小程序 `wx.request` 目标必须是已在后台配置的合法域名 |
| 备案与三类白名单 | 自建服务器需要 ICP 备案（7–20 工作日），且要分别配 `request` / `uploadFile` / `downloadFile` |

---

## 4. 平台选型

### 4.1 三个候选

**A. 微信云开发（云函数 + 云数据库 + 云存储）**
- 免运维、免备案、免配 `request` 合法域名。
- 但：云函数只跑 Node/Python 函数，**没有 HTTP 服务器概念**，现有 6534 行 Express 风格路由要整体重写成函数路由，89 条分支全部重写。
- 冷启动 2–3 秒；有数据库读写配额上限。
- **结论：改造成本最高，且无法复用现有测试。**

**B. 微信云托管（CloudBase Run）**
- Docker 容器化，**跑任意 Node 服务**，`server.js` 原样丢进去就能跑。
- 容器服务对应固定 HTTPS 域名；**微信生态请求走内网接入层，自动带 `x-wx-openid`**。
- 支持定时任务；可缩容到 0（30 分钟无访问）。
- 环境变量在「服务配置 → 环境变量」里配，密钥不进代码、不进镜像。
- **结论：后端改造量最小，是本方案的选择。**

**C. 自建服务器（腾讯云轻量 / CVM）**
- 需要 ICP 备案 + HTTPS 证书 + 三类域名白名单分别配置。
- 要自己管 Node 进程守护、备份、日志、监控、升级。
- **结论：一次性成本低，但持续运维成本和「能不能过审」的风险最高。**

### 4.2 对比表

| 维度 | 云开发（云函数） | **云托管** | 自建服务器 |
|---|---|---|---|
| 免 ICP 备案 | ✅ | ✅ | ❌ 需 7–20 工作日 |
| 免配 request 合法域名 | ✅ | ✅（走 `callContainer`） | ❌ |
| 现有 `server.js` 改造量 | **全部重写** | **只换存储层** | 只换存储层 |
| 免运维 | ✅ | ✅ | ❌ |
| 自动带 `x-wx-openid` | ✅ | ✅ | ❌ 需自己换 openid |
| 冷启动 | 2–3 秒 | 3–10 秒（最小实例=0 时） | 无 |
| 数据库 | 内置云数据库 | 需单独开通云开发数据库（控制台模板有 MySQL 选项） | 需自己搭 |
| 长期成本 | 低 | 按量付费，可缩容到 0 | 固定月费 |

### 4.3 选型结论

**选 B：微信云托管（CloudBase Run）+ 云开发数据库 + 云存储。**

决策依据（按权重排序）：

1. **`server.js` 一行不用重写**是最大红利。6534 行里沉淀了 818 项回归测试覆盖的权限逻辑，重写等于把已经验证过的东西推倒重来。
2. **免备案、免配域名白名单**，配合 `wx.cloud.callContainer` 走内网，绕开了本项目最大的两个流程风险。
3. 微信自动注入 `openid`，省掉「`code2session` 换 openid + 自己维护 access_token」这一整块。
4. 后端仍是**零第三方依赖**，Docker 镜像不需要 `npm install`，构建秒级、可复现。

---

## 5. 总体架构

### 5.1 架构图

```
┌─────────────────┐
│  微信小程序      │  (重写的 miniprogram/ 前端)
│  8 个视图 → 页面 │
└────────┬────────┘
         │  wx.cloud.callContainer
         │  header: X-WX-SERVICE: family-menu
         │          X-Auth-Token / X-House-Token / X-Device-Token / X-Verified-Token
         │  （平台自动注入 X-WX-OPENID）
         ▼
┌──────────────────────────────────────────────┐
│  微信云托管 CloudBase Run（Docker）           │
│  ┌────────────────────────────────────────┐  │
│  │  server.js（6534 行，业务逻辑零改动）   │  │
│  │  ├─ handleAPI：89 条路由分支（不动）    │  │
│  │  ├─ canDoSensitive / 三层权限（不动）   │  │
│  │  └─ Store 抽象层（★ 唯一改造点）       │  │
│  └───────────────┬────────────────────────┘  │
│                  │                           │
│  ┌───────────────▼─────────┐  ┌───────────┐ │
│  │ 云开发数据库（NoSQL）     │  │ 云存储     │ │
│  │ 13 个集合 = 13 个 FILES  │  │ 菜品照片   │ │
│  └─────────────────────────┘  └───────────┘ │
└──────────────────────────────────────────────┘
```

### 5.2 请求链路

1. 小程序 `onLaunch` → `wx.cloud.init({ env })` → `wx.cloud.callContainer({ path: '/api/...' })`。
2. 微信内网接入层把请求转给云托管容器，**自动附加 `X-WX-OPENID`**。
3. 容器内 `server.js` 的 `handleAPI` 照常解析路由、跑权限守卫、读写 `state`。
4. `state` 的持久化从「写本地文件」换成「写云数据库」。

**关键点：第 3 步完全没变。** 这是整个方案成立的前提。

### 5.3 保留 `server.js` 的具体边界

| 部分 | 处理方式 |
|---|---|
| 89 条路由分支 | **完全保留** |
| 三层权限、`canDoSensitive()`、令牌校验 | **完全保留** |
| `normalizeUser` / `normMembers` / `normHousehold` 等数据规整 | **完全保留** |
| `scheduleSave()` / 原子写 | **改写为调用 Store**（接口形状不变） |
| `state` 内存态 | **保留**，但加载时机与失效策略要改（见 6.3） |
| `fs.writeFileSync` × 3 | **替换为 Store / 云存储调用** |
| `todayStr()` / `mondayOf()` 等本地日期 | **保留代码，配 `TZ=Asia/Shanghai`**（见第 10 章） |

---

## 6. 持久化层改造

### 6.1 Store 抽象

引入一个极薄的存储接口，让 `server.js` 的业务代码感知不到底层是文件还是云数据库：

```js
// server.js 里新增（示意）
const Store = {
  // 启动时把全部集合读进内存
  async loadAll() { /* → state */ },
  // 防抖落盘时调用；只传变了的 key
  async save(key, value) { /* → 云数据库 */ },
};
```

现有调用点 `scheduleSave('dishes')` **保持不变**，只是 `scheduleSave` 内部从 `writeFileSync` 改成 `Store.save`。

### 6.2 集合映射

采用**「一个 FILES 对应一个集合，每个集合一条文档存整个数组」**的映射，而不是「一条记录一个文档」：

| 理由 | 说明 |
|---|---|
| 改动最小 | `state.dishes` 在 6534 行里被读了几百次，改成文档级查询会牵动全身 |
| 原子性天然保持 | 整个数组一次写入，天然避免「写一半」 |
| 数据量匹配 | 当前 6 道菜 / 6 条点餐 / 3 个家庭，离单文档上限极远 |

**风险与对策**：数组会随使用增长（点餐、库存、计划）。当单个集合文档逼近上限时（云开发单文档约 1 MB 量级），需要拆分为「按记录存文档 + 内存聚合」。因此 Store 接口要**按集合粒度设计**，而不是按文件粒度，以便后期无痛切换：

```js
// 后期可替换为按记录存，调用方不变
Store.save('orders', orders)  →  内部决定写单文档还是逐条 upsert
```

**附带的字段调整**（不改变业务语义）：

- 每个集合文档增加 `_id: 'singleton'`（或 `meta` 段），避免云开发自动生成 `_id` 与业务主键混淆。
- `settings.json` 里的 `adminPin` 是**明文口令**。数据库里的 `adminPin` 应改为**哈希存储**（与服务端已有的 `hashUserPassword` 同款 scrypt 方案），并保留一次「明文兼容读」的迁移路径 —— 这一点比 JSON 文件时代更紧迫，因为云数据库有控制台可见性。
- `ai.json` 的 API Key **不迁移**。云上改用环境变量 `MINIMAX_API_KEY`（`loadAIConfig()` 已经优先读环境变量，`server.js:644`，零改动即可生效）。

### 6.3 内存态 `state` 与多实例

这是**云化最容易出事的地方**。`server.js` 把全部数据缓存在模块级 `const state = {}` 里。多个容器实例各有各的 `state`，会出现「A 实例改了，B 实例还拿着旧数据」的分歧。

**对策（按推荐度排序）**：

1. **固定单实例：最小副本数 = 最大副本数 = 1。**
   代价是失去自动扩容、失去高可用；收益是 `state` 永远一致，**`server.js` 的业务逻辑一行不改**。
   对家庭菜单这个量级（几个家庭、几十个成员），单实例绰绰有余。

2. **读时校验版本号。** 每次请求比对集合文档的 `rev`/版本戳，不一致就重新加载。改动大、延迟高，暂不做。

3. **改成无状态（每次请求读数据库）。** 最彻底，但要重写全部 `state.xxx` 的用法，等于重写 `server.js`。

**选 1。** 并在文档里写明：一旦将来需要多副本，必须先做方案 2 或 3，不能只把副本数调大。

**另一个必须处理的点**：云托管默认最小实例数 = 0，30 分钟无访问会缩容到零，下次请求要等 3–10 秒冷启动。对「家人随时点餐」的场景体验很差。
**对策：最小实例数设为 1**（常驻，按量付费，费用很小），并在小程序 `onLaunch` 发一个轻量 `GET /api/version` 作为预热。

### 6.4 图片：`uploads/` → 云存储

现状：`POST /api/upload` 接收 base64 dataURL，写到本地 `uploads/`，返回 `/uploads/xxx.png`。**容器文件系统是临时的**，本地路径在云上完全无效。

**改法（推荐：图片根本不过容器）**：

1. 小程序用 `wx.cloud.uploadFile` 直接把图片传到云存储，拿到 `fileID`。
2. 小程序把 `fileID` 随菜品表单一起提交。
3. 服务端只存 `fileID` 字符串，**不接触图片字节**。

好处：容器不做 base64 解码（省内存、省 CPU），图片也不占容器磁盘。`<image src="{{fileID}}">` 可直接渲染云存储 fileID。

**保留兼容**：服务端 `POST /api/upload` 仍然保留，接受 dataURL，但内部改为写云存储并返回 fileID（这样已有的 Web 前端不用改也能用）。**注意 `upload` 在 `SUPER_ONLY` 里**（`server.js:4044`），需要调整权限，否则普通成员无法上传 —— 这一点在实施阶段一并处理。

### 6.5 备份与导出

现状 `GET /api/export` 返回一个**内存中打包的 ZIP 流**（`server.js:6223`），包含全部数据 + 照片。`POST /api/import` 接受 ZIP 还原。

云上的问题：

- 容器**没有持久磁盘**，备份 ZIP 不能像现在这样写在 `backups/` 目录。
- 流式返回大文件经过网关，可能被超时掐断。

**改法**：

- 备份 ZIP 生成后**存到云存储**，返回 `fileID` 而不是二进制流。小程序侧用 `wx.cloud.downloadFile` + `wx.openDocument` 打开。
- 备份记录本身（时间、文件 ID）写进一个云数据库集合 `backups`。
- 定时备份：云托管支持定时任务，可以配一个每日 cron 自动生成备份并写云存储。

### 6.6 设备令牌

`data/devices.json` 存在**文件系统**里，**永远不进备份**。云上改存为一个云数据库集合，同样**排除在备份/导出之外**。

注意：本地版是「30 天设备令牌」，云端多端登录场景一样，`X-Device-Token` 的语义不变。

### 6.7 密钥与环境变量

| 密钥 | 现状 | 云上 |
|---|---|---|
| `MINIMAX_API_KEY` | `data/ai.json` | 环境变量（`loadAIConfig()` 已优先读环境变量，**零代码改动**） |
| `adminPin` | `settings.json` 明文 | 改哈希存储 |
| 云环境 ID / 服务名 | — | 小程序编译期常量注入，不写死在业务代码里 |
| 数据库凭据 | — | 环境变量（云托管内部访问通常不需要显式密码，但要确认实际连接方式） |

**Docker 镜像里绝对不能有 `data/ai.json`。** 仓库里已经踩过这个坑（提交 `9bc0335` 修过一次），云上要用 `.dockerignore` 再挡一次。

---

## 7. 身份与权限在云上的落点

### 7.1 openid 从哪来

云托管接入层在微信生态请求上自动注入 `X-WX-OPENID`（同时还有 `X-WX-UNIONID`、`X-WX-APPID`）。

> **待落地确认**：该 header 的确切大小写与注入条件（是否所有 `callContainer` 请求都有、是否仅限微信通道）需要在首次联调时抓包核对。备选方案是服务端调微信接口用 `code` 换 openid，但那样要自己维护 `access_token`，不推荐。

### 7.2 账号绑定

现有 `users.json` 的账户是「登录 ID + 密码」。小程序端不需要用户记密码，所以新增一条**微信身份绑定**路径：

```
小程序 onLaunch
  → POST /api/account/wechat-login   （新增接口）
      请求头带 X-WX-OPENID（平台注入）
      服务端：openid 已绑定 → 返回现有 accountToken
              openid 未绑定 → 创建/绑定一个用户，返回 accountToken
  → 之后所有请求带 X-Auth-Token
```

**数据模型变更**：`users[]` 的每个用户增加 `openid` 字段。

**要保留的能力**：即使在微信里，也允许「家人用另一个人的身份操作」（比如妈妈用自己微信、爸爸用妈妈账号点餐）。所以绑定不强制 —— 一个 openid 可以绑定到多个用户，登录时让用户选「用微信身份」还是「用登录 ID + 密码」。

### 7.3 三层身份模型不变

`server.js` 里的权限判断逻辑**完全不改**：

- 超级管理员（`adminPin`）→ 所有家庭 + 共享菜单 + 系统设置 / AI / 备份 + 家庭启停
- 家庭管理员（`household.pin`）→ 共享菜单 + 本家私菜 + 本家成员 + 本家申请审批
- 普通成员（成员 `password`）→ 只能改 `authorId` 是自己的

云上唯一的变化是：**多了一个 openid 维度的登录入口**，它最终仍然兑换成同一套 `X-Auth-Token` / `X-House-Token` / `X-Device-Token`。下游逻辑感知不到。

### 7.4 危险动作凭证

`X-Verified-Token` 5 分钟有效期、`canDoSensitive()` 的放行顺序，**逻辑不变**。小程序侧只是把 `prompt()`/`confirm()` 换成 `wx.showModal` 的输入框模式（`editable: true`）。

---

## 8. 接口映射

### 8.1 `callContainer` 调用约定

```js
// 小程序端统一封装
function api(method, path, data, headers = {}) {
  return wx.cloud.callContainer({
    config: { env: CLOUD_ENV },
    path,                       // 必须以 / 开头，如 '/api/dishes'
    method,                     // 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    header: {
      'X-WX-SERVICE': 'family-menu',
      'Content-Type': 'application/json',
      ...headers,                // X-Auth-Token / X-House-Token / X-Device-Token / X-Verified-Token
    },
    data,                       // GET 时放 query，POST/PUT 时放 body
    timeout: 15000,             // callContainer 上限 15 秒
  }).then(res => {
    if (res.data && res.data.ok === false) throw new Error(res.data.error || '请求失败');
    return res.data ? res.data.data : null;
  });
}
```

### 8.2 需要特殊处理的接口

| 接口 | 小程序侧做法 |
|---|---|
| `POST /api/upload` | 改用 `wx.cloud.uploadFile` 直传云存储，服务端只收 fileID（见 6.4） |
| `GET /api/export` | 返回云存储 fileID → `wx.cloud.downloadFile` + `wx.openDocument` |
| `POST /api/import` | `wx.chooseMessageFile` 选 ZIP → 传 fileID，服务端从云存储读 |
| `POST /api/ai/chat` | **同步长请求，必须改造成异步任务**（见 8.3） |
| `GET /api/state` | 单次拉全量，接近现有前端行为；数据量增长后需分页 |
| `GET /api/version` | 兼作冷启动预热探针 |

### 8.3 三个平台硬约束（必须专门设计）

#### 约束一：`callContainer` 的 `timeout` 上限 15 秒

现有 `POST /api/ai/chat` 是**同步长请求**：`loadAIConfig()` 默认 `timeoutMs: 45000`（`server.js:664`），`callAI()` 用 `AbortController` 控超时。走 `callContainer` 会被网关在 15 秒掐断，而**容器里的 AI 请求还在跑**（服务端视角是成功的，用户视角是失败）。

**改法：改成「提交任务 → 轮询结果」两段式。**

```
POST /api/ai/chat        → { taskId }        （毫秒级返回）
GET  /api/ai/chat/:taskId → { status, text } （小程序按 1s→2s→3s 退避轮询）
```

服务端用一个内存 `Map` 存任务结果（单实例下没问题；多实例则需存数据库）。前端轮询带退避，别打爆服务端。

#### 约束二：冷启动

最小实例数 = 0 时，首次请求要等 3–10 秒。
**对策**：最小实例数设 1；小程序 `onLaunch` 预热 `GET /api/version`；请求层统一设 `timeout: 15000` 并在 `fail` 里对 timeout 错误自动重试一次。

#### 约束三：网关掐断长请求

同上，任何超过 ~50 秒的同步请求都会被掐断。当前代码里超过 15 秒的只有 AI 对话，改造后不存在了。

### 8.4 基础库版本

`callContainer` 需要**基础库 ≥ 2.23.0**，且要在**两处**都设置：

1. 小程序管理后台 →「设置」→「功能设置」→「基础库最低版本设置」→ 设为 `2.23.0` 或更高
2. 开发者工具 / 代码里的最低版本声明

> 只在开发者工具里调高不够，后台不设，线上照样报错。这一步容易漏。

---

## 9. 小程序工程结构

### 9.1 目录树

```
E:\code\家庭菜单\
├── server.js                    # 后端（存储层改造后）
├── public/                      # 保留：本地 Web 版继续可用
├── miniprogram/                 # 新增：小程序前端
│   ├── app.js                   # wx.cloud.init、全局状态
│   ├── app.json                 # 页面注册 + tabBar
│   ├── app.wxss                 # 全局样式
│   ├── project.config.json
│   ├── sitemap.json
│   ├── config.js                # CLOUD_ENV / SERVICE_NAME 编译期常量
│   ├── utils/
│   │   ├── api.js               # callContainer 封装 + 令牌管理 + 重试
│   │   ├── store.js             # wx.storage 封装（替代 localStorage）
│   │   ├── auth.js              # 登录/认领/角色判断
│   │   ├── format.js            # 日期、emoji、时长
│   │   └── dialog.js            # wx.showModal 封装（含 editable 输入）
│   ├── components/              # 复用的 WXML 组件
│   │   ├── dish-card/           # 菜品卡片（含同名折叠）
│   │   ├── dish-detail/         # 菜品详情（做法/调料切换）
│   │   ├── member-chip/         # 成员徽章
│   │   ├── pin-input/           # 口令输入弹层
│   │   ├── empty-state/
│   │   └── scope-filter/        # 全部/共享/我家私房
│   └── pages/
│       ├── index/               # 菜单（对应 viewMenu）
│       ├── order/               # 点餐（viewOrder）
│       ├── plan/                # 本周计划（viewPlan）
│       ├── board/               # 留言板（viewBoard）
│       ├── pantry/              # 库存（viewPantry）
│       ├── household/           # 家庭首页（viewHouseholdHome）
│       ├── members/             # 成员管理（viewManageMember）
│       ├── manage/              # 管理页（viewManage）
│       ├── dish-edit/           # 菜品编辑（从菜单进入）
│       └── login/               # 身份认领向导（renderWhoami 三步）
```

### 9.2 页面与 tabBar

现有 8 个视图 → 小程序页面映射：

| 现有视图 | 小程序页面 | 位置 |
|---|---|---|
| `viewMenu` | `pages/index` | tabBar 第 1 项 |
| `viewOrder` | `pages/order` | tabBar 第 2 项 |
| `viewPlan` | `pages/plan` | tabBar 第 3 项 |
| `viewBoard` | `pages/board` | tabBar 第 4 项 |
| `viewPantry` | `pages/pantry` | tabBar 第 5 项 |
| `viewHouseholdHome` | `pages/household` | 从顶栏身份按钮进入 |
| `viewManageMember` | `pages/members` | 从管理页进入 |
| `viewManage` | `pages/manage` | 从身份按钮进入 |
| `renderWhoami`（三步向导） | `pages/login` | 首次进入 / 切换身份 |

`tabBar` 上限 5 项，正好够放「菜单 / 点餐 / 计划 / 库存 / 我的」。留言板和设置放进「我的」。

### 9.3 存储层替换

33 处 `localStorage` 映射表：

| 现有 | 小程序 |
|---|---|
| `localStorage.getItem(k)` | `wx.getStorageSync(k)` |
| `localStorage.setItem(k, v)` | `wx.setStorageSync(k, v)` |
| `localStorage.removeItem(k)` | `wx.removeStorageSync(k)` |
| `JSON.parse(localStorage.getItem(k))` | `JSON.parse(wx.getStorageSync(k) || 'null')` |

**保留键名不变**，方便复用现有逻辑。

### 9.4 交互替换

| 现有 | 小程序 | 备注 |
|---|---|---|
| `confirm(msg)` | `wx.showModal({ title, content })` | 24 处，改造成 `utils/dialog.js` 的 `confirm()` 同名函数，调用点几乎不用改 |
| `prompt(msg, def)` | `wx.showModal({ editable: true, content: def })` | 口令输入 |
| `alert(msg)` | `wx.showToast` / `wx.showModal` | 用 `showModal` 承载错误详情 |
| `document.querySelector(...)` | `this.selectComponent` / 页面内 `data` 绑定 | 49 处，需要逐个改 |
| `innerHTML = ...` | `setData({ x: ... })` | 29 处 |
| `window.addEventListener` | `Page({ onShow, onHide, onPullDownRefresh })` | 14 处 |
| `<input type="file">` | `wx.chooseMedia` + `wx.cloud.uploadFile` | 4 处 |
| `URL.createObjectURL` | 云存储 fileID 直接用 | 2 处 |
| `FileReader.readAsDataURL` | `wx.getFileSystemManager().readFile` | 1 处 |
| `navigator.userAgent` | `wx.getSystemInfoSync` | 1 处 |

### 9.5 样式迁移

`styles.css` 1538 行 → `app.wxss` + 各页 `wxss`。

小程序差异：

- **没有 `vh`/`vw` 的自由使用** → 布局改用 `rpx`（750rpx = 屏幕宽）或 `flex`。
- **不支持 `position: fixed` 的多层嵌套** → tabBar 用原生 `tabBar` 组件，不用自定义底部栏。
- **不支持 `:hover`、`:focus`** → 用 `:active`、`wx:` 状态类。
- **单文件组件样式隔离** → 公共样式放 `app.wxss`（全局），组件样式用 `styleIsolation: 'apply-shared'` 或 `addGlobalClass: true`。
- **不支持 `<style scoped>` 的部分选择器** → 尽量用 class 而非标签选择器。

### 9.6 图片选择与压缩

现有 Web 端是 `<input type="file">` → `FileReader` → dataURL → 上传。

小程序端：

```js
wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
  → wx.cloud.uploadFile({ cloudPath, filePath })  → fileID
```

小程序的 `sizeType: 'compressed'` 已经压缩过，**不需要再走 base64**，比 Web 端更省。

---

## 10. 已知坑清单

| # | 坑 | 影响 | 对策 |
|---|---|---|---|
| 1 | **容器时区是 UTC**，比本地少 8 小时 | `todayStr()`（`server.js:586`）、`dateAdd()`（`server.js:1941`）、`mondayOf()`（`server.js:1947`）、备份文件名（`server.js:2932`）共 **18 处**用本地日期。**北京时间 16:00–24:00 之间，「今天」会算成昨天** | 云托管环境变量设 `TZ=Asia/Shanghai`，并确认镜像装了 `tzdata`。**不改代码** |
| 2 | **多实例内存态分歧** | A 实例改了 B 实例看不到 | 副本数固定为 1 |
| 3 | **`callContainer` timeout 上限 15 秒** | AI 对话（默认 45 秒超时）必然失败 | 改成异步任务 + 轮询 |
| 4 | **冷启动 3–10 秒** | 首次打开白屏 | 最小实例数 = 1 + `onLaunch` 预热 |
| 5 | **基础库 ≥ 2.23.0 要设两处** | 线上报 `callContainer` 不可用 | 后台「基础库最低版本设置」同步改 |
| 6 | **`wx.cloud.init` 是异步的** | 立即调用报 `Cloud API isn't enabled` | `onLaunch` 里 await，或捕获该错误后 300ms 重试、最多 3 次 |
| 7 | **容器无持久磁盘** | `backups/`、`uploads/` 会丢 | 备份与图片都进云存储 |
| 8 | **`upload` 在 `SUPER_ONLY` 里** | 普通成员不能传图，与小程序场景冲突 | 实施时调整权限 |
| 9 | **`adminPin` 明文** | 数据库控制台可见 | 改 scrypt 哈希存储，留一次明文兼容读 |
| 10 | **部署上下文不能是仓库根目录** | `wxcloud run:deploy .` 会把整个仓库打包上传，超出体积限制 | 准备一个精简发布目录（见 12.4） |
| 11 | **容器端口必须与实际监听端口一致** | 健康检查打 80，服务监听 3001 → 部署失败 | 部署时显式声明 `--containerPort` |
| 12 | **`.dockerignore` 必须挡掉 `data/`** | `ai.json` 的 API Key 被打进镜像 | 加 `.dockerignore`（仓库已踩过这个坑，`9bc0335`） |
| 13 | **云上访问外部 API 受国内网络约束** | `api.minimax.io` 的连通性需实测 | 联调时验证 AI 功能 |
| 14 | **`getApp().globalData` 不是响应式** | 跨页共享状态不刷新 | 状态放 `wx.storage` + 页面 `onShow` 重读 |

---

## 11. 数据迁移

### 11.1 迁移脚本

新增 `_migrate-cloud.js`（一次性工具，不进生产镜像）：

```
读本地 data/*.json
  → 逐集合写云开发数据库
  → 写迁移报告（每个集合的条数、跳过数、错误）
```

**迁移原则**：

- **只读本地 `data/`，绝不改写**。迁移脚本对源目录只做读操作。
- **幂等**：重复执行不会产生重复数据（按集合 `_id` upsert，不 append）。
- **先迁移到测试集合**，核对无误后再迁正式集合。
- 迁移前把本地 `data/` 整体打包备份一份。

### 11.2 图片迁移

本地 `uploads/` 里的图片 → 云存储：

```
读本地文件 → wx-server-sdk uploadFile → 云存储 → 得到 fileID
  → 把菜品记录里的 '/uploads/xxx.png' 替换成 fileID
  → 迁移完成后校验：所有菜品图片字段都能在云存储里找到
```

### 11.3 校验

迁移后跑一份**对账脚本**，逐项比对本地与云端：

| 校验项 | 判据 |
|---|---|
| 菜品条数 | 相等 |
| 每道菜的字段 | 深比对（做法数、调料数、图片字段） |
| 家庭 / 成员 | 相等，且成员 `id` 没变 |
| 点餐 / 库存 / 计划 | 条数与关键字段相等 |
| 分类顺序 | `order` 字段一致 |
| 图片可达性 | 每个 fileID 能下载成功 |

**菜品条数、成员 id、家庭 id 三项必须严格相等，其余字段不一致要逐条列出。**

### 11.4 回滚

- 迁移前：`data/` 打包成 `data-backup-<日期>.zip`，留档。
- 迁移后若发现问题：清空云端集合，重新迁移。
- **本地版不受影响** —— 本地 `data/` 只读不写，随时可以继续用本地版。

### 11.5 双轨期

建议**云端与本地并行 2–4 周**：

- 本地版保留，作为「云端出问题时家里还能点餐」的兜底。
- 两边数据会分叉，所以并行期内要**明确以哪边为准**（建议云端为准，本地版只读）。
- 并行期结束后再考虑是否停用本地服务。

---

## 12. 分阶段实施

> 每个阶段结束都必须**可运行、可回滚**，不追求一次做完。

### Phase 0：环境准备（不改业务代码）

- [ ] 注册小程序账号，拿 AppID
- [ ] 开通云开发环境，拿到**环境 ID**
- [ ] 创建云托管服务，命名 `family-menu`，记下**服务名**
- [ ] 创建云数据库集合（13 个，见 6.2）
- [ ] 创建云存储目录
- [ ] 配置环境变量：`TZ=Asia/Shanghai`、`MINIMAX_API_KEY`
- [ ] 服务设置：**最小副本数 = 1**，**最大副本数 = 1**，**关闭公网访问**
- [ ] 小程序后台「基础库最低版本设置」设为 `2.23.0`+

**验收**：云托管服务已部署一个 hello world，`callContainer` 能通，`X-WX-OPENID` 头能收到。

### Phase 1：存储层抽象（后端改造，业务逻辑不动）

- [ ] 抽出 `Store` 接口：`loadAll()` / `save(key, value)`
- [ ] 实现 `StoreFile`（现有 JSON 文件行为，用于本地版）
- [ ] 实现 `StoreCloud`（云数据库）
- [ ] `scheduleSave()` 改为走 `Store.save`
- [ ] 启动时按 `STORAGE_DRIVER` 环境变量选择实现
- [ ] `adminPin` 改哈希存储 + 明文兼容读迁移
- [ ] **本地版功能零变化**，`node _selftest.js` 仍 818 项全绿

**验收**：`_selftest.js` 全绿；用 `STORAGE_DRIVER=cloud` 起服务，接口行为与文件模式完全一致。

### Phase 2：图片与备份上云

- [ ] `POST /api/upload` 改为写云存储，返回 fileID
- [ ] 调整 `upload` 的权限（去掉超管专属或按需）
- [ ] `GET /api/export` 改为生成 ZIP → 云存储 → 返回 fileID
- [ ] `POST /api/import` 改为从云存储读 ZIP
- [ ] 备份集合 `backups` 落库

**验收**：小程序能上传图片、能导出并打开 ZIP、能导入还原。

### Phase 3：AI 异步化

- [ ] `POST /api/ai/chat` 拆成「提交任务」+「查询结果」两个接口
- [ ] 服务端任务表（内存 Map，单实例够用）
- [ ] 超时时间从 45 秒降到 12 秒以内（受 15 秒网关限制）

**验收**：AI 对话在 `callContainer` 下能稳定拿到结果。

### Phase 4：openid 登录

- [ ] `users[]` 增加 `openid` 字段
- [ ] 新增 `POST /api/account/wechat-login`
- [ ] `normUser` 兼容处理
- [ ] 抓包核对 `X-WX-OPENID` 的确切注入条件

**验收**：新用户打开小程序 → 自动登录 → 看到正确家庭和角色。

### Phase 5：小程序前端

按页面逐步来，每个页面完成并验收后再做下一个：

- [ ] 5.1 工程骨架：`app.js` / `app.json` / `app.wxss` / `utils/api.js` / `utils/store.js` / `utils/dialog.js`
- [ ] 5.2 登录与身份向导（`pages/login`）
- [ ] 5.3 菜单页（`pages/index`）：菜品列表、分类筛选、详情、增删改
- [ ] 5.4 点餐页（`pages/order`）：提交点餐、状态流转
- [ ] 5.5 计划页（`pages/plan`）
- [ ] 5.6 库存页（`pages/pantry`）
- [ ] 5.7 留言板（`pages/board`）
- [ ] 5.8 家庭与成员管理（`pages/household` / `pages/members` / `pages/manage`）
- [ ] 5.9 身份按钮与角色徽章（`#meBtn` 的等价物）

**每页验收标准**：能完成对应 Web 版的全部操作，且**权限表现一致**（普通成员看不到管理入口，调用管理接口服务端仍返回 401/403）。

### Phase 6：数据迁移与灰度

- [ ] 写 `_migrate-cloud.js`
- [ ] 迁移图片
- [ ] 对账脚本
- [ ] 迁移本地真实数据到测试集合 → 核对 → 迁正式集合
- [ ] 双轨期

### Phase 7：发布

- [ ] 准备精简部署目录（不传仓库根目录）
- [ ] 写 `Dockerfile` + `.dockerignore`
- [ ] `wxcloud run:deploy <发布目录> --dockerfile Dockerfile --containerPort <实际端口>`
- [ ] 健康检查通过
- [ ] 小程序上传体验版 → 家庭成员试用
- [ ] 提交审核

---

## 13. 验收标准

### 13.1 后端

- [ ] `node _selftest.js` **818 项全绿**，且**在云端容器里跑同一套断言也全绿**（测试脚本进镜像，用 `STORAGE_DRIVER=cloud` 跑）
- [ ] `node _packtest.js` 27 项全绿（本地版不受影响）
- [ ] `server.js` 业务逻辑改动量：**只改存储层调用点 + 权限表调整 + AI 异步化 + openid 登录接口**，其余保持原样
- [ ] 四类令牌仍然分离，跨家庭令牌不能越权
- [ ] `canDoSensitive()` 的危险动作在没有 5 分钟凭证时仍然 403

### 13.2 数据

- [ ] 迁移后菜品数、成员 id、家庭 id 与本地**严格相等**
- [ ] 孜然牛肉的 1 张图 / 5 种做法 / 12 样调料**完整迁移**
- [ ] 所有图片 fileID 可下载
- [ ] `adminPin` 在数据库里不是明文

### 13.3 小程序

- [ ] 五个 tab 页都能打开且不白屏
- [ ] 冷启动（最小实例数=1）首次打开 < 3 秒
- [ ] 普通成员看不到「管理」入口，直接调管理接口返回 401/403
- [ ] 图片能上传、能显示
- [ ] AI 对话能返回结果（不受 15 秒限制）
- [ ] 「今天 / 本周」的日期与北京时间一致（验证 `TZ` 生效）
- [ ] 断网 / 超时 / 冷启动都有明确的用户提示，不是白屏

### 13.4 发布

- [ ] 镜像里不含 `data/`、`ai.json`、任何密钥
- [ ] 云托管服务公网访问已关闭
- [ ] 小程序后台基础库最低版本已设为 2.23.0+

---

## 14. 成本与运维

| 项 | 说明 |
|---|---|
| 云托管 | 按量付费；最小实例数 = 1 意味着**一直有一台实例在跑**，按最小规格计，量级很小 |
| 云数据库 | 读多写少，本项目数据量极小，费用接近于零 |
| 云存储 | 只存菜品照片，容量占用可忽略 |
| 备份 | 建议开启数据库自动备份 + 每日定时任务生成业务备份 |
| 运维 | 无需管理服务器；升级 = 推代码 + 重新部署 |

**对比本地**：本地零成本，但要有一台常开机器；云端有持续成本，换来「随时随地能用」。

---

## 15. 待确认的问题

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | 云端版是否要**取代**本地版，还是并存？ | 并存 2–4 周，云端为主、本地兜底 |
| 2 | 小程序是否需要**家庭成员自助注册**（微信直接进，不用管理员批准）？ | 建议保留「加入申请需管理员批准」，与现有权限模型一致 |
| 3 | 小程序是否需要**微信分享/家庭群通知**？ | 值得加（把点餐结果分享到家庭群），但属于 Phase 5 之后的增强 |
| 4 | AI 功能在云上是否保留？ | 保留（环境变量已支持），但需实测 `api.minimax.io` 连通性 |
| 5 | 多副本是否将来可能需要？ | 先锁定单副本；如果将来要扩，必须先做版本号校验或无状态化，**不能只调副本数** |

---

## 附录 A：现状事实速查（2026-11-22 实测）

```
版本            1.31.13（package.json / APP_VERSION / RELEASES[0] 三处一致）
HEAD            a2dbc89，与 origin/main 一致，工作树仅本方案文档与主文档改动
_selftest.js    818 项通过 / 0 失败
_packtest.js    27 项通过 / 0 失败
接口            28 个一级路由组，89 条「方法 × 路径」分支
实时通道        SSE / WebSocket / 长轮询：0 处
数据文件        13 个（FILES）+ devices.json + ai.json
真实数据        菜品 6 / 分类 7 / 家庭 3 / 用户 2 / 点餐 6
代码规模        server.js 6534 行，public/app.js 8946 行，styles.css 1538 行
Web 专属 API    localStorage 33、document. 49、window. 30、innerHTML 29、confirm 24
后端落盘点      fs.writeFileSync × 3，fs.mkdirSync × 4
本地日期 API    后端 18 处（todayStr / dateAdd / mondayOf / 备份文件名）
```

## 附录 B：平台事实来源

- 微信云托管容器默认时区为 UTC，需通过 `TZ` 环境变量调整；环境变量在「服务配置 → 环境变量」配置 —— 云托管官方文档与实践文章一致。
- `wx.cloud.callContainer` 走内网，不受小程序 `request` 合法域名限制；底层若改用 `wx.request` 打云托管公网域名，**仍然受限**。
- `callContainer` 需要基础库 ≥ 2.23.0，且小程序后台「基础库最低版本设置」也要同步设置。
- `callContainer` 的 `timeout` 最大 15 秒；网关会掐断长请求，服务端进程不受影响。
- 冷启动 3–10 秒，最小实例数默认 0；设 1 可常驻但持续计费。
- 云托管提供环境变量，不内置 Redis；数据库需单独开通（控制台模板提供 MySQL 选项）。
- 部署时「部署上下文」必须是被打包的目录，不能是 monorepo 仓库根；容器端口需与监听端口一致。
