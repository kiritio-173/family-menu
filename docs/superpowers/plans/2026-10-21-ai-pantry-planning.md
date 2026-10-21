# 家庭共享原料字典实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让菜谱、计划和库存通过家庭内共享原料 ID 和可扩展分类树协同工作，并在用户确认 AI 建议后保存原料映射、重算计划页面。

**Architecture:** 服务端为每个家庭保存原料字典和分类树；菜谱材料、库存条目引用 `ingredientId`，计划聚合同一原料 ID。分类父子关系只用于展示分组，不合并不同材料。AI 只提供标准名/别名/分类/追踪方式建议；确认后保存建议，数量需求、库存缺口、采购状态和库存扣减仍由确定性代码及用户操作决定。

**Tech Stack:** Node.js 内置 HTTP 服务、原生 JavaScript 前端、JSON 文件存储、现有 `_selftest.js`、`_pantrylogic-test.js`、`_packtest.js`。

---

## 文件地图

- 修改 `server.js`：新增家庭原料与子分类持久化/规范化/路由、旧菜谱和库存关联迁移、状态导出导入、家庭解散清理、菜谱和库存关联验证、AI 建议结构及应用保存。
- 修改 `public/app.js`：共享原料状态和查找器、菜谱材料选择/新增、菜单内新增子分类、库存新增原料、按原料 ID 计算计划、AI 建议确认后刷新。
- 修改 `public/pantry-logic.js`：材料 ID 优先的需求聚合；名称别名兼容只用于尚未迁移的旧数据；分类不用于身份匹配。
- 修改 `public/index.html`：只在新增独立前端模块时调整脚本加载顺序；优先沿用现有 `pantry-logic.js`。
- 修改 `public/styles.css`：仅添加原料选择器、内联新建表单、分类路径和 AI 可编辑建议所需样式。
- 修改 `_selftest.js`：家庭隔离、权限、迁移、分类新增/删除约束、菜谱/库存引用和 AI 应用行为。
- 修改 `_pantrylogic-test.js`：别名合并、不同原料不合并、重复计划需求、库存单位不可比、分类不参与聚合等纯逻辑。
- 修改 `_packtest.js`：便携包包含新数据/资源且重启迁移和 API 冒烟通过。
- 修改 `docs/product/2026-10-18-current-interface-product-logic.md`：记录原料字典、分类层级、计划计算和 AI 确认副作用。

## Task 1: 建立家庭原料字典与分类树的服务端存储
**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: 写失败测试，固定家庭隔离与分类边界**

在家庭/库存 API 测试中新增断言：家庭成员能创建属于当前家庭的原料和“肉类 > 牛肉”子分类；非成员不能读写该家庭记录；幽灵家庭 ID 被拒绝；原料只能引用同家庭分类；被原料引用的子分类不能直接删除；`牛里脊` 与 `牛排` 可以拥有不同 ID 且都指向“牛肉”。

运行 `node _selftest.js`，新路由断言应失败，现有测试基线应继续执行。

- [ ] **Step 2: 增加数据文件和规范化模型**

在 `FILES` 与 `defaultState()` 增加 `ingredients: 'ingredients.json'` 和 `pantryCategories: 'pantry-categories.json'`。原料规范化字段固定为 `{ id, householdId, name, aliases, categoryId, defaultTrackingMode, defaultUnit, createdAt, updatedAt }`；分类规范化字段固定为 `{ id, householdId, parentId, name, createdAt, updatedAt }`。内置顶级分类仍来自 `PANTRY_CATEGORIES`，不得保存为某个家庭私有分类。

分类名和同一家庭内标准名应做去重校验；同义名称只在用户明确确认后写入 `aliases`。分类树节点删除前检查引用。新增数据必须通过现有 `requireAccountHousehold` / `isHouseAdmin` 权限模式校验，不能接受客户端指定的其他家庭 ID。

- [ ] **Step 3: 增加家庭隔离 CRUD 路由和状态暴露**

新增 `GET/POST/PUT/DELETE /api/ingredients` 和 `/api/pantry-categories`。GET 仅返回当前家庭记录；创建/编辑原料要求该家庭可写权限；分类新增、重命名、删除要求家庭管理员权限。`GET /api/state?householdId=...` 只在该家庭成员或有效超级管理员视图中返回对应原料和子分类，公开浏览家庭和未选家庭状态返回空数组。

导出备份和导入恢复包含两个数据集合；家庭解散时一并删除该家庭的原料和自定义分类。保存沿用 `scheduleSave()`，不增加第二套文件写入机制。

