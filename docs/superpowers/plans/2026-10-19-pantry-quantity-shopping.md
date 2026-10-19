# 库存余量采购识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让当前家庭采购清单按库存余量识别已有、库存不足和待购买，并允许用户维护库存数量。

**Architecture:** 保持现有家庭级 `pantry` 和 `shopping-status` 数据模型；前端在汇总调料时解析需求数量与单位，读取当前家庭库存后实时计算状态。服务端只负责库存数据校验、持久化和现有家庭权限，不新增口令或全局状态。

**Tech Stack:** Node.js 原生 HTTP 服务、原生 JavaScript、JSON 数据文件、现有 Node 自测与便携版构建脚本。

---

### Task 1: 采购数量解析与库存比较辅助函数

**Files:**
- Modify: `E:/code/家庭菜单/public/app.js`，采购清单辅助函数（约 2200-2310 行）
- Test: `E:/code/家庭菜单/_selftest.js`，增加可被页面静态检查覆盖的采购规则断言

- [ ] 增加 `parseAmountText(text)`：识别 `数字 + 单位`，支持整数、小数和中文常见单位；无法识别时返回 `{ quantity: null, unit: '' }`。
- [ ] 在 `mergeSeasonings(rows)` 中汇总同名调料需求，保留 `requiredQty`、`requiredUnit`、`requiredComparable`；同名需求单位一致才累加，单位不同则标记不可直接比较。
- [ ] 增加 `stockAssessment(it)`：同单位库存合计与需求量可比较时返回 `enough` 或 `shortage` 及 `shortageQty`；库存为 0 返回 `needed`；无法比较但有库存返回 `uncertain`。
- [ ] 为无数量、单位不一致、库存为 0、同单位合计和库存不足差额补充可执行的浏览器端函数断言或在自测中检查源代码行为。

### Task 2: 采购清单状态与提示

**Files:**
- Modify: `E:/code/家庭菜单/public/app.js`，`shopListHtml`、批量采购工具条和入库操作
- Modify: `public/styles.css`，库存不足/需确认状态样式

- [ ] 用 `stockAssessment` 替换 `it.stock.length ? '已有' : ...` 的存在性判断。
- [ ] 状态显示规则固定为：`needed` 无库存、`shortage` 库存不足、`uncertain` 有库存但需确认、`enough` 已有；用户标记的 `completed` 仅在没有可用库存时显示已完成。
- [ ] 对 `shortage` 显示“库存 X，还需 Y 单位”，对 `uncertain` 显示“请确认余量”，仍显示库存明细。
- [ ] 库存不足和需确认条目保留“入库”按钮；已有条目不再显示入库按钮，避免重复入库误导。
- [ ] 不改变普通成员勾选、取消勾选和入库接口；入库成功后刷新当前家庭库存与采购状态。

### Task 3: 库存编辑与数据兼容

**Files:**
- Modify: `E:/code/家庭菜单/server.js`，`normPantryItem` 和库存接口（约 1148、3961 行）
- Modify: `public/app.js`，库存编辑表单、数量加减和库存卡片
- Test: `E:/code/家庭菜单/_selftest.js`

- [ ] 保持 `quantity` 最小 0、最大 99999、最多三位小数；输入空值按 0 保存并明确显示。
- [ ] 保持自由单位，不强制换算；库存卡片显示数量和单位，数量 0 显示“用完，待补”。
- [ ] 采购条目入库继续使用可解析用量，无法解析时默认 1 份，并允许用户在库存编辑表单中修正数量和单位。
- [ ] 增加服务端回归断言：普通家庭成员可新增、修改数量为 0、修改小数和删除库存；旧 pantry 数据读取不丢字段。

### Task 4: 文档与验收测试

**Files:**
- Modify: `E:/code/家庭菜单/docs/product/2026-10-18-family-workspace-flow.md`，补充数量比较规则和状态说明
- Modify: `E:/code/家庭菜单/docs/product/2026-10-18-current-interface-product-logic.md`（若存在），同步采购与库存说明
- Test: `E:/code/家庭菜单/_selftest.js`

- [ ] 更新产品文档中的采购流程图，加入“库存不足”和“需确认余量”。
- [ ] 运行 `node --check server.js`、`node --check public/app.js`、`git diff --check`。
- [ ] 运行 `node _selftest.js`，确认既有家庭权限、采购状态和库存测试全部通过。
- [ ] 运行 `node build-package.js`、`node _packtest.js`、`node publish-selftest.js`，确认便携版输出目录仍为 `E:/code/家庭菜单/package/家庭菜单-便携版/`。
- [ ] 重启或确认 `http://localhost:8787/`，手工验证同单位足够、不足、无库存、适量和单位不同五条路径。
- [ ] 提交本次代码和文档变更；尝试推送 GitHub，若网络不可达则保留本地提交并报告。
