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
const zlib = require('zlib');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 16 * 1024 * 1024; // 16MB，够放压缩后的 base64 图片
// 恢复备份走的是 zip 原样上传，里面装着 uploads/ 的照片，体积比单条请求大得多
const MAX_IMPORT = 128 * 1024 * 1024;
// 自动备份保留几份
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP) || 7;
// node server.js --open  启动后自动打开浏览器
const AUTO_OPEN = process.argv.includes('--open') || process.env.AUTO_OPEN === '1';

/* ------------------------------------------------------------------ *
 * 版本与更新内容
 *
 * 网页上「这是第几版、这一版加了什么」直接读这里。
 * 写在代码里而不是另开一个文件，是为了保证打包时不会漏 —— 少一个文件，
 * 网页上就会出现一个空白的更新日志，比没有还糟。
 * ------------------------------------------------------------------ */

const APP_VERSION = '1.6.0';

// 新的排在前面；date 只写发布年月日，不用精确到时分
const RELEASES = [
  {
    version: '1.6.0',
    date: '2026-10-15',
    title: 'AI 助手改成底部悬浮窗，而且真的能动手',
    items: [
      'AI 入口从顶栏搬到底部：收起时是一条小胶囊，点开是贴着底面的对话面板，单手拿手机也戳得到',
      '它现在不只是聊天：「把红烧排骨记到菜单」「刚买了三斤排骨」「这道排进本周计划」——说完就给你一张操作卡',
      '操作卡上写着它准备改什么（菜名、用量、几步、哪个做法），你点「确认」才真的存进去，点「算了」就当没说过',
      '能操作四样：加菜品（调料和步骤按常见做法自动填好）、下点餐单、排本周计划、记库存',
      '菜单里已有的菜会一起告诉它，它不会再一本正经地重复添加已有的那道',
      '模型偶尔没把回复包成 JSON 也不会整句没回应，原话照样显示，只是这轮没有可点确认的操作',
      '收起时 pill 上会冒个红点，方便你忙完别的再回来看它答了什么',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-15',
    title: '全局对话助手 + 一菜多做法各带调料 + 备份区瘦身',
    items: [
      '顶栏多了个 💬，在哪个页面都能打开直接问 AI：它知道你正在看哪一页、哪个家庭、手上这道菜、谁点了什么、哪些食材快过期了',
      '菜品调料拆成两层：菜品上的「通用调料」是每种做法都要用的，每个做法里还能只给自己加几味不一样的（比如微辣版多一勺小米辣）',
      '买菜清单会把各做法的调料一起汇总，并写清是哪道菜的哪个做法要用',
      '管理页数据区不再堆一列快照：改成「⬇ 导出备份 / ⬆ 恢复备份」两个按钮，恢复就是选一个文件回来',
      '自动快照还在（每天凌晨 3 点 + 每次启动，保留最近 7 份），只是收成了一行字加两个小按钮',
      '老的菜谱不用改：以前没有的做法级调料会自动补成空，你记的东西一样不少',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-15',
    title: '备餐流程时间轴 + 批量操作 + 版本页',
    items: [
      '厨房助手升级成完整备餐时间轴：从开始洗菜到最后一道上桌，每步带预计耗时，能并行的标「可离开」，要守着的标「要守灶」',
      '库存支持批量删除：进多选模式，勾选或全选后一次清掉',
      '点餐页新增「一键开做」：待做的菜一次全部转成制作中',
      '管理页新增版本信息，点开能看到每个版本都改了什么',
      '点餐单上的菜名现在可以直接点开菜谱（自定义菜除外）',
      '导出备份改成 zip，照片一起带走；每天凌晨自动存一份快照，坏了可一键回退',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-15',
    title: 'AI 厨房助手',
    items: [
      '拍张照 AI 认菜谱：传一张成品图，自动填菜名、分类、调料用量、步骤',
      '菜谱规范化：把随手记的乱菜谱理顺，「够两个人吃的」会变成「2 人份」',
      '厨房助手：把今晚几道菜排成并行下厨的顺序',
      'AI 全程走服务端，API Key 不进网页、不进备份、不进 GitHub',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-14',
    title: '本周计划',
    items: [
      '新增「本周计划」页：把想做的菜先排上，一周一次买齐',
      '计划菜自动汇总成采购清单，标了「家里有」的不用买',
      '可以翻到下一周提前备菜，计划按家庭各记各的',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-14',
    title: '管理口令',
    items: [
      '可选的管理口令，口令只存在服务端，前端拿不到明文',
      '改菜谱、导备份要口令；点餐、库存、本周计划不受影响',
      '编辑菜品时误关弹层不再丢内容，自动存草稿',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-13',
    title: '第一版',
    items: [
      '菜谱管理、点餐、买菜清单、库存、多家庭、局域网扫码点餐',
      '零第三方依赖：不用 npm install、不用数据库',
    ],
  },
];

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
 * AI（可选增强）
 *
 * 这一块是纯增量的：没配 Key、没网、服务挂了，都不影响点餐/计划/库存/买菜清单
 * 任何原有功能。Node 22 自带全局 fetch，所以不用引任何 npm 包，零依赖保住了。
 *
 * Key 只从 data/ai.json 读，永远不进 /api/state、不进导出备份、不下发前端。
 * ------------------------------------------------------------------ */

const AI_FILE = path.join(DATA_DIR, 'ai.json');

/** 环境变量优先，其次 data/ai.json —— 方便不想把 Key 放文件里的用法 */
function loadAIConfig() {
  const fromEnv = {
    enabled: process.env.MINIMAX_API_KEY ? true : null,
    baseUrl: process.env.MINIMAX_BASE_URL || null,
    model: process.env.MINIMAX_MODEL || null,
    apiKey: process.env.MINIMAX_API_KEY || null,
    timeoutMs: process.env.MINIMAX_TIMEOUT ? Number(process.env.MINIMAX_TIMEOUT) : null,
  };
  let fromFile = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(AI_FILE, 'utf8'));
  } catch (_) {
    /* 没有这个文件就是没配 AI，正常情况 */
  }
  const cfg = { ...fromFile, ...Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v != null)) };
  return {
    enabled: cfg.enabled !== false,
    baseUrl: String(cfg.baseUrl || 'https://api.minimax.io/v1').replace(/\/+$/, ''),
    model: String(cfg.model || 'MiniMax-M3'),
    apiKey: String(cfg.apiKey || ''),
    timeoutMs: Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 45000,
    maxCompletionTokens: Number(cfg.maxCompletionTokens) > 0 ? Number(cfg.maxCompletionTokens) : 8000,
  };
}

/** 给前端看的状态：绝不含 key 本身 */
function aiStatus() {
  const c = loadAIConfig();
  return {
    enabled: c.enabled && !!c.apiKey,
    model: c.model,
    hasKey: !!c.apiKey,
    timeoutMs: c.timeoutMs,
  };
}

/**
 * 剥掉 <think>…</think>。
 * MiniMax-M3 开启思考时，回答和思考过程会挤在 content 同一个字段里，
 * 不剥的话后面 JSON.parse 必崩。
 */
function stripThink(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/i, '')
    .trim();
}

/** 从可能夹杂散文/代码围栏的回复里抠出 JSON 对象 */
function extractJSON(text) {
  const s = stripThink(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * 调一次 MiniMax。永远不抛异常，只返回 { ok, data, error }，
 * 调用方拿不到结果时走降级，不该让整个功能崩掉。
 */
async function callAI(messages, opts = {}) {
  const c = loadAIConfig();
  if (!c.enabled || !c.apiKey) {
    return { ok: false, error: '还没配置 AI，去 data/ai.json 填上 API Key' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || c.timeoutMs);
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model || c.model,
        messages,
        max_completion_tokens: opts.maxTokens || c.maxCompletionTokens,
        temperature: opts.temperature == null ? 0.6 : opts.temperature,
        // 默认关掉思考：实测同一道调度题，开思考 20.3s/1628 tokens，
        // 关掉只要 5.0s/430 tokens，而 JSON 质量一样 —— 做饭时等 20 秒不可接受。
        // 需要仔细看图的任务可以单独开回来。
        // 只有 adaptive / disabled 两种取值，没有 enabled。
        ...(opts.think
          ? { thinking: { type: 'adaptive' }, reasoning_split: true }
          : { thinking: { type: 'disabled' }, reasoning_split: true }),
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let msg = `AI 返回 ${res.status}`;
      try {
        const j = JSON.parse(raw);
        msg = (j.error && j.error.message) || (j.base_resp && j.base_resp.status_msg) || msg;
      } catch (_) {
        /* 保持默认信息 */
      }
      if (res.status === 401 || res.status === 403) msg = 'API Key 不对或已失效，去 data/ai.json 换一个新的';
      if (res.status === 429) msg = 'AI 额度用完了，等会儿再试';
      return { ok: false, error: msg };
    }
    const j = JSON.parse(raw);
    const content = j.choices && j.choices[0] && j.choices[0].message
      ? j.choices[0].message.content
      : '';
    const text = stripThink(content);
    if (!text) return { ok: false, error: 'AI 没返回内容' };
    return {
      ok: true,
      text,
      json: opts.wantJSON ? extractJSON(text) : null,
      usage: j.usage || null,
      model: j.model || c.model,
    };
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      return { ok: false, error: 'AI 超时了，可能网络不通或模型在想太久' };
    }
    return { ok: false, error: `连不上 AI：${(err && err.message) || '未知错误'}` };
  } finally {
    clearTimeout(timer);
  }
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
 * ZIP 读写 —— 自己手写的，零依赖
 *
 * 为什么不用现成的库：这个项目承诺「不需要 npm install」。而备份必须
 * 能带上 uploads/ 里的照片，照片在磁盘上是独立文件，JSON 装不下
 * （base64 撑爆 16MB 请求上限）。所以自己写一个够用的 ZIP：
 * 写：store 或 deflate（压不小就不压，省 CPU）
 * 读：从尾部找 EOCD，顺着中央目录逐个解
 *
 * 只支持标准 ZIP 的最常见形态，不做 ZIP64（4GB 以上）、不加密、不解压
 * 带密码的包 —— 家庭菜单的备份用不上那些。
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP 用的是 MS-DOS 时间（秒只有 2 秒精度，1980 年起） */
function dosStamp(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/**
 * files: [{ name, data }]，data 可以是 Buffer 或字符串
 * 返回整个 zip 的 Buffer
 */
function zipMake(files) {
  const { time, date } = dosStamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(raw);
    // 压不小就原样存：省掉一次 inflate/deflate，家庭菜单的 JSON 本来就压不动
    const deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // 标志位：文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra 长度
    locals.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    cd.writeUInt16LE(20, 4); // 生成版本
    cd.writeUInt16LE(20, 6); // 解压所需版本
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // 起始磁盘号
    cd.writeUInt16LE(0, 36); // 内部属性
    cd.writeUInt32LE(0, 38); // 外部属性
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(centrals);
  if (cdBuf.length + offset > 0xffffffff) throw new Error('内容太大，超过 ZIP 上限');

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/**
 * 读 zip，返回 Map<文件名, Buffer>。
 * 刻意不做「目录穿越」防护在函数里 —— 调用方拿到名字后必须自己
 * path.basename 消毒，否则一个 ../ 的条目就能把文件写到 uploads/ 外面。
 */
function zipRead(buf, maxTotalBytes) {
  // 从尾部往前找 EOCD 签名（注释最长 65535，所以往后多扫一段）
  let eocd = -1;
  const from = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('这不是有效的备份文件（不是 zip）');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('备份文件目录损坏');
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // 本地文件头的 extra 长度可能和中央目录记录的不一样，必须去本地头重读，
    // 直接拿中央目录的偏移算会差那么几个字节，图片就解不出来了
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error('备份文件内容损坏');
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    if (start + compSize > buf.length) throw new Error('备份文件内容不完整');

    total += rawSize;
    if (maxTotalBytes && total > maxTotalBytes) {
      throw new Error('备份文件解压后太大，已拒绝（可能是损坏文件）');
    }

    const payload = buf.slice(start, start + compSize);
    if (method === 8) out.set(name, zlib.inflateRawSync(payload));
    else if (method === 0) out.set(name, Buffer.from(payload));
    else throw new Error(`备份文件里有不支持的压缩方式（method=${method}）`);

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** 看看这坨字节是不是 zip（PK\x03\x04） */
function looksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/* ------------------------------------------------------------------ *
 * 备份 / 恢复
 *
 * 备份是一个 zip：backup.json（7 类数据）+ uploads/（照片）。
 * 之前导出只给 JSON，照片全丢 —— 菜谱在、图没了，恢复完才发现，
 * 等于备份了个寂寞。
 * ------------------------------------------------------------------ */

function backupPayload() {
  return {
    __app: 'family-menu',
    exportedAt: nowISO(),
    categories: state.categories,
    dishes: state.dishes,
    orders: state.orders,
    settings: state.settings,
    households: state.households,
    pantry: state.pantry,
    plans: state.plans,
  };
}

/**
 * 把一份备份灌进当前状态。返回恢复进去的条数。
 * 上传恢复和备份恢复共用这一段，免得两条路修一个漏一个。
 */
function applyBackup(src) {
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
    // hasPin 是给前端的派生标记，不是真配置，别让它进磁盘
    const { hasPin: _ignored, ...incoming } = src.settings;
    const prevPin = state.settings.adminPin;
    state.settings = { ...defaultState().settings, ...incoming };
    // 备份可能把口令换了或取消了，旧会话全部作废
    if (state.settings.adminPin !== prevPin) sessions.clear();
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

  saveNow();
  return {
    dishes: state.dishes.length,
    households: state.households.length,
    pantry: state.pantry.length,
    plans: state.plans.length,
  };
}
const PHOTO_RE = /\.(jpg|jpeg|png|gif|webp|avif)$/i;

/** 当前状态 + uploads/ 里的照片，打成一个 zip */
function buildBackupZip() {
  const files = [{ name: 'backup.json', data: JSON.stringify(backupPayload(), null, 2) }];
  let photos = 0;
  try {
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      if (!name || name.startsWith('.') || !PHOTO_RE.test(name)) continue;
      const full = path.join(UPLOAD_DIR, name);
      if (!fs.statSync(full).isFile()) continue;
      files.push({ name: 'uploads/' + name, data: fs.readFileSync(full) });
      photos++;
    }
  } catch (_) {
    /* uploads/ 还没建，照片 0 张，不影响导出 */
  }
  return { zip: zipMake(files), photos };
}

/**
 * 把 zip 里的照片写回 uploads/。
 * 条目名一律 path.basename —— 备份文件可能来自别人，一个
 * 「uploads/../../.bashrc」不能顺着写到 uploads/ 外面去。
 */
function restoreUploads(zipFiles) {
  let written = 0;
  let skipped = 0;
  for (const [name, data] of zipFiles) {
    if (!name.startsWith('uploads/')) continue;
    const base = path.basename(name);
    if (!base || base.startsWith('.') || !PHOTO_RE.test(base)) {
      skipped++;
      continue;
    }
    fs.writeFileSync(path.join(UPLOAD_DIR, base), data);
    written++;
  }
  return { written, skipped };
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

function listBackups() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^backup-\d{8}-\d{6}\.zip$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1)); // 新的排前面
  } catch (_) {
    return [];
  }
}

/** 备份名是外部来的，拼路径前必须认死格式，否则 ../ 就能读任意文件 */
function safeBackupName(name) {
  if (typeof name !== 'string' || !/^backup-\d{8}-\d{6}\.zip$/.test(name)) return null;
  return name;
}

function pruneBackups() {
  const all = listBackups();
  let n = 0;
  for (const old of all.slice(BACKUP_KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, old.name));
      n++;
    } catch (_) {
      /* ignore */
    }
  }
  return n;
}

