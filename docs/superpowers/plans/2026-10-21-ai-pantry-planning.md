# AI 食材分类与计划库存协同 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate material display categories from stock tracking, track staple seasonings as present/absent, calculate weekly purchase gaps for quantity foods, and add user-confirmed AI classification and plan analysis.

**Architecture:** Keep `pantry.json` as the household-scoped source of truth and add `trackingMode` plus `hasStock` for presence-based items. Reuse explicit ingredient aliases and deterministic weekly requirement calculations; AI returns bounded JSON suggestions and explanations that require user confirmation. Preserve existing API and old pantry records through idempotent normalization.

**Tech Stack:** Node.js built-in HTTP server, vanilla JavaScript frontend, JSON file persistence, existing `_selftest.js` and `_packtest.js` suites.

---

## File Map

- Modify `server.js`: pantry normalization and migration, ingredient classification helper, AI task prompt/validation, and any household-scoped pantry handlers needed by presence updates.
- Modify `public/app.js`: material matching, recipe-plan aggregation, inventory editor and rows, AI suggestion review, seasoning confirmation, and plan analysis presentation.
- Create `public/pantry-logic.js`: dependency-free material matching, tracking-mode inference, plan-demand aggregation, and stock assessment shared by the browser and Node tests.
- Modify `public/styles.css`: compact styles for tracking-mode controls and AI review results only where current styles cannot express them.
- Modify `public/index.html`: load the pure pantry helper before `app.js`.
- Modify `_selftest.js`: server integration coverage for migration, presence items, AI task output validation, and existing plan/stock contracts.
- Create `_pantrylogic-test.js`: direct Node assertions for shared pantry and plan rules.
- Modify `_packtest.js`: portable-package assertions for presence inventory and updated assets if package validation requires them.
- Modify `docs/product/2026-10-18-current-interface-product-logic.md`: document the final material, plan, purchase, and stock rules.
- Create `docs/superpowers/specs/2026-10-21-ai-pantry-planning-design.md`: approved design spec, already committed as `217c081`.

## Task 1: Add Presence-Based Pantry Records and Idempotent Legacy Migration

**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: Add failing integration checks for pantry modes**

Add checks beside the existing pantry normalization tests. Creating an item with `trackingMode: 'presence', hasStock: true` must return those fields with quantity fields neutralized; invalid tracking modes must become `quantity`. An existing salt row with quantity `1` must normalize to `presence` and `hasStock: true`; the same row with quantity `0` must normalize to `hasStock: false`; a tomato row must retain its quantity and unit. An unknown legacy name under `调味干货` must remain quantity-tracked with its old quantity and unit.

- [ ] **Step 2: Run the suite and confirm the new assertions fail**

Run: `node _selftest.js`

Expected: failures specifically report missing `trackingMode`/`hasStock` normalization while the existing baseline checks continue running.

- [ ] **Step 3: Implement server normalization and migration**

In `normPantryItem`, normalize `trackingMode` to `presence` or `quantity`. When an old input omits the field, infer presence only from explicit known-seasoning names and aliases, including salt, sugar, soy sauce, vinegar, cooking wine, common sauces, spices and scallion/ginger/garlic. Do not infer presence from the legacy `调味干货` category alone. Infer `hasStock` from old quantity greater than zero. For presence items persist `hasStock`, set quantity/minimum to zero and unit to an empty string; for quantity items preserve the existing capped numeric validation and unit fallback. If an existing record explicitly has `trackingMode`, preserve that choice regardless of category. Unknown names from the old seasoning category remain quantity-tracked and can appear in the AI review suggestions.

Add regression coverage for restart/load normalization using the existing legacy-fixture harness. Ensure a second load preserves explicit `trackingMode` and `hasStock` instead of re-inferring them from category.

- [ ] **Step 4: Run the relevant suite and verify it passes**

Run: `node _selftest.js`

Expected: all existing server checks and the new migration checks pass.

- [ ] **Step 5: Commit the server model change**

```bash
git add server.js _selftest.js
git commit -m "feat: support presence-based pantry items"
```

## Task 2: Add a Validated AI Ingredient Classification Task

**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: Add failing AI task contract checks**

Extend the fake-AI request tests to call tasks `ingredient-classify` and `plan-analysis`. Assert that the classification task requests JSON with `name`, `category`, `trackingMode`, `confidence`, and `reason`; the analysis task requests concise explanations and review flags only, and explicitly cannot return stock writes or authoritative purchase quantities. Both tasks must reject an empty prompt and return the existing clear error for an unknown task.