- [ ] **Step 4: 运行服务端测试并修正**

运行 `node _selftest.js`。新增测试应通过，旧账户、家庭隔离、导入/导出和删除家庭测试不回归。

## Task 2: 迁移旧菜谱和库存并维护材料关联

**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: 写失败迁移测试**

加载旧备份，其中菜谱的通用材料、做法材料和 pantry 条目均缺少 `ingredientId`。断言迁移保留名称、用量、`purchaseType`、做法归属、库存数值/单位/备注/保质期，并为同一家庭中明确同名条目关联同一 `ingredientId`。另设“牛里脊”和“牛排”归属同一“牛肉”子分类但 ID 不同。重复加载不能重复创建原料或覆盖用户确认的别名和追踪方式。

运行 `node _selftest.js`，确认新增关联断言失败。

- [ ] **Step 2: 实现确定性旧数据迁移**

在 `loadState()` 现有 migration 流程中，先规范化分类，再以家庭范围内的标准名/显式别名查找原料；找不到时创建原料，随后为 `dish.seasonings`、`method.seasonings` 和 pantry 项补写 `ingredientId`。绝不根据共同分类合并原料；模糊包含匹配不得用于 ID 迁移。迁移更改后分别 `scheduleSave('ingredients')`、`scheduleSave('dishes')`、`scheduleSave('pantry')`。

若一个别名命中多个原料，不自动挑选；保留原名称，交由用户后续处理。库存重复项不自动合并。

- [ ] **Step 3: 保持旧 API 与菜谱格式兼容**

更新 `normDish()` 的材料映射以保留有效 `ingredientId`，同时继续读写旧格式中只有 `name`/`amount`/`purchaseType` 的行。菜谱保存时验证原料 ID 属于该菜谱家庭；旧客户端字段缺失时按已有家庭材料精确名称兼容解析。更新 `normPantryItem()` 保留有效关联，并始终从已关联原料取得展示分类；无关联的历史行仍能读写。

- [ ] **Step 4: 验证迁移幂等和备份往返**

运行 `node _selftest.js`，确认旧备份重复启动内容稳定、备份导入保留 `ingredients`/`pantryCategories`、家庭删除没有孤儿记录。