function makeBackup(reason) {
  saveNow(); // 先把内存里的落盘，快照才是准的
  ensureBackupDir();
  const { zip, photos } = buildBackupZip();
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name =
    `backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`;
  fs.writeFileSync(path.join(BACKUP_DIR, name), zip);
  const pruned = pruneBackups();
  console.log(
    `[backup] ${name}  ${(zip.length / 1024).toFixed(0)}KB  照片 ${photos} 张` +
      (reason ? `  (${reason})` : '') +
      (pruned ? `  清理旧备份 ${pruned} 份` : '')
  );
  return { name, size: zip.length, photos };
}

let autoBackupTimer = null;

function scheduleAutoBackup() {
  // 启动先来一份：万一这之前的数据已经是坏的，至少留个现场
  try {
    makeBackup('启动');
  } catch (err) {
    console.error('[backup] 启动快照失败：', err.message);
  }
  // 每天凌晨 3 点打一份（家里没人改数据的时间）
  const msUntilNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };
  const run = () => {
    autoBackupTimer = setTimeout(
      () => {
        try {
          makeBackup('每日');
        } catch (err) {
          console.error('[backup] 定时快照失败：', err.message);
        }
        run();
      },
      msUntilNext()
    );
    if (autoBackupTimer.unref) autoBackupTimer.unref();
  };
  run();
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
        // 每个做法可以带自己的调料。
        // 一道菜常有几种做法甚至几种口味（红烧/清蒸、甜口/辣口），
        // 用到的调料本来就不一样，全挂在菜品级就分不出谁是谁的。
        // 菜品级的 seasonings 现在的语义是「通用调料」，两种都不冲突。
        // 老数据没有这个字段，解析出来就是空数组 —— 不用迁移，菜谱不会少东西。
        seasonings: safeList(m && m.seasonings)
          .map((s) => ({
            name: safeText(s && s.name, 30).trim(),
            amount: safeText(s && s.amount, 30).trim(),
          }))
          .filter((s) => s.name)
          .slice(0, 40),
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