- [ ] **Step 2: Run the suite and confirm the task is rejected as unknown**

Run: `node _selftest.js`

Expected: the new request receives HTTP 400 with `不认识这个 AI 任务` before implementation.

- [ ] **Step 3: Add the bounded prompt and result validation**

Add `ingredient-classify` and `plan-analysis` tasks to `AI_TASKS`. Restrict classification input to material names and current category/tracking-mode candidates; request one result per input name, confidence from `0` to `1`, and no inferred stock quantity. Validate every category against `PANTRY_CATEGORIES` and every mode against `presence`/`quantity`; discard invalid rows and return a clear failed result if the shape is not usable. The analysis task accepts only a precomputed plan summary and returns `{ "summary": "...", "flags": [{ "name": "...", "reason": "...", "suggestion": "..." }] }`; validate this as display-only text, not pantry writes or replacement quantities. Keep the established AI API configuration and current super-admin frontend gate.

- [ ] **Step 4: Run the AI contract and full self-test suite**

Run: `node _selftest.js`

Expected: fake provider receives both new tasks and all prior AI checks pass.

- [ ] **Step 5: Commit the AI task change**

```bash
git add server.js _selftest.js
git commit -m "feat: add AI ingredient classification task"
```

## Task 3: Update Inventory Editing and Add Confirmable AI Cleanup

**Files:**
- Modify: `public/app.js`
- Create: `public/pantry-logic.js`
- Create: `_pantrylogic-test.js`
- Modify: `public/index.html`
- Modify: `public/styles.css` only if needed for the confirmation list
- Test: `_pantrylogic-test.js`, browser interaction, and `_selftest.js` served-asset checks

- [ ] **Step 1: Define client-side tracking inference checks**

Create `_pantrylogic-test.js` using Node's built-in `assert` and `require('./public/pantry-logic')`. Add these assertions:

```js
const assert = require('assert');
const { inferTrackingMode } = require('./public/pantry-logic');
assert.strictEqual(inferTrackingMode({ name: '白砂糖', category: '其他' }), 'presence');
assert.strictEqual(inferTrackingMode({ name: '蒜末', category: '蔬菜' }), 'presence');
assert.strictEqual(inferTrackingMode({ name: '番茄', category: '蔬菜' }), 'quantity');
assert.strictEqual(inferTrackingMode({ name: '鸡肉', category: '肉类' }), 'quantity');
assert.strictEqual(inferTrackingMode({ name: '食盐', category: '调味干货', trackingMode: 'quantity' }), 'quantity');
```

Do not load application state or add external test dependencies.
- [ ] **Step 2: Run the focused check and confirm it fails**

Run: `node _pantrylogic-test.js`

Expected: the test fails because `public/pantry-logic.js` and `inferTrackingMode` do not exist yet.

- [ ] **Step 3: Implement the inventory mode controls and AI review**

Implement the pure helpers in `public/pantry-logic.js`, load that script before `app.js` in `public/index.html`, and replace duplicate client helpers with the shared functions. Keep the helper free of DOM/network access so `_pantrylogic-test.js` can require it. Update the stock editor so typing/picking a material applies local preset defaults but always leaves category and tracking mode editable. Show `presence` items with a binary “家里有 / 没有” control and omit quantity, unit and minimum-stock inputs. Keep all existing quantity and expiration controls for `quantity` items. Add “AI 整理分类” to the inventory view; send only current household item names/categories/modes, render returned proposals with confidence, and save only rows the user explicitly confirms. Keep cancel/skip actions non-mutating and preserve explicitly stored user values unless checked for replacement.

- [ ] **Step 4: Verify server normalization, client assets and browser workflow**

Run: `node _pantrylogic-test.js`

Run: `node _selftest.js`

Then open `http://localhost:8787/` and verify: an existing seasoning displays no quantity controls; a normal food retains quantity controls; AI proposals can be edited, selectively confirmed, skipped, and cancelled without silently changing unselected rows.

- [ ] **Step 5: Commit the inventory workflow change**

```bash
git add public/app.js public/pantry-logic.js public/index.html public/styles.css _pantrylogic-test.js _selftest.js
git commit -m "feat: add presence stock controls and AI review"
```

## Task 4: Make Weekly Plan and Shopping Rules Tracking-Mode Aware

**Files:**
- Modify: `public/app.js`
- Modify: `public/pantry-logic.js`
- Modify: `server.js` only if a household-scoped persistence action is required for explicit presence confirmation
- Test: `_pantrylogic-test.js` and `_selftest.js`

