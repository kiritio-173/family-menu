# Recipe Scope Copy Implementation Plan

> **For agentic workers:** Use inline execution for this user-approved change. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household member copy shared recipes into household private recipes and let an authorized household administrator copy private recipes into the shared menu, with each copy independent.

**Architecture:** Keep the existing exclusive recipe ownership model. Add a guarded copy-to-shared API alongside the existing adopt-to-household API, normalize destination category and ingredient references, and expose scope-specific copy actions in recipe details. Keep the source recipe unchanged and reject duplicate copies from the same source into the same destination scope.

**Tech Stack:** Node.js HTTP API, vanilla JavaScript frontend, `_selftest.js` integration tests.

---

### Task 1: Verify scope-copy API contracts

**Files:**
- Modify: `_selftest.js`
- Test: `_selftest.js`

- [x] Add tests for shared-to-household copying, private-to-shared copying, source preservation, independent destination edits, repeat-copy rejection, and authorization failures.
- [x] Run `node _selftest.js` and confirm failures identify the missing copy behavior.

### Task 2: Implement copy endpoints and destination normalization

**Files:**
- Modify: `server.js`

- [x] Add a shared helper that copies recipe data into a target scope, maps categories to target-visible categories, maps exact ingredient names/aliases to destination ingredient IDs, and drops IDs unavailable in the target scope.
- [x] Keep `/api/my-dishes/:id/adopt` as the household copy endpoint and reject a second copy of the same source into that household.
- [x] Add `/api/dishes/:id/copy-to-shared`, requiring membership in and administrator rights over the source household; reject an existing shared copy of the source.
- [x] Run `node _selftest.js` and `node _pantrylogic-test.js`.

### Task 3: Add explicit menu actions and product documentation

**Files:**
- Modify: `public/app.js`
- Modify: `docs/product/2026-10-18-current-interface-product-logic.md`
- Modify: `README.md`

- [x] Show “收进我家” for shared recipes when the account belongs to the selected household.
- [x] Show “添加到共享” for current-household private recipes when the account is that household's administrator; preserve the existing recipe editor as an edit action only.
- [x] Remove recipe visibility changes from the editor; new recipes inherit the selected menu scope and batch import follows that scope.
- [x] Refresh menu state after copy and explain when the recipe already exists in the target scope.
- [x] Document independent copies, permission rules, and destination category/ingredient mapping.
- [x] Run `node _selftest.js`, `node _pantrylogic-test.js`, and `node _packtest.js`.
