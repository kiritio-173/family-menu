# 菜谱原料统一选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 菜谱通用材料与做法材料使用家庭原料字典和分类选择，计划与库存通过同一原料 ID 判定，并让 AI 仅辅助匹配旧材料到已有条目。

**Architecture:** 在 `public/app.js` 把原料行改为层级分类、分类过滤后的家庭原料、烹饪用量和删除操作；新增材料直接保存到家庭字典并链接当前草稿。AI 整理只给出由请求白名单限制的材料行 ID 和候选原料 ID，页面校验且用户确认后再保存。`public/pantry-logic.js`、`server.js` 和旧菜谱序列化统一忽略逐行 `purchaseType`，继续以原料默认方式和已有库存覆盖决定计划状态。

**Tech Stack:** Node.js 16+, vanilla JavaScript, built-in Node `assert`, `_selftest.js` isolated HTTP test harness.

---

## Files and responsibilities

- `public/recipe-ingredient-logic.js` (new): pure category filtering and AI candidate validation helpers usable by browser and Node tests.
- `public/index.html`: load the helper before `app.js`.
- `public/app.js`: render and update the shared ingredient picker for general and method-specific recipe rows; preserve unresolved legacy values; add old-material AI matching and confirmation UI.
- `public/pantry-logic.js`: remove recipe-row `purchaseType` overrides from plan aggregation and inferred tracking.
- `server.js`: stop using legacy row `purchaseType` when linking legacy recipe rows; stop serializing it on saved dishes; retain household ID validation for ingredient references.
- `_selftest.js`: add unit-style assertions for picker helpers and integration assertions for recipe save, legacy mapping validation, plan aggregation and copy-to-household behavior.
- `package.json`, `CHANGELOG.md`, `public/app.js` release metadata: update version and user-visible release notes after verification.
- `docs/product/2026-10-18-current-interface-product-logic.md` if present: align the recipe/plan/pantry explanation with the shipped behavior.
- `E:/code/家庭菜单/package/家庭菜单-便携版`: regenerate using the repository's publish scripts after tests pass.

## Task 1: Add pure picker and AI response rules

**Files:**
- Create: `public/recipe-ingredient-logic.js`
- Modify: `public/index.html`
- Modify: `_selftest.js`

- [ ] **Step 1: Add failing helper assertions**

At the top of `_selftest.js`, require the helper and assert that a category returns its own and descendant ingredients, excludes sibling categories, and accepts only response row IDs and ingredient IDs present in the submitted allowlists. Include a candidate from a different household in the catalog and assert that it is rejected.

```js
const RecipeIngredientLogic = require(path.join(ROOT, 'public', 'recipe-ingredient-logic.js'));
assert.deepStrictEqual(
  RecipeIngredientLogic.filterIngredientsByCategory(ingredients, categories, 'cat-beef').map((row) => row.id),
  ['ing-steak', 'ing-tenderloin']
);
assert.deepStrictEqual(
  RecipeIngredientLogic.validateAiMatches(
    [{ rowId: 'row-1', ingredientId: 'ing-steak' }, { rowId: 'row-2', ingredientId: 'foreign-id' }],
    [{ id: 'row-1', name: '牛排' }, { id: 'row-2', name: '牛里脊' }],
    [{ id: 'ing-steak', householdId: 'h1' }],
    'h1'
  ),
  [{ rowId: 'row-1', ingredientId: 'ing-steak' }]
);
```

- [ ] **Step 2: Run the test and confirm the helper is missing**

Run: `node _selftest.js`
Expected: FAIL immediately because `public/recipe-ingredient-logic.js` does not exist.

- [ ] **Step 3: Implement the minimal pure helper and load it before the app**

Export `filterIngredientsByCategory(ingredients, categories, categoryId)` which includes the selected category and its descendants, and `validateAiMatches(response, rows, ingredients, householdId)` which returns only unique pairs whose row ID and ingredient ID were in the exact request allowlists and whose ingredient belongs to the household. Ignore free-text fields and reject duplicate row assignments. Add CommonJS and browser-global exports, then load `/recipe-ingredient-logic.js` before `/app.js`.

