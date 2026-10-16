# 管理员与普通用户工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通用户只能使用家庭日常功能和维护本家私菜，让管理员独占共享菜单、做饭状态、家庭管理和系统设置。

**Architecture:** 保留现有单页应用和管理口令会话，在前端按角色切换工作区入口，在服务端对点餐状态写操作做独立管理员校验。状态接口按当前家庭过滤普通用户可见的家庭数据，并补齐加入申请数据；管理员会话仍可读取完整状态。

**Tech Stack:** Node.js 原生 HTTP 服务、原生 JavaScript 前端、JSON 文件数据、现有 `_selftest.js` 接口自检。

---

### Task 1: 服务端状态范围与加入申请数据

**Files:**
- Modify: `server.js` in `GET /api/state`
- Test: `_selftest.js` state and permission sections

- [ ] **Step 1: Add the selected household and member query inputs**

  Read `householdId` and `memberName` from `/api/state` query parameters. Treat a request as administrator-visible when no admin PIN is configured or the request carries a valid session token.

- [ ] **Step 2: Return `access` and filter ordinary-user state**

  Always include `access: { requests: ... }`. Return all requests to administrators; return only requests matching the supplied member name to ordinary users. For ordinary users, include shared dishes/categories plus private resources for the requested household, and filter orders, pantry, plans, notes, and dish votes to that household. Keep the household list available for the picker.

- [ ] **Step 3: Add self-tests for the response contract**

  Create a second household and private dish/order, set an admin PIN, call `/api/state?householdId=<first>&memberName=我` without a token, and assert that `access` exists, the other household's private dish/order is absent, and the shared dish remains. Call the same endpoint with the admin token and assert the second household data is present.

- [ ] **Step 4: Run the focused self-test**

  Run `node _selftest.js`; expected result is zero failures.

### Task 2: Administrator-only cooking status mutations

**Files:**
- Modify: `server.js` in the `/api/orders` route
- Modify: `public/app.js` in `orderItem`, `viewOrder`, and order action handlers
- Test: `_selftest.js` permission section

- [ ] **Step 1: Add server-side guards for order management writes**

  Keep `POST /api/orders` available to ordinary users. Require `isAuthed(req)` for `PATCH /api/orders`, `PATCH /api/orders/:id`, and all order deletion endpoints (`DELETE /api/orders`, `/done`, and `/:id`). Return the existing 401 message when the request lacks an administrator session.

- [ ] **Step 2: Hide cooking controls from ordinary users**

  Render “开做”, “完成”, “一键开做”, batch status buttons, clear-completed, delete-order, and order multi-select only when `isAdmin()` is true. Ordinary users continue to see the status and can submit new orders; add a short “管理员更新状态” hint where an action would otherwise appear.

- [ ] **Step 3: Add client-side guards as a UX fallback**

  Guard `set-status`, `batch-status`, `start-all`, `clear-done`, and `del-order` with an administrator check before making a request. The server remains the authoritative protection.

- [ ] **Step 4: Add self-tests for ordinary and administrator requests**

  With a configured PIN, assert that an unauthenticated PATCH status and DELETE order return 401, while the same requests with the admin token succeed. Assert that ordinary POST order still returns 200.

- [ ] **Step 5: Run the focused self-test**

  Run `node _selftest.js`; expected result is zero failures.

### Task 3: Role-aware navigation and persistent current member

**Files:**
- Modify: `public/index.html` only if the tab needs a role-neutral label
- Modify: `public/app.js` in local-storage constants, `meName`, household switching, `loadState`, `render`, and `viewManageMember`
- Modify: `README.md` permission and usage sections

- [ ] **Step 1: Persist the selected member per household**

  Store a small JSON map under a new `familyMenu.memberNames` local-storage key. Make `meName()` restore the saved member for the current household, fall back to the first registered member, and save updates from the member picker and join-request form.

- [ ] **Step 2: Request scoped state during initial load**

  Include the saved household and member name in the `/api/state` query. After loading, reconcile the selected household and member against the returned households and persist the final valid selection.

- [ ] **Step 3: Rename the ordinary-user workspace**

  In `render()`, change the bottom tab label to “我的私菜” for ordinary users and “管理” for administrators. Keep the ordinary workspace available, but remove its version/settings section and replace it with a compact administrator-entry row that opens the unlock prompt.

- [ ] **Step 4: Make the ordinary workspace explain its boundary**

  Keep private dish/category CRUD and read-only shared dishes/categories, but use direct copy: “这里可以维护你家私菜；共享菜谱和家庭设置由管理员维护。”

- [ ] **Step 5: Update the README**

  Document the two workspaces, administrator-only cooking status, persistent member selection, and the open-mode warning when no PIN is configured.

- [ ] **Step 6: Run syntax and interface checks**

  Run `node --check server.js`, `node --check public/app.js`, `node _selftest.js`, and `node _packtest.js`; all commands must exit successfully.

### Task 4: Package and publish verification

**Files:**
- Modify: `server.js`, `public/app.js`, `README.md`, `_selftest.js`
- Generated: `package/家庭菜单-便携版/`, `package/家庭菜单-便携版.zip`

- [ ] **Step 1: Run the existing release checks**

  Run `npm run publish:check` and confirm the publish self-test passes.

- [ ] **Step 2: Rebuild the portable package**

  Run `npm run publish`; confirm the package directory and ZIP are regenerated and the local commit is created.

- [ ] **Step 3: Verify the final Git state**

  Run `git status --short --branch` and report any push failure separately from local verification.
