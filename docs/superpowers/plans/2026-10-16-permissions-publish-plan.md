# 家庭菜单权限与发布流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留普通用户维护自家私菜的能力，阻止其修改共享菜单和管理员设置，并提供可重复的提交、推送、便携版打包流程。

**Architecture:** 继续使用现有服务端口令守卫和 `my-dishes`/`my-categories` 自有资源接口；新增独立发布脚本统一执行版本校验、Git 提交/推送和 `build-package.js`。发布脚本只提交明确的应用文件，避免把本地数据、备份和临时脚本带进仓库。

**Tech Stack:** Node.js 原生 API、PowerShell、Git、现有 `_selftest.js` 和 `_packtest.js`。

---

### Task 1: 固化普通用户权限边界

**Files:**
- Modify: `_selftest.js`
- Modify: `server.js` only if a failing test exposes a missing server guard
- Modify: `public/app.js` only if a failing test exposes a UI permission leak

- [ ] Add regression cases proving ordinary users can write private dishes/categories but cannot write shared dishes/categories or administrator settings.
- [ ] Run the focused self-test and observe the expected failure for any missing behavior.
- [ ] Implement only the missing guard or UI change.
- [ ] Run the full self-test and verify the permission cases pass.

### Task 2: Add repeatable publish workflow

**Files:**
- Create: `publish-update.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `server.js` and `package.json` version values if needed

- [ ] Add a script that checks the working tree, runs syntax checks, runs `_selftest.js`, runs `build-package.js`, stages only application files, creates a commit, and pushes `main` to `origin`.
- [ ] Make the script fail before commit/push if checks or packaging fail.
- [ ] Add `npm run publish` and document the workflow.
- [ ] Verify the script's dry-run/validation behavior without pushing an empty commit.

### Task 3: Build and publish the current update

**Files:**
- Generated: `package/家庭菜单-便携版/`
- Generated: `package/家庭菜单-便携版.zip`

- [ ] Run the full self-test and portable package cold-start test.
- [ ] Run the publish workflow with the current update.
- [ ] Verify `origin/main` contains the new commit and the portable package files match the source files.

