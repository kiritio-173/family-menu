# 零库存清理与花生分类实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数量型库存归零后自动移除，并将做菜花生归入豆制品分类。

**Architecture:** 服务端在库存写入和计划扣减的权威路径维护“数量型库存必须大于 0”的不变量，并在启动迁移清理旧记录。`presence` 型库存继续用 `hasStock` 表示有无，不受零数量清理影响。预置食材只将做菜用花生及其做法名称映射到现有豆制品根分类。

**Tech Stack:** Node.js HTTP API、JSON 文件存储、原生 JavaScript、`_selftest.js`。

---

## 文件地图

- 修改 `server.js`：库存规范化/保存、计划扣减、启动迁移和花生预置分类。
- 修改 `_selftest.js`：覆盖恰好扣完、手动归零、旧零库存迁移、presence 保留和花生分类。
- 修改 `package.json` 与 `server.js` 发布记录：版本号和更新日志。
- 更新便携版目录与压缩包并做冷启动验证。

## Task 1: 用测试定义零库存规则与花生分类

1. 扩展计划完成测试：库存刚好满足菜谱用量后，库存行不存在。
2. 增加 API 测试：将现存数量型库存保存为 0 后删除；新建数量为 0 的库存不创建；`presence` 行仍能保存为 `hasStock: true`。
3. 增加旧数据启动测试：清理数量型零库存，保留 presence 行。
4. 断言预置花生归豆制品，薯片/瓜子等仍归零食。
5. 运行 `node _selftest.js`，确认新断言在实现前失败。

## Task 2: 实现库存零量删除

1. 计划扣减时先按现有单位规则扣量；被扣至 0 的数量型行从 `state.pantry` 移除，并仍将已消耗量记入响应。
2. 库存 API 保存数量型 0 时删除已有行；POST 零数量不创建库存记录并返回明确结果。presence 行保持原流程。
3. `loadState()` 规范化旧库存后，过滤掉数量型 `quantity <= 0` 的行，并通过 `scheduleSave('pantry')` 持久化迁移。
4. 运行 `node _selftest.js` 和 `node _pantrylogic-test.js`。

## Task 3: 修正花生预置并发布

1. 将菜用“花生”“花生米”“油酥花生米”映射到豆制品；保留“混合坚果”“瓜子”等零食分类。
2. 将版本从 `1.29.0` bump 至 `1.29.1`，写明零库存清理及分类修正。
3. 运行完整接口、计划逻辑、发布流程和便携版冷启动测试，重建 `package/家庭菜单-便携版`。
4. 提交并推送当前 `main`；若 GitHub 网络仍不可达，保留本地提交并报告状态。