- [ ] **Step 4: Run the focused self-test assertions**

Run: `node _selftest.js`
Expected: helper assertions pass; any later legacy expectations remain unchanged until their task is reached.

## Task 2: Remove recipe-row tracking overrides from plan logic and persistence

**Files:**
- Modify: `public/pantry-logic.js`
- Modify: `server.js`
- Modify: `_selftest.js`

- [ ] **Step 1: Add failing regression cases**

Add cases where two rows with the same `ingredientId` have conflicting old `purchaseType` values. Assert the tracking mode follows the provided ingredient/stock `trackingMode`, not either legacy field; presence materials do not accumulate numeric amount. Assert saved normalized dishes omit `purchaseType` while preserving `name`, `amount`, and `ingredientId`.

- [ ] **Step 2: Run the focused checks and confirm they fail**

Run: `node _selftest.js`
Expected: the new regression assertions fail because plan aggregation and `normDish` still preserve `purchaseType`.

- [ ] **Step 3: Make the smallest production changes**

In `public/pantry-logic.js`, remove the `purchaseType` branches from `inferTrackingMode`, `aggregatePlanMaterials`, and its output. In `server.js`, remove `purchaseType` use from `ensureHouseholdIngredient` and omit it from normalized general and method-specific seasonings. Keep old JSON readable; the next successful dish save naturally drops the ignored field. Keep `dishIngredientReferenceProblem` household validation intact.

- [ ] **Step 4: Run the regression checks and then the full self-test**

Run: `node _selftest.js`
Expected: new assertions pass and no unrelated self-test failures occur.

## Task 3: Build the shared category and ingredient picker

**Files:**
- Modify: `public/app.js`
- Modify: `_selftest.js`

- [ ] **Step 1: Add failing markup and draft behavior checks**

Add source assertions that the general and method ingredient rows use the shared picker renderer, include category and ingredient selectors, preserve a quantity text input, and contain no `seasoningTypeSelect`, `season-type`, or `mseason-type` control. Add a behavior assertion that selecting an ingredient writes its ID and canonical name to the correct draft row.

- [ ] **Step 2: Run the focused checks and confirm they fail**

Run: `node _selftest.js`
Expected: picker-specific assertions fail against the current free-text rows and third-column selector.

- [ ] **Step 3: Implement a reusable picker row renderer**

Add helpers in `public/app.js` to render flattened category paths, list only ingredients in the selected category subtree using `RecipeIngredientLogic`, and render category, ingredient, amount, and delete controls. Use the same helper for `dish.seasonings` and `method.seasonings`. On category changes, clear the row's `ingredientId` and selected name; on ingredient selection, persist `ingredientId` and canonical ingredient name while keeping `amount` unchanged. Add an unresolved legacy row state that displays original name and amount without silently selecting the first category or ingredient.

- [ ] **Step 4: Connect all draft events and collect/save logic**

Replace `season-name`, `mseason-name`, `season-type`, and `mseason-type` event handling with category/ingredient actions for both row scopes. Ensure `collectDish()` keeps only `name`, `ingredientId`, and `amount` for each non-empty material. Remove duplicated `seasoningTypeSelect` and name-datalist rendering from the editor.

- [ ] **Step 5: Run tests and check both row types**

Run: `node _selftest.js`
Expected: both general and method-specific rows preserve independent IDs and amounts; there are no legacy selector assertions left expecting the old third column.

## Task 4: Add inline creation for the selected category

**Files:**
- Modify: `public/app.js`
- Modify: `_selftest.js`

- [ ] **Step 1: Add failing creation-flow assertions**

Assert that the picker exposes “新增原料” for an eligible household row, includes the selected category ID in the create action, and that successful creation selects the returned canonical name and ID in the originating general or method row.

- [ ] **Step 2: Run the focused checks and confirm they fail**

Run: `node _selftest.js`
Expected: current quick-create UI is a separate sheet and does not target the originating row or selected category.

- [ ] **Step 3: Implement row-scoped inline creation**

Open the existing create sheet from the row action with row scope and selected category. Reuse the current `POST /api/ingredients` endpoint and category permission behavior. On success, reload family state, restore the open draft, select the new ingredient in the originating row, and preserve all other draft rows. Do not create a category from the member flow; retain the existing administrator-only child-category path where already offered.

