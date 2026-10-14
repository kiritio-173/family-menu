'use strict';

/**
 * 家庭菜单服务 —— 本地部署版
 * 零第三方依赖：Node 原生 http + JSON 文件存储
 * 启动：node server.js   （Windows 可双击 start.bat）
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 16 * 1024 * 1024; // 16MB，够放压缩后的 base64 图片
// node server.js --open  启动后自动打开浏览器
const AUTO_OPEN = process.argv.includes('--open') || process.env.AUTO_OPEN === '1';

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const uid = (p = '') =>
  p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

const nowISO = () => new Date().toISOString();

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function safeText(v, max = 500) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function safeList(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60);
}

/* ------------------------------------------------------------------ *
 * 数据存储（原子写入 + 防抖落盘）
 * ------------------------------------------------------------------ */

const FILES = {
  categories: 'categories.json',
  dishes: 'dishes.json',
  orders: 'orders.json',
  settings: 'settings.json',
  households: 'households.json',
  pantry: 'pantry.json',
  plans: 'plans.json',
};

const state = {};
let saveTimer = null;

function seedDishes() {
  return [
    {
      id: 'd_seed_tomato_egg',
      name: '番茄炒蛋',
      category: '家常菜',
      description: '国民下饭菜，酸甜开胃，10 分钟上桌。',
      images: [],
      servings: '2 人份',
      duration: 10,
      difficulty: '简单',
      tags: ['下饭', '快手'],
      seasonings: [
        { name: '番茄', amount: '2 个' },
        { name: '鸡蛋', amount: '3 个' },
        { name: '白糖', amount: '1 小勺' },
        { name: '盐', amount: '适量' },
        { name: '葱花', amount: '1 根' },
      ],
      methods: [
        {
          name: '家常做法',
          steps: [
            '番茄顶部划十字，开水烫 30 秒去皮，切成滚刀块。',
            '鸡蛋打散，加一小勺清水，热油下锅炒至半凝固盛出。',
            '锅内留底油，下番茄中火炒出汁水，加白糖和盐。',
            '倒回鸡蛋，翻拌均匀让蛋吸满汤汁，撒葱花出锅。',
          ],
        },
      ],
      notes: '番茄一定要炒出红汤再回蛋，不然味道寡淡。',
      isFavorite: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
    {
      id: 'd_seed_kungpao',
      name: '宫保鸡丁',
      category: '家常菜',
      description: '荔枝口，酸甜微辣，鸡丁嫩滑、花生酥脆。',
      images: [],
      servings: '3 人份',
      duration: 30,
      difficulty: '中等',
      tags: ['下饭', '宴客'],
      seasonings: [
        { name: '鸡腿肉', amount: '400g' },
        { name: '油酥花生米', amount: '80g' },
        { name: '干辣椒', amount: '10 个' },
        { name: '花椒', amount: '1 小勺' },
        { name: '生抽', amount: '2 勺' },
        { name: '香醋', amount: '2 勺' },
        { name: '白糖', amount: '1.5 勺' },
        { name: '淀粉', amount: '1 小勺' },
      ],
      methods: [
        {
          name: '正宗川味',
          steps: [
            '鸡腿肉切 1.5cm 丁，加生抽、淀粉抓匀腌 15 分钟。',
            '调碗汁：生抽 2 勺、香醋 2 勺、糖 1.5 勺、水 3 勺、淀粉少许。',
            '热油下干辣椒花椒小火炒香，转大火下鸡丁快速滑炒至变色。',
            '倒入碗汁大火收稠，最后放花生米翻两下立刻出锅。',
          ],
        },
      ],
      notes: '花生米一定最后放，久炒会回软失去酥脆。',
      isFavorite: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
    {
      id: 'd_seed_pumpkin',
      name: '小米南瓜粥',
      category: '主食',
      description: '暖胃养人的早餐粥，煮一锅够全家吃。',
      images: [],
      servings: '3 碗',
      duration: 40,
      difficulty: '简单',
      tags: ['早餐', '养胃'],
      seasonings: [
        { name: '小米', amount: '80g' },
        { name: '南瓜', amount: '200g' },
        { name: '清水', amount: '1.2L' },
      ],
      methods: [
        {
          name: '电饭锅版',
          steps: [
            '小米淘洗两遍，南瓜去皮切小块。',
            '全部放入电饭锅，按下煮粥键。',
            '煮到南瓜化开、小米出油即可，可按口味加少许糖。',
          ],
        },
      ],
      notes: '',
      isFavorite: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
    {
      id: 'd_seed_smashed_cucumber',
      name: '拍黄瓜',
      category: '凉菜',
      description: '3 分钟上桌的爽口小菜，越拍越入味。',
      images: [],
      servings: '2 人份',
      duration: 5,
      difficulty: '简单',
      tags: ['快手', '解腻'],
      seasonings: [
        { name: '黄瓜', amount: '2 根' },
        { name: '蒜', amount: '3 瓣' },
        { name: '香醋', amount: '1 勺' },
        { name: '生抽', amount: '1 勺' },
        { name: '香油', amount: '几滴' },
      ],
      methods: [
        {
          name: '快手版',
          steps: [
            '黄瓜洗净用刀面拍裂，切成小段。',
            '蒜切末，与醋、生抽、香油、糖调成料汁。',
            '料汁倒进黄瓜拌匀，腌 5 分钟更脆。',
          ],
        },
      ],
      notes: '',
      isFavorite: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
  ];
}

function defaultState() {
  return {
    categories: [
      { id: 'c_home', name: '家常菜', order: 1 },
      { id: 'c_staple', name: '主食', order: 2 },
      { id: 'c_soup', name: '汤羹', order: 3 },
      { id: 'c_cold', name: '凉菜', order: 4 },
      { id: 'c_breakfast', name: '早餐', order: 5 },
      { id: 'c_snack', name: '小吃甜点', order: 6 },
      { id: 'c_drink', name: '饮品', order: 7 },
    ],
    dishes: seedDishes(),
    orders: [],
    households: [
      {
        id: 'h_home',
        name: '我家',
        emoji: '🏠',
        note: '',
        members: [{ id: 'm_self', name: '我', emoji: '🙋' }],
        createdAt: nowISO(),
        updatedAt: nowISO(),
      },
    ],
    pantry: [],
    plans: [],
    settings: {
      shopName: '家庭菜单',
      adminPin: '',
      currentHouseholdId: 'h_home',
      shoppingChecked: [],
      welcome: '把常做的菜录进来，家人随时扫码点餐。',
    },
  };
}

const MEMBER_EMOJI = ['🙋', '👩', '👨', '👧', '👦', '🧒', '👵', '👴', '🐱', '🐶'];

const HOUSEHOLD_EMOJI = ['🏠', '🏡', '🏘️', '🏢', '🚪', '🛏️', '🍀', '🌷', '⭐', '🌙'];

/** 库存分类：肉蛋奶菜饮料……覆盖家里会囤的东西 */
const PANTRY_CATEGORIES = [
  { name: '肉类', emoji: '🥩' },
  { name: '蛋类', emoji: '🥚' },
  { name: '奶制品', emoji: '🥛' },
  { name: '蔬菜', emoji: '🥬' },
  { name: '水果', emoji: '🍎' },
  { name: '主食粮油', emoji: '🍚' },
  { name: '豆制品', emoji: '🫘' },
  { name: '水产海鲜', emoji: '🐟' },
  { name: '冷冻食品', emoji: '🧊' },
  { name: '饮料', emoji: '🥤' },
  { name: '调味干货', emoji: '🧂' },
  { name: '零食', emoji: '🍪' },
  { name: '其他', emoji: '📦' },
];

/**
 * 家庭成员统一成 {id, name, emoji}
 * 兼容早期存成 ["妈妈","爸爸"] 的字符串数组，老数据不用手动改
 */
function normMembers(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const m of input.slice(0, 30)) {
    const name = safeText(typeof m === 'object' && m ? m.name : m, 12).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const emoji =
      typeof m === 'object' && m && typeof m.emoji === 'string' && m.emoji.trim()
        ? safeText(m.emoji.trim(), 4)
        : MEMBER_EMOJI[out.length % MEMBER_EMOJI.length];
    out.push({
      id: typeof m === 'object' && m && typeof m.id === 'string' && m.id ? m.id : uid('m_'),
      name,
      emoji,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 预置食材库：录入库存时点一下就有名字、分类、单位、参考保质期
 * [名称, 分类, 单位, 保质期天数]
 * ------------------------------------------------------------------ */

const FOOD_PRESETS = [
  // 肉类
  ['猪里脊', '肉类', 'g', 3], ['五花肉', '肉类', 'g', 3], ['猪排骨', '肉类', 'g', 3],
  ['猪蹄', '肉类', 'g', 3], ['牛肉', '肉类', 'g', 3], ['牛腩', '肉类', 'g', 3],
  ['肥牛卷', '肉类', 'g', 90], ['羊肉', '肉类', 'g', 3], ['羊排', '肉类', 'g', 3],
  ['鸡胸肉', '肉类', 'g', 3], ['鸡腿', '肉类', 'g', 3], ['鸡翅', '肉类', 'g', 3],
  ['鸭肉', '肉类', 'g', 3], ['腊肉', '肉类', '块', 180], ['香肠', '肉类', '根', 30],
  ['火腿肠', '肉类', '根', 30], ['午餐肉', '肉类', '罐', 365],
  // 蛋类
  ['鸡蛋', '蛋类', '个', 20], ['鸭蛋', '蛋类', '个', 20], ['鹌鹑蛋', '蛋类', '个', 15],
  ['咸鸭蛋', '蛋类', '个', 60], ['皮蛋', '蛋类', '个', 90],
  // 奶制品
  ['纯牛奶', '奶制品', '盒', 30], ['酸奶', '奶制品', '盒', 21], ['奶酪', '奶制品', '片', 30],
  ['黄油', '奶制品', '块', 60], ['淡奶油', '奶制品', '盒', 30], ['奶粉', '奶制品', '罐', 540],
  // 蔬菜
  ['番茄', '蔬菜', '个', 7], ['黄瓜', '蔬菜', '根', 7], ['土豆', '蔬菜', '个', 30],
  ['洋葱', '蔬菜', '个', 30], ['胡萝卜', '蔬菜', '根', 21], ['大白菜', '蔬菜', '颗', 10],
  ['青菜', '蔬菜', '棵', 3], ['小油菜', '蔬菜', '把', 3], ['生菜', '蔬菜', '颗', 5],
  ['菠菜', '蔬菜', '把', 3], ['西兰花', '蔬菜', '颗', 7], ['芹菜', '蔬菜', '把', 7],
  ['茄子', '蔬菜', '个', 7], ['青椒', '蔬菜', '个', 10], ['小米椒', '蔬菜', 'g', 10],
  ['大蒜', '蔬菜', '头', 60], ['生姜', '蔬菜', '块', 30], ['香菇', '蔬菜', 'g', 5],
  ['金针菇', '蔬菜', '包', 7], ['木耳', '蔬菜', '包', 180], ['豆角', '蔬菜', 'g', 5],
  ['四季豆', '蔬菜', 'g', 5], ['冬瓜', '蔬菜', 'g', 7], ['南瓜', '蔬菜', 'g', 14],
  ['莲藕', '蔬菜', 'g', 7], ['山药', '蔬菜', 'g', 14], ['白萝卜', '蔬菜', '根', 14],
  ['玉米', '蔬菜', '根', 7], ['苦瓜', '蔬菜', '个', 7], ['西葫芦', '蔬菜', '个', 7],
  ['韭菜', '蔬菜', '把', 3], ['娃娃菜', '蔬菜', '颗', 7], ['紫甘蓝', '蔬菜', '颗', 10],
  // 水果
  ['苹果', '水果', '个', 14], ['香蕉', '水果', '根', 5], ['橙子', '水果', '个', 14],
  ['葡萄', '水果', 'g', 7], ['西瓜', '水果', 'g', 7], ['草莓', '水果', 'g', 3],
  ['蓝莓', '水果', 'g', 5], ['柠檬', '水果', '个', 14], ['梨', '水果', '个', 14],
  ['芒果', '水果', '个', 5], ['桃子', '水果', '个', 5], ['火龙果', '水果', '个', 7],
  ['猕猴桃', '水果', '个', 10], ['圣女果', '水果', 'g', 7],
  // 主食粮油
  ['大米', '主食粮油', 'g', 180], ['面粉', '主食粮油', 'g', 180], ['挂面', '主食粮油', 'g', 180],
  ['小米', '主食粮油', 'g', 180], ['糯米', '主食粮油', 'g', 180], ['燕麦片', '主食粮油', 'g', 180],
  ['馒头', '主食粮油', '个', 3], ['包子', '主食粮油', '个', 3], ['饺子', '主食粮油', '包', 90],
  ['面包', '主食粮油', '个', 5], ['吐司', '主食粮油', '个', 5], ['方便面', '主食粮油', '包', 120],
  ['米粉', '主食粮油', '包', 180], ['粉丝', '主食粮油', '包', 180], ['食用油', '主食粮油', '瓶', 300],
  // 豆制品
  ['豆腐', '豆制品', '块', 3], ['豆干', '豆制品', '块', 5], ['腐竹', '豆制品', '包', 180],
  ['豆浆', '豆制品', '杯', 2], ['黄豆', '豆制品', 'g', 180],
  // 水产海鲜
  ['草鱼', '水产海鲜', '条', 2], ['鲈鱼', '水产海鲜', '条', 2], ['鲫鱼', '水产海鲜', '条', 2],
  ['带鱼', '水产海鲜', 'g', 180], ['基围虾', '水产海鲜', 'g', 1], ['螃蟹', '水产海鲜', '只', 2],
  ['蛤蜊', '水产海鲜', 'g', 2], ['鱿鱼', '水产海鲜', 'g', 2], ['三文鱼', '水产海鲜', 'g', 3],
  // 冷冻食品
  ['速冻水饺', '冷冻食品', '包', 90], ['速冻汤圆', '冷冻食品', '包', 90],
  ['冷冻虾仁', '冷冻食品', 'g', 90], ['冰淇淋', '冷冻食品', '盒', 180],
  ['冷冻披萨', '冷冻食品', '张', 180], ['冷冻玉米', '冷冻食品', '根', 90],
  // 饮料
  ['矿泉水', '饮料', '瓶', 180], ['可乐', '饮料', '罐', 180], ['果汁', '饮料', '盒', 180],
  ['苏打水', '饮料', '瓶', 180], ['绿茶', '饮料', '瓶', 180], ['柠檬茶', '饮料', '瓶', 180],
  ['咖啡豆', '饮料', 'g', 180], ['速溶咖啡', '饮料', '盒', 180],
  // 调味干货
  ['食盐', '调味干货', '袋', 540], ['白砂糖', '调味干货', '袋', 365], ['生抽', '调味干货', '瓶', 540],
  ['老抽', '调味干货', '瓶', 540], ['香醋', '调味干货', '瓶', 540], ['蚝油', '调味干货', '瓶', 365],
  ['料酒', '调味干货', '瓶', 365], ['豆瓣酱', '调味干货', '瓶', 365], ['辣椒酱', '调味干货', '瓶', 365],
  ['番茄酱', '调味干货', '瓶', 365], ['沙拉酱', '调味干货', '瓶', 365], ['蜂蜜', '调味干货', '罐', 540],
  ['淀粉', '调味干货', '袋', 365], ['鸡精', '调味干货', '袋', 540], ['咖喱块', '调味干货', '盒', 365],
  ['花椒', '调味干货', '包', 180], ['干辣椒', '调味干货', 'g', 180], ['八角', '调味干货', '包', 180],
  ['孜然粒', '调味干货', '包', 180], ['辣椒面', '调味干货', '包', 180],
  // 零食
  ['薯片', '零食', '袋', 180], ['巧克力', '零食', '块', 365], ['饼干', '零食', '袋', 180],
  ['瓜子', '零食', '包', 180], ['花生', '零食', '包', 180], ['混合坚果', '零食', '罐', 180],
  ['糖果', '零食', '袋', 180],
  // 其他
  ['保鲜膜', '其他', '卷', 0], ['厨房纸', '其他', '卷', 0], ['洗洁精', '其他', '瓶', 1080],
];

/** 日期只认 YYYY-MM-DD，其它一律当作「没填」 */
function normDate(v) {
  const s = safeText(v, 10).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/**
 * 家庭统一成 {id, name, emoji, note, members[]}
 * 名字可以是房号（301）、门牌（西苑 2 栋 501），也可以是随便起的称呼
 */
function normHousehold(input, prev) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 20).trim();
  if (!name) return null;
  return {
    id: base.id || (typeof input.id === 'string' && input.id ? input.id : uid('h_')),
    name,
    emoji: safeText(input.emoji ?? base.emoji, 4) || '🏠',
    note: safeText(input.note ?? base.note, 100),
    members: normMembers(input.members ?? base.members) || [],
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/** 库存条目：{id, householdId, name, category, quantity, unit, expireAt, note} */
function normPantryItem(input, prev, keepInputId) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 24).trim();
  if (!name) return null;

  const rawQty = Number(input.quantity ?? base.quantity ?? 1);
  const qty = Number.isFinite(rawQty)
    ? Math.min(99999, Math.max(0, Math.round(rawQty * 1000) / 1000))
    : 0;

  const cat = safeText(input.category ?? base.category, 12).trim();
  const known = PANTRY_CATEGORIES.some((c) => c.name === cat);

  return {
    id:
      base.id ||
      (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('f_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    name,
    category: known ? cat : '其他',
    quantity: qty,
    unit: safeText(input.unit ?? base.unit, 8).trim() || '份',
    expireAt: normDate(input.expireAt ?? base.expireAt),
    note: safeText(input.note ?? base.note, 100),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: keepInputId && input.updatedAt ? safeText(input.updatedAt, 40) : nowISO(),
  };
}

/** 今天往前推 n 天，返回 YYYY-MM-DD */
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + Number(n || 0));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 一律按「周一开始」归周，传周一传今天都会落到同一周 */
function mondayOf(dateStr) {
  const s = normDate(dateStr) || todayStr();
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const date = new Date(y, m - 1, d);
  // getDay() 里周日是 0，换成周一为 0
  const back = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - back);
  const p = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 本周计划里的一道菜 */
function normPlanItem(input, prev, keepInputId) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 40).trim();
  if (!name) return null;
  return {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('pi_')),
    dishId: safeText(input.dishId ?? base.dishId, 40) || null,
    name,
    servings: safeText(input.servings ?? base.servings, 30),
    note: safeText(input.note ?? base.note, 100),
    addedAt: base.addedAt || input.addedAt || nowISO(),
  };
}

/** 一个家庭一周的计划：{id, householdId, weekOf, items[]} */
function normPlan(input, prev) {
  const base = prev || {};
  const weekOf = mondayOf(input.weekOf ?? base.weekOf);
  const items = (Array.isArray(input.items) ? input.items : base.items || [])
    .map((it) => normPlanItem(it, undefined, true))
    .filter(Boolean);
  // 同一周同一道菜只留一条
  const seen = new Set();
  return {
    id: base.id || (typeof input.id === 'string' && input.id ? input.id : uid('pl_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    weekOf,
    items: items.filter((it) => (seen.has(it.name) ? false : (seen.add(it.name), true))),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/** 找出某家庭某周的计划，没有就现建一条空的 */
function findPlan(householdId, weekOf, create) {
  const hid = resolveHouseholdId(householdId);
  const wk = mondayOf(weekOf);
  let plan = state.plans.find((p) => p.householdId === hid && p.weekOf === wk);
  if (!plan && create) {
    plan = { id: uid('pl_'), householdId: hid, weekOf: wk, items: [], createdAt: nowISO(), updatedAt: nowISO() };
    state.plans.push(plan);
  }
  return plan || null;
}

function loadState() {
  const base = defaultState();
  const fromDisk = new Set(); // 哪些数据文件是真的存在的，用来判断是不是首次升级
  for (const key of Object.keys(FILES)) {
    const file = path.join(DATA_DIR, FILES[key]);
    let parsed = null;
    try {
      if (fs.existsSync(file)) {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      console.error(`[warn] ${FILES[key]} 解析失败，已使用默认值：${err.message}`);
      const backup = file + '.corrupt-' + Date.now();
      try {
        fs.renameSync(file, backup);
        console.error(`[warn] 原文件已备份到 ${backup}`);
      } catch (_) {
        /* ignore */
      }
    }
    if (parsed === null || parsed === undefined) {
      state[key] = base[key];
    } else {
      fromDisk.add(key);
      if (Array.isArray(base[key])) {
        state[key] = Array.isArray(parsed) ? parsed : base[key];
      } else {
        state[key] =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { ...base[key], ...parsed }
            : base[key];
      }
    }
  }
  // 分类去重修正（菜品按分类名归属）
  state.categories = state.categories.filter((c) => c && c.name);
  state.dishes = state.dishes.filter((d) => d && d.name);
  // 按 id 去重：重复 id 会让删除/更新只命中一条
  const seenD = new Set();
  state.dishes = state.dishes.filter((d) => (seenD.has(d.id) ? false : (seenD.add(d.id), true)));
  const seenO = new Set();
  state.orders = state.orders.filter((o) => (seenO.has(o.id) ? false : (seenO.add(o.id), true)));

  /* ---- 家庭 / 库存：从旧版本平滑升级 ---- */

  // 旧版本没有 households，settings.members 里存着家庭成员，搬进第一个家庭
  const legacyMembers = normMembers(state.settings.members) || [];

  state.households = (Array.isArray(state.households) ? state.households : [])
    .map((h) => (h && typeof h === 'object' ? normHousehold(h, undefined) : null))
    .filter(Boolean);

  const seenH = new Set();
  state.households = state.households.filter((h) =>
    seenH.has(h.id) ? false : (seenH.add(h.id), true)
  );
  if (!state.households.length) {
    state.households = [normHousehold({ name: '我家', emoji: '🏠', members: legacyMembers })];
  } else if (legacyMembers.length && !fromDisk.has('households')) {
    // households.json 是这次升级才有的，说明用户跑的是老版本：
    // settings.members 里的老成员认领给第一个家庭（不要被示例成员占位）
    state.households[0].members = legacyMembers;
  } else if (legacyMembers.length && !state.households.some((h) => h.members.length)) {
    state.households[0].members = legacyMembers;
  }
  delete state.settings.members; // 成员改由各家庭自己持有

  const hhIds = new Set(state.households.map((h) => h.id));
  const fallbackH = state.households[0].id;

  // 历史点餐 / 库存没有 householdId 的，都归到第一个家庭
  state.orders.forEach((o) => {
    if (!hhIds.has(o.householdId)) o.householdId = fallbackH;
  });

  const seenF = new Set();
  state.pantry = (Array.isArray(state.pantry) ? state.pantry : [])
    .map((p) => (p && typeof p === 'object' ? normPantryItem(p, undefined, true) : null))
    .filter(Boolean)
    .filter((p) => (seenF.has(p.id) ? false : (seenF.add(p.id), true)));
  state.pantry.forEach((p) => {
    if (!hhIds.has(p.householdId)) p.householdId = fallbackH;
  });

  // 本周计划：同样拉回有效家庭，周一归一
  const seenPl = new Set();
  state.plans = (Array.isArray(state.plans) ? state.plans : [])
    .map((pl) => (pl && typeof pl === 'object' ? normPlan(pl, undefined) : null))
    .filter(Boolean)
    .filter((pl) => (seenPl.has(pl.id) ? false : (seenPl.add(pl.id), true)));
  state.plans.forEach((pl) => {
    if (!hhIds.has(pl.householdId)) pl.householdId = fallbackH;
  });

  if (!hhIds.has(state.settings.currentHouseholdId)) {
    state.settings.currentHouseholdId = fallbackH;
  }
}

function persist(key) {
  const file = path.join(DATA_DIR, FILES[key]);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state[key], null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function scheduleSave(key) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      for (const k of Object.keys(FILES)) persist(k);
    } catch (err) {
      console.error('[error] 保存失败：', err.message);
    }
  }, 150);
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  for (const k of Object.keys(FILES)) persist(k);
}

/* ------------------------------------------------------------------ *
 * 菜品规范化
 * ------------------------------------------------------------------ */

function normDish(input, prev, keepInputId) {
  const base = prev || {};
  const rawName = safeText(input.name, 40).trim();
  // 新建必须给名字（导入历史数据除外），避免空名菜谱混进菜单
  if (!rawName && prev === undefined && !keepInputId) return null;

  const d = {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('d_')),
    name: rawName || base.name || '未命名菜品',
    category: safeText(input.category ?? base.category, 24).trim() || '家常菜',
    description: safeText(input.description, 300),
    images: safeList(input.images ?? base.images)
      .map((s) => safeText(s, 300))
      .filter((s) => /^\/uploads\//.test(s))
      .slice(0, 9),
    servings: safeText(input.servings ?? base.servings, 30),
    duration: Number(input.duration ?? base.duration) || 0,
    difficulty: safeText(input.difficulty ?? base.difficulty, 12) || '简单',
    tags: (Array.isArray(input.tags)
      ? input.tags
      : safeText(input.tags, 120).split(/[,，\s]+/)
    )
      .map((t) => safeText(t, 12).trim())
      .filter(Boolean)
      .slice(0, 8),
    seasonings: safeList(input.seasonings)
      .map((s) => ({
        name: safeText(s && s.name, 30).trim(),
        amount: safeText(s && s.amount, 30).trim(),
      }))
      .filter((s) => s.name)
      .slice(0, 40),
    methods: safeList(input.methods)
      .map((m) => ({
        name: safeText(m && m.name, 24).trim() || '做法',
        steps: (Array.isArray(m && m.steps)
          ? m.steps
          : safeText(m && m.steps, 3000).split('\n')
        )
          .map((s) => safeText(s, 400).trim())
          .filter(Boolean)
          .slice(0, 40),
      }))
      .filter((m) => m.steps.length)
      .slice(0, 8),
    notes: safeText(input.notes, 1000),
    isFavorite: input.isFavorite === undefined ? !!base.isFavorite : !!input.isFavorite,
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
  return d;
}

/** 只认已存在的家庭 id，认不出就落到当前/默认家庭，避免数据悬空 */
function resolveHouseholdId(v) {
  const id = safeText(v, 40);
  if (id && state.households.some((h) => h.id === id)) return id;
  const cur = state.settings && state.settings.currentHouseholdId;
  if (cur && state.households.some((h) => h.id === cur)) return cur;
  return (state.households[0] && state.households[0].id) || '';
}

function normOrder(input, prev, keepInputId) {
  const base = prev || {};
  return {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('o_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    dishId: input.dishId ? safeText(input.dishId, 40) : null,
    dishName: safeText(input.dishName, 40).trim() || base.dishName || '随便吃点',
    requester: safeText(input.requester, 20).trim() || '匿名',
    people: Math.max(1, Math.min(20, Number(input.people) || base.people || 2)),
    note: safeText(input.note, 200),
    status: ['pending', 'cooking', 'done', 'cancelled'].includes(input.status)
      ? input.status
      : base.status || 'pending',
    date: safeText(input.date, 20) || base.date || todayStr(),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/* ------------------------------------------------------------------ *
 * HTTP 基础
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, code, message) {
  sendJSON(res, code, { ok: false, error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（上限 16MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, filePath, cacheable) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

async function handleAPI(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = seg.slice(1);
  const method = req.method;

  // GET /api/state —— 全量状态（家庭规模数据很小，一次取完最省事）
  if (method === 'GET' && route.length === 1 && route[0] === 'state') {
    return sendJSON(res, 200, {
      ok: true,
      data: {
        categories: state.categories,
        dishes: state.dishes,
        orders: state.orders,
        settings: state.settings,
        households: state.households,
        pantry: state.pantry,
        plans: state.plans,
      },
    });
  }

  // GET /api/ingredient-presets —— 常见食材预设（录库存时选一下就有分类和保质期）
  if (method === 'GET' && route.length === 1 && route[0] === 'ingredient-presets') {
    return sendJSON(res, 200, {
      ok: true,
      data: {
        categories: PANTRY_CATEGORIES,
        presets: FOOD_PRESETS.map((p) => ({
          name: p[0],
          category: p[1],
          unit: p[2],
          shelfLife: p[3],
          expireAt: p[3] > 0 ? daysFromNow(p[3]) : '',
        })),
      },
    });
  }

  // ---- 家庭 ----
  if (route[0] === 'households') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const h = normHousehold({
        ...body,
        emoji: safeText(body.emoji, 4) || HOUSEHOLD_EMOJI[state.households.length % HOUSEHOLD_EMOJI.length],
      });
      if (!h) return sendError(res, 400, '家庭名称不能为空');
      state.households.push(h);
      scheduleSave('households');
      return sendJSON(res, 200, { ok: true, data: h });
    }
    if (method === 'PUT' && id) {
      const idx = state.households.findIndex((h) => h.id === id);
      if (idx < 0) return sendError(res, 404, '家庭不存在');
      const next = normHousehold(await readBody(req), state.households[idx]);
      if (!next) return sendError(res, 400, '家庭名称不能为空');
      state.households[idx] = next;
      scheduleSave('households');
      return sendJSON(res, 200, { ok: true, data: next });
    }
    if (method === 'DELETE' && id) {
      if (state.households.length <= 1) {
        return sendError(res, 400, '至少要保留一个家庭');
      }
      const idx = state.households.findIndex((h) => h.id === id);
      if (idx < 0) return sendError(res, 404, '家庭不存在');
      const [gone] = state.households.splice(idx, 1);
      // 家庭没了，它名下的点餐和库存也一并清掉，免得数据无处安放
      const removedOrders = state.orders.filter((o) => o.householdId === id).length;
      const removedPantry = state.pantry.filter((p) => p.householdId === id).length;
      state.orders = state.orders.filter((o) => o.householdId !== id);
      state.pantry = state.pantry.filter((p) => p.householdId !== id);
      state.plans = state.plans.filter((p) => p.householdId !== id);
      if (state.settings.currentHouseholdId === id) {
        state.settings.currentHouseholdId = state.households[0].id;
      }
      scheduleSave('households');
      scheduleSave('orders');
      scheduleSave('pantry');
      scheduleSave('plans');
      scheduleSave('settings');
      return sendJSON(res, 200, {
        ok: true,
        data: { ...gone, removedOrders, removedPantry },
      });
    }
  }

  // ---- 本周计划 ----
  if (route[0] === 'plans') {
    const id = route[1];

    // 加一道菜进某家庭某周的计划
    if (method === 'POST' && route[1] === 'items') {
      const body = await readBody(req);
      const dish = body.dishId ? state.dishes.find((d) => d.id === body.dishId) : null;
      const item = normPlanItem({
        ...body,
        name: body.name || (dish && dish.name),
        servings: body.servings || (dish && dish.servings),
      });
      if (!item) return sendError(res, 400, '要加哪道菜？写个菜名吧');
      const plan = findPlan(body.householdId, body.weekOf, true);
      // 同一道菜别重复加
      if (plan.items.some((it) => it.name === item.name)) {
        return sendError(res, 400, `「${item.name}」已经在本周计划里了`);
      }
      plan.items.push(item);
      plan.updatedAt = nowISO();
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { plan, item } });
    }

    // 从计划里拿掉一道菜
    if (method === 'DELETE' && route[1] === 'items' && route[2]) {
      const target = route[2];
      let hit = null;
      for (const plan of state.plans) {
        const i = plan.items.findIndex((it) => it.id === target);
        if (i >= 0) {
          hit = plan.items.splice(i, 1)[0];
          plan.updatedAt = nowISO();
          break;
        }
      }
      if (!hit) return sendError(res, 404, '计划里没有这道菜');
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: hit });
    }

    // 查某家庭某周的计划（不传参数就是当前家庭本周）
    if (method === 'GET' && !id) {
      const hid = resolveHouseholdId(url.searchParams.get('householdId'));
      const wk = mondayOf(url.searchParams.get('weekOf'));
      return sendJSON(res, 200, { ok: true, data: findPlan(hid, wk, false) });
    }

    // 清空某家庭某周
    if (method === 'DELETE' && !id) {
      const hid = resolveHouseholdId(url.searchParams.get('householdId'));
      const wk = mondayOf(url.searchParams.get('weekOf'));
      const plan = findPlan(hid, wk, false);
      if (!plan) return sendJSON(res, 200, { ok: true, data: { removed: 0 } });
      const removed = plan.items.length;
      plan.items = [];
      plan.updatedAt = nowISO();
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { removed } });
    }
  }

  // ---- 库存 ----
  if (route[0] === 'pantry') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const item = normPantryItem(await readBody(req));
      if (!item) return sendError(res, 400, '食材名不能为空');
      state.pantry.unshift(item);
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: item });
    }
    if (method === 'PUT' && id) {
      const idx = state.pantry.findIndex((p) => p.id === id);
      if (idx < 0) return sendError(res, 404, '库存条目不存在');
      const item = normPantryItem(await readBody(req), state.pantry[idx]);
      if (!item) return sendError(res, 400, '食材名不能为空');
      state.pantry[idx] = item;
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: item });
    }
    if (method === 'DELETE' && id) {
      const idx = state.pantry.findIndex((p) => p.id === id);
      if (idx < 0) return sendError(res, 404, '库存条目不存在');
      const [gone] = state.pantry.splice(idx, 1);
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
    if (method === 'DELETE' && !id) {
      // 批量清理：?householdId=xxx&scope=expired|soon
      const hid = safeText(url.searchParams.get('householdId'), 40);
      const scope = safeText(url.searchParams.get('scope'), 12);
      const today = todayStr();
      const soon = daysFromNow(3);
      const keep = (p) => {
        if (hid && p.householdId !== hid) return true;
        if (!p.expireAt) return true;
        if (scope === 'expired') return p.expireAt >= today;
        if (scope === 'soon') return p.expireAt < today || p.expireAt > soon;
        return false;
      };
      const before = state.pantry.length;
      state.pantry = state.pantry.filter(keep);
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.pantry.length } });
    }
  }

  // ---- 菜品 ----
  if (route[0] === 'dishes') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const dish = normDish(await readBody(req));
      if (!dish) return sendError(res, 400, '菜名不能为空');
      state.dishes.unshift(dish);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: dish });
    }
    if (method === 'PUT' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      const dish = normDish(await readBody(req), state.dishes[idx]);
      state.dishes[idx] = dish;
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: dish });
    }
    if (method === 'POST' && route[2] === 'duplicate' && id) {
      const src = state.dishes.find((d) => d.id === id);
      if (!src) return sendError(res, 404, '菜品不存在');
      const copy = normDish({ ...src, id: '', name: src.name + '（副本）' });
      copy.isFavorite = false;
      state.dishes.unshift(copy);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: copy });
    }
    if (method === 'DELETE' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      const [gone] = state.dishes.splice(idx, 1);
      // 同时清掉该菜品相关的未完成点餐
      state.orders = state.orders.filter(
        (o) => !(o.dishId === id && o.status !== 'done')
      );
      // 本周计划里引用的这道菜也去掉，免得采购买到已删的菜
      state.plans.forEach((p) => {
        p.items = p.items.filter((it) => it.dishId !== id);
      });
      scheduleSave('dishes');
      scheduleSave('orders');
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
  }

  // ---- 分类 ----
  if (route[0] === 'categories') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const name = safeText(body.name, 24).trim();
      if (!name) return sendError(res, 400, '分类名不能为空');
      const cat = {
        id: uid('c_'),
        name,
        order: state.categories.length + 1,
      };
      state.categories.push(cat);
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'PUT' && id) {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return sendError(res, 404, '分类不存在');
      const body = await readBody(req);
      const name = safeText(body.name, 24).trim();
      if (name) cat.name = name;
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'DELETE' && id) {
      const idx = state.categories.findIndex((c) => c.id === id);
      if (idx < 0) return sendError(res, 404, '分类不存在');
      const [gone] = state.categories.splice(idx, 1);
      // 该分类下菜品改为「其他」，不丢数据
      state.dishes.forEach((d) => {
        if (d.category === gone.name) d.category = '其他';
      });
      scheduleSave('categories');
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
    }

  // ---- 点餐 ----
  if (route[0] === 'orders') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const order = normOrder(await readBody(req));
      state.orders.unshift(order);
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: order });
    }
    if (method === 'PATCH' && id) {
      const order = state.orders.find((o) => o.id === id);
      if (!order) return sendError(res, 404, '点餐不存在');
      const body = await readBody(req);
      // 逐字段更新：只改请求里明确带上的字段，避免清空备注等未提交的内容
      if (['pending', 'cooking', 'done', 'cancelled'].includes(body.status)) {
        order.status = body.status;
      }
      if (body.dishName !== undefined) {
        order.dishName = safeText(body.dishName, 40).trim() || order.dishName;
      }
      if (body.requester !== undefined) {
        order.requester = safeText(body.requester, 20).trim() || order.requester;
      }
      if (body.people !== undefined) {
        order.people = Math.max(1, Math.min(20, Number(body.people) || order.people));
      }
      if (body.note !== undefined) order.note = safeText(body.note, 200);
      if (body.date !== undefined) order.date = safeText(body.date, 20) || order.date;
      if (body.dishId !== undefined) order.dishId = body.dishId ? safeText(body.dishId, 40) : null;
      order.updatedAt = nowISO();
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: order });
    }
    // 注意要排在「按 id 删点餐」前面，否则 /api/orders/done 会被当成删 id 为 done 的点餐
    if (method === 'DELETE' && route[1] === 'done') {
      const hid = safeText(url.searchParams.get('householdId'), 40);
      const before = state.orders.length;
      state.orders = state.orders.filter(
        (o) => o.status !== 'done' || (hid && o.householdId !== hid)
      );
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.orders.length } });
    }
    if (method === 'DELETE' && id) {
      const idx = state.orders.findIndex((o) => o.id === id);
      if (idx < 0) return sendError(res, 404, '点餐不存在');
      const [gone] = state.orders.splice(idx, 1);
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
  }

  // ---- 图片上传（前端已压缩的 dataURL）----
  if (method === 'POST' && route[0] === 'upload') {
    const body = await readBody(req);
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
      safeText(body.dataUrl, 32 * 1024 * 1024)
    );
    if (!m) return sendError(res, 400, '图片格式不支持（需 png/jpg/webp/gif 的 dataURL）');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return sendError(res, 400, '图片过大');
    const name = uid('img_') + '.' + ext;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    return sendJSON(res, 200, { ok: true, data: { url: '/uploads/' + name } });
  }

  // ---- 设置 ----
  if (method === 'PUT' && route[0] === 'settings') {
    const body = await readBody(req);
    const s = state.settings;
    if (typeof body.shopName === 'string') s.shopName = safeText(body.shopName, 30).trim() || '家庭菜单';
    if (typeof body.welcome === 'string') s.welcome = safeText(body.welcome, 120);
    if (typeof body.adminPin === 'string') s.adminPin = safeText(body.adminPin, 12).trim();
    if (typeof body.currentHouseholdId === 'string') {
      const id = safeText(body.currentHouseholdId, 40);
      // 只认存在的家庭，防止前端写进脏 id
      if (state.households.some((h) => h.id === id)) s.currentHouseholdId = id;
    }
    if (Array.isArray(body.shoppingChecked)) {
      s.shoppingChecked = body.shoppingChecked
        .map((m) => safeText(m, 40).trim())
        .filter(Boolean)
        .slice(0, 400);
    }
    scheduleSave('settings');
    return sendJSON(res, 200, { ok: true, data: s });
  }

  // ---- 导入 / 导出 ----
  if (method === 'GET' && route[0] === 'export') {
    const payload = JSON.stringify(
      {
        __app: 'family-menu',
        exportedAt: nowISO(),
        categories: state.categories,
        dishes: state.dishes,
        orders: state.orders,
        settings: state.settings,
        households: state.households,
        pantry: state.pantry,
        plans: state.plans,
      },
      null,
      2
    );
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="menu-backup-${todayStr()}.json"`,
      'Content-Length': Buffer.byteLength(payload),
    });
    return res.end(payload);
  }

  if (method === 'POST' && route[0] === 'import') {
    const body = await readBody(req);
    const src = body && body.data ? body.data : body;
    if (!src || !Array.isArray(src.dishes)) return sendError(res, 400, '备份文件格式不正确');
    state.categories = Array.isArray(src.categories) ? src.categories : state.categories;
    state.dishes = src.dishes.map((d) => normDish(d, undefined, true)).filter(Boolean);
    if (Array.isArray(src.orders)) {
      state.orders = src.orders.map((o) => normOrder(o, undefined, true));
    }
    // 家庭要先恢复，否则点餐/库存的 householdId 会指向不存在的家庭
    if (Array.isArray(src.households)) {
      const seen = new Set();
      state.households = src.households
        .map((h) => normHousehold(h, undefined))
        .filter(Boolean)
        .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
      if (!state.households.length) state.households = defaultState().households;
    }
    if (Array.isArray(src.pantry)) {
      const seen = new Set();
      state.pantry = src.pantry
        .map((p) => normPantryItem(p, undefined, true))
        .filter(Boolean)
        .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    }
    if (Array.isArray(src.plans)) {
      const seen = new Set();
      state.plans = src.plans
        .map((pl) => normPlan(pl, undefined))
        .filter(Boolean)
        .filter((pl) => (seen.has(pl.id) ? false : (seen.add(pl.id), true)));
    }
    if (src.settings && typeof src.settings === 'object') {
      state.settings = { ...defaultState().settings, ...src.settings };
    }
    // 兜底：任何指向已删除家庭的记录拉回第一个家庭
    const hhIds = new Set(state.households.map((h) => h.id));
    if (!hhIds.has(state.settings.currentHouseholdId)) {
      state.settings.currentHouseholdId = state.households[0].id;
    }
    state.orders.forEach((o) => {
      if (!hhIds.has(o.householdId)) o.householdId = state.households[0].id;
    });
    state.pantry.forEach((p) => {
      if (!hhIds.has(p.householdId)) p.householdId = state.households[0].id;
    });
    state.plans.forEach((pl) => {
      if (!hhIds.has(pl.householdId)) pl.householdId = state.households[0].id;
    });

    scheduleSave('categories');
    scheduleSave('dishes');
    scheduleSave('orders');
    scheduleSave('settings');
    scheduleSave('households');
    scheduleSave('pantry');
    scheduleSave('plans');
    return sendJSON(res, 200, {
      ok: true,
      data: {
        dishes: state.dishes.length,
        households: state.households.length,
        pantry: state.pantry.length,
        plans: state.plans.length,
      },
    });
  }

  // ---- 汇总统计（首页小卡片用）----
  if (method === 'GET' && route[0] === 'summary') {
    const today = todayStr();
    const soon = daysFromNow(3);
    const pending = state.orders.filter((o) => o.status === 'pending' || o.status === 'cooking');
    const mine = state.pantry.filter((p) => p.householdId === state.settings.currentHouseholdId);
    return sendJSON(res, 200, {
      ok: true,
      data: {
        dishCount: state.dishes.length,
        pendingCount: pending.length,
        categoryCount: state.categories.length,
        householdCount: state.households.length,
        pantryCount: mine.length,
        expiredCount: mine.filter((p) => p.expireAt && p.expireAt < today).length,
        soonCount: mine.filter((p) => p.expireAt && p.expireAt >= today && p.expireAt <= soon).length,
      },
    });
  }

  return sendError(res, 404, '接口不存在：' + req.method + ' ' + url.pathname);
}

/* ------------------------------------------------------------------ *
 * 路由分发
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleAPI(req, res, url);
    }

    // 上传的图片
    if (url.pathname.startsWith('/uploads/')) {
      const rel = path.basename(decodeURIComponent(url.pathname));
      return await serveStatic(req, res, path.join(UPLOAD_DIR, rel), true);
    }

    // 静态资源
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    rel = path.normalize(rel).replace(/^(\.\.[\\/])+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('403');
    }
    await serveStatic(req, res, file, false);
  } catch (err) {
    console.error('[error]', req.method, url.pathname, err);
    if (!res.headersSent) sendError(res, 500, err.message || '服务器内部错误');
    else res.end();
  }
});

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function banner(port) {
  const line = '─'.repeat(46);
  console.log('');
  console.log(`  ${state.settings.shopName || '家庭菜单'} 正在运行`);
  console.log(`  ${line}`);
  console.log(`  本机访问：   http://localhost:${port}`);
  for (const ip of lanAddresses()) {
    console.log(`  手机访问：   http://${ip}:${port}   ← 家人连同一个 WiFi 打开这个`);
  }
  console.log(`  ${line}`);
  console.log(
    `  菜品 ${state.dishes.length} 道 · 分类 ${state.categories.length} 个 · 家庭 ${state.households.length} 个`
  );
  console.log(`  数据目录 ${DATA_DIR}`);
  console.log(`  按 Ctrl+C 停止服务`);
  console.log('');
}

/** 启动后自动打开浏览器（打包版用，省得家人自己敲地址） */
function openBrowser(port) {
  const url = `http://localhost:${port}`;
  try {
    let cmd, args;
    if (process.platform === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '', url]];
    else if (process.platform === 'darwin') [cmd, args] = ['open', [url]];
    else [cmd, args] = ['xdg-open', [url]];
    require('child_process')
      .spawn(cmd, args, { detached: true, stdio: 'ignore' })
      .unref();
  } catch (err) {
    console.error('[warn] 无法自动打开浏览器：' + err.message);
  }
}

function init() {
  for (const dir of [DATA_DIR, UPLOAD_DIR, PUBLIC_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  loadState();
  saveNow();
}

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${sig}，正在保存数据…`);
  try {
    saveNow();
    console.log('数据已保存，服务已停止。');
  } catch (err) {
    console.error('保存失败：', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[fatal]', err);
  try {
    saveNow();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});

init();

/** 端口被占用时自动往后找，避免打包到别人电脑上起不来 */
function startServer(port, triesLeft) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && triesLeft > 1) {
      console.warn(`  端口 ${port} 已被占用，自动改用 ${port + 1}…`);
      setTimeout(() => startServer(port + 1, triesLeft - 1), 250);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`\n端口 ${port} 到 ${port + triesLeft} 都被占用了。`);
      console.error('可以用环境变量指定别的端口：set PORT=9000 && node server.js\n');
    } else {
      console.error('[fatal]', err);
    }
    process.exit(1);
  };

  const onListening = () => {
    server.removeListener('error', onError);
    server.on('error', (e) => console.error('[warn] 服务异常：', e.message));
    banner(port);
    if (AUTO_OPEN) openBrowser(port);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}

startServer(PORT, 12);