- [ ] **Step 1: Add failing plan aggregation checks**

Extend `_pantrylogic-test.js` with `aggregatePlanMaterials(rows, options)` and `assessStock(item)` tests. The helper contract is:

```js
aggregatePlanMaterials(rows, {
  normalizeName(name),
  inferTrackingMode(row),
  parseAmount(amount),
  stockFor(name),
  categoryFor(name),
});
assessStock(item); // returns enough, shortage, needed, uncertain, or presence state
```

Use three tomato rows from two dishes with amounts `2 个`, `1 个`, and `2 个`; the result must have `useCount: 3` and `requiredQty: 5`. Use two salt rows with unrelated spoon/gram amounts; they must produce one presence item with null quantity/unit. Assert same-unit shortage, enough stock, and mismatched units separately.

- [ ] **Step 2: Run the focused suite and confirm it fails**

Run: `node _pantrylogic-test.js`

Expected: total tomato demand and unit-mismatch assertions fail before the shared aggregation implementation is added.

- [ ] **Step 3: Implement plan-aware aggregation and seasoning confirmation**

Implement `aggregatePlanMaterials(rows, options)` and `assessStock(item)` in `public/pantry-logic.js`. The aggregator must use explicit tracking mode, then recipe `purchaseType`, then known material aliases; `category` alone must never select presence mode. It must merge same-name presence items without parsing their amounts and sum quantity items only when parsed units agree. In `public/app.js`, pass only uncompleted plan rows for the active household week and the existing pantry matcher. When no presence record exists show a confirmation prompt; “家里有” and “需要购买” create/update a household pantry presence record with `hasStock: true` or `false`, respectively. After buying a seasoning, the household marks “家里有” to set `hasStock: true` without quantity/unit entry. Existing quantity purchase status and one-time completion deduction behavior must remain intact.

- [ ] **Step 4: Add an AI plan analysis action that only explains computed results**

Add a plan-page “AI 备菜分析” action using `plan-analysis`. Send the already aggregated material list, deterministic shortage results and unresolved unit/category questions. Parse `{ summary, flags: [{ name, reason, suggestion }] }` and render it as read-only explanation text; do not alter purchase state, quantity, or stock. If AI is unavailable, leave the existing plan view fully usable.

- [ ] **Step 5: Run the full test suite and verify manual scenarios**

Run: `node _selftest.js`

Run: `node _pantrylogic-test.js`

Run: `node _packtest.js`

In the browser verify a week with tomato plans repeated five times, one tomato stock row, multiple dishes using salt, and an unparseable/mismatched unit. Expected: tomato demand is summed before shortage comparison; salt appears once with a binary confirmation and no quantity; the mismatch prompts manual confirmation; completing a dish subtracts quantity inventory once.

- [ ] **Step 6: Commit plan and shopping behavior**

```bash
git add public/app.js public/pantry-logic.js server.js _pantrylogic-test.js _selftest.js
git commit -m "feat: align weekly shopping with pantry modes"
```

## Task 5: Update Product Documentation and Build the Portable Package

**Files:**
- Modify: `docs/product/2026-10-18-current-interface-product-logic.md`
- Verify: `build-package.js`, `_packtest.js`, `package/家庭菜单-便携版`

- [ ] **Step 1: Document the shipped workflow**

Update the product logic document with the final distinction between display category and `trackingMode`, old-data migration, seasoning presence confirmation, quantity-food weekly aggregation, completion deduction, AI confirmation and deterministic shortage calculation.

- [ ] **Step 2: Build and test the portable package**

Run: `node build-package.js`

Run: `node _packtest.js`

Expected: the package includes the new app/server behavior, excludes private AI credentials and pantry data, and portable API tests pass.

- [ ] **Step 3: Run all final checks**

Run: `node _selftest.js`

Run: `node _pantrylogic-test.js`

Run: `node publish-selftest.js`

Expected: all checks pass with no test failures.

- [ ] **Step 4: Commit the documentation and package-build inputs**

```bash
git add docs/product/2026-10-18-current-interface-product-logic.md
git commit -m "docs: explain AI pantry and planning workflow"
```

- [ ] **Step 5: Publish the completed update**

Push the implementation commits to the configured GitHub remote and verify the push result. Confirm `package/家庭菜单-便携版` exists and passes its own self-test. Report any network failure accurately; do not describe an unpushed local commit as published.
