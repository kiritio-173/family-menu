'use strict';

const assert = require('assert');
const {
  inferTrackingMode,
  aggregatePlanMaterials,
  assessStock,
} = require('./public/pantry-logic');

assert.strictEqual(inferTrackingMode({ name: '白砂糖', category: '其他' }), 'presence');
assert.strictEqual(inferTrackingMode({ name: '蒜末', category: '蔬菜' }), 'presence');
assert.strictEqual(inferTrackingMode({ name: '食用油', category: '调味干货' }), 'quantity');
assert.strictEqual(inferTrackingMode({ name: '番茄', category: '调味干货' }), 'quantity');
assert.strictEqual(inferTrackingMode({ name: '鸡肉', category: '肉类' }), 'quantity');
assert.strictEqual(inferTrackingMode({ name: '食盐', trackingMode: 'quantity' }), 'quantity');

const rows = [
  { name: '番茄', amount: '2 个', dish: '炒蛋', category: '蔬菜' },
  { name: '西红柿', amount: '1 个', dish: '汤', category: '蔬菜' },
  { name: '番茄', amount: '2 个', dish: '面', category: '蔬菜' },
  { name: '盐', amount: '1 勺', dish: '炒蛋' },
  { name: '食盐', amount: '3 克', dish: '汤' },
  { name: '蒜末', amount: '2 克', dish: '炒蛋' },
  { name: '蒜', amount: '1 瓣', dish: '汤' },
];
const aggregate = aggregatePlanMaterials(rows, {
  normalizeName: (name) => ({ 西红柿: '番茄', 食盐: '盐', 蒜末: '蒜' }[name] || name),
  inferTrackingMode,
  parseAmount: (amount) => {
    const match = /^(\d+(?:\.\d+)?)\s*(\S+)$/.exec(amount || '');
    return match ? { quantity: Number(match[1]), unit: match[2] } : { quantity: null, unit: '' };
  },
  stockFor: () => [],
  categoryFor: (name) => name === '番茄' ? '蔬菜' : '调味干货',
});
const tomato = aggregate.find((item) => item.name === '番茄');
assert.strictEqual(tomato.useCount, 3);
assert.strictEqual(tomato.requiredQty, 5);
assert.strictEqual(tomato.requiredUnit, '个');
const salt = aggregate.find((item) => item.name === '盐');
assert.strictEqual(salt.useCount, 2);
assert.strictEqual(salt.trackingMode, 'presence');
assert.strictEqual(salt.requiredQty, null);
assert.strictEqual(salt.requiredUnit, '');
assert.strictEqual(aggregate.find((item) => item.name === '蒜末').useCount, 2);

const idAggregate = aggregatePlanMaterials([
  { name: '番茄', amount: '2 个', dish: '炒蛋', ingredientId: 'ing-tomato', categoryId: 'veg-root', trackingMode: 'quantity' },
  { name: '樱桃番茄', amount: '3 个', dish: '沙拉', ingredientId: 'ing-tomato', categoryId: 'veg-root', trackingMode: 'quantity' },
  { name: '牛里脊', amount: '200 g', dish: '煎牛肉', ingredientId: 'ing-tenderloin', categoryId: 'beef-sub', trackingMode: 'quantity' },
  { name: '牛排', amount: '1 份', dish: '牛排饭', ingredientId: 'ing-steak', categoryId: 'beef-sub', trackingMode: 'quantity' },
], {
  inferTrackingMode,
  parseAmount: (amount) => {
    const match = /^(\d+(?:\.\d+)?)\s*(\S+)$/.exec(amount || '');
    return match ? { quantity: Number(match[1]), unit: match[2] } : { quantity: null, unit: '' };
  },
  stockFor: (_name, ingredientId) => [{ ingredientId, quantity: 10, unit: 'g' }],
  categoryFor: (_name, _stock, ingredientId) => ingredientId === 'ing-tenderloin' || ingredientId === 'ing-steak' ? '肉类 > 牛肉' : '蔬菜',
});
assert.strictEqual(idAggregate.length, 3);
assert.strictEqual(idAggregate.find((item) => item.ingredientId === 'ing-tomato').requiredQty, 5);
assert.strictEqual(idAggregate.find((item) => item.ingredientId === 'ing-tomato').name, '番茄');
assert.strictEqual(idAggregate.find((item) => item.ingredientId === 'ing-tenderloin').name, '牛里脊');
assert.strictEqual(idAggregate.find((item) => item.ingredientId === 'ing-steak').name, '牛排');

assert.strictEqual(assessStock({ trackingMode: 'quantity', requiredComparable: true, requiredQty: 5, requiredUnit: '个', stock: [{ quantity: 3, unit: '个' }] }).key, 'shortage');
assert.strictEqual(assessStock({ trackingMode: 'quantity', requiredComparable: true, requiredQty: 5, requiredUnit: '个', stock: [{ quantity: 6, unit: '个' }] }).key, 'enough');
assert.strictEqual(assessStock({ trackingMode: 'quantity', requiredComparable: true, requiredQty: 5, requiredUnit: '个', stock: [{ quantity: 6, unit: '斤' }] }).key, 'uncertain');
assert.strictEqual(assessStock({ trackingMode: 'presence', stock: [{ hasStock: true }] }).key, 'enough');
assert.strictEqual(assessStock({ trackingMode: 'presence', stock: [{ hasStock: false }] }).key, 'staple');

console.log('库存与计划逻辑测试通过');