/* ------------------------------------------------------------------ *
 * 管理口令
 *
 * 口令是拦「乱改菜谱」的，不是拦网络攻击者的 —— 威胁模型是同一个
 * 局域网里手欠的家里人。所以没必要上完整的账号体系，一个口令换一枚
 * 会话 token 就够：口令不落前端，token 走请求头，服务端自己判定。
 *
 * 没设口令时一律放行，保持「装了就能用」的默认状态。
 * ------------------------------------------------------------------ */

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 小时
const sessions = new Map(); // token -> 过期时间戳

function pruneSessions() {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp <= now) sessions.delete(t);
}

function issueSession() {
  if (sessions.size > 200) pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

/** 没设口令 → 放行；设了 → 必须带有效 token */
function isAuthed(req) {
  const pin = state.settings.adminPin;
  if (!pin) return true;
  const token = req.headers['x-auth-token'];
  if (!token || typeof token !== 'string') return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_TTL); // 滑动续期
  return true;
}

/**
 * 需要管理权限的写操作。
 * 点餐、库存、本周计划**不在列** —— 那是家里人每天都要用的，
 * 口令不该挡着他们正常吃饭。
 */
const ADMIN_WRITES = new Set(['households', 'dishes', 'categories', 'settings', 'import', 'upload']);

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

