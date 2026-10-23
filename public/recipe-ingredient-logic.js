/* Shared, side-effect-free helpers for the recipe ingredient picker. */
(function attachRecipeIngredientLogic(root) {
  'use strict';

  function descendantsOf(categories, categoryId) {
    const list = Array.isArray(categories) ? categories : [];
    const wanted = String(categoryId || '');
    if (!wanted) return new Set();
    const children = new Map();
    list.forEach((category) => {
      if (!category || !category.id) return;
      const parent = String(category.parentId || '');
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(String(category.id));
    });
    const found = new Set([wanted]);
    const queue = [wanted];
    while (queue.length) {
      const current = queue.shift();
      (children.get(current) || []).forEach((child) => {
        if (found.has(child)) return;
        found.add(child);
        queue.push(child);
      });
    }
    return found;
  }

  function filterIngredientsByCategory(ingredients, categories, categoryId, keyword) {
    const allowed = descendantsOf(categories, categoryId);
    const needle = String(keyword || '').trim().toLocaleLowerCase();
    return (Array.isArray(ingredients) ? ingredients : [])
      .filter((ingredient) => ingredient && allowed.has(String(ingredient.categoryId || '')))
      .filter((ingredient) => {
        if (!needle) return true;
        return [ingredient.name, ...(Array.isArray(ingredient.aliases) ? ingredient.aliases : [])]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(needle));
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  }

  function validateAiMatches(response, rows, ingredients, householdId) {
    const allowedRows = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row && row.id || '')));
    const allowedIngredients = new Set((Array.isArray(ingredients) ? ingredients : [])
      .filter((ingredient) => ingredient && ingredient.householdId === householdId)
      .map((ingredient) => String(ingredient.id || '')));
    const matches = Array.isArray(response)
      ? response
      : response && Array.isArray(response.matches) ? response.matches : [];
    const seenRows = new Set();
    const seenIngredients = new Set();
    const out = [];
    matches.forEach((match) => {
      const rowId = String(match && match.rowId || '');
      const ingredientId = String(match && match.ingredientId || '');
      if (!allowedRows.has(rowId) || !allowedIngredients.has(ingredientId)) return;
      if (seenRows.has(rowId) || seenIngredients.has(ingredientId)) return;
      seenRows.add(rowId);
      seenIngredients.add(ingredientId);
      out.push({ rowId, ingredientId });
    });
    return out;
  }

  const api = { descendantsOf, filterIngredientsByCategory, validateAiMatches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RecipeIngredientLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