- [ ] **Step 4: Verify duplicate and failed-create behavior**

Run: `node _selftest.js`
Expected: duplicate names show the server error without clearing the draft; successful creation affects only the active household and selected draft row.

## Task 5: Add bounded AI matching for unresolved legacy materials

**Files:**
- Modify: `public/app.js`
- Modify: `public/recipe-ingredient-logic.js`
- Modify: `_selftest.js`

- [ ] **Step 1: Add failing allowlist and stale-row cases**

Test the validator against invented IDs, IDs from another household, duplicate row assignments, duplicate input rows, missing rows, extra JSON properties, and an input row changed after the request snapshot. Assert only exact request row IDs and current household ingredient IDs can be presented for confirmation.

- [ ] **Step 2: Run the focused checks and confirm failures**

Run: `node _selftest.js`
Expected: candidate validation assertions fail until the helper and UI snapshot checks are complete.

- [ ] **Step 3: Implement AI request and confirmation without generated content**

Offer AI matching only when the existing AI feature is available. Send only pending row IDs/names and the current household ingredient IDs/names/confirmed aliases/category paths. Instruct the model to return only `{ "matches": [{ "rowId": "...", "ingredientId": "..." }] }`, and no match for uncertainty. Do not send amounts, inventory quantities, user data, or unrelated recipe fields. Validate output through `validateAiMatches`; render candidate display names from the local dictionary, never model-provided names, reasons, confidence, aliases, or categories. Require explicit per-row confirmation before writing draft IDs. When uncertain, malformed, unmatched, stale, or unavailable, leave the original row untouched and keep manual selection available.

- [ ] **Step 4: Run AI boundary tests**

Run: `node _selftest.js`
Expected: fabricated IDs and generated free-text fields are ignored; no AI response changes a dish before the user confirms and saves.

## Task 6: Verify plan, household copy, migration and release output

**Files:**
- Modify: `_selftest.js`
- Modify: `CHANGELOG.md` and release metadata in `public/app.js` (only after tests pass)
- Modify: relevant product logic document if present
- Generate: `E:/code/家庭菜单/package/家庭菜单-便携版`

- [ ] **Step 1: Add integration cases before final implementation adjustments**

Cover a category with multiple distinct ingredients, a `presence` ingredient with recipe amount text, a `quantity` ingredient repeated across multiple planned dishes, old materials with no ID, old `purchaseType` values, copied shared recipes, and rejection of foreign household ingredient IDs. Assert no legacy purchase value changes mode or gets written on the next dish save.

- [ ] **Step 2: Run the full self-test and fix only failing behavior**

Run: `node _selftest.js`
Expected: all API and recipe ingredient integration cases pass.

- [ ] **Step 3: Update version and product notes**

Increment the application version using the repository's release convention. State that recipe materials now share family ingredient IDs with planning and pantry, and legacy AI matching only proposes existing entries for user confirmation. Do not claim AI creates or classifies materials.

- [ ] **Step 4: Build and verify the portable package**

Run: `npm run publish:check`, then `npm run publish`.
Expected: publish self-test succeeds and the portable output at `E:/code/家庭菜单/package/家庭菜单-便携版` contains the same current version and updated assets.

- [ ] **Step 5: Run final checks and inspect the worktree**

Run: `node _selftest.js`; `npm run publish:check`; `git diff --check`; `git status --short`.
Expected: all commands exit 0; only this feature's code, tests, docs, release output and intended commits are present. Preserve the pre-existing modified permission plan and `.superpowers/` directory.

## Self-review

- Every feature requirement in the design spec maps to Tasks 1-6: selectors, inline addition, shared household identity, quantity/presence behavior, legacy compatibility, household isolation, and constrained AI matching.
- AI output is restricted to known row and ingredient IDs; all display data comes from the local dictionary and no mapping saves without explicit user confirmation.
- `ingredientId` is the aggregation key across recipe, plan, and pantry; different ingredients in the same category remain distinct.
- The feature does not broaden family roles, AI availability, stock quantity editing, or recipe ownership rules.
