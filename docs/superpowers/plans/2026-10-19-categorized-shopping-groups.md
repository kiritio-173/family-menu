# 分类采购与库存折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让计划采购和家庭库存按分类可折叠展示，并支持分类全选、分类批量入库和现有批量库存操作。

**Architecture:** 在 `public/app.js` 增加通用分类分组与折叠状态辅助函数；采购组复用现有 `S.shoppingChecked` 和 `stockOne`，库存组复用现有 `S.sel.pantry` 与 `pickBarHtml`。折叠状态写入账户上下文，不修改服务端数据模型。

**Tech Stack:** 原生 JavaScript/HTML/CSS、Node.js 服务、localStorage 账户上下文、现有自测和便携版脚本。

---

### Task 1: 分类解析与账户上下文

**Files:**
- Modify: `E:/code/家庭菜单/public/app.js`，状态、上下文保存/恢复、采购辅助函数
- Test: `E:/code/家庭菜单/_selftest.js`（加入源代码行为检查）

- [ ] 在 `S` 增加 `shoppingGroups` 和 `pantryGroups` 折叠状态对象，默认分类组展开。
- [ ] 在 `saveAccountContext`、登录恢复和启动恢复中保存/读取两个对象；未知分类默认展开，不污染其他账户。
- [ ] 增加 `ingredientCategory(name)`：优先使用当前家庭同名库存的非“其他”分类，再使用已加载食材预设，最后返回“其他”。
- [ ] 增加通用 `groupByCategory(list, categoryFn)` 和固定分类排序，保证采购和库存使用相同顺序。
- [ ] 进入计划/点餐页时确保食材预设已加载一次，加载完成后刷新当前视图，使未入库食材也能正确归类。

### Task 2: 采购分类折叠与组内批量操作

**Files:**
- Modify: `E:/code/家庭菜单/public/app.js`，`shopListHtml`、事件 ACTIONS
- Modify: `E:/code/家庭菜单/public/styles.css`，采购分类组样式

- [ ] 把 `shopListHtml` 的平铺 `list.map` 改为按 `ingredientCategory` 分组；每组标题显示分类、条目数、需要补购数和折叠箭头。
- [ ] 每组标题增加复选框，点击后只切换该组条目的 `S.shoppingChecked`，调用现有 `saveShoppingChecked`。
- [ ] 每组标题增加“本组入库”按钮；使用同组 `stockAssessment` 过滤，跳过 `enough`，调用现有 `stockOne`，完成后清除勾选并刷新。
- [ ] 保留顶部跨组批量工具条；顶部全选仍操作整张当前清单，复制和取消勾选行为不变。
- [ ] 增加 `toggle-shopping-group`、`select-shopping-group`、`stock-shopping-group` 事件，阻止组标题按钮冒泡到折叠容器。
- [ ] 采购组折叠状态每次切换后保存账户上下文，刷新后恢复。

### Task 3: 库存分类折叠与分类全选

**Files:**
- Modify: `E:/code/家庭菜单/public/app.js`，`viewPantry` 和库存多选事件
- Modify: `E:/code/家庭菜单/public/styles.css`，库存分类组样式

- [ ] 将库存现有分类标题改为可展开/收起的 `details` 组，默认打开有内容的分类；标题显示条目数、数量为 0 的条目数和箭头。
- [ ] 多选模式下，组标题提供“选本组/取消本组”，只更新 `S.sel.pantry` 当前组 ID；顶部批量改保质期、改分类和删除继续使用同一选择集。
- [ ] 非多选模式下保留单条数量加减、编辑和删除，不增加会误导的“入库”按钮。
- [ ] 增加 `toggle-pantry-group`、`select-pantry-group` 事件并保存 `pantryGroups` 上下文。
- [ ] 当前分类筛选、临期/过期筛选和全选操作保持一致，不选中隐藏条目。

### Task 4: 文档、验证与发布

**Files:**
- Modify: `E:/code/家庭菜单/docs/product/2026-10-18-current-interface-product-logic.md`
- Modify: `E:/code/家庭菜单/docs/product/2026-10-18-family-workspace-flow.md`
- Modify: `E:/code/家庭菜单/server.js`、`E:/code/家庭菜单/package.json`（版本与更新日志）

- [ ] 更新产品文档，记录采购和库存的分类折叠、分类全选、本组入库和账户级折叠状态。
- [ ] 版本提升到 `1.24.0`，更新发布日志。
- [ ] 运行 `node --check server.js`、`node --check public/app.js`、`git diff --check`。
- [ ] 运行 `node _selftest.js`、`node build-package.js`、`node _packtest.js`、`node publish-selftest.js`。
- [ ] 重启 `http://localhost:8787/`，确认服务返回 1.24.0；检查计划和库存分类交互。
- [ ] 提交本次代码，更新 `E:/code/家庭菜单/package/家庭菜单-便携版/`，并推送 GitHub。
