# 家庭中心工作区与采购权限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让家庭菜单围绕当前家庭工作区运行，修复普通成员采购勾选被管理口令拦截、补齐家庭广场入口、收紧菜谱作者权限，并恢复同一账户上次关闭网页时的家庭与页面上下文。

**Architecture:** 采购状态从全局 settings 拆到家庭范围资源，由服务端按账户成员关系校验；前端菜单、家庭、采购和库存统一读取当前家庭投影。公开家庭只读共享菜单，复制后生成当前家庭独立菜谱副本。账户上下文保存在按用户隔离的 localStorage，服务端失效家庭时自动回到账户首页。

**Tech Stack:** Node.js 原生 HTTP 服务、前端原生 JavaScript/HTML/CSS、JSON 数据文件、现有 self-test/build-package 流程。

---

### Task 1: 家庭级采购状态接口

**Files:**
- Modify: `E:/code/家庭菜单/server.js` 状态默认值、备份恢复和 `/api` 路由
- Modify: `E:/code/家庭菜单/public/app.js` 采购清单读写
- Test: `E:/code/家庭菜单/_selftest.js`

- [ ] 在默认状态增加 `shoppingStatus: {}`，备份与恢复保留该字段，并兼容旧的 `settings.shoppingChecked`。
- [ ] 增加 `GET /api/shopping-status?householdId=`、`PUT /api/shopping-status`、`DELETE /api/shopping-status`；所有写操作使用 `requireAccountHousehold`，不经过 `SUPER_ONLY`。
- [ ] 状态只保存 `needed` 和 `completed`，库存数量大于 0 时前端显示为“已有”，入库后清除已买状态。
- [ ] 前端 `saveShoppingChecked`、`toggle-shop`、批量勾选和批量入库改用新接口，普通成员操作失败时保留服务端错误，不显示管理口令提示。
- [ ] 采购清单显示“已有 / 待购买 / 已完成”三组，并在切换家庭时清空上一家的状态缓存。
- [ ] 为普通成员勾选、取消勾选、入库和跨家庭隔离补充 self-test。

### Task 2: 家庭广场和家庭栏目

**Files:**
- Modify: `E:/code/家庭菜单/public/index.html`
- Modify: `E:/code/家庭菜单/public/app.js`
- Modify: `E:/code/家庭菜单/public/styles.css`

- [ ] 将底部最后入口从“设置”改为“家庭”，账户资料继续由顶部账户按钮打开。
- [ ] 有当前家庭时，家庭页显示概览、成员、申请、家庭设置、退出/解散和家庭广场入口；无当前家庭时显示公开家庭目录、共享菜单、创建家庭和申请加入。
- [ ] `browse-public-house` 使用目标家庭的公开信息展示共享菜，明确只读；提供“收进我的家庭”并要求选择已加入家庭后复制。
- [ ] `pick-house` 对未加入家庭打开浏览/申请页，不再直接模拟切换；当前家庭切换后恢复菜单视图并保存上下文。
- [ ] 让计划、点餐、留言、库存在无家庭时保留导航但显示创建/加入家庭入口，不产生写操作。

### Task 3: 菜谱作者权限和菜单管理入口

**Files:**
- Modify: `E:/code/家庭菜单/server.js` 菜谱写入权限
- Modify: `E:/code/家庭菜单/public/app.js` 菜谱卡片、详情和管理视图
- Test: `E:/code/家庭菜单/_selftest.js`

- [ ] 服务端编辑/删除菜谱只允许 `authorUserId` 对应账户或超级管理员；家庭管理员不因 role=owner 获得他人私菜编辑权。
- [ ] 无作者旧菜只允许超级管理员修复，普通成员只能查看或复制。
- [ ] 菜单页增加“我家私房 / 菜谱管理”视图；共享菜、私房菜详情和卡片统一显示“收进我家/复制”入口。
- [ ] 复制时新菜谱绑定目标家庭和当前账户作者，源菜保持不变。
- [ ] 删除设置页中的菜谱编辑入口，保留账户和平台配置职责。

### Task 4: 账户上下文恢复

**Files:**
- Modify: `E:/code/家庭菜单/public/app.js`
- Modify: `E:/code/家庭菜单/public/index.html`

- [ ] 新增 `familyMenu.context.<userId>`，保存 `householdId`、`view`、菜单筛选、计划周、库存筛选和折叠状态。
- [ ] 登录后首次没有上下文时保持无家庭；同一账户再次打开时仅在家庭仍可访问时恢复。
- [ ] 退出家庭、解散家庭、家庭被删除或接口返回无权限时清理无效上下文并回到账户首页。
- [ ] 登录不同账户时只读取新账户自己的上下文，不沿用上一账户家庭。

### Task 5: 文档、构建与发布

**Files:**
- Modify: `E:/code/家庭菜单/docs/product/2026-10-18-current-interface-product-logic.md`
- Create: `E:/code/家庭菜单/docs/product/2026-10-18-family-workspace-flow.md`
- Modify: `E:/code/家庭菜单/package.json` 版本号（如当前版本未自动更新）

- [ ] 记录家庭工作区、采购三状态、家庭广场、作者权限和上下文恢复规则。
- [ ] 运行 `node --check server.js`、`node --check public/app.js`、`git diff --check`、`node _selftest.js`。
- [ ] 运行 `node build-package.js`、`node _packtest.js`、`node publish-selftest.js`，确认便携版输出到 `E:/code/家庭菜单/package/家庭菜单-便携版/`。
- [ ] 重启 `http://localhost:8787/`，检查无家庭、家庭广场、采购勾选、库存入库、作者权限和上下文恢复。
- [ ] 提交并推送 GitHub，记录提交号和便携版校验结果。
