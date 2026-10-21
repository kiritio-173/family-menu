(function (root) {
  'use strict';

  function filterIngredientsByCategory(ingredients, categories, categoryId) {
    const categoryRows = Array.isArray(categories) ? categories : [];
    const allowed = new Set([categoryId]);
    let changed = true;
    while (changed) {
      changed = false;
      categoryRows.forEach((category) => {
        if (!allowed.has(category.id) && allowed.has(category.parentId)) {
          allowed.add(category.id);
          changed = true;
        }
      });
    }
    return (Array.isArray(ingredients) ? ingredients : []).filter((ingredient) => allowed.has(ingredient.categoryId));
  }

  function filterIngredientsByScope(ingredients, householdId) {
    return (Array.isArray(ingredients) ? ingredients : []).filter((ingredient) =>
      ingredient && (ingredient.scope === 'global' || (!!householdId && ingredient.householdId === householdId)));
  }

  function applyIngredientToRecipeRow(dish, rowId, ingredient) {
    if (!dish || !ingredient || !ingredient.id) return false;
    const parts = String(rowId || '').split(':');
    let row = null;
    if (parts[0] === 'general' && parts.length === 2) row = (dish.seasonings || [])[Number(parts[1])];
    if (parts[0] === 'method' && parts.length === 3) row = dish.methods?.[Number(parts[1])]?.seasonings?.[Number(parts[2])];
    if (!row) return false;
    row.name = ingredient.name;
    row.ingredientId = ingredient.id;
    row.categoryId = ingredient.categoryId || '';
    return true;
  }

  function validateAiMatches(response, rows, ingredients, householdId, allowGlobal) {
    const rawMatches = Array.isArray(response) ? response : response && response.matches;
    if (!Array.isArray(rawMatches)) return [];

    const validRows = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row && row.id || '')));
    const validIngredients = new Set((Array.isArray(ingredients) ? ingredients : [])
      .filter((ingredient) => ingredient && (ingredient.scope === 'global' || (!!householdId && allowGlobal !== false && ingredient.householdId === householdId)))
      .map((ingredient) => String(ingredient.id || '')));
    const counts = new Map();
    rawMatches.forEach((match) => {
      const rowId = String(match && match.rowId || '');
      counts.set(rowId, (counts.get(rowId) || 0) + 1);
    });

    const seen = new Set();
    return rawMatches.flatMap((match) => {
      const rowId = String(match && match.rowId || '');
      const ingredientId = String(match && match.ingredientId || '');
      if (!validRows.has(rowId) || counts.get(rowId) !== 1 || seen.has(rowId) || !validIngredients.has(ingredientId)) return [];
      seen.add(rowId);
      return [{ rowId, ingredientId }];
    });
  }

  function filterCurrentAiMatches(matches, snapshot, currentRows) {
    const requested = new Map((Array.isArray(snapshot) ? snapshot : []).map((row) => [
      String(row && row.rowId || ''),
      { name: String(row && row.name || ''), ingredientId: String(row && row.ingredientId || '') },
    ]));
    const current = new Map((Array.isArray(currentRows) ? currentRows : []).map((row) => [
      String(row && row.rowId || ''),
      { name: String(row && row.name || ''), ingredientId: String(row && row.ingredientId || '') },
    ]));
    return (Array.isArray(matches) ? matches : []).filter((match) => {
      const rowId = String(match && match.rowId || '');
      const before = requested.get(rowId);
      const now = current.get(rowId);
      return !!before && !!now && before.name === now.name && before.ingredientId === now.ingredientId;
    }).map((match) => ({ rowId: String(match.rowId), ingredientId: String(match.ingredientId) }));
  }

  const api = { filterIngredientsByCategory, filterIngredientsByScope, applyIngredientToRecipeRow, validateAiMatches, filterCurrentAiMatches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RecipeIngredientLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