/** 和 readBody 一样，但收原始字节（恢复备份传的是 zip 本体，不是 JSON） */
function readBodyRaw(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error(`请求体过大（上限 ${Math.round(max / 1024 / 1024)}MB）`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
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

  // ---- 登录换会话 token ----
  if (method === 'POST' && route.length === 1 && route[0] === 'auth') {
    const body = await readBody(req);
    const pin = state.settings.adminPin || '';
    const given = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!pin) return sendJSON(res, 200, { ok: true, data: { token: '', hasPin: false } });
    if (given !== pin) return sendError(res, 401, '口令不对');
    return sendJSON(res, 200, { ok: true, data: { token: issueSession(), hasPin: true } });
  }

  // ---- 统一守卫 ----
  // 管理类的写操作要有有效会话；导出/导入因为文件里含口令明文，同样要认证。
  // AI 调用要花钱，也不能让别人白用。
  // 点餐、库存、本周计划不在保护范围内 —— 那是家里人每天都要用的。
  // 统一守卫。备份一律要认证，GET 也要 —— 备份里存着管理口令明文，
  // 「只能下载不能看列表」等于没保护。
  const needsAuth =
    route[0] === 'export' ||
    route[0] === 'backups' ||
    route[0] === 'ai' ||
    (method !== 'GET' && method !== 'HEAD' && ADMIN_WRITES.has(route[0]));
  if (needsAuth && !isAuthed(req)) {
    return sendError(res, 401, '需要管理口令，请先在「管理」页解锁');
  }

  // ---- AI ----
  // 只暴露「能不能用」和「用的哪个模型」，永远不下发 Key
  if (method === 'GET' && route.length === 1 && route[0] === 'ai') {
    return sendJSON(res, 200, { ok: true, data: aiStatus() });
  }

  // 通用对话入口。task 只用来挑提示词模板，不接受前端传任意模型/baseUrl，
  // 免得有人拿这个接口当任意 API 的跳板。
  if (method === 'POST' && route.length === 2 && route[0] === 'ai' && route[1] === 'chat') {
    const body = await readBody(req);
    const task = safeText(body && body.task, 30);
    const prompt = safeText(body && body.prompt, 12000);
    const imageUrl = safeText(body && body.imageUrl, 8 * 1024 * 1024);
    if (!prompt) return sendError(res, 400, '内容不能为空');

    const AI_TASKS = {
      'recipe-from-image': {
        system:
          '你是中餐菜谱助手。用户会给你一道菜的照片（成品图或食材图）。' +
          '请只输出 JSON，不要任何解释、不要 markdown 代码块。格式：' +
          '{"name":"菜名","category":"分类","description":"一句话介绍",' +
          '"servings":"份量","duration":分钟数,"difficulty":"简单|中等|有点难",' +
          '"tags":["标签"],"seasonings":[{"name":"食材","amount":"用量"}],' +
          '"methods":[{"name":"做法名","seasonings":[{"name","amount"}],"steps":["一步一句"]}],' +
          '"notes":"备注"}。' +
          '要求：分类从家常菜/主食/汤羹/凉菜/早餐/小吃甜点/饮品/其他里挑一个；' +
          '调料用量写「2 个」「400g」「1 小勺」这种能直接买菜的形式；步骤 4-8 步。' +
          'seasonings 是所有做法都要用的通用调料；只有当这道菜有多种做法时，' +
          '才把某几个做法独有的调料放进那个做法的 seasonings 里，通用调料不要重复放。' +
          '看不清的字段就留空字符串或空数组，不要编造。',
        wantJSON: true,
        think: true, // 看图要仔细判断，给它开思考
      },
      'recipe-normalize': {
        system:
          '你是菜谱整理助手。请把用户给的这道菜整理成规范格式，只输出 JSON，' +
          '不要解释、不要 markdown 代码块。格式：' +
          '{"name","category","description","servings","duration":分钟数,' +
          '"difficulty","tags":[],"seasonings":[{"name","amount"}],' +
          '"methods":[{"name","seasonings":[{"name","amount"}],"steps":[]}],"notes"}。' +
          '做法：统一份量写法（如「2-3 人份」「3 碗」）、把用量写规范、' +
          '步骤一行一步、补上原文里明显缺的字段。不要凭空增加原文没有的食材。' +
          '一道菜有多种做法时，把各做法独有的调料放进那个做法的 seasonings，' +
          '通用的留在菜品级；只有一个做法时调料一律放菜品级，那个做法的 seasonings 留空数组。',
        wantJSON: true,
      },
      'cook-plan': {
        system:
          '你是厨房调度助手。用户会给今天要一起做的几道菜。' +
          '请给出并行下厨的顺序：备菜可以并行，热灶必须串行，等待（腌/炖）时去做别的。' +
          '只输出 JSON，不要解释。格式：' +
          '{"prep":["备菜事项"],"sequence":[{"step":1,"what":"做什么","dish":"哪道菜","why":"为什么这么做"}],' +
          '"tips":["提醒"]}。',
        wantJSON: true,
      },
      // 厨房助手现在用的是这个：把 cook-plan 的「顺序」升级成带时间轴的整条流程
      'prep-timeline': {
        system:
          '你是厨房调度助手。用户会给今天要一起做的几道菜，请排出一条从「开始洗菜」' +
          '到最后一道菜上桌的完整流程。只输出 JSON，不要解释、不要 markdown 代码块。格式：' +
          '{"totalMinutes":总耗时分钟数,' +
          '"stages":[{"step":1,"startMinute":从第几分钟开始,"minutes":这一步要几分钟,' +
          '"what":"具体做什么（动词开头，一句话）","dish":"属于哪道菜，没有就空字符串",' +
          '"parallel":true或false,"why":"为什么这一步排在这里"}],' +
          '"tips":["提醒"]}。' +
          '要求：' +
          '1) startMinute 必须和前面所有步骤的时长对得上——第一步 startMinute=0，' +
          '之后每一步的 startMinute = 上一步 startMinute + 上一步 minutes；' +
          '2) parallel=true 表示这一步可以和别的菜同时做（洗菜、切配、腌肉、蒸饭），' +
          'parallel=false 表示必须守着灶台或必须等上一步做完（下锅、翻炒、收汁、装盘）；' +
          '3) minutes 写实际耗时，洗菜切菜 3-8 分钟，下锅翻炒 2-5 分钟，' +
          '炖煮 15-40 分钟，不要一律填 5；' +
          '4) 步骤 5-12 条，从备菜一直写到全部上桌；' +
          '5) why 用一句话说明为什么这么排，不要空话。',
        wantJSON: true,
      },
      // 全局对话助手：菜单/库存/点餐/计划哪都能问，能多轮接着聊，
      // 还能回一句「加到菜单里」就真的给出一张待确认的操作卡。
      // 前端把「当前在看什么」拼进 prompt，这里只管怎么回。
      'assistant-chat': {
        system:
          '你是「家庭菜单」这个本地菜谱应用的助手，服务于一户普通人家。你不只是聊天，' +
          '还能真的动手改这个应用里的数据。\n' +
          '应用里有：菜单（菜谱）、点餐单、买菜清单、库存（食材/数量/保质期）、本周计划、家庭成员。\n\n' +
          '用户消息前面有一段【当前页面】上下文，说明他在哪个页面、手上是什么。务必结合它回答。\n\n' +
          '只输出 JSON，不要 markdown 代码块。格式：\n' +
          '{"reply":"给用户看的话，纯文本","actions":[]}\n' +
          'actions 里放你要执行的操作，最多 3 条：\n' +
          '[{"type":"add_dish","data":{"name":"菜名","category":"分类","description":"一句话介绍",' +
          '"servings":"2 人份","duration":20,"difficulty":"简单","tags":["下饭"],' +
          '"seasonings":[{"name":"盐","amount":"2g"}],' +
          '"methods":[{"name":"做法名","steps":["一步一行"],"seasonings":[{"name":"小米辣","amount":"1 勺"}]}]}}]\n' +
          '[{"type":"order_dish","data":{"dishName":"菜名（必须和菜单里的完全一样）",' +
          '"requester":"谁点的，没有就说匿名","people":2,"note":"备注"}}]\n' +
          '[{"type":"add_to_plan","data":{"dishName":"菜名"}}]\n' +
          '[{"type":"add_pantry","data":{"name":"食材名","category":"蔬菜","quantity":2,' +
          '"unit":"根","expireAt":"2026-10-20","note":""}}]\n\n' +
          '怎么用 actions：\n' +
          '· 用户说「把…加到菜单 / 记一道菜 / 收录这道菜」→ add_dish\n' +
          '· 用户说「我想吃… / 帮我点… / 加个单」→ order_dish\n' +
          '· 用户说「这周做… / 排进计划」→ add_to_plan\n' +
          '· 用户说「刚买了… / 记一下库存 / 进了几斤」→ add_pantry\n' +
          '· 只是问「这道菜怎么做」「今晚吃什么」「还有几天过期」→ 不要 actions，actions 留空数组 []\n' +
          '· 一次最多 3 条。\n' +
          '· 参数不全不要反问一串：按下面的默认值补上，然后在 reply 里带一句\n' +
          '  「缺的我先按…记的，不对告诉我」即可。\n' +
          '  只有菜名缺了（用户压根没说做什么）才真的反问。\n' +
          '  默认值：servings="2 人份"、difficulty="简单"、duration=30、people=2、\n' +
          '  category="家常菜"、order_dish 的 requester="匿名"、add_pantry 的 unit="份"。\n' +
          '· add_dish 特殊：用户常常只给一个菜名。这时候要像正常菜谱一样把\n' +
          '  seasonings 和 methods 填完整 —— 通用调料给足量，每个做法写清步骤\n' +
          '  （一行一步，4-8 步），这是这个功能最有用的地方，不要留空。\n' +
          '  只有用户明说「先建个空壳」「别的我一会儿填」时才留空数组。\n' +
          '  在 reply 里说明「用量和步骤我按常见做法填了，录进来后可以改」。\n' +
          '  add_dish 里 duration 是分钟（数字），expireAt 是 YYYY-MM-DD。\n' +
          '  category 从这些里选：家常菜、主食、汤羹、凉菜、早餐、小吃甜点、饮品。\n' +
          '  order_dish / add_to_plan 的 dishName 必须能在菜单里找到，找不到就别放这条。\n\n' +
          'reply 怎么写：\n' +
          '1) 用中文，直接给答案，不要客套开场（「好的」「没问题」这类直接省掉）；\n' +
          '2) 有 actions 时，reply 用一两句话说明「我准备做什么」，别把内容重复一遍；\n' +
          '3) 步骤用编号列表，用量写「2 个」「400g」「1 小勺」这种具体形式；\n' +
          '4) 上下文里没给的数字不要编。缺信息就直说「你没说几个人吃」并给个按 2 人份的答案；\n' +
          '5) 简洁。一次别写超过 400 字，用户在手机上扫着看。',
        wantJSON: true,
        // 对话不能因为模型偶尔没包好 JSON 就整句没回应：
        // 解析失败就把原文当 reply 返回，actions 照常是空。
        jsonFallback: true,
        think: false, // 对话要快，开思考会明显拖慢每一句
      },
    };

    const t = AI_TASKS[task];
    if (!t) return sendError(res, 400, '不认识这个 AI 任务');

    const userContent = imageUrl
      ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }]
      : prompt;
    // 多轮对话：body.history 里的历史也是模型给的，不接受前端直接传消息数组
    // （那等于把这个接口变成任意角色扮演的跳板）
    const history = Array.isArray(body && body.history)
      ? body.history
          .slice(-12) // 只带最近几轮，太长会把每句都拖慢
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
          .map((m) => ({ role: m.role, content: safeText(m.text, 2000) }))
      : [];
    const messages = [{ role: 'system', content: t.system }, ...history, { role: 'user', content: userContent }];
    const r = await callAI(messages, { wantJSON: t.wantJSON, think: !!t.think });
    if (!r.ok) return sendJSON(res, 200, { ok: true, data: { ok: false, error: r.error } });
    if (t.wantJSON && !r.json) {
      // 对话任务不让「模型这轮没包好 JSON」把整句话吞掉：
      // 原文照样当回复给用户，只是这轮没有可执行动作。
      if (t.jsonFallback && r.text) {
        return sendJSON(res, 200, {
          ok: true,
          data: {
            ok: true,
            result: { reply: r.text, actions: [] },
            fallback: true,
            usage: r.usage,
            model: r.model,
          },
        });
      }
      return sendJSON(res, 200, {
        ok: true,
        data: { ok: false, error: 'AI 的回复看不懂（不是合法 JSON），可以再试一次' },
      });
    }
    return sendJSON(res, 200, {
      ok: true,
      data: { ok: true, result: t.wantJSON ? r.json : r.text, usage: r.usage, model: r.model },
    });
  }

  // GET /api/version —— 版本号和更新内容。
  // 不用认证：这里没有任何用户数据，网页上任何人都该能看到自己跑的是哪一版。
  if (method === 'GET' && route.length === 1 && route[0] === 'version') {
    return sendJSON(res, 200, {
      ok: true,
      data: { version: APP_VERSION, releases: RELEASES },
    });
  }

  // GET /api/state —— 全量状态（家庭规模数据很小，一次取完最省事）
  if (method === 'GET' && route.length === 1 && route[0] === 'state') {
    // 口令绝不能跟着 state 一起发出去：否则局域网里任何人按 F12
    // 就能在返回的 JSON 里读到明文，管理口令形同虚设。
    const { adminPin, ...pubSettings } = state.settings;
    return sendJSON(res, 200, {
      ok: true,
      data: {
        categories: state.categories,
        dishes: state.dishes,
        orders: state.orders,
        settings: { ...pubSettings, hasPin: !!adminPin },
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
      // 两种批量删法，靠参数区分：
      //   ?ids=a,b,c            删勾选的那几样（库存多选模式）
      //   ?householdId=&scope=   删过期 / 临期（保质期清理）
      // 两种都必须明确给参数：宁可报错，也不能「不传参数就当全选」。
      const idsRaw = url.searchParams.get('ids');
      if (idsRaw !== null) {
        const ids = new Set(
          idsRaw
            .split(',')
            .map((s) => safeText(s, 40))
            .filter(Boolean)
        );
        if (!ids.size) return sendError(res, 400, '没有选中任何一样');
        const before = state.pantry.length;
        // 一次过滤删完，而不是循环 splice：省掉「边删边比对」的坑
        state.pantry = state.pantry.filter((p) => !ids.has(p.id));
        scheduleSave('pantry');
        return sendJSON(res, 200, {
          ok: true,
          data: { removed: before - state.pantry.length },
        });
      }
      const hid = safeText(url.searchParams.get('householdId'), 40);
      const scope = safeText(url.searchParams.get('scope'), 12);
      // 少了 scope 就直接拒：以前这里是 return false（=删），
      // 意味着误调一次接口就能把全家的保质期食材清空
      if (scope !== 'expired' && scope !== 'soon') {
        return sendError(res, 400, '得说清楚清理哪一类：expired 或 soon');
      }
      const today = todayStr();
      const soon = daysFromNow(3);
      const keep = (p) => {
        if (hid && p.householdId !== hid) return true;
        if (!p.expireAt) return true;
        if (scope === 'expired') return p.expireAt >= today;
        return p.expireAt < today || p.expireAt > soon; // soon
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
    // 批量改状态：点餐页「一键开做」用。PATCH /api/orders 不带 id。
    // 一次改完，不是循环单改 —— 十几条点餐时前者明显更快。
    if (method === 'PATCH' && !id) {
      const body = await readBody(req);
      const status = ['pending', 'cooking', 'done', 'cancelled'].includes(body.status)
        ? body.status
        : null;
      if (!status) return sendError(res, 400, '状态不对');
      const ids = Array.isArray(body.ids) ? body.ids.map((s) => safeText(s, 40)).filter(Boolean) : [];
      if (!ids.length) return sendError(res, 400, '没有选中任何一条');
      const set = new Set(ids);
      let n = 0;
      const now = nowISO();
      state.orders.forEach((o) => {
        if (!set.has(o.id)) return;
        o.status = status;
        o.updatedAt = now;
        n++;
      });
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: { changed: n, status } });
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
    // 口令三态：不传 = 不动；传空串 = 取消；传非空 = 改新值。
    // 前端拿不到旧口令明文了，所以「清除」必须靠显式标记，不能靠留空猜。
    if (body.clearAdminPin === true) {
      s.adminPin = '';
      sessions.clear(); // 口令没了，所有会话作废
    } else if (typeof body.adminPin === 'string' && body.adminPin.trim()) {
      const next = safeText(body.adminPin, 12).trim();
      if (next !== s.adminPin) sessions.clear(); // 换口令了，旧会话全部失效
      s.adminPin = next;
    }
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
    // 响应里同样不能带口令明文
    const { adminPin, ...safeSettings } = s;
    return sendJSON(res, 200, {
      ok: true,
      data: { ...safeSettings, hasPin: !!adminPin },
    });
  }

  // ---- 备份列表 / 立即打一份 / 下载 / 恢复 ----
  if (route[0] === 'backups') {
    const name = route[1];

    if (method === 'GET' && !name) {
      return sendJSON(res, 200, { ok: true, data: { keep: BACKUP_KEEP, list: listBackups() } });
    }
    if (method === 'GET' && name) {
      const safe = safeBackupName(path.basename(decodeURIComponent(name)));
      if (!safe) return sendError(res, 400, '备份文件名不对');
      const file = path.join(ensureBackupDir(), safe);
      if (!fs.existsSync(file)) return sendError(res, 404, '没有这份备份');
      const buf = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safe}"`,
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }
    if (method === 'POST' && !name) {
      const r = makeBackup('手动');
      return sendJSON(res, 200, {
        ok: true,
        data: { ...r, list: listBackups() },
      });
    }
    if (method === 'POST' && route[2] === 'restore') {
      const safe = safeBackupName(path.basename(decodeURIComponent(name)));
      if (!safe) return sendError(res, 400, '备份文件名不对');
      const file = path.join(ensureBackupDir(), safe);
      if (!fs.existsSync(file)) return sendError(res, 404, '没有这份备份');

      // 顺序很重要：先把要恢复的那份整个读进内存。
      // 反过来先打「恢复前」快照的话，那一下会触发保留份数的清理 ——
      // 手上正好只有 7 份、要恢复的是最老那份的话，它会被自己刚存的快照挤掉。
      let zipFiles;
      try {
        zipFiles = zipRead(fs.readFileSync(file), MAX_IMPORT);
      } catch (err) {
        return sendError(res, 400, '备份文件读不出来：' + err.message);
      }
      const jsonBuf = zipFiles.get('backup.json');
      if (!jsonBuf) return sendError(res, 400, '这份备份里没有 backup.json，可能不是本程序的备份');
      let src;
      try {
        src = JSON.parse(jsonBuf.toString('utf8'));
      } catch (_) {
        return sendError(res, 400, '备份文件格式不正确');
      }

      // 恢复会覆盖现在的数据：先给现状留一份，免得用户后悔了没得退
      let safety = null;
      try {
        safety = makeBackup('恢复前').name;
      } catch (err) {
        console.error('[backup] 恢复前快照失败：', err.message);
      }

      let photos;
      try {
        photos = restoreUploads(zipFiles);
      } catch (err) {
        return sendError(res, 500, '照片写回失败：' + err.message);
      }
      const r = applyBackup(src);
      return sendJSON(res, 200, { ok: true, data: { ...r, ...photos, safety } });
    }
    return sendError(res, 405, '不支持的请求');
  }

  // ---- 导出（zip，含照片）----
  if (method === 'GET' && route[0] === 'export') {
    const { zip, photos } = buildBackupZip();
    const filename = `menu-backup-${todayStr()}.zip`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': zip.length,
    });
    return res.end(zip);
  }

  if (method === 'POST' && route[0] === 'import') {
    // 两种都收：新版 zip（含照片），以及旧版导出的纯 JSON
    const raw = await readBodyRaw(req, MAX_IMPORT);
    let src;
    let photos = { written: 0, skipped: 0 };

    if (looksLikeZip(raw)) {
      let zipFiles;
      try {
        zipFiles = zipRead(raw, MAX_IMPORT);
      } catch (err) {
        return sendError(res, 400, '备份文件读不出来：' + err.message);
      }
      const jsonBuf = zipFiles.get('backup.json');
      if (!jsonBuf) return sendError(res, 400, '这个 zip 里没有 backup.json，可能不是本程序的备份');
      try {
        src = JSON.parse(jsonBuf.toString('utf8'));
      } catch (_) {
        return sendError(res, 400, '备份文件格式不正确');
      }
      try {
        photos = restoreUploads(zipFiles);
      } catch (err) {
        return sendError(res, 500, '照片写回失败：' + err.message);
      }
    } else {
      try {
        src = JSON.parse(raw.toString('utf8'));
      } catch (_) {
        return sendError(res, 400, '既不是备份 zip，也不是 JSON');
      }
      if (src && src.data) src = src.data;
    }

    if (!src || !Array.isArray(src.dishes)) return sendError(res, 400, '备份文件格式不正确');
    const r = applyBackup(src);
    return sendJSON(res, 200, { ok: true, data: { ...r, ...photos } });
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
  console.log(`  自动备份 ${BACKUP_DIR}（每天凌晨 3 点，保留最近 ${BACKUP_KEEP} 份）`);
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
  for (const dir of [DATA_DIR, UPLOAD_DIR, PUBLIC_DIR, BACKUP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  loadState();
  saveNow();
  scheduleAutoBackup();
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