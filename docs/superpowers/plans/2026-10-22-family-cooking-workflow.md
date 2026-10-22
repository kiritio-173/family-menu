# 家庭点餐计划库存流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让家庭菜谱、按餐次点餐、按做法周计划和本家库存使用同一本家庭原料目录，并将采购只保留在计划页。

**Architecture:** 服务端继续使用 JSON 文件和稳定 ID。将使用过的全局原料按家庭复制成本地条目并迁移引用；订单按日期/餐次/菜品关联到一个计划烹饪事件；事件存做法和份数，采购需求从未完成事件即时计算。新增纯函数模块负责订单分组和需求推导，页面层只展示和触发服务端变更。

**Tech Stack:** Node.js 16+, vanilla JavaScript, built-in Node `assert`, `_selftest.js` isolated HTTP harness.

---

## 文件与职责

- `server.js`: 本家目录迁移/权限、订单日期餐次与每用户防重、订单和计划事件关联、删除/取消/完成与库存扣减。
- `public/recipe-ingredient-logic.js`: 家庭原料候选过滤与排序；保持无猜测匹配。
- `public/pantry-logic.js`: 按事件所选做法、份数和家庭库存计算材料需求；不确定值标记确认。
- `public/app.js`: 家庭原料维护入口、仅做法材料编辑、菜单原料推荐、午晚餐点餐聚合、计划事件/做法选择、仅计划页采购与备菜确认。
- `public/styles.css`: 以上页面在窄屏与桌面上的布局。
- `_selftest.js`: 纯函数、API、迁移、权限、幂等和静态界面回归。
- `docs/product/2026-10-18-current-interface-product-logic.md`: 更新最终规则与页面分工。
- `docs/superpowers/specs/2026-10-22-family-cooking-workflow-design.md`: 已确认行为和数据迁移边界。
- `publish-update.js`: 在发布清单加入新规格/计划；生成便携包并推送工作分支。

## Task 1: 家庭目录本地化迁移

**Files:** `server.js`, `_selftest.js`, `public/recipe-ingredient-logic.js`

- [ ] 先写启动迁移测试：两个家庭都引用同一全局原料时，各自得到不同本地 ID；菜谱、库存和分类引用正确；数量、单位、追踪方式、别名保留；多次启动不重复复制。
- [ ] 运行 `node _selftest.js` 确认迁移测试失败。
- [ ] 实现只迁移被家庭引用的全局原料；重写家庭菜谱、库存和依赖它们的家庭计划材料引用。全局只读模板不转成本地记录。
- [ ] 加 API 测试：家庭成员可在本家创建分类/原料；同名别名冲突返回可解释错误；其他家庭 ID 被拒；本家更名不影响其他家。
- [ ] 运行 `node _selftest.js`，确认目录隔离及迁移重复执行均通过。

## Task 2: 做法级材料和可靠需求计算

**Files:** `server.js`, `public/app.js`, `public/pantry-logic.js`, `public/recipe-ingredient-logic.js`, `_selftest.js`

- [ ] 增加失败测试：菜品没有通用材料字段；各做法保留独立材料；旧单做法通用材料迁入该做法；旧多做法无法确定的材料进入待分配状态，不复制给所有做法。
- [ ] 增加纯函数需求测试：只汇总所选做法；同一家庭原料 ID 累加；基准份数按计划份数缩放；适量、缺单位、单位不兼容、无做法均返回 `uncertain`，不返回推测数量；presence 不累计数量。
- [ ] 实现菜谱保存和编辑兼容：材料行引用本家 ID，候选标准名/已确认别名确定性匹配，未知名称保留待关联；新增条目仍需选择分类。
- [ ] 实现按原料筛选已有菜谱的确定性推荐，排序优先匹配材料更多的菜；AI 不参与。
- [ ] 运行 `node _selftest.js`；验证牛肉子类、别名、未知材料、备选做法和单位不确定情况。

## Task 3: 点餐按餐次分组并自动关联计划

**Files:** `server.js`, `public/app.js`, `public/styles.css`, `_selftest.js`

- [x] 增加 API 测试：餐次只允许 `lunch`/`dinner`、份数默认为 1、同一用户同餐次同菜重复提交不重复增加、多人同菜的订单身份仍各自保留。
- [ ] 增加订单/计划关系测试：同家庭日期餐次菜品共用一个计划事件，事件份数等于有效订单份数之和；临时菜创建无菜谱的待补项；删除一个订单仅减其份数；最后一个未完成订单删除时移除关联事件。
- [ ] 运行自测确认失败后，实现规范化字段和服务端同步关系；订单与计划事件关系通过 ID 保存，重复 API 请求不能重复关联。
- [x] 改造点餐弹窗：日期默认今天、餐次选择、每菜一份默认；列表按日期、餐次和菜品归组，同时保留个人订单及备注；支持调整份数。
- [x] 运行 `node _selftest.js` 验证多成员、同用户重试、临时菜和删除场景。

## Task 4: 计划事件选做法、按事件汇总采购

**Files:** `server.js`, `public/app.js`, `public/pantry-logic.js`, `_selftest.js`

- [x] 增加 API/逻辑测试：计划事件存日期、餐次、methodId、份数、关联 order IDs；完成事件不会重复扣库存。
- [x] 实现计划按日期和午餐/晚餐排序；订单联动事件可选做法；用户可另加独立烹饪事件。
- [x] 采购从未完成计划事件即时计算；库存或菜谱材料变更后重算；已完成事件不追溯改账。
- [x] 将点餐页采购清单和采购操作移除，保留厨房做菜提示；计划页保留数量采购、调料确认、入库和清单复制。
- [x] 运行 `node _selftest.js` 覆盖订单新增/撤销、库存入库、做法选择和菜谱材料。

## Task 5: 历史兼容与发布

**Files:** `server.js`, `_selftest.js`, `docs/product/2026-10-18-current-interface-product-logic.md`, `publish-update.js`

- [ ] 增加旧数据 fixture：订单无 meal/servings、计划无 methodId、全局原料引用、菜品级通用材料、历史已完成扣库存。先验证当前迁移未通过。
- [ ] 加入幂等迁移：旧订单餐次按可确认时间映射，无法确认则待排期；旧计划做法待选；完成库存流水原样保留；无法分配的旧材料在 UI 显示待处理。
- [x] 更新产品逻辑文档，删除“点餐页采购清单”和菜品级通用材料描述，写明计划派生采购与原料家庭作用域。
- [ ] 运行 `node --check server.js`, `node --check public/app.js`, `node _selftest.js`, `git diff --check`, `npm run publish:check`。
- [ ] 生成便携版时保留指定输出目录中的家庭数据；同步程序文件后校验版本、资源哈希和自测；提交并推送当前分支。

## 验收复核

- 点餐默认当天午/晚餐，每人默认一份，多人同菜聚合，个人订单可追溯。
- 每个订单最多关联一个烹饪事件；重复提交不重复累计；有额外烹饪需求可单独加事件。
- 每个计划事件明确做法；需求只计算该做法；份数按菜谱基准可靠缩放，否则提示需确认。
- 采购和库存确认仅在计划页；任何未完成计划依赖的菜谱/目录/库存变化都会即时重算。
- 家庭原料 ID、库存隔离；家庭目录修改不影响其他家庭或只读模板。
- AI 无配置时全部核心流程可用；不会把同类原料或单位强行合并。
