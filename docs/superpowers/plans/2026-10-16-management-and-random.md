# 管理页与随机菜筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理页改为可折叠、可模糊搜索的分组界面，补齐家庭改名与管理员申请/审批，并让随机菜按范围、分类、标签和日常状态筛选。

**Architecture:** 复用现有 `/api/households`、成员角色和加入申请权限校验；申请记录只增加 `requestedRole`，批准接口增加可选 `role`。管理页由前端生成三个 `<details>` 分组并以 `S.manageKeyword` 过滤，随机菜筛选完全在前端基于当前状态接口数据计算。

**Tech Stack:** Node.js 原生 HTTP 服务、JSON 文件存储、原生 HTML/CSS/JavaScript、现有 `_selftest.js` 与便携版脚本。

---

### Task 1: 加入申请支持管理员身份

**Files:**
- Modify: `server.js` 的加入申请 POST/PUT 分支与申请规范化迁移
- Modify: `_selftest.js` 的申请和多管理员场景

- [ ] **Step 1: 写失败测试**：新增申请时传 `requestedRole: 'owner'`，断言申请保存；管理员批准时传 `role: 'owner'`，断言新成员为 owner；普通申请默认仍为 member。
- [ ] **Step 2: 运行回归测试确认失败**：`node _selftest.js`，预期新断言失败而旧断言保持通过。
- [ ] **Step 3: 实现服务端**：申请 POST 将非法或缺失角色归一为 `member`；申请 PUT 读取 `body.role || jr.requestedRole`，仅接受 `member/owner`，批准时写入新成员 `role`，保留最后管理员保护与现有危险操作校验；旧申请迁移时补 `requestedRole: 'member'`。
- [ ] **Step 4: 运行测试确认通过**：`node _selftest.js`，预期所有断言通过。

### Task 2: 管理页分组折叠与模糊搜索

**Files:**
- Modify: `public/app.js` 的状态、`viewManage`、事件处理
- Modify: `public/styles.css` 的管理搜索和分组样式

- [ ] **Step 1: 写前端回归断言**：静态检查生成的管理页包含三个 `details.manage-group`、搜索输入和分组关键词；运行 `node --check public/app.js` 先确认基线。
- [ ] **Step 2: 实现最小 UI**：新增 `S.manageKeyword` 与 `S.manageGroups`；渲染方案 A 的三个 `<details>` 分组，搜索框输入时按 `title/description/keywords` 做大小写不敏感包含匹配；分组默认展开，折叠状态保存在内存。
- [ ] **Step 3: 接入现有管理内容**：把家庭/申请、菜单/数据、系统/备份现有模板放入对应分组，家庭管理员视图也显示当前家庭编辑入口；搜索只隐藏分组，不绕过现有按钮权限。
- [ ] **Step 4: 添加样式并检查**：`node --check public/app.js`、`git diff --check`，确认窄屏下搜索框和折叠标题可用。

### Task 3: 家庭改名与管理员申请/审批 UI

**Files:**
- Modify: `public/app.js` 的家庭设置、加入申请弹层、审批列表
- Modify: `public/styles.css` 的角色/申请控件样式

- [ ] **Step 1: 扩展申请弹层**：加入“申请身份”下拉框，默认普通成员，提交时发送 `requestedRole`。
- [ ] **Step 2: 扩展管理员审批**：申请行显示申请身份，提供“批准为成员”和“批准为管理员”两个按钮，分别带 `role` 调用现有 `join-decide`。
- [ ] **Step 3: 补齐家庭管理员入口**：当前家庭管理员在家庭设置中看到编辑家庭按钮，复用 `openHouseholdEditor`；保存名称后刷新状态并保留当前家庭。
- [ ] **Step 4: 验证权限边界**：普通成员编辑家庭仍应得到 403；最后管理员不能被降级或删除；运行 `_selftest.js`。

### Task 4: 随机来一道筛选弹层

**Files:**
- Modify: `public/app.js` 的状态、随机动作和筛选函数
- Modify: `public/styles.css` 的随机筛选布局

- [ ] **Step 1: 写筛选函数测试样例**：用现有数据构造共享/私菜、标签、当天点餐和分类，验证每个条件组合只返回符合项。
- [ ] **Step 2: 实现筛选状态**：随机按钮打开弹层，提供范围、分类、标签、今天没做过、排除已点餐；条件只存在弹层生命周期。
- [ ] **Step 3: 实现候选计算**：基于 `scopeDishes()`、`householdOrders()` 和 `todayStr()` 过滤，标签按逗号/顿号/空格拆分并要求全部命中；无结果只提示不关闭弹层，命中后打开随机菜谱。
- [ ] **Step 4: 验证**：`node --check public/app.js`，浏览器手动点选每个条件并确认不会抽到范围外菜品。

### Task 5: 版本、完整测试与便携版

**Files:**
- Modify: `server.js` 的版本号与更新日志
- Modify: `package.json`、`README.md`、`_selftest.js`（同步版本说明与新增验收断言）

- [ ] **Step 1: 更新版本记录**：版本升至 `1.14.0`，记录管理页、审批身份和随机筛选。
- [ ] **Step 2: 跑完整验证**：`node --check server.js`、`node --check public/app.js`、`git diff --check`、`node _selftest.js`。
- [ ] **Step 3: 构建便携版**：`node build-package.js`、`node _packtest.js`、`node publish-selftest.js`。
- [ ] **Step 4: 提交**：只提交源代码、测试、README、规格和计划文档；不提交 `data/`、`uploads/`、`backups/`、便携版目录和临时文件。