## Task 3: 菜谱和库存入口共用原料选择/新增

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css` only if needed
- Modify: `server.js` only for validation discovered by UI tests
- Test: `_selftest.js` and browser interaction

- [ ] **Step 1: 写服务端材料引用回归测试**

新增菜谱时为菜品级和做法级材料分别提交 `ingredientId`，确认读取时 ID 保留；提交其他家庭的 ID 返回 400/403。库存引用同一家庭原料时标准名和分类一致；分类父节点不改变材料 ID。

- [ ] **Step 2: 在菜谱材料编辑行接入家庭字典**

把菜品级和做法级材料名称输入改成可搜索选择器：匹配家庭标准名和显式别名；选择后保存 `ingredientId`，但显示标准名和原用量输入。没有结果时在当前菜单表单内提供“新建原料”，填写标准名、分类路径、默认追踪方式和可选单位，创建成功后立即绑定到该材料行。分类选择支持从已有树选择，并在当前菜单编辑流程内创建子分类。

只有现有菜单编辑权限允许保存菜谱的用户可以创建原料；分类树增删改继续由现有家庭管理员权限控制。取消创建不得改变草稿或服务端状态。

- [ ] **Step 3: 在库存页复用原料字典创建入口**

库存编辑器选择/输入原料时，从同一家庭字典中选择；没有结果时允许新建原料并同时录入本家庭库存状态。创建库存前先创建/选中原料，后续 pantry API 保存对应 `ingredientId`。库存页展示原料分类树路径，不再把每条库存的自有分类作为另一份事实来源。保留 `presence` 和 `quantity` 两种录入控件及已有单位数据。

- [ ] **Step 4: 浏览器验证两个入口和权限状态**

启动应用后在家庭 A 的菜谱编辑器新增“牛里脊”并选择“肉类 > 牛肉”，再从库存页新增“牛排”并选同一子分类。断言它们显示在相同分类分组下但保有不同原料 ID。验证菜单成员能在有权编辑的菜谱中创建原料；普通浏览者看不到创建控件；非管理员不能创建/删除分类节点。

## Task 4: 让计划按材料 ID 聚合并应用 AI 建议

**Files:**
- Modify: `public/pantry-logic.js`
- Modify: `public/app.js`
- Modify: `server.js`
- Test: `_pantrylogic-test.js`, `_selftest.js`

- [ ] **Step 1: 写失败的材料身份聚合测试**

为 `aggregatePlanMaterials()` 添加 `ingredientId`、别名和分类字段输入。两条同 ID/显式别名的番茄需求 `2 个` 与 `3 个` 汇总为 5；同类别不同 ID 的牛里脊与牛排必须保留两条；仅因类别同为“牛肉”不得合并；salt 的 presence 用量仍不参与数值汇总；不同单位仍返回不确定状态。

运行 `node _pantrylogic-test.js` 确认缺少 ID 优先规则时测试失败。

- [ ] **Step 2: 实现 ID 优先的确定性聚合**

在 `public/pantry-logic.js` 中为聚合键采用 `ingredientId`；旧数据没有 ID 时才调用明确别名 normalizer。category 只作为展示字段，不参与匹配。`stockFor` 按 `ingredientId` 找库存；旧 pantry 条目再走现有名称兼容路径。按原有规则汇总数量、比较单位、单独确认 presence 调料。

- [ ] **Step 3: 扩展 AI 计划分析返回结构**

更新 `AI_TASKS['plan-analysis']` 提示要求返回 `{ summary, flags, proposals }`。每条 proposal 包含 `inputName`, `ingredientId`（可选）, `name`, `aliases`, `categoryId`, `trackingMode`, `confidence`, `reason`。服务端按当前 household 的有效原料和分类树过滤 ID/分类，验证文本长度、别名数量、置信度 `[0,1]` 和追踪枚举；不接受数量、库存、采购状态写入字段。

- [ ] **Step 4: 增加逐条确认保存和重算刷新**

`ai-plan-analysis` 动作渲染可编辑标准名、别名、分类、追踪方式及逐项勾选；无匹配材料时可确认创建新原料，父子分类不同的原料保持独立 ID。确认动作通过服务端 household-scoped API 保存字典条目并更新当前家庭菜谱材料的 `ingredientId`。只提交勾选项；冲突、被删除的计划菜或越权 ID 返回错误且不显示成功。

服务端保存成功后关闭弹窗、`await loadState(true)`、重新计算当前周计划并 `render()`；失败时保留弹窗选项和原计划显示。确认 AI 建议不得写 `pantry.quantity`、`hasStock`、`shoppingStatus`、plan `received` 或菜品完成状态。

- [ ] **Step 5: 运行计划、AI 与家庭隔离测试**

运行 `node _pantrylogic-test.js` 和 `node _selftest.js`。覆盖选中建议持久化、跳过项不变、AI 保存失败不刷新成功、越权家庭 ID 拒绝、确认后计划缺口更新、确认不修改库存和采购状态。

## Task 5: 更新产品说明、便携版并完成发布检查

**Files:**
- Modify: `docs/product/2026-10-18-current-interface-product-logic.md`
- Modify: `_packtest.js` if package contract requires assertions
- Verify: `build-package.js`, `publish-selftest.js`, `package/家庭菜单-便携版`

- [ ] **Step 1: 更新产品说明和发布记录**

说明菜单与库存两处新增原料、家庭共享分类/子分类、标准原料 ID、分类不合并材料、每周按材料 ID 汇总、AI 建议确认后刷新以及 AI 不改库存/购买状态。同步更新适用的版本记录，不删除不相关历史内容。

- [ ] **Step 2: 运行完整测试**

运行 `node _selftest.js`、`node _pantrylogic-test.js`、`node _packtest.js` 和 `node publish-selftest.js`。修复失败后重跑失败的目标测试与本组完整测试。

- [ ] **Step 3: 构建并冷启动便携版**

运行 `node build-package.js`，然后 `node _packtest.js`。验证 `package/家庭菜单-便携版` 包含新增静态资源和数据文件默认值、不包含本机家庭数据或 AI 密钥，并通过便携版 API 自测。

- [ ] **Step 4: 在浏览器检查端到端流程**

验证：菜单建原料和子分类；库存页选择同一原料并录入数量；同分类不同原料保持独立；重复计划菜按 ID 汇总需求；AI 建议勾选保存后计划采购缺口立即变化；取消/跳过/保存失败不写入数据；家庭 A 数据不出现在家庭 B。

- [ ] **Step 5: 提交、推送并报告便携版**

按职责提交服务端模型、前端流程、测试和产品说明；将最终提交推送到配置的 GitHub remote。推送失败时保留本地提交并准确报告远端连接错误；不得把未推送提交称为已发布。最终说明便携版目录及通过的测试。
