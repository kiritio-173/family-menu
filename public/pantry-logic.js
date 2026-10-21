(function (root) {
  'use strict';

  const PRESENCE_NAMES = new Set([
    '盐', '食盐', '食用盐', '精盐', '盐巴', '白糖', '白砂糖', '糖', '冰糖', '红糖', '味精', '鸡精',
    '生抽', '酱油', '生抽酱油', '老抽', '老抽酱油', '醋', '米醋', '陈醋', '香醋',
    '料酒', '黄酒', '蚝油', '豆瓣酱', '甜面酱', '番茄酱', '辣椒酱', '芝麻油', '香油',
    '花椒', '八角', '桂皮', '香叶', '孜然', '胡椒粉', '白胡椒', '黑胡椒', '五香粉',
    '葱', '小葱', '大葱', '葱花', '葱末', '姜', '生姜', '姜末', '蒜', '大蒜', '蒜末', '蒜蓉',
  ]);

  function defaultNormalizeName(name) {
    const key = String(name || '').toLowerCase().replace(/[\s\u3000、，。；：:（）()【】\[\]\/\\·'"“”‘’\-_.]/g, '');
    const aliases = {
      食盐: '盐', 食用盐: '盐', 精盐: '盐', 盐巴: '盐', 白砂糖: '糖', 白糖: '糖',
      生抽酱油: '生抽', 酱油: '生抽', 老抽酱油: '老抽', 大蒜: '蒜', 生姜: '姜',
      蒜末: '蒜', 蒜蓉: '蒜', 姜末: '姜', 葱花: '葱', 葱末: '葱', 小葱: '葱', 大葱: '葱',
      西红柿: '番茄', 番茄: '番茄',
    };
    return aliases[key] || key;
  }

  function inferTrackingMode(item) {
    const category = String(item && item.category || '').trim();
    if (item && item.trackingMode === 'presence') return 'presence';
    if (item && item.trackingMode === 'quantity') return 'quantity';
    if (category === '调味干货' || category.startsWith('调味干货 > ')) return 'presence';
    const raw = String(item && item.name || '').trim();
    const normalized = defaultNormalizeName(raw);
    const known = new Set([...PRESENCE_NAMES].map(defaultNormalizeName));
    return known.has(normalized) ? 'presence' : 'quantity';
  }

  function resolveIngredientCategory(source) {
    const item = source || {};
    return String(item.ingredientCategory || item.stockCategory || item.presetCategory || item.recipeCategory || '').trim();
  }

  function aggregatePlanMaterials(rows, options) {
    const opts = options || {};
    const normalizeName = opts.normalizeName || defaultNormalizeName;
    const infer = opts.inferTrackingMode || inferTrackingMode;
    const parseAmount = opts.parseAmount || (() => ({ quantity: null, unit: '' }));
    const stockFor = opts.stockFor || (() => []);
    const categoryFor = opts.categoryFor || (() => '其他');
    const map = new Map();
    const modeByKey = new Map();
    const keyFor = (row) => row.ingredientId
      ? `id:${String(row.ingredientId)}`
      : `name:${normalizeName(row.name)}`;

    (rows || []).forEach((row) => {
      if (!row || !String(row.name || '').trim()) return;
      const key = keyFor(row);
      const mode = infer(row);
      if (mode === 'quantity' || !modeByKey.has(key)) modeByKey.set(key, mode);
    });

    (rows || []).forEach((row) => {
      if (!row || !String(row.name || '').trim()) return;
      const key = keyFor(row);
      const mode = modeByKey.get(key) || infer(row);
      if (!map.has(key)) {
        map.set(key, {
          name: row.name,
          ingredientId: row.ingredientId || '',
          categoryId: row.categoryId || '',
          parts: [],
          useCount: 0,
          requiredQty: null,
          requiredUnit: '',
          requiredComparable: true,
          trackingMode: mode,
        });
      }
      const item = map.get(key);
      item.useCount += 1;
      item.trackingMode = mode;
      const part = row.method ? `${row.dish || ''}（${row.method}） ${row.amount || ''}` : `${row.dish || ''} ${row.amount || ''}`;
      if (part.trim() && !item.parts.includes(part.trim())) item.parts.push(part.trim());
      if (item.trackingMode === 'presence') return;

      const amount = parseAmount(row.amount);
      if (!amount || amount.quantity == null || !amount.unit) {
        item.requiredComparable = false;
        return;
      }
      if (!item.requiredUnit) {
        item.requiredUnit = amount.unit;
        item.requiredQty = amount.quantity;
      } else if (item.requiredComparable && item.requiredUnit === amount.unit) {
        item.requiredQty += amount.quantity;
      } else {
        item.requiredComparable = false;
      }
    });

    return [...map.values()].map((item) => {
      const stock = stockFor(item.name, item.ingredientId, item) || [];
      return {
        ...item,
        category: categoryFor(item.name, stock, item.ingredientId, item),
        isSeasoning: item.trackingMode === 'presence',
        isStaple: item.trackingMode === 'presence',
        stock,
      };
    });
  }

  function assessStock(item) {
    const stock = Array.isArray(item.stock) ? item.stock : [];
    if (item.trackingMode === 'presence' || item.isSeasoning) {
      const present = stock.some((row) => row.hasStock === true || (row.trackingMode !== 'presence' && Number(row.quantity) > 0));
      return { key: present ? 'enough' : 'staple', stockQty: null, stockMinQty: 0, targetQty: null, shortageQty: null };
    }

    const unit = String(item.requiredUnit || '').trim().toLowerCase();
    const positive = stock.filter((row) => Number(row.quantity) > 0);
    const units = [...new Set((positive.length ? positive : stock).map((row) => String(row.unit || '').trim().toLowerCase()).filter(Boolean))];
    if (!item.requiredComparable || item.requiredQty == null || !unit || (stock.length && (units.length !== 1 || units[0] !== unit))) {
      return { key: 'uncertain', stockQty: null, stockMinQty: 0, targetQty: null, shortageQty: null };
    }
    const stockQty = positive.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const minimum = positive.reduce((sum, row) => sum + Number(row.minQuantity || 0), 0);
    const targetQty = item.requiredQty + minimum;
    if (!positive.length) return { key: 'needed', stockQty: 0, stockMinQty: minimum, targetQty, shortageQty: targetQty };
    return stockQty >= targetQty
      ? { key: 'enough', stockQty, stockMinQty: minimum, targetQty, shortageQty: 0 }
      : { key: 'shortage', stockQty, stockMinQty: minimum, targetQty, shortageQty: targetQty - stockQty };
  }

  const api = { inferTrackingMode, resolveIngredientCategory, aggregatePlanMaterials, assessStock, normalizeName: defaultNormalizeName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PantryLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
