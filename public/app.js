/* =========================================================
   家庭菜单 · 前端
   ========================================================= */

'use strict';

/* ---------------- 状态 ---------------- */

const S = {
  view: 'menu',
  category: '全部',
  keyword: '',
  orderStatus: 'pending',
  groupByMember: true,
  memberFilter: '',
  pantryCat: '全部',
  pantryFilter: 'all', // all | soon | expired
  pantryPick: false, // 库存批量删除：多选模式开关
  pantrySel: new Set(), // 库存批量删除：勾中的 id
  planWeek: '', // 正在看的周（周一日期），空 = 本周
  authed: false, // 是否已解锁管理区（没设口令时恒为 true）
  cookPlanText: '', // 厨房助手结果的纯文本版，给「复制」用
  version: null, // /api/version 的结果，管理页显示版本和更新内容
  backups: null, // /api/backups 的结果，管理页显示自动备份状态
  chatOpenDish: '', // 打开对话时正在看/编辑的是哪道菜，AI 回答要贴着它
  chatTurns: [], // 对话历史，{role:'user'|'assistant', text, actions:[{type,data,state}]}
  chatOpen: false, // 底部悬浮窗是展开还是收起
  chatDot: false, // 收起期间来了新回复，在 pill 上冒个红点
  householdId: '', // 当前家庭，存在本机 localStorage：每台设备各选各的
  data: {
    categories: [], dishes: [], orders: [], settings: {},
    households: [], pantry: [], plans: [],
  },
  presets: null, // 食材预设，按需从 /api/ingredient-presets 拉一次
  draft: null, // 菜品编辑草稿
  draftOrder: null, // 点餐草稿
  shoppingChecked: new Set(),
  loading: true,
};

/** 老的 households.json 还没建时，历史数据都落在 h_home 上 */
const FALLBACK_HOUSE = 'h_home';
const LS_HOUSE = 'familyMenu.householdId';

/* ---------------- 工具 ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, ms = 1900) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), ms);
}

const EMOJI = ['🍚', '🍜', '🍲', '🍛', '🍳', '🥘', '🍤', '🥗', '🍖', '🐟', '🥟', '🍤', '🥦', '🍠', '🌽'];

/** 库存分类图标：预设接口没拉到时也要有兜底 */
const PANTRY_EMOJI = {
  肉类: '🥩', 蛋类: '🥚', 奶制品: '🥛', 蔬菜: '🥬', 水果: '🍎', 主食粮油: '🍚',
  豆制品: '🫘', 水产海鲜: '🐟', 冷冻食品: '🧊', 饮料: '🥤', 调味干货: '🧂',
  零食: '🍪', 其他: '📦',
};
const PANTRY_ORDER = Object.keys(PANTRY_EMOJI);

const catEmoji = (name) => PANTRY_EMOJI[name] || '📦';

/** 按菜名取一个稳定的 emoji 占位图 */
function dishEmoji(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
  return EMOJI[h % EMOJI.length];
}

function dishById(id) {
  return S.data.dishes.find((d) => d.id === id) || null;
}

function sortedCategories() {
  return [...S.data.categories].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/* ---------------- 日期 ---------------- */

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function fmtDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayStr(d = new Date()) {
  return fmtDay(d);
}

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmtDay(d);
}

/** to - from，按整天算（不受时分秒影响） */
function dayDiff(from, to) {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/* ---------------- 周 ---------------- */

/** 一律按「周一开始」归周，传今天传周三都会落到同一个周一 */
function mondayOf(dateStr) {
  const d = parseDay(dateStr) || new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtDay(d);
}

function addDays(dateStr, n) {
  const d = parseDay(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + n);
  return fmtDay(d);
}

/** 正在查看的那一周（周一日期） */
function planWeek() {
  return S.planWeek || mondayOf(todayStr());
}

function planLabel(weekOf) {
  const from = parseDay(weekOf);
  const to = parseDay(addDays(weekOf, 6));
  const f = `${from.getMonth() + 1}月${from.getDate()}日`;
  const t = `${to.getMonth() + 1}月${to.getDate()}日`;
  const now = new Date();
  const sameYear = from.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : from.getFullYear() + '年'}${f} - ${t}`;
}

/** 这一周相对今天的位置：-1 上周 / 0 本周 / 1 下周 */
function planWeekOffset(weekOf) {
  return Math.round((parseDay(weekOf) - parseDay(mondayOf(todayStr()))) / (7 * 86400000));
}

/* ---------------- 家庭 ---------------- */

function households() {
  return (S.data.households || []).filter((h) => h && h.name);
}

function currentHousehold() {
  const list = households();
  return list.find((h) => h.id === S.householdId) || list[0] || null;
}

function householdName(id) {
  const h = households().find((x) => x.id === id);
  return h ? h.name : '未知家庭';
}

/** 历史点餐可能没记家庭，统一算到默认家庭头上 */
const orderHouse = (o) => o.householdId || FALLBACK_HOUSE;

function householdOrders(id) {
  const hid = id || S.householdId;
  return S.data.orders.filter((o) => orderHouse(o) === hid);
}

function householdPantry(id) {
  const hid = id || S.householdId;
  return S.data.pantry.filter((p) => p.householdId === hid);
}

/** 当前家庭某一周的计划条目（找不到就是空数组） */
function planItems(weekOf, id) {
  const hid = id || S.householdId;
  const wk = mondayOf(weekOf);
  const plan = (S.data.plans || []).find((p) => p.householdId === hid && p.weekOf === wk);
  return plan ? plan.items : [];
}

function planCount(weekOf) {
  return planItems(weekOf).length;
}

/** 保质期状态：过期 / 今天 / 临期(3 天内) / 正常 */
function shelfStatus(item) {
  if (!item.expireAt) return { key: 'none', label: '没填保质期', days: null };
  const today = todayStr();
  const left = dayDiff(today, item.expireAt);
  if (left === null) return { key: 'none', label: '', days: null };
  if (left < 0) return { key: 'expired', label: `已过期 ${-left} 天`, days: left };
  if (left === 0) return { key: 'today', label: '今天到期', days: 0 };
  if (left <= 3) return { key: 'soon', label: `还剩 ${left} 天`, days: left };
  return { key: 'ok', label: `还剩 ${left} 天`, days: left };
}

function pendingOrders() {
  return householdOrders().filter((o) => o.status === 'pending' || o.status === 'cooking');
}

function relTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/* ---------------- 家庭成员（每个家庭各管各的） ---------------- */

/** 当前家庭登记的成员；兼容老数据里 members 是字符串数组的情况 */
function memberList() {
  const h = currentHousehold();
  const raw = (h && h.members) || [];
  return raw
    .map((m, i) =>
      typeof m === 'string'
        ? { id: 'legacy_' + i, name: m, emoji: ['🙋', '👩', '👨', '👧', '👦'][i % 5] }
        : { id: m.id || 'm_' + i, name: m.name, emoji: m.emoji || '🙋' }
    )
    .filter((m) => m.name);
}

function memberByName(name) {
  return memberList().find((m) => m.name === name) || null;
}

function memberEmoji(name) {
  const m = memberByName(name);
  return m ? m.emoji : '👤';
}

/** 某人点过多少次、总共几份（只算当前家庭） */
function memberStats(name) {
  const list = householdOrders().filter((o) => o.requester === name);
  return { count: list.length, people: list.reduce((s, o) => s + (o.people || 1), 0), last: list[0] || null };
}

/* ---------------- AI ---------------- */

// AI 状态：页面加载时拉一次。没配 Key 就整个隐藏入口 ——
// 与其让用户点了才报错，不如一开始就不给入口。
let aiInfo = null;

async function loadAIStatus() {
  try {
    aiInfo = await api('GET', '/api/ai');
  } catch (_) {
    aiInfo = { enabled: false };
  }
  // 没配 Key 就不给入口：与其点了才报错，不如一开始就没有那个悬浮窗
  redrawChat();
  return aiInfo;
}

const aiReady = () => !!(aiInfo && aiInfo.enabled);

/**
 * 版本号和更新内容。
 * 拉不到也不能挡着页面：该显示什么还显示什么，只是版本号位置空着而已。
 */
async function loadVersion() {
  try {
    S.version = await api('GET', '/api/version');
  } catch (_) {
    S.version = null;
  }
  return S.version;
}

/**
 * 自动备份列表。
 * 没解锁就拉不到（备份里存着管理口令），失败就安静空着 ——
 * 备份区是加分项，不该在别处报错时跟着炸。
 */
async function loadBackups() {
  try {
    S.backups = await api('GET', '/api/backups');
  } catch (_) {
    S.backups = null;
  }
  return S.backups;
}

/**
 * 调一次 AI。
 * 失败时统一 toast + 返回 null，调用方拿到 null 就安静退回去，
 * 绝不让 AI 的问题影响到菜谱/点餐这些主流程。
 */
async function askAI(task, prompt, imageUrl) {
  if (!aiReady()) {
    toast('还没配置 AI（data/ai.json 里填 API Key）');
    return null;
  }
  try {
    const r = await api('POST', '/api/ai/chat', { task, prompt, imageUrl });
    if (!r || r.ok === false) {
      toast((r && r.error) || 'AI 这次没成功');
      return null;
    }
    return r.result;
  } catch (err) {
    toast('AI 这次没成功：' + err.message);
    return null;
  }
}

/* =========================================================
   全局 AI 对话助手（底部悬浮窗）

   两件事，都是冲着「更好用」去的：

   1) 入口从顶栏搬到底部。收起时是一条 pill，点开是贴着底部的面板。
      顶栏那颗 💬 又小又靠上，单手拿手机够不着；放到底部随时能戳。

   2) 它不只是聊天。模型可以回一句「我准备把这道菜加到菜单」并附一张
      操作卡，用户点「确认」才真的落库 —— 问一句就能把菜记进来，
      不用先去菜单页找「记一道菜」再抄一遍；但改数据这步仍然由人按。

   关键不在于「能聊天」，而在于**它知道你在看什么**：当前哪个家庭、
   手上这道菜是什么、点餐单上挂着哪几道、库存里什么快过期，
   以及菜单里已经有哪些菜（不然它会一本正经地重复添加已有的那道）。
   ========================================================= */

const VIEW_LABEL = {
  menu: '菜单（浏览菜谱）',
  plan: '本周计划',
  order: '点餐单',
  pantry: '库存',
  manage: '管理',
};

/** 把「当前页面上看得见的东西」摘要成一段话，贴在用户消息前面发给 AI */
function chatContext() {
  const L = [];
  L.push(`【当前页面】${VIEW_LABEL[S.view] || S.view}`);

  const house = currentHousehold();
  if (house) {
    const members = (house.members || []).map((m) => m.name).join('、');
    L.push(`【当前家庭】${house.name}${members ? '，成员：' + members : '，成员还没登记'}`);
  }

  // 手上这道菜：AI 答「减盐怎么改」全靠这段，不然它根本不知道说的是哪道菜
  const d = S.chatOpenDish ? dishById(S.chatOpenDish) : null;
  if (d) {
    const lines = [`【正在看的菜】${d.name}（${d.category}，${d.servings || '份量未填'}，约 ${d.duration || '?'} 分钟，难度${d.difficulty || '未填'}）`];
    if (d.description) lines.push(`  介绍：${d.description}`);
    const gs = collectDishSeasonings(d);
    if (gs.length) {
      lines.push('  调料：' + gs.map((s) => (s.method ? `${s.name} ${s.amount}（${s.method}独有）` : `${s.name} ${s.amount}`)).join('、'));
    }
    (d.methods || []).forEach((m) => {
      if (m.steps && m.steps.length) lines.push(`  做法「${m.name}」：${m.steps.slice(0, 3).join(' ')}${m.steps.length > 3 ? ' …' : ''}`);
    });
    if (d.notes) lines.push(`  备注：${d.notes}`);
    L.push(lines.join('\n'));
  }

  const pend = pendingOrders();
  if (pend.length) {
    L.push(
      `【待做点餐】共 ${pend.length} 道：` +
        pend.map((o) => `${o.dishName}（${o.people} 人份${o.requester ? '，' + o.requester + '点的' : ''}）`).join('、')
    );
  }

  // 库存只给「要处理」的那些，全量倒进去既超长又没用
  const p = householdPantry();
  const soon = p.filter((x) => x.expireAt && daysToToday(x.expireAt) <= 3);
  if (soon.length) {
    L.push(
      `【库存里快过期/已过期】${soon
        .map((x) => `${x.name} ${x.quantity}${x.unit}（${x.expireAt < todayStr() ? '已过期' : '还剩 ' + daysToToday(x.expireAt) + ' 天'}）`)
        .join('、')}`
    );
  } else if (p.length) {
    L.push(`【库存】共 ${p.length} 样，暂时没有快过期的`);
  }

  // 菜单里已有哪些菜必须给全：不然它会一本正经地「添加」一道早就有的菜
  const all = S.data.dishes || [];
  L.push(
    `【菜单里已有的 ${all.length} 道菜】` +
      (all.length
        ? all.map((x) => `${x.name}（${x.category}${x.methods && x.methods.length ? '，' + x.methods.length + ' 种做法' : ''}）`).join('、')
        : '（还一道菜都没有）')
  );
  L.push('【可选分类】' + (S.data.categories || []).map((c) => c.name).join('、'));
  return L.join('\n');
}

/** 距离今天还有几天（过期为负） */
function daysToToday(dateStr) {
  const t = new Date(todayStr() + 'T00:00:00');
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}

/** 快捷指令：跟着当前页面走，减少用户自己想「该问什么」 */
function chatChips() {
  const base = [['清空对话', 'chat-clear']];
  const d = S.chatOpenDish ? dishById(S.chatOpenDish) : null;
  if (d) {
    base.unshift([`${d.name} 还能怎么做`, '']);
    base.unshift([`${d.name} 两个人吃要多少量`, '']);
    base.unshift([`${d.name} 减盐怎么做`, '']);
  }
  if (S.view === 'order' && pendingOrders().length >= 2) {
    base.unshift(['这几道菜先做哪个', '']);
    base.unshift(['今晚几点能吃上', '']);
  }
  if (S.view === 'pantry') {
    base.unshift(['这些能配出今晚的菜吗', '']);
    base.unshift(['哪些该先处理', '']);
  }
  // 「让它动手」的例子放在最前面 —— 这是它跟普通聊天框最不一样的地方
  base.unshift(['把今天做的菜都加到菜单里', '']);
  base.unshift(['随便推荐今晚吃什么', '']);
  return base;
}

/* ---------- 底部悬浮窗的显隐 ---------- */

function openChat() {
  // 这里不再判断 aiReady()：没配 Key 时整个 dock 本来就是 hidden，
  // 多一层判断只会在「刚加载完、正好点进来」的时候白挡一次。
  S.chatOpenDish = S.chatOpenDish || '';
  S.chatOpen = true;
  S.chatDot = false;
  document.body.classList.add('chat-open');
  redrawChat();
  const inp = $('#chatInput');
  if (inp && !('ontouchstart' in window)) inp.focus();
}

function closeChat() {
  S.chatOpen = false;
  document.body.classList.remove('chat-open');
  redrawChat();
}

/* ---------- 可执行动作 ---------- */

const ACTION_META = {
  add_dish: { icon: '📖', verb: '加入菜单', label: '添加菜品' },
  order_dish: { icon: '🔔', verb: '下单', label: '加入点餐单' },
  add_to_plan: { icon: '🗓️', verb: '排进本周计划', label: '加入本周计划' },
  add_pantry: { icon: '🧊', verb: '入库', label: '加入库存' },
};

/** 把模型给的 payload 收拾干净：只留本应用认识的字段，长度也卡住 */
function cleanDishPayload(d) {
  const seasons = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => ({
        name: String((s && s.name) || '').trim().slice(0, 30),
        amount: String((s && s.amount) || '').trim().slice(0, 30),
      }))
      .filter((s) => s.name)
      .slice(0, 40);
  const steps = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => String(s == null ? '' : s).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 30);
  return {
    name: String(d.name || '').trim().slice(0, 40),
    category: String(d.category || '').trim().slice(0, 24),
    description: String(d.description || '').trim().slice(0, 300),
    servings: String(d.servings || '').trim().slice(0, 30),
    duration: Number(d.duration) || 0,
    difficulty: String(d.difficulty || '').trim().slice(0, 12),
    tags: (Array.isArray(d.tags) ? d.tags : [])
      .map((t) => String(t).trim().slice(0, 12))
      .filter(Boolean)
      .slice(0, 8),
    seasonings: seasons(d.seasonings),
    methods: (Array.isArray(d.methods) ? d.methods : [])
      .map((m) => ({
        name: String((m && m.name) || '').trim().slice(0, 24),
        steps: steps(m && m.steps),
        seasonings: seasons(m && m.seasonings),
      }))
      .filter((m) => m.name || m.steps.length)
      .slice(0, 6),
  };
}

/** 动作卡上那几行摘要，让人一眼看清「它到底要改什么」 */
function actionLines(a) {
  const d = a.data || {};
  const out = [];
  if (a.type === 'add_dish') {
    out.push([d.category, d.servings, d.duration ? `约 ${d.duration} 分钟` : '', d.difficulty].filter(Boolean).join(' · '));
    if ((d.seasonings || []).length) {
      out.push('通用调料 ' + d.seasonings.map((s) => `${s.name} ${s.amount || ''}`.trim()).join('、'));
    }
    (d.methods || []).forEach((m) => {
      const extra = (m.seasonings || []).map((s) => `${s.name} ${s.amount || ''}`.trim()).join('、');
      out.push(
        `做法「${m.name || '未命名'}」${m.steps && m.steps.length ? m.steps.length + ' 步' : '（没写步骤）'}` +
          (extra ? ` · 独有调料：${extra}` : '')
      );
    });
  } else if (a.type === 'order_dish') {
    out.push(`${d.people || 2} 人份${d.requester ? ' · ' + d.requester + ' 点的' : ''}`);
    if (d.note) out.push(d.note);
  } else if (a.type === 'add_to_plan') {
    out.push('本周 · ' + (currentHousehold() ? currentHousehold().name : ''));
  } else if (a.type === 'add_pantry') {
    const bits = [d.category, d.quantity != null ? `${d.quantity}${d.unit || ''}` : ''];
    if (d.expireAt) {
      const left = daysToToday(d.expireAt);
      bits.push('保质期到 ' + d.expireAt + (left < 0 ? '（那天就过期了）' : `（还有 ${left} 天）`));
    }
    out.push(bits.filter(Boolean).join(' · '));
  }
  return out.filter(Boolean);
}

function actionTitle(a) {
  const d = a.data || {};
  if (a.type === 'add_dish') return '加一道菜：' + (d.name || '（没名字）');
  if (a.type === 'order_dish') return '点餐：' + (d.dishName || '（没写菜名）');
  if (a.type === 'add_to_plan') return '排进本周计划：' + (d.dishName || '（没写菜名）');
  if (a.type === 'add_pantry') return '入库：' + (d.name || '（没写食材）');
  return '执行操作';
}

/**
 * 真的落库。只在用户点了卡上的「确认」之后才走到这里。
 *
 * 保守为上：菜名对不上菜单、库存没写名字这类情况一律不猜，直接报回去，
 * 让用户改一句话重新问 —— 宁可多问一句，也不要往菜单里塞错东西。
 */
async function runChatAction(turnIdx, actIdx) {
  const t = S.chatTurns[turnIdx];
  const a = t && t.actions && t.actions[actIdx];
  if (!a || a.state !== 'pending') return;
  const d = a.data || {};
  a.state = 'busy';
  redrawChat();
  try {
    if (a.type === 'add_dish') {
      const p = cleanDishPayload(d);
      if (!p.name) throw new Error('这道菜没名字，没法加');
      const dup = (S.data.dishes || []).find((x) => x.name === p.name);
      if (dup) throw new Error(`菜单里已经有「${p.name}」了，不用再加一遍`);
      const saved = await api('POST', '/api/dishes', p);
      a.dishId = (saved && saved.id) || '';
      a.done = `已加入菜单：${p.name}`;
      toast(`📖 已加入菜单：${p.name}`);
    } else if (a.type === 'order_dish') {
      const name = String(d.dishName || '').trim();
      if (!name) throw new Error('没说要吃哪道菜');
      const dish = (S.data.dishes || []).find((x) => x.name === name);
      if (!dish) throw new Error(`菜单里没有「${name}」，先让它加到菜单里`);
      await api('POST', '/api/orders', {
        householdId: S.householdId,
        dishId: dish.id,
        dishName: dish.name,
        requester: String(d.requester || '').trim() || '匿名',
        people: Number(d.people) || 2,
        note: String(d.note || '').trim(),
      });
      a.done = `已下单：${dish.name}`;
      toast(`🔔 已下单：${dish.name}`);
    } else if (a.type === 'add_to_plan') {
      const name = String(d.dishName || '').trim();
      if (!name) throw new Error('没说要排哪道菜');
      const dish = (S.data.dishes || []).find((x) => x.name === name);
      await addToPlan(
        dish ? { dishId: dish.id, name: dish.name, servings: dish.servings } : { name },
        planWeek(),
        () => {}
      );
      a.done = `已排进本周计划：${name}`;
      toast(`🗓️ 已排进本周计划：${name}`);
    } else if (a.type === 'add_pantry') {
      const name = String(d.name || '').trim();
      if (!name) throw new Error('没写食材名');
      await api('POST', '/api/pantry', {
        householdId: S.householdId,
        name,
        category: String(d.category || '其他').trim().slice(0, 20),
        quantity: Number(d.quantity) || 1,
        unit: String(d.unit || '份').trim().slice(0, 10),
        expireAt: d.expireAt ? String(d.expireAt).slice(0, 10) : '',
        note: String(d.note || '').trim(),
      });
      a.done = `已入库：${name}`;
      toast(`🧊 已入库：${name}`);
    } else {
      throw new Error('不认识这个操作');
    }
    a.state = 'done';
    await loadState(true);
    render();
  } catch (err) {
    a.state = 'error';
    a.done = (err && err.message) || '没能执行';
    toast('没执行成功：' + a.done);
  }
  redrawChat();
}

/* ---------- 渲染 ---------- */

/** 一张待确认的操作卡 */
function actionCardHtml(a, ti, ai) {
  const meta = ACTION_META[a.type] || { icon: '⚙️', label: '操作' };
  let body = '';
  if (a.state === 'pending' || a.state === 'busy') {
    const main = meta.icon === '📖' ? 'btn' : 'btn soft';
    body =
      `<div class="act-card-lines">${actionLines(a).map((l) => `<div>${esc(l)}</div>`).join('')}</div>` +
      `<div class="act-card-btns">` +
      `<button class="${main} sm" data-act="chat-run" data-t="${ti}" data-a="${ai}" ${a.state === 'busy' ? 'disabled' : ''}>` +
      `${a.state === 'busy' ? '执行中…' : esc(meta.icon + ' 确认' + meta.verb)}</button>` +
      `<button class="btn ghost sm" data-act="chat-dismiss" data-t="${ti}" data-a="${ai}">算了</button>` +
      `</div>`;
  } else {
    const cls = a.state === 'done' ? 'ok' : 'bad';
    body =
      `<div class="act-card-result ${cls}">${a.state === 'done' ? '✅' : '⚠️'} ${esc(a.done || '')}</div>` +
      `<div class="act-card-btns">` +
      (a.state === 'done' && a.dishId
        ? `<button class="btn ghost sm" data-act="chat-view" data-d="${esc(a.dishId)}">去看看</button>`
        : '') +
      `<button class="btn ghost sm" data-act="chat-dismiss" data-t="${ti}" data-a="${ai}">知道了</button>` +
      `</div>`;
  }
  return `<div class="act-card" data-state="${a.state}">
    <div class="act-card-head">${esc(meta.icon)} <b>${esc(meta.label)}</b></div>
    <div class="act-card-title">${esc(actionTitle(a))}</div>
    ${body}
  </div>`;
}

function redrawChat() {
  const dock = $('#chatDock');
  const panel = $('#chatPanel');
  const pillTxt = $('#chatPillTxt');
  const dot = $('#chatDot');
  if (!dock) return;

  dock.hidden = !aiReady();
  if (!aiReady()) return;

  const open = !!S.chatOpen;
  if (panel) panel.hidden = !open;
  // 展开时 pill 就没用了（面板自带标题栏），留着反而挡住上面的内容
  const pill = document.querySelector('.chat-pill');
  if (pill) pill.hidden = open;

  // 收起状态下那一条 pill：没话就说「问问 AI」，有话就把最后一句露个脸
  if (pillTxt) {
    const last = S.chatTurns[S.chatTurns.length - 1];
    pillTxt.textContent = open
      ? '问问 AI'
      : last
      ? (last.role === 'user' ? '你：' : '') + String(last.text || '').replace(/\s+/g, ' ').slice(0, 18)
      : '问问 AI';
  }
  if (dot) dot.hidden = !S.chatDot;

  const box = $('#chatTurns');
  if (box) {
    box.innerHTML = S.chatTurns
      .map((t, ti) => {
        const bubble =
          `<div class="chat-msg ${t.role}">${
            t.role === 'user' ? esc(t.text) : esc(t.text).replace(/\n/g, '<br />')
          }</div>`;
        const acts =
          t.actions && t.actions.length
            ? `<div class="chat-acts">${t.actions.map((a, ai) => actionCardHtml(a, ti, ai)).join('')}</div>`
            : '';
        return bubble + acts;
      })
      .join('');
    if (chatSending) box.insertAdjacentHTML('beforeend', '<div class="chat-msg assistant typing">正在想…</div>');
    box.scrollTop = box.scrollHeight;
  }

  const chips = $('#chatChips');
  if (chips) {
    chips.innerHTML = chatChips()
      .map(([label, act]) =>
        act
          ? `<button class="chip" data-act="${esc(act)}">${esc(label)}</button>`
          : `<button class="chip" data-act="chat-chip" data-q="${esc(label)}">${esc(label)}</button>`
      )
      .join('');
  }

  const ctx = $('#chatCtx');
  if (ctx) {
    const h = currentHousehold();
    ctx.textContent = [VIEW_LABEL[S.view] || '', h ? h.name : ''].filter(Boolean).join(' · ');
  }
  const send = $('#chatSendBtn');
  if (send) send.disabled = chatSending;
}

/* ---------- 发消息 ---------- */

/** 发一条。上下文每次重算 —— 用户可能在别的页面待了一会儿了 */
async function sendChat(text) {
  const q = String(text || '').trim();
  if (!q) return;
  if (chatSending) return;
  chatSending = true;
  const inp = $('#chatInput');
  if (inp) inp.value = '';
  S.chatTurns.push({ role: 'user', text: q });
  redrawChat();

  const prompt = chatContext() + '\n\n【用户问】' + q;
  const history = S.chatTurns
    .slice(0, -1)
    .map((t) => ({ role: t.role, text: t.text }));

  try {
    const r = await api('POST', '/api/ai/chat', {
      task: 'assistant-chat',
      prompt,
      history,
    });
    if (!r || r.ok === false) {
      S.chatTurns.push({
        role: 'assistant',
        text: '（' + ((r && r.error) || '这次没答上来') + '）',
        actions: [],
      });
    } else {
      // 服务端给的是 { reply, actions }；万一是纯文本（老服务端或降级）也接得住
      const res = r.result;
      const reply = typeof res === 'string' ? res : String((res && res.reply) || '').trim();
      const acts = typeof res === 'object' && res && Array.isArray(res.actions) ? res.actions : [];
      S.chatTurns.push({
        role: 'assistant',
        text: reply || '（没说话）',
        actions: acts
          .filter((a) => a && typeof a.type === 'string' && ACTION_META[a.type])
          .slice(0, 3)
          .map((a) => ({ type: a.type, data: a.data || {}, state: 'pending' })),
      });
    }
  } catch (err) {
    S.chatTurns.push({ role: 'assistant', text: '（连不上：' + err.message + '）', actions: [] });
  }
  chatSending = false;
  // 收着的时候别让用户干等：pill 上冒个红点，回来再看
  S.chatDot = !S.chatOpen;
  redrawChat();
}

let chatSending = false;

/**
 * AI 干活时的忙碌遮罩。
 *
 * 这里刻意不用 openSheet() 当加载层：全局只有一个 #modalRoot，盖上去就把
 * 正在编辑的表单冲掉了 —— 等结果回来 applyAIResult() 找不到 #fName，
 * 表现为「点了规范化，弹层直接消失，菜谱一点没变」，且 Console 一片干净，
 * 极难排查。改成在当前弹层上浮一层透明遮罩：表单原封不动，也顺手挡住
 * 中途误触关闭（关掉了结果就白等一场）。
 */
let aiBusyOn = false;
// 这次忙碌遮罩是不是我们临时把 #modalRoot 掀开才挂上去的
// （原本没弹层，它带着 hidden，遮罩挂进去也看不见）
let aiBusyOwn = false;

function aiBusy(title, hint) {
  if (aiBusyOn) return; // 已经有一层了，别叠成两层
  aiBusyOn = true;
  const el = document.createElement('div');
  el.id = 'aiBusy';
  el.className = 'ai-busy';
  el.innerHTML =
    '<div class="ai-busy-card">' +
    '<div class="ai-busy-ico">🧑‍🍳</div>' +
    `<div class="ai-busy-title">${esc(title)}</div>` +
    `<div class="ai-busy-hint">${esc(hint || '')}</div>` +
    '</div>';
  const root = $('#modalRoot');
  // CSS 里有 `[hidden] { display: none !important }`，而 #modalRoot 没弹层时
  // 一直带着 hidden —— 遮罩挂进去等于挂进了黑洞。点餐页点「厨房助手」正好
  // 没弹层，表现是按下去十几秒毫无反馈，像按钮坏了。临时掀开，用完盖回去。
  if (root && root.hidden) {
    root.hidden = false;
    aiBusyOwn = true;
    document.body.style.overflow = 'hidden';
  }
  (root || document.body).appendChild(el);
}

function aiBusyDone() {
  aiBusyOn = false;
  const el = $('#aiBusy');
  if (el) el.remove();
  if (!aiBusyOwn) return;
  aiBusyOwn = false;
  const root = $('#modalRoot');
  // 等结果的间隙可能已经开出了新弹层（比如厨房助手的时间轴），
  // 那种情况下不能再把 root 盖回去，否则连刚出的结果一起收走
  if (root && !root.querySelector('.sheet')) {
    root.hidden = true;
    document.body.style.overflow = '';
  }
}

/* ---------------- API ---------------- */

// 管理口令换来的会话 token，存在本机。服务端不再把口令明文下发给前端，
// 所以前端只能靠这个 token 证明「我已经解锁过」。
const LS_AUTH = 'familyMenu.authToken';
const authToken = () => localStorage.getItem(LS_AUTH) || '';
function setAuthToken(t) {
  if (t) localStorage.setItem(LS_AUTH, t);
  else localStorage.removeItem(LS_AUTH);
}

async function api(method, path, body, rawContentType) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (rawContentType) {
      // 恢复备份传的是 zip 本体，不能 JSON.stringify —— 服务端按字节嗅探格式
      opts.headers['Content-Type'] = rawContentType;
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const t = authToken();
  if (t) opts.headers['X-Auth-Token'] = t;
  const res = await fetch(path, opts);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    throw new Error('服务器返回异常');
  }
  // 401 = 口令不对或会话过期，清掉本地 token 逼用户重新解锁
  if (res.status === 401) setAuthToken('');
  if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败(${res.status})`);
  return json.data;
}

async function loadState(silent) {
  try {
    const data = await api('GET', '/api/state');
    S.data = data;
    S.shoppingChecked = new Set(data.settings.shoppingChecked || []);
    // 没设口令 → 管理区本来就开着；设了 → 看本机有没有有效会话
    if (!data.settings.hasPin) S.authed = true;
    else if (!authToken()) S.authed = false;
    // 当前家庭记在这台设备上：A 家选 301、B 家选 502，互不影响
    const list = households();
    const saved = localStorage.getItem(LS_HOUSE);
    if (saved && list.some((h) => h.id === saved)) S.householdId = saved;
    else S.householdId = (list[0] && list[0].id) || '';
    if (S.householdId !== saved) {
      if (S.householdId) localStorage.setItem(LS_HOUSE, S.householdId);
      else localStorage.removeItem(LS_HOUSE);
    }
    S.loading = false;
    if (!silent) render();
  } catch (err) {
    S.loading = false;
    if (!silent) {
      $('#view').innerHTML = `<div class="empty">
        <span class="empty-emoji">😵</span>
        <p class="empty-title">连不上服务</p>
        <p class="empty-text">${esc(err.message)}<br/>请确认家庭菜单服务还在运行，然后刷新页面。</p>
        <button class="btn soft" style="margin-top:16px" data-act="reload">重新连接</button>
      </div>`;
    }
  }
}

/* ---------------- 弹层 ---------------- */

let sheetOnMount = null;

/**
 * 表单草稿：填到一半被误关掉不该白填。
 * key = 菜品 id（新菜用 __new__），值是打开时的表单基线。
 * 关掉时如果内容变了，存进 dishDrafts，下次打开同一条自动恢复。
 */
const dishDrafts = new Map();
let sheetBaseline = null; // 打开时的表单快照；null = 不做脏检查
let sheetDraftKey = null; // 这次草稿归属谁

/**
 * 抓当前弹层里所有可编辑控件的值，用来判断「有没有改过」和存草稿。
 * 用 id 区分普通字段，用 data-act+data-i 区分调料行/做法行（它们没有 id）。
 */
function snapshotSheetInputs() {
  const out = {};
  const root = $('#modalRoot');
  if (!root) return out;
  root
    .querySelectorAll(
      'input[id], textarea[id], select[id], input[data-act="season-name"], input[data-act="season-amt"], input[data-act="method-name"], textarea[data-act="method-steps"]'
    )
    .forEach((el) => {
      const k = el.id || `${el.dataset.act}:${el.dataset.i || ''}`;
      out[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
  return out;
}

function sheetIsDirty() {
  if (!sheetBaseline) return false;
  return JSON.stringify(snapshotSheetInputs()) !== JSON.stringify(sheetBaseline);
}

/** 把草稿值盖回表单控件（用于恢复上次没保存的内容） */
function applySheetInputs(snap) {
  const root = $('#modalRoot');
  if (!root || !snap) return;
  root
    .querySelectorAll(
      'input[id], textarea[id], select[id], input[data-act="season-name"], input[data-act="season-amt"], input[data-act="method-name"], textarea[data-act="method-steps"]'
    )
    .forEach((el) => {
      const k = el.id || `${el.dataset.act}:${el.dataset.i || ''}`;
      if (!(k in snap)) return;
      if (el.type === 'checkbox') el.checked = !!snap[k];
      // 文件框的 value 只能置空，赋别的值浏览器会抛异常并中断后面的恢复
      else if (el.type === 'file') { /* 跳过 */ }
      else el.value = snap[k];
    });
}

/** 存草稿（只在真正关闭、且确实改过内容时调用） */
function stashSheetDraft() {
  if (!sheetDraftKey || !sheetBaseline) return;
  if (!sheetIsDirty()) {
    // 内容和打开时一样，不用留草稿
    dishDrafts.delete(sheetDraftKey);
    return;
  }
  dishDrafts.set(sheetDraftKey, snapshotSheetInputs());
}

/**
 * 用户主动关闭弹层。
 *
 * 这里刻意不弹「确定放弃吗」——录菜是高频操作，填到一半被模态框打断很烦，
 * 而用户真正的诉求只是「别把我填的弄丢」。所以改成：
 * 静默存草稿 + 一句提示，内容一定能捞回来，也不用他做决定。
 */
function requestCloseSheet() {
  // AI 正在往这个表单里写结果，中途关掉等于白等一场，还白花一次额度
  if (aiBusyOn) return;
  if (!sheetBaseline) return closeSheet();
  if (sheetIsDirty()) {
    stashSheetDraft();
    toast('已存成草稿，下次打开这道菜自动接着填');
  } else {
    dishDrafts.delete(sheetDraftKey);
  }
  closeSheet();
}

function openSheet({ title, body, foot, onMount, draftKey }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head">
        <h2 class="sheet-title">${esc(title)}</h2>
        <button class="sheet-close" data-act="close-sheet" aria-label="关闭">✕</button>
      </div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  sheetOnMount = onMount || null;
  if (sheetOnMount) sheetOnMount(root);

  // 草稿恢复：有上次没保存的内容就盖回表单，并提示一声
  sheetDraftKey = draftKey || null;
  const saved = sheetDraftKey ? dishDrafts.get(sheetDraftKey) : null;
  // 存草稿那一刻可能一个字段都没填（打开就手滑关掉），
  // 这种空草稿直接丢掉，别下次开门就弹「已恢复」吓人
  const worthRestoring =
    saved && Object.values(saved).some((v) => (typeof v === 'string' ? v.trim() : v === true));
  if (worthRestoring) {
    applySheetInputs(saved);
    toast('已恢复上次没保存的内容');
  }
  // 基线必须在恢复之后取：草稿已经落袋，就不该再警告「有未保存内容」
  sheetBaseline = sheetDraftKey ? snapshotSheetInputs() : null;
}

function closeSheet() {
  aiBusyDone(); // 弹层没了，忙碌遮罩不能留着
  const root = $('#modalRoot');
  root.hidden = true;
  root.innerHTML = '';
  document.body.style.overflow = '';
  sheetOnMount = null;
  sheetBaseline = null;
  sheetDraftKey = null;
}

document.addEventListener('click', (e) => {
  if (e.target === $('#modalRoot')) requestCloseSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modalRoot').hidden) requestCloseSheet();
});

/* =========================================================
   视图 1：菜单
   ========================================================= */

function matchKeyword(dish, kw) {
  if (!kw) return true;
  const k = kw.toLowerCase();
  const hay = [
    dish.name,
    dish.description,
    dish.category,
    (dish.tags || []).join(' '),
    (dish.seasonings || []).map((s) => s.name).join(' '),
    (dish.methods || []).map((m) => m.steps.join(' ')).join(' '),
    dish.notes,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(k);
}

function visibleDishes() {
  return S.data.dishes.filter((d) => {
    const inCat = S.category === '全部' || d.category === S.category;
    return inCat && matchKeyword(d, S.keyword);
  });
}

function dishCard(d) {
  const cover = d.images && d.images[0];
  const img = cover
    ? `<img src="${esc(cover)}" alt="${esc(d.name)}" loading="lazy" />`
    : `<span>${dishEmoji(d.name)}</span>`;
  const meta = [];
  if (d.duration) meta.push(`<span class="tag">⏱ ${d.duration}′</span>`);
  if (d.servings) meta.push(`<span class="tag">👥 ${esc(d.servings)}</span>`);
  if ((d.tags || []).length) meta.push(`<span class="tag hot">${esc(d.tags[0])}</span>`);

  return `<article class="card" role="button" tabindex="0" aria-label="查看 ${esc(d.name)} 做法"
    data-act="open-dish" data-id="${esc(d.id)}">
    <div class="card-cover">
      ${img}
      ${d.isFavorite ? `<span class="card-fav">⭐</span>` : ''}
      ${d.category ? `<span class="card-badge">${esc(d.category)}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${esc(d.name)}</div>
      ${d.description ? `<div class="card-desc">${esc(d.description)}</div>` : ''}
      <div class="card-meta">${meta.join('')}</div>
    </div>
  </article>`;
}

function viewMenu() {
  const cats = sortedCategories();
  const list = visibleDishes();
  const activeCount = pendingOrders().length;
  const week = planWeek();
  const planned = planItems(week).length;
  const plannedNames = planItems(week).map((it) => it.name).join('、');

  const planCard = `<div class="plan-entry ${planned ? 'on' : ''}" role="button" tabindex="0" data-act="nav" data-view="plan">
      <span class="plan-entry-icon">🗓️</span>
      <span class="plan-entry-main">
        <span class="plan-entry-title">${planned ? `本周计划 · ${planned} 道菜` : '本周计划'}</span>
        <span class="plan-entry-sub">${
          planned ? esc(plannedNames) : '把想做的菜先排上，一次买齐食材'
        }</span>
      </span>
      <span class="plan-entry-go">›</span>
    </div>`;

  const chips = [{ name: '全部', count: S.data.dishes.length }]
    .concat(
      cats.map((c) => ({
        name: c.name,
        count: S.data.dishes.filter((d) => d.category === c.name).length,
      }))
    )
    .map(
      (c) => `<button class="chip" data-act="filter-cat" data-cat="${esc(c.name)}"
        aria-pressed="${S.category === c.name}">${esc(c.name)}<span class="chip-count">${c.count}</span></button>`
    )
    .join('');

  let body;
  if (S.loading) {
    body = `<div class="grid">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
  } else if (!list.length) {
    body = `<div class="empty">
      <span class="empty-emoji">${S.keyword ? '🔍' : '🍳'}</span>
      <p class="empty-title">${S.keyword ? '没找到这道菜' : '还没有菜'}</p>
      <p class="empty-text">${S.keyword ? '换个词试试' : '点右下角「记一道菜」，把家里常做的录进来'}</p>
    </div>`;
  } else {
    body = `<div class="grid">${list.map(dishCard).join('')}</div>`;
  }

  return `
    ${planCard}
    <div class="chip-row">${chips}</div>
    ${
      activeCount
        ? `<div class="section-head">
             <h2 class="section-title">今晚 ${activeCount} 道待做</h2>
             <button class="btn soft sm" data-act="nav" data-view="order">去点餐单 →</button>
           </div>`
        : ''
    }
    ${body}
    <button class="fab" data-act="new-dish">＋ 记一道菜</button>`;
}

/* ---------------- 菜品详情 ---------------- */

/* =========================================================
   菜品详情
   ========================================================= */

/** 往某一周的计划里加一道菜；after 用来让调用方刷新自己的界面 */
async function addToPlan(entry, weekOf, after) {
  const week = mondayOf(weekOf);
  try {
    await api('POST', '/api/plans/items', { householdId: S.householdId, weekOf: week, ...entry });
    await loadState(true);
    if (after) after();
    else closeSheet();
    render();
    toast(`已加到${planWeekTitle(week)}`);
  } catch (err) {
    toast(err.message);
  }
}

/**
 * 厨房助手的结果：从洗菜到最后上桌的整条流程。
 *
 * 做饭时真正想知道的是「现在几点该干嘛、还要多久」，所以每一步都挂时间轴：
 * 左边是 T+几分钟，右边标清楚这一步能不能离开灶台。
 */
function openCookPlanSheet(r) {
  const stages = Array.isArray(r.stages) ? r.stages.filter((s) => s && (s.what || s.dish)) : [];
  const tips = Array.isArray(r.tips) ? r.tips : [];
  const prep = Array.isArray(r.prep) ? r.prep : [];
  const seq = Array.isArray(r.sequence) ? r.sequence : [];

  // 总耗时：优先用 AI 给的，没有就按最后一步的 startMinute + minutes 算
  const last = stages[stages.length - 1];
  const derived = last ? (Number(last.startMinute) || 0) + (Number(last.minutes) || 0) : 0;
  const total = Number(r.totalMinutes) || derived;

  const clock = (m) => `T+${Math.max(0, Math.round(Number(m) || 0))}′`;

  let timeline = '';
  if (stages.length) {
    // AI 漏给 startMinute 时按前一步顺推，别让整条时间轴空着
    let timelineCursor = 0;
    timeline = `<div class="block">
      <h3 class="block-title">⏱ 备餐流程${total ? ` · 大约 ${total} 分钟` : ''}</h3>
      <ol class="timeline">
        ${stages
          .map((s, i) => {
            const start = Number(s.startMinute);
            const mins = Number(s.minutes);
            const hasClock = Number.isFinite(start) && start >= 0;
            const at = hasClock ? start : i === 0 ? 0 : timelineCursor;
            timelineCursor = at + Math.max(1, Math.round(mins) || 1);
            const parallel = s.parallel === true;
            return `<li class="tl-step ${parallel ? 'tl-par' : 'tl-seq'}">
              <div class="tl-time">
                <span class="tl-at">${clock(at)}</span>
                <span class="tl-len">${Math.round(mins) || '?'} 分钟</span>
              </div>
              <div class="tl-body">
                <div class="tl-what"><span class="tl-n">${i + 1}</span>${esc(s.what || '')}</div>
                ${s.dish ? `<div class="tl-dish">${esc(s.dish)}</div>` : ''}
                <span class="tl-flag ${parallel ? 'tl-flag-par' : 'tl-flag-seq'}">
                  ${parallel ? '可离开 · 和别的菜同时做' : '要守灶 · 得看着'}
                </span>
                ${s.why ? `<div class="tl-why">💡 ${esc(s.why)}</div>` : ''}
              </div>
            </li>`;
          })
          .join('')}
      </ol>
      <p class="section-sub" style="margin-top:8px;line-height:1.6">
        标了「可离开」的是可以顺手做的事 —— 洗菜的时候把另一道菜的肉腌上，
        炖着的 20 分钟正好够切完剩下两道。标了「要守灶」的就别走开。
      </p>
    </div>`;
  }

  // 老结构（prep/sequence）保留：万一 AI 少给了 stages，至少还能看到点什么
  const legacy = !stages.length
    ? `<div class="block">
        <h3 class="block-title">👨‍🍳 下厨顺序</h3>
        ${prep.length ? `<div class="panel"><ul class="prep-list">${prep.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
        ${
          seq.length
            ? `<ol class="cook-seq">
                ${seq
                  .map(
                    (s) => `<li class="cook-step">
                      <div class="cook-step-head">
                        <span class="cook-step-n">${esc(s.step)}</span>
                        <span class="cook-step-what">${esc(s.what)}</span>
                      </div>
                      ${s.dish ? `<div class="cook-step-dish">${esc(s.dish)}</div>` : ''}
                      ${s.why ? `<div class="cook-step-why">💡 ${esc(s.why)}</div>` : ''}
                    </li>`
                  )
                  .join('')}
              </ol>`
            : ''
        }
      </div>`
    : '';

  const tipsHtml = tips.length
    ? `<div class="block">
        <h3 class="block-title">📌 提醒</h3>
        <div class="panel"><ul class="prep-list">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      </div>`
    : '';

  openSheet({
    title: '厨房助手 · 今晚怎么做',
    body: `${timeline}${legacy}${tipsHtml}${
      !stages.length && !prep.length && !seq.length
        ? '<div class="empty"><p class="empty-text">这次没排出来，试试再点一次</p></div>'
        : ''
    }`,
    foot: `<button class="btn ghost" data-act="close-sheet">关闭</button>
           <button class="btn" data-act="copy-cook-plan">复制</button>`,
  });

  const lines = stages.length
    ? stages.map(
        (s, i) =>
          `${i + 1}. [${clock(s.startMinute)} · ${Math.round(Number(s.minutes)) || '?'} 分钟${
            s.parallel === true ? ' · 可并行' : ' · 要守灶'
          }] ${s.what}${s.dish ? `（${s.dish}）` : ''}`
      )
    : seq.map((s) => `${s.step}. ${s.what}${s.dish ? `（${s.dish}）` : ''}`);

  S.cookPlanText = [
    total ? `【整桌大约 ${total} 分钟】` : '',
    lines.length ? '【流程】\n' + lines.join('\n') : '',
    prep.length && !stages.length ? '【先备菜】\n' + prep.map((p, i) => `${i + 1}. ${p}`).join('\n') : '',
    tips.length ? '【提醒】\n' + tips.map((t) => '· ' + t).join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 复制文本，剪贴板不可用时退回弹层让人自己拷 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制，去备忘录粘贴吧');
  } catch (_) {
    openSheet({
      title: '清单',
      body: `<textarea class="textarea" style="min-height:260px">${esc(text)}</textarea>`,
    });
  }
}

function openDish(id) {
  const d = dishById(id);
  if (!d) return;
  // 记住手上这道菜：顶栏的 AI 助手要靠它知道你在问哪道菜
  S.chatOpenDish = id;

  const cover = d.images && d.images[0];
  const hero = cover
    ? `<div class="hero"><img src="${esc(cover)}" alt="${esc(d.name)}" /></div>`
    : `<div class="hero"><div class="hero-empty">${dishEmoji(d.name)}</div></div>`;

  const meta = [];
  if (d.category) meta.push(`<span class="tag">${esc(d.category)}</span>`);
  if (d.servings) meta.push(`<span class="tag">👥 ${esc(d.servings)}</span>`);
  if (d.duration) meta.push(`<span class="tag">⏱ ${esc(d.duration)} 分钟</span>`);
  if (d.difficulty) meta.push(`<span class="tag">${esc(d.difficulty)}</span>`);
  (d.tags || []).forEach((t) => meta.push(`<span class="tag hot">${esc(t)}</span>`));

  const seasoningHtml = (d.seasonings || []).length
    ? `<div class="block">
         <h3 class="block-title">通用调料</h3>
         <div class="panel">
           ${d.seasonings
             .map(
               (s) => `<div class="seasoning-row">
                 <span class="seasoning-name">${esc(s.name)}</span>
                 <span class="seasoning-dots"></span>
                 <span class="seasoning-amt">${esc(s.amount)}</span>
               </div>`
             )
             .join('')}
         </div>
       </div>`
    : '';

  // 每种做法额外要的调料就挂在它自己下面，不用往上翻去对照
  const methodsHtml = (d.methods || []).length
    ? `<div class="block">
         <h3 class="block-title">做法步骤</h3>
         ${d.methods
           .map(
             (m) => `<div class="method-head">👩‍🍳 ${esc(m.name)}</div>
                     ${
                       (m.seasonings || []).length
                         ? `<div class="panel mseason-view">
                       ${m.seasonings
                         .map(
                           (s) => `<div class="seasoning-row">
                         <span class="seasoning-name">${esc(s.name)}</span>
                         <span class="seasoning-dots"></span>
                         <span class="seasoning-amt">${esc(s.amount)}</span>
                       </div>`
                         )
                         .join('')}
                     </div>`
                         : ''
                     }
                     <div class="panel"><ol class="steps">
                       ${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}
                     </ol></div>`
           )
           .join('')}
       </div>`
    : '';

  const notesHtml = d.notes
    ? `<div class="block"><h3 class="block-title">备注</h3><div class="note-box">${esc(d.notes)}</div></div>`
    : '';

  const shots = (d.images || []).length > 1
    ? `<div class="block"><h3 class="block-title">成品图</h3><div class="img-grid">
         ${d.images.map((u) => `<div class="img-thumb"><img src="${esc(u)}" alt="" loading="lazy" /></div>`).join('')}
       </div></div>`
    : '';

  const inPlan = planItems(planWeek()).some((it) => it.dishId === d.id);

  openSheet({
    title: d.name,
    body: `${hero}
      <h2 class="detail-name">${esc(d.name)}</h2>
      ${d.description ? `<p class="detail-desc">${esc(d.description)}</p>` : ''}
      <div class="meta-row">${meta.join('')}</div>
      ${seasoningHtml}
      ${methodsHtml}
      ${notesHtml}
      ${shots}`,
    foot: `
      <button class="btn ghost" data-act="edit-dish" data-id="${esc(d.id)}">编辑</button>
      <button class="btn soft" data-act="toggle-plan-dish" data-id="${esc(d.id)}" data-week="${esc(planWeek())}">
        ${inPlan ? '✓ 已在计划里' : '＋ 加入计划'}
      </button>
      <button class="btn" data-act="order-dish" data-id="${esc(d.id)}">今天想吃这个</button>`,
  });
}

/* =========================================================
   视图 2：点餐
   ========================================================= */

const STATUS_TEXT = { pending: '待做', cooking: '制作中', done: '已完成', cancelled: '已取消' };

function orderItem(o) {
  const d = o.dishId ? dishById(o.dishId) : null;
  const thumb = d && d.images && d.images[0]
    ? `<img src="${esc(d.images[0])}" alt="" loading="lazy" />`
    : (d ? dishEmoji(d.name) : '✍️');

  let actions = '';
  if (o.status === 'pending') {
    actions = `<button class="btn soft sm" data-act="set-status" data-id="${esc(o.id)}" data-status="cooking">开做</button>`;
  } else if (o.status === 'cooking') {
    actions = `<button class="btn green sm" data-act="set-status" data-id="${esc(o.id)}" data-status="done">完成</button>`;
  } else {
    actions = `<button class="btn ghost sm" data-act="del-order" data-id="${esc(o.id)}">删除</button>`;
  }

  return `<div class="order-item">
    <div class="order-thumb">${thumb}</div>
    <div class="order-main${d ? ' link' : ''}" role="button" tabindex="0" ${d ? `data-act="open-dish" data-id="${esc(d.id)}"` : ''}
      ${d ? `aria-label="查看 ${esc(o.dishName)} 做法"` : ''}>
      <div class="order-name">${esc(o.dishName)}</div>
      <div class="order-meta">${esc(o.requester)} · ${o.people} 人份 · ${relTime(o.createdAt)}</div>
      ${o.note ? `<div class="order-note">📝 ${esc(o.note)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <span class="status-pill status-${o.status}">${STATUS_TEXT[o.status]}</span>
      <div style="margin-top:6px">${actions}</div>
    </div>
  </div>`;
}

/** 从「番茄炒蛋 2 个」这类用量里猜出数量和单位，用来一键入库 */
function guessAmount(parts) {
  for (const p of parts) {
    const m = /([0-9]+(?:\.[0-9]+)?)\s*(.*)/.exec(p);
    if (m && Number(m[1]) > 0) {
      const unit = m[2].trim();
      return { quantity: Number(m[1]), unit: unit && unit.length <= 4 ? unit : '份' };
    }
  }
  return { quantity: 1, unit: '份' };
}

/** 在当前家庭库存里找同名（或名字互相包含）的食材 */
function findStock(name) {
  const list = householdPantry();
  const exact = list.filter((p) => p.name === name);
  if (exact.length) return exact;
  return list.filter((p) => p.name && (p.name.includes(name) || name.includes(p.name)));
}

/**
 * 一道菜要用的所有调料，带上「这是哪个做法要的」。
 *
 * 通用调料（菜品级）和各做法独有的调料都得算进来 ——
 * 买菜的人只看到「冰糖」，得知道红烧要 10g、清蒸不要。
 */
function collectDishSeasonings(d) {
  const out = [];
  (d.seasonings || []).forEach((s) => {
    if (s.name) out.push({ name: s.name, amount: s.amount, method: '' });
  });
  (d.methods || []).forEach((m) => {
    (m.seasonings || []).forEach((s) => {
      if (s.name) out.push({ name: s.name, amount: s.amount, method: m.name || '' });
    });
  });
  return out;
}

/** 把一批「菜名 + 调料」汇总成采购条目，同名的合并 */
function mergeSeasonings(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (!r.name) return;
    if (!map.has(r.name)) map.set(r.name, []);
    const parts = map.get(r.name);
    const tag = r.method ? `${r.dish}（${r.method}） ${r.amount}` : `${r.dish} ${r.amount}`;
    if (!parts.includes(tag)) parts.push(tag);
  });
  return [...map.entries()].map(([name, parts]) => {
    const stock = findStock(name);
    return {
      name,
      parts,
      stock,
      stockQty: stock.reduce((s, p) => s + (p.quantity || 0), 0),
      // 多条同名但单位不同的时候就不显示数字，免得误导
      stockUnit:
        stock.length === 1
          ? stock[0].unit
          : stock.map((p) => p.unit).filter((v, i, a) => a.indexOf(v) === i).join('/'),
    };
  });
}

/** 采购清单：把一批菜品的调料合并，并标出家里已经有的 */
function shoppingFromDishIds(dishIds) {
  const rows = [];
  dishIds.forEach((id) => {
    const d = dishById(id);
    if (!d) return;
    collectDishSeasonings(d).forEach((s) => rows.push({ ...s, dish: d.name }));
  });
  return mergeSeasonings(rows);
}

/** 采购清单：当前家庭待做菜品的调料 */
function buildShoppingList() {
  const rows = [];
  pendingOrders()
    .filter((o) => !S.memberFilter || o.requester === S.memberFilter)
    .forEach((o) => {
      const d = o.dishId ? dishById(o.dishId) : null;
      if (!d) return;
      collectDishSeasonings(d).forEach((s) => rows.push({ ...s, dish: d.name }));
    });
  return mergeSeasonings(rows);
}

/**
 * 采购清单的通用渲染：点餐页和计划页共用
 * opts: { title, sub, hint, bare（不画标题行，直接接在别的小标题下面） }
 */
function shopListHtml(list, opts) {
  const o = opts || {};
  if (!list.length) {
    return o.bare
      ? ''
      : `<div class="section-head">
        <h2 class="section-title">${esc(o.title || '买菜清单')}</h2>
      </div>
      <div class="empty" style="padding:30px 20px">
        <p class="empty-text">${esc(o.empty || '暂时没有需要买菜的东西')}</p>
      </div>`;
  }
  const head = o.bare
    ? ''
    : `<div class="section-head">
      <h2 class="section-title">${esc(o.title || '买菜清单')}</h2>
      <span class="section-sub">${esc(o.sub || `${list.length} 样待买`)}</span>
      <button class="btn ghost sm" style="margin-left:auto" data-act="copy-shopping" data-scope="${esc(o.scope || '')}">复制</button>
    </div>`;
  return `${head}
    ${list
      .map((it) => {
        const done = S.shoppingChecked.has(it.name);
        const stockHtml = it.stock.length
          ? `<span class="shop-stock" title="家里已经有 ${esc(
              it.stock.map((p) => p.name + ' ' + p.quantity + p.unit).join('、')
            )}">🏠 家里有 ${esc(String(it.stockQty))}${esc(it.stockUnit)}</span>`
          : '';
        const restockHtml = it.stock.length
          ? ''
          : `<button class="btn soft sm" data-act="stock-it" data-name="${esc(it.name)}"
               data-parts="${esc(it.parts.join('|'))}">入库</button>`;
        return `<div class="shop-item ${done ? 'done' : ''}">
          <div class="shop-check" role="checkbox" tabindex="0" aria-checked="${done}"
            aria-label="${esc(it.name)} 是否已买" data-act="toggle-shop" data-name="${esc(it.name)}">✓</div>
          <div class="shop-main">
            <div class="shop-name">${esc(it.name)}</div>
            <div class="shop-from">${esc(it.parts.join(' · '))}</div>
          </div>
          <div class="shop-side">${stockHtml}${restockHtml}</div>
        </div>`;
      })
      .join('')}
    ${o.hint ? `<p class="section-sub" style="margin-top:6px">${esc(o.hint)}</p>` : ''}`;
}

function viewOrder() {
  const all = householdOrders();
  const today = todayStr();
  const house = currentHousehold();

  const tabs = [
    ['pending', '待做 ' + all.filter((o) => o.status === 'pending').length],
    ['cooking', '制作中 ' + all.filter((o) => o.status === 'cooking').length],
    ['done', '已完成 ' + all.filter((o) => o.status === 'done').length],
  ]
    .map(
      ([k, label]) =>
        `<button class="chip" data-act="filter-status" data-status="${k}" aria-pressed="${S.orderStatus === k}">${label}</button>`
    )
    .join('');

  let listHtml;
  const list = all.filter(
    (o) => o.status === S.orderStatus && (!S.memberFilter || o.requester === S.memberFilter)
  );
  if (!list.length) {
    listHtml = `<div class="empty">
      <span class="empty-emoji">🍽️</span>
      <p class="empty-title">这里空空的</p>
      <p class="empty-text">${S.orderStatus === 'pending' ? '去菜单里点几道想吃的吧' : '暂时没有记录'}</p>
    </div>`;
  } else if (S.groupByMember) {
    listHtml = groupOrdersByMember(list);
  } else {
    listHtml = list.map(orderItem).join('');
  }

  // 成员筛选：只在有家人时出现，超过 1 人才有意义
  const members = memberList();
  const activeMembers = [...new Set(all.map((o) => o.requester))];
  const memberFilterHtml =
    members.length > 1 || activeMembers.length > 1
      ? `<div class="chip-row member-filter">
          <button class="chip" data-act="filter-member" data-name="" aria-pressed="${!S.memberFilter}">
            全部 ${esc(String(members.length || activeMembers.length))}人
          </button>
          ${(members.length ? members : activeMembers.map((n) => ({ name: n, emoji: '👤' })))
            .map(
              (m) =>
                `<button class="chip member-chip" data-act="filter-member" data-name="${esc(m.name)}"
                  aria-pressed="${S.memberFilter === m.name}">${esc(m.emoji)} ${esc(m.name)}</button>`
            )
            .join('')}
        </div>`
      : '';

  const shop = buildShoppingList();
  const shopScope = pendingOrders().filter((o) => !S.memberFilter || o.requester === S.memberFilter);
  const shopHtml = shopListHtml(shop, {
    sub: `${S.memberFilter ? S.memberFilter + '的 ' : ''}${shopScope.length} 道待做菜自动汇总`,
    hint: '标了「家里有」的不用买；买回来的点「入库」记进库存。',
  });

  const doneCount = all.filter((o) => o.status === 'done').length;
  const pendingCount = all.filter((o) => o.status === 'pending').length;

  return `
    ${shopHtml}
    <div class="section-head">
      <h2 class="section-title">点餐单</h2>
      <span class="section-sub">${esc(house ? house.emoji + ' ' + house.name : '点餐单')} · ${today}</span>
      ${
        S.orderStatus === 'done' && doneCount
          ? `<button class="btn ghost sm" style="margin-left:auto" data-act="clear-done">清空已完成</button>`
          : ''
      }
      ${
        pendingCount
          ? `<button class="btn green sm" style="margin-left:${
              S.orderStatus === 'done' && doneCount ? '8px' : 'auto'
            }"
              data-act="start-all" title="待做的全部开始做">🔥 一键开做 ${pendingCount}</button>`
          : ''
      }
      ${
        aiReady() && pendingOrders().length >= 2
          ? `<button class="btn soft sm" style="margin-left:${
              S.orderStatus === 'done' && doneCount || pendingCount ? '8px' : 'auto'
            }"
              data-act="ai-cook-plan" title="看这几道菜怎么并行着做最快">👨‍🍳 厨房助手</button>`
          : ''
      }
    </div>
    <div class="status-tabs">${tabs}</div>
    ${memberFilterHtml}
    ${
      list.length
        ? `<div class="list-toolbar">
             <span class="section-sub">${S.groupByMember ? '按家人分组' : '按时间排序'}</span>
             <button class="btn ghost sm" data-act="toggle-group">
               ${S.groupByMember ? '⇅ 改成按时间' : '👨‍👩‍👧‍👦 按家人分组'}
             </button>
           </div>`
        : ''
    }
    ${listHtml}
    <button class="fab" data-act="new-order">＋ 我要点餐</button>`;
}

/** 按点餐人分组：一眼看清谁要吃什么、共几份 */
function groupOrdersByMember(list) {
  const groups = new Map();
  list.forEach((o) => {
    const k = o.requester || '匿名';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });

  // 有登记成员的排前面，其余按名字排
  const known = new Set(memberList().map((m) => m.name));
  const keys = [...groups.keys()].sort((a, b) => {
    const ka = known.has(a) ? 0 : 1;
    const kb = known.has(b) ? 0 : 1;
    return ka - kb || a.localeCompare(b, 'zh');
  });

  return keys
    .map((name) => {
      const items = groups.get(name);
      const people = items.reduce((s, o) => s + (o.people || 1), 0);
      const dishes = [...new Set(items.map((o) => o.dishName))].join('、');
      return `<div class="member-group">
        <div class="member-group-head">
          <span class="member-avatar">${esc(memberEmoji(name))}</span>
          <span class="member-name">${esc(name)}</span>
          <span class="member-sum">${items.length} 道 · 共 ${people} 份</span>
        </div>
        <div class="member-dishes">${esc(dishes)}</div>
        ${items.map(orderItem).join('')}
      </div>`;
    })
    .join('');
}

/* ---------------- 点餐表单 ---------------- */

/** 提示这一单会记到哪个家庭名下 */
function houseOrderNote() {
  const h = currentHousehold();
  if (!h) return '';
  return `<div class="order-house">
    <span>记到 <b>${esc(h.emoji)} ${esc(h.name)}</b></span>
    ${
      households().length > 1
        ? '<button class="btn ghost sm" data-act="close-sheet">换一个家庭</button>'
        : ''
    }
  </div>`;
}

function openOrderForm(dish) {
  const members = memberList();
  const d = dish || null;
  S.draftOrder = {
    dishId: d ? d.id : null,
    dishName: d ? d.name : '',
    householdId: S.householdId,
    requester: members[0] ? members[0].name : '',
    people: 2,
    note: '',
  };

  const picker = S.data.dishes
    .map((x) => {
      const on = d && x.id === d.id;
      const t = x.images && x.images[0] ? `<img src="${esc(x.images[0])}" alt="" />` : dishEmoji(x.name);
      return `<button class="picker-item" data-act="pick-dish" data-id="${esc(x.id)}" aria-pressed="${!!on}">
        <span class="picker-thumb">${t}</span>
        <span style="flex:1;min-width:0">
          <span class="picker-name">${esc(x.name)}</span>
          ${x.category ? `<span class="tag">${esc(x.category)}</span>` : ''}
        </span>
      </button>`;
    })
    .join('');

  const memberCards = members.length
    ? `<div class="member-cards">
        ${members
          .map(
            (m) => `<button class="member-card" data-act="pick-member" data-name="${esc(m.name)}"
              aria-pressed="${S.draftOrder.requester === m.name}">
              <span class="member-card-emoji">${esc(m.emoji)}</span>
              <span>${esc(m.name)}</span>
            </button>`
          )
          .join('')}
      </div>`
    : '';

  openSheet({
    title: d ? `点「${d.name}」` : '我要点餐',
    body: `
      ${houseOrderNote()}
      <div class="field">
        <label class="field-label">选一道菜</label>
        <div class="picker-list">${picker}</div>
      </div>
      <div class="field">
        <label class="field-label">或者自己写<span class="field-hint">不在菜单里的也可以</span></label>
        <input class="input" id="ordName" value="${esc(S.draftOrder.dishName)}" placeholder="例如：妈，我想吃红烧排骨" />
      </div>
      <div class="field">
        <label class="field-label">谁点的</label>
        ${memberCards}
        <input class="input" id="ordWho" value="${esc(S.draftOrder.requester)}" placeholder="名字，或直接输入" style="margin-top:8px" />
      </div>
      <div class="field">
        <label class="field-label">几个人吃</label>
        <input class="input" id="ordPeople" type="number" min="1" max="20" value="${S.draftOrder.people}" />
      </div>
      <div class="field">
        <label class="field-label">备注<span class="field-hint">少放辣、不要香菜…</span></label>
        <textarea class="textarea" id="ordNote" placeholder="有什么要求写这里">${esc(S.draftOrder.note)}</textarea>
      </div>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="submit-order">提交点餐</button>`,
  });

  const name = $('#ordName');
  if (name && !d) name.focus();
}

function collectOrder() {
  const el = (id) => $('#' + id);
  S.draftOrder.householdId = S.householdId;
  S.draftOrder.dishName = (el('ordName').value || '').trim();
  S.draftOrder.requester = (el('ordWho').value || '').trim() || '匿名';
  S.draftOrder.people = Number(el('ordPeople').value) || 2;
  S.draftOrder.note = (el('ordNote').value || '').trim();
  return S.draftOrder;
}

/* =========================================================
   视图 3：本周计划
   ========================================================= */

function planRow(it) {
  const d = it.dishId ? dishById(it.dishId) : null;
  const cover = d && d.images && d.images[0];
  const thumb = cover
    ? `<img src="${esc(cover)}" alt="" loading="lazy" />`
    : d
    ? dishEmoji(d.name)
    : '✍️';
  const meta = [];
  if (it.servings) meta.push(esc(it.servings));
  if (d && d.duration) meta.push(`⏱ ${d.duration}′`);
  if (it.note) meta.push(esc(it.note));

  return `<div class="plan-item">
    <div class="plan-thumb">${thumb}</div>
    <div class="plan-main" role="button" tabindex="0" ${d ? `data-act="open-dish" data-id="${esc(d.id)}"` : ''}
      ${d ? `aria-label="查看 ${esc(it.name)} 做法"` : ''}>
      <div class="plan-name">${esc(it.name)}</div>
      ${meta.length ? `<div class="plan-meta">${meta.join(' · ')}</div>` : ''}
    </div>
    <button class="icon-mini" data-act="rm-plan" data-id="${esc(it.id)}" aria-label="从计划里拿掉 ${esc(it.name)}">✕</button>
  </div>`;
}

function viewPlan() {
  const week = planWeek();
  const offset = planWeekOffset(week);
  const house = currentHousehold();
  const items = planItems(week);
  const names = items.map((it) => it.name).join('、');

  // 只有能查到调料的菜才进采购汇总（自己随手写的那道不算）
  const dishIds = items.map((it) => it.dishId).filter(Boolean);
  const shop = shoppingFromDishIds(dishIds);
  const missing = shop.filter((it) => !it.stock.length);

  const weekNav = `<div class="week-nav">
      <button class="week-btn" data-act="week-shift" data-n="-1" aria-label="上一周">‹</button>
      <div class="week-label">
        <div class="week-range">${esc(planLabel(week))}</div>
        <div class="week-tag">${
          offset === 0 ? '本周' : offset === 1 ? '下周' : offset === -1 ? '上周' : (offset > 0 ? offset + ' 周后' : -offset + ' 周前')
        } · ${esc(house ? house.emoji + ' ' + house.name : '')}</div>
      </div>
      <button class="week-btn" data-act="week-shift" data-n="1" aria-label="下一周">›</button>
    </div>`;

  let listHtml;
  if (!items.length) {
    listHtml = `<div class="empty">
      <span class="empty-emoji">🗓️</span>
      <p class="empty-title">${offset === 0 ? '这周还没安排' : '这一周还没安排'}</p>
      <p class="empty-text">把想做的菜加进来，点「一次买齐」就能照着单子采购</p>
    </div>`;
  } else {
    listHtml = `<div class="section-head">
        <h2 class="section-title">计划做 ${items.length} 道</h2>
        <button class="btn ghost sm" style="margin-left:auto" data-act="clear-plan">清空这一周</button>
      </div>
      ${items.map(planRow).join('')}`;
  }

  const shopSection = items.length
    ? `<div class="section-head">
        <h2 class="section-title">一次买齐</h2>
        <span class="section-sub">${
          shop.length
            ? `${shop.length} 样待买${missing.length ? ` · ${missing.length} 样家里没有` : ' · 家里都有'}`
            : '计划里的菜没写调料用量'
        }</span>
        ${shop.length ? `<button class="btn soft sm" style="margin-left:auto" data-act="copy-plan-shopping">复制清单</button>` : ''}
      </div>
      ${
        shop.length
          ? shopListHtml(shop, {
              bare: true,
              hint: '照着这张单子一次买回来，买完点「入库」记进库存。',
            })
          : '<p class="section-sub">给计划里的菜补上「调料用量」，这里就会自动汇总成采购清单。</p>'
      }`
    : '';

  return `
    ${weekNav}
    ${listHtml}
    ${shopSection}
    <button class="fab" data-act="add-plan-dish">＋ 加一道菜</button>`;
}

/** 加菜：先选菜谱里的，也能自己写一道临时的 */
function openPlanPicker(weekOf) {
  const week = weekOf || planWeek();
  const planned = new Set(planItems(week).map((it) => it.name));

  const picker = S.data.dishes
    .map((x) => {
      const on = planned.has(x.name);
      const t = x.images && x.images[0] ? `<img src="${esc(x.images[0])}" alt="" />` : dishEmoji(x.name);
      return `<button class="picker-item" data-act="pick-plan-dish" data-id="${esc(x.id)}" aria-pressed="${on}"
        ${on ? 'disabled style="opacity:.45"' : ''}>
        <span class="picker-thumb">${t}</span>
        <span style="flex:1;min-width:0">
          <span class="picker-name">${esc(x.name)}${on ? ' · 已加入' : ''}</span>
          ${x.category ? `<span class="tag">${esc(x.category)}</span>` : ''}
        </span>
      </button>`;
    })
    .join('');

  openSheet({
    title: `加到${planWeekTitle(week)}`,
    body: `
      <div class="field">
        <label class="field-label">从菜单里选</label>
        <div class="picker-list">${picker}</div>
      </div>
      <div class="field">
        <label class="field-label">或者自己写一道<span class="field-hint">菜单里没有的，比如「楼下那家的烤鸭」</span></label>
        <input class="input" id="planName" placeholder="例如：红烧排骨" />
      </div>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-plan-custom" data-week="${esc(week)}">加进去</button>`,
  });
  $('#planName').focus();
}

/** 「本周」「下周」「10月20日 那周」 */
function planWeekTitle(weekOf) {
  const off = planWeekOffset(weekOf);
  if (off === 0) return '本周计划';
  if (off === 1) return '下周计划';
  if (off === -1) return '上周计划';
  return `${planLabel(weekOf)} 那周`;
}

/* =========================================================
   视图 4：库存
   ========================================================= */

/** 数量显示：整数不带小数点，1.5 这种保留 */
function fmtQty(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** 加减步长：称重的按大份走，论个的按 1 走 */
function qtyStep(unit) {
  const u = String(unit || '').trim();
  if (u === 'g') return 50;
  if (u === 'ml') return 100;
  if (u === 'kg' || u === 'L' || u === '斤') return 0.5;
  return 1;
}

function foodRow(p) {
  const st = shelfStatus(p);
  const flagText =
    st.key === 'none' ? (p.expireAt || '未填保质期') : st.label;

  // 多选模式：整行变成一个勾选框，数量加减暂时让位（批量清理不需要先调数量）
  if (S.pantryPick) {
    const on = S.pantrySel.has(p.id);
    return `<div class="food-row pick ${on ? 'on' : ''}" role="checkbox" tabindex="0"
      aria-checked="${on}" data-act="pick-food" data-id="${esc(p.id)}"
      aria-label="选择 ${esc(p.name)}">
      <span class="pick-box">${on ? '✓' : ''}</span>
      <div class="food-main">
        <div class="food-name">${esc(p.name)}
          <span class="food-qty-inline">${esc(fmtQty(p.quantity))}${esc(p.unit)}</span>
        </div>
        <div class="food-sub">${esc(p.category)} · ${esc(flagText)}</div>
      </div>
    </div>`;
  }

  return `<div class="food-row">
    <span class="food-emoji">${catEmoji(p.category)}</span>
    <div class="food-main" role="button" tabindex="0" data-act="edit-food" data-id="${esc(p.id)}"
      aria-label="编辑 ${esc(p.name)}">
      <div class="food-name">${esc(p.name)}
        <span class="food-qty-inline">${esc(fmtQty(p.quantity))}${esc(p.unit)}</span>
      </div>
      <div class="food-sub">${esc(p.category)}${p.note ? ' · ' + esc(p.note) : ''}</div>
    </div>
    <div class="food-ops">
      <span class="food-flag flag-${st.key}">${esc(flagText)}</span>
      <div class="stepper">
        <button class="step-btn" data-act="qty-dec" data-id="${esc(p.id)}" aria-label="减少 ${esc(p.name)}">−</button>
        <span class="step-val">${esc(fmtQty(p.quantity))}</span>
        <button class="step-btn" data-act="qty-inc" data-id="${esc(p.id)}"
          aria-label="增加 ${esc(p.name)}">${qtyStep(p.unit) === 1 ? '＋' : `+${esc(fmtQty(qtyStep(p.unit)))}`}</button>
      </div>
    </div>
  </div>`;
}

/** 库存数量加减；不会减到负数 */
async function bumpQty(id, delta) {
  const p = householdPantry().find((x) => x.id === id);
  if (!p) return;
  const step = qtyStep(p.unit);
  const next = Math.max(0, Math.round((p.quantity + delta * step) * 1000) / 1000);
  if (next === p.quantity) return toast(delta < 0 ? '已经没有更多了' : '');
  await api('PUT', `/api/pantry/${p.id}`, { ...p, quantity: next });
  await loadState(true);
  render();
}

/**
 * 当前筛选条件下能看到的那批食材。
 *
 * viewPantry 和「全选」都必须走这一个函数 —— 两边各算一遍的话，
 * 迟早会出现「全选显示 10 样、删掉却是 12 样」这种对不上的情况。
 */
function pantryVisible() {
  const all = householdPantry();
  let list = all;
  if (S.pantryFilter === 'soon') list = list.filter((p) => ['soon', 'today'].includes(shelfStatus(p).key));
  else if (S.pantryFilter === 'expired') list = list.filter((p) => shelfStatus(p).key === 'expired');
  if (S.pantryCat !== '全部') list = list.filter((p) => p.category === S.pantryCat);
  return list;
}

const visiblePantryIds = () => pantryVisible().map((p) => p.id);

const pantryNames = (ids) => {
  const set = new Set(ids);
  return householdPantry()
    .filter((p) => set.has(p.id))
    .map((p) => p.name);
};

function viewPantry() {
  const all = householdPantry();
  const house = currentHousehold();
  const statusOf = (p) => shelfStatus(p).key;
  const expired = all.filter((p) => statusOf(p) === 'expired');
  const soon = all.filter((p) => statusOf(p) === 'soon' || statusOf(p) === 'today');

  const alertHtml =
    expired.length || soon.length
      ? `<div class="alert ${expired.length ? 'danger' : 'warn'}">
          <span class="alert-emoji">${expired.length ? '🚨' : '⏰'}</span>
          <div class="alert-text">
            <b>${esc(house ? house.name : '本家庭')}</b>
            ${expired.length ? `有 ${expired.length} 样已经过期` : `有 ${soon.length} 样快到保质期`}${expired.length && soon.length ? `，另有 ${soon.length} 样 3 天内到期` : ''}
          </div>
          <div class="alert-ops">
            <button class="btn ghost sm" data-act="filter-pantry" data-filter="${expired.length ? 'expired' : 'soon'}">看看</button>
            <button class="btn danger sm" data-act="purge-pantry" data-scope="${expired.length ? 'expired' : 'soon'}">清理</button>
          </div>
        </div>`
      : '';

  const filterChips = [
    ['all', '全部', all.length],
    ['soon', '临期', soon.length],
    ['expired', '过期', expired.length],
  ]
    .map(
      ([k, label, n]) =>
        `<button class="chip" data-act="filter-pantry" data-filter="${k}" aria-pressed="${S.pantryFilter === k}"
          ${n === 0 && k !== 'all' ? 'disabled' : ''}>${label}<span class="chip-count">${n}</span></button>`
    )
    .join('');

  const catChips = [{ name: '全部', count: all.length }]
    .concat(
      PANTRY_ORDER.map((c) => ({ name: c, count: all.filter((p) => p.category === c).length })).filter(
        (c) => c.count
      )
    )
    .map(
      (c) => `<button class="chip" data-act="filter-pcat" data-cat="${esc(c.name)}"
        aria-pressed="${S.pantryCat === c.name}">${catEmoji(c.name)} ${esc(c.name)}<span class="chip-count">${c.count}</span></button>`
    )
    .join('');

  // 筛选和「全选」共用 pantryVisible()，不要在这里另算一遍
  const list = pantryVisible();

  let body;
  if (S.loading) {
    body = `<div class="skeleton" style="height:120px"></div>`;
  } else if (!list.length) {
    const reason =
      all.length && S.pantryFilter !== 'all'
        ? '这个筛选下暂时没有东西'
        : S.pantryCat !== '全部'
        ? '这个分类还是空的'
        : '还没记过库存';
    body = `<div class="empty">
      <span class="empty-emoji">🧊</span>
      <p class="empty-title">${reason}</p>
      <p class="empty-text">点右下角「记一样食材」，把家里现有的东西录进来</p>
    </div>`;
  } else {
    // 按分类分组，分类按固定顺序（肉类→蛋类→奶制品→蔬菜…），同分类内快过期的排前面
    const groups = new Map();
    list.forEach((p) => {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category).push(p);
    });
    const rank = { expired: 0, today: 1, soon: 2, ok: 3, none: 4 };
    const catRank = (c) => {
      const i = PANTRY_ORDER.indexOf(c);
      return i < 0 ? PANTRY_ORDER.length : i;
    };
    body = [...groups.entries()]
      .sort((a, b) => catRank(a[0]) - catRank(b[0]))
      .map(([cat, items]) => {
        items.sort(
          (a, b) =>
            rank[shelfStatus(a).key] - rank[shelfStatus(b).key] ||
            a.name.localeCompare(b.name, 'zh')
        );
        return `<div class="section-head">
            <h2 class="section-title">${catEmoji(cat)} ${esc(cat)}</h2>
            <span class="section-sub">${items.length} 样</span>
          </div>
          ${items.map(foodRow).join('')}`;
      })
      .join('');
  }

  // 多选模式的工具条：全选、已选几样、退出、删掉
  const pickBar = S.pantryPick
    ? (() => {
        const visible = list.map((p) => p.id).filter((id) => S.pantrySel.has(id));
        const allOn = list.length > 0 && visible.length === list.length;
        return `<div class="pick-bar">
          <button class="btn ghost sm" data-act="pick-all">${allOn ? '☑ 全不选' : '☐ 全选'}</button>
          <span class="pick-count">${list.length ? `已选 ${visible.length} / ${list.length}` : '没有可选的'}</span>
          <button class="btn ghost sm" data-act="pick-cancel">退出</button>
          <button class="btn danger sm" data-act="pick-delete" ${visible.length ? '' : 'disabled'}>🗑 删除</button>
        </div>`;
      })()
    : all.length
    ? `<div class="list-toolbar">
        <span class="section-sub">${all.length} 样食材</span>
        <button class="btn ghost sm" data-act="pick-on">☑ 批量删除</button>
      </div>`
    : '';

  return `
    ${alertHtml}
    ${pickBar}
    <div class="stat-row">
      <div class="stat"><div class="stat-num">${all.length}</div><div class="stat-label">样食材</div></div>
      <div class="stat${soon.length ? ' warn' : ''}"><div class="stat-num">${soon.length}</div><div class="stat-label">快过期</div></div>
      <div class="stat${expired.length ? ' bad' : ''}"><div class="stat-num">${expired.length}</div><div class="stat-label">已过期</div></div>
    </div>
    <div class="chip-row">${filterChips}</div>
    <div class="chip-row">${catChips}</div>
    ${body}
    ${S.pantryPick ? '' : '<button class="fab" data-act="new-food">＋ 记一样食材</button>'}`;
}

/* ---------------- 食材录入 / 编辑 ---------------- */

const UNITS = ['g', 'kg', '斤', '个', '根', '颗', '把', '块', '片', '袋', '包', '盒', '瓶', '罐', '杯', '只', '条', 'ml', 'L', '份'];

async function ensurePresets() {
  if (S.presets) return S.presets;
  try {
    S.presets = await api('GET', '/api/ingredient-presets');
  } catch (_) {
    S.presets = { categories: [], presets: [] };
  }
  return S.presets;
}

/** 常见食材快选：跟着上面的分类和搜索词变 */
function renderPresetGrid() {
  const box = $('#fPresets');
  if (!box) return;
  const kw = (($('#fPresetSearch') || {}).value || '').trim();
  const catEl = $('#fFoodCat');
  const cat = catEl ? catEl.value : '';
  const all = (S.presets && S.presets.presets) || [];
  const list = all
    .filter((p) => (kw ? p.name.indexOf(kw) >= 0 : p.category === cat))
    .slice(0, 48);
  box.innerHTML = list.length
    ? list
        .map(
          (p) => `<button class="preset-opt" data-act="pick-preset"
            data-name="${esc(p.name)}" data-cat="${esc(p.category)}"
            data-unit="${esc(p.unit)}" data-exp="${esc(p.expireAt)}">${esc(p.name)}</button>`
        )
        .join('')
    : '<p class="section-sub">没有匹配的，直接在上面输入名字也行</p>';
}

async function openFoodEditor(item) {
  await ensurePresets();
  const p = item || {
    id: null,
    name: '',
    category: '蔬菜',
    quantity: 1,
    unit: '份',
    expireAt: '',
    note: '',
  };

  const catOptions = PANTRY_ORDER.map(
    (c) => `<option value="${esc(c)}" ${p.category === c ? 'selected' : ''}>${catEmoji(c)} ${esc(c)}</option>`
  ).join('');

  openSheet({
    title: item ? '编辑食材' : '记一样食材',
    body: `
      <div class="field">
        <label class="field-label">食材名 *</label>
        <input class="input" id="fFoodName" value="${esc(p.name)}" placeholder="例如：鸡蛋" />
      </div>
      <div class="field">
        <label class="field-label">常见食材<span class="field-hint">点一下自动填分类、单位、保质期</span></label>
        <input class="input" id="fPresetSearch" type="search" placeholder="搜食材名…" autocomplete="off" />
        <div class="preset-grid" id="fPresets"></div>
      </div>
      <div class="field">
        <label class="field-label">分类</label>
        <select class="select" id="fFoodCat">${catOptions}</select>
      </div>
      <div class="field">
        <label class="field-label">家里还有多少</label>
        <div class="row-2">
          <input class="input" id="fFoodQty" type="number" min="0" step="0.01" value="${esc(fmtQty(p.quantity))}" />
          <input class="input" id="fFoodUnit" value="${esc(p.unit)}" list="unitList" placeholder="单位" />
        </div>
        <datalist id="unitList">${UNITS.map((u) => `<option value="${esc(u)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">保质期到哪天<span class="field-hint">超过或快到 3 天会自动标红提醒</span></label>
        <input class="input" id="fFoodExp" type="date" value="${esc(p.expireAt)}" />
        <div class="quick-dates">
          <button class="btn ghost sm" data-act="exp-preset" data-days="1">明天</button>
          <button class="btn ghost sm" data-act="exp-preset" data-days="3">3 天</button>
          <button class="btn ghost sm" data-act="exp-preset" data-days="7">一周</button>
          <button class="btn ghost sm" data-act="exp-preset" data-days="30">一个月</button>
          <button class="btn ghost sm" data-act="exp-preset" data-days="0">不填</button>
        </div>
      </div>
      <div class="field">
        <label class="field-label">备注</label>
        <input class="input" id="fFoodNote" value="${esc(p.note)}" placeholder="放冰箱第二层 / 已开封…" />
      </div>`,
    foot: `<button class="btn danger" data-act="del-food" data-id="${esc(item ? item.id : '')}"
        ${item ? '' : 'disabled style="visibility:hidden"'}>删除</button>
           <button class="btn" data-act="save-food" data-id="${item ? esc(item.id) : ''}">保存</button>`,
  });

  renderPresetGrid();
  const name = $('#fFoodName');
  if (name) name.focus();
}

/* =========================================================
   视图 4：管理
   ========================================================= */

/**
 * 版本号 + 更新内容。
 *
 * 放在「关于」里而不是藏进设置深处：这个页面跑在别人家的电脑上，
 * 出了新版本时得让人一眼看到自己跑的是哪一版、这一版加了什么。
 */
function versionHtml() {
  const v = S.version;
  if (!v) {
    return `<div class="list-row"><span class="icon-mini">🏷️</span><span class="list-row-main">
      <span class="list-row-title">版本</span>
      <span class="list-row-sub">没读到版本信息（服务刚起来或连不上）</span>
    </span></div>`;
  }
  const latest = v.releases[0];
  return `<div class="list-row" role="button" tabindex="0" data-act="show-changelog"
      aria-label="查看版本 ${esc(v.version)} 的更新内容">
      <span class="icon-mini">🏷️</span>
      <span class="list-row-main">
        <span class="list-row-title">版本 v${esc(v.version)}</span>
        <span class="list-row-sub">${esc(latest ? latest.title : '点开看更新内容')}</span>
      </span>
      <span class="version-tag">${v.releases.length} 次更新</span>
    </div>`;
}

/** 更新内容弹层：新版本排在最上面，越往下越早 */
function openChangelogSheet() {
  const v = S.version;
  if (!v) return toast('还没读到版本信息，稍后再看看');
  const body = v.releases
    .map(
      (r, i) => `<div class="block release${i ? '' : ' current'}">
        <h3 class="block-title">v${esc(r.version)}${i ? '' : ' <span class="pill-now">当前</span>'}</h3>
        <p class="section-sub" style="margin:-4px 0 8px">${esc(r.date)} · ${esc(r.title)}</p>
        <ul class="prep-list">${r.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>`
    )
    .join('');

  openSheet({
    title: `版本 v${v.version}`,
    body,
    foot: `<button class="btn" data-act="close-sheet">知道了</button>`,
  });
}

/**
 * 数据区的备份说明。
 *
 * 原来这里把 backups/ 里每一份都列出来，攒到 7 份时页面上就是 7 行，
 * 长得像日志、挤得慌，平时其实没人看。这里只留一行状态 + 手动存一份，
 * 恢复走「选文件」—— 真要回退的时候，用户手里通常本来就有个备份文件。
 */
function backupsHtml() {
  const b = S.backups;
  const n = b && b.list ? b.list.length : 0;
  const keep = (b && b.keep) || 7;
  return `<div class="list-row" style="margin-top:6px">
      <span class="icon-mini">🗂️</span><span class="list-row-main">
        <span class="list-row-title">自动备份</span>
        <span class="list-row-sub">${
          n
            ? `已自动存 ${n} 份，保留最近 ${keep} 份，在 backups/ 目录`
            : `每天凌晨 3 点自动存一份，保留最近 ${keep} 份`
        }</span>
      </span><span class="bk-btns">
        <button class="icon-mini" data-act="backup-now" title="立刻存一份">💾</button>
        ${
          n
            ? `<button class="icon-mini" data-act="restore-latest" title="回到最近一次自动备份">↩</button>`
            : ''
        }
      </span>
    </div>`;
}

function viewManage() {
  // 前端拿不到口令明文了，改成看 hasPin 标记 + 本机有没有会话 token
  if (S.data.settings.hasPin && !S.authed) {
    return `<div class="empty">
      <span class="empty-emoji">🔒</span>
      <p class="empty-title">管理区已加锁</p>
      <p class="empty-text">需要家庭口令才能修改菜单</p>
      <button class="btn" style="margin-top:16px" data-act="unlock">输入口令</button>
    </div>`;
  }

  const s = S.data.settings;
  const d = S.data.dishes;

  const dishRows = d
    .slice()
    .sort((a, b) => String(a.category).localeCompare(String(b.category), 'zh'))
    .map(
      (x) => `<div class="list-row">
        <span class="icon-mini act">${x.images && x.images[0] ? '🖼️' : dishEmoji(x.name)}</span>
        <span class="list-row-main">
          <span class="list-row-title">${esc(x.name)}</span>
          <span class="list-row-sub">${esc(x.category)} · ${(x.methods || []).length} 种做法 · ${(x.seasonings || []).length} 样调料</span>
        </span>
        <button class="icon-mini" data-act="edit-dish" data-id="${esc(x.id)}" title="编辑">✏️</button>
        <button class="icon-mini" data-act="dup-dish" data-id="${esc(x.id)}" title="复制">⧉</button>
        <button class="icon-mini" data-act="del-dish" data-id="${esc(x.id)}" title="删除">🗑️</button>
      </div>`
    )
    .join('');

  const catRows = sortedCategories()
    .map(
      (c) => `<div class="list-row">
        <span class="list-row-main">
          <span class="list-row-title">${esc(c.name)}</span>
          <span class="list-row-sub">${d.filter((x) => x.category === c.name).length} 道菜</span>
        </span>
        <button class="icon-mini" data-act="edit-cat" data-id="${esc(c.id)}">✏️</button>
        <button class="icon-mini" data-act="del-cat" data-id="${esc(c.id)}">🗑️</button>
      </div>`
    )
    .join('');

  const houseRows = households()
    .map(
      (h) => `<div class="list-row ${h.id === S.householdId ? 'on' : ''}">
        <span class="member-avatar">${esc(h.emoji)}</span>
        <span class="list-row-main">
          <span class="list-row-title">${esc(h.name)}${h.id === S.householdId ? ' <span class="pill-now">当前</span>' : ''}</span>
          <span class="list-row-sub">${(h.members || []).length} 位家人 · ${householdOrders(h.id).filter((o) => o.status === 'pending' || o.status === 'cooking').length} 道待做 · ${householdPantry(h.id).length} 样库存${h.note ? ' · ' + esc(h.note) : ''}</span>
        </span>
        ${
          h.id === S.householdId
            ? ''
            : `<button class="icon-mini act" data-act="pick-house" data-id="${esc(h.id)}" title="切到这个家庭">→</button>`
        }
        <button class="icon-mini" data-act="edit-household" data-id="${esc(h.id)}" title="重命名">✏️</button>
        <button class="icon-mini" data-act="del-household" data-id="${esc(h.id)}" title="删除">🗑️</button>
      </div>`
    )
    .join('');

  return `
    <div class="section-head">
      <h2 class="section-title">家庭</h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-household">＋ 添加家庭</button>
    </div>
    <p class="section-sub" style="margin:-6px 0 12px">菜谱所有家庭共享；点餐和库存各记各的。</p>
    ${houseRows}

    <div class="stat-row">
      <div class="stat"><div class="stat-num">${d.length}</div><div class="stat-label">道菜</div></div>
      <div class="stat"><div class="stat-num">${S.data.categories.length}</div><div class="stat-label">个分类</div></div>
      <div class="stat"><div class="stat-num">${pendingOrders().length}</div><div class="stat-label">道待做</div></div>
    </div>

    <div class="section-head">
      <h2 class="section-title">菜品管理</h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-dish">＋ 新增</button>
    </div>
    ${dishRows || '<div class="empty"><p class="empty-text">还没有菜</p></div>'}

    <div class="section-head">
      <h2 class="section-title">家庭成员<span class="section-sub" style="margin-left:8px">${esc(currentHousehold() ? currentHousehold().name : '')}</span></h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-member">＋ 添加</button>
    </div>
    ${
      memberList().length
        ? memberList()
            .map((m) => {
              const st = memberStats(m.name);
              const sub = st.count
                ? `点过 ${st.count} 次 · 共 ${st.people} 份`
                : '还没点过';
              return `<div class="list-row">
                <span class="member-avatar">${esc(m.emoji)}</span>
                <span class="list-row-main">
                  <span class="list-row-title">${esc(m.name)}</span>
                  <span class="list-row-sub">${esc(sub)}</span>
                </span>
                <button class="icon-mini" data-act="edit-member" data-id="${esc(m.id)}" title="编辑">✏️</button>
                <button class="icon-mini" data-act="del-member" data-id="${esc(m.id)}" title="删除">🗑️</button>
              </div>`;
            })
            .join('')
        : '<div class="empty" style="padding:28px"><p class="empty-text">还没有登记成员，点右上角添加</p></div>'
    }

    <div class="section-head">
      <h2 class="section-title">分类管理</h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-cat">＋ 新增</button>
    </div>
    ${catRows}

    <div class="section-head"><h2 class="section-title">家庭设置</h2></div>
    <div class="list-row"><span class="icon-mini">🍽️</span><span class="list-row-main">
      <span class="list-row-title">店名与欢迎语</span>
      <span class="list-row-sub">${esc(s.shopName)} · 共 ${households().length} 个家庭</span>
    </span><button class="icon-mini" data-act="edit-settings">✏️</button></div>
    <div class="list-row"><span class="icon-mini">🔐</span><span class="list-row-main">
      <span class="list-row-title">管理口令</span>
      <span class="list-row-sub">${s.hasPin ? '已开启' : '未开启'}</span>
    </span><button class="icon-mini" data-act="edit-settings">✏️</button></div>
    <div class="list-row"><span class="icon-mini">🤖</span><span class="list-row-main">
      <span class="list-row-title">AI 助手</span>
      <span class="list-row-sub">${
        aiReady()
          ? `已就绪 · ${esc(aiInfo.model)} · 拍图识菜谱 / 规范化 / 厨房调度`
          : '未配置（data/ai.json 里填上 API Key 就会出现在菜谱编辑和点餐页）'
      }</span>
    </span></div>

    <div class="section-head"><h2 class="section-title">关于</h2></div>
    ${versionHtml()}

    <div class="section-head"><h2 class="section-title">数据</h2></div>
    <div class="row-2">
      <button class="btn ghost" data-act="export-data">⬇ 导出备份</button>
      <button class="btn ghost" data-act="import-data">⬆ 恢复备份</button>
    </div>
    ${backupsHtml()}
    <p class="section-sub" style="margin-top:10px;line-height:1.6">
      数据保存在本机 <code>data/</code> 目录，图片在 <code>uploads/</code>，自动备份在 <code>backups/</code>。
      导出的备份是一个 zip，菜谱和照片都在里面。
    </p>
    <input type="file" id="importFile" accept="application/zip,application/json,.zip,.json" hidden />`;
}

/* =========================================================
   家庭增删改
   ========================================================= */

const HOUSE_EMOJI = ['🏠', '🏡', '🏘️', '🏢', '🚪', '🛏️', '🍀', '🌷', '⭐', '🌙'];

function openHouseholdEditor(house) {
  const h = house || {
    id: null,
    name: '',
    emoji: HOUSE_EMOJI[households().length % HOUSE_EMOJI.length],
    note: '',
  };
  openSheet({
    title: house ? `编辑「${house.name}」` : '添加家庭',
    body: `
      <div class="field">
        <label class="field-label">名字或房号 *<span class="field-hint">例如：301、外婆家、单身公寓</span></label>
        <input class="input" id="hName" value="${esc(h.name)}" placeholder="例如：302" />
      </div>
      <div class="field">
        <label class="field-label">图标</label>
        <div class="emoji-grid">
          ${HOUSE_EMOJI.map(
            (e) =>
              `<button class="emoji-opt ${e === h.emoji ? 'on' : ''}" data-act="pick-house-emoji" data-e="${e}">${e}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label">备注<span class="field-hint">住哪、几口人，随你写</span></label>
        <input class="input" id="hNote" value="${esc(h.note)}" placeholder="例如：3 号楼 502" />
      </div>
      <p class="section-sub">
        新建的家庭从零开始：没有点餐记录、库存是空的。菜谱是所有家庭共享的，不用重复录。
      </p>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-household" data-id="${house ? esc(house.id) : ''}">保存</button>`,
  });
  $('#hName').focus();
}

/* =========================================================
   菜品编辑
   ========================================================= */

function openDishEditor(dish) {
  const d =
    dish ||
    {
      id: null,
      name: '',
      category: sortedCategories()[0] ? sortedCategories()[0].name : '家常菜',
      description: '',
      images: [],
      servings: '',
      duration: '',
      difficulty: '简单',
      tags: [],
      seasonings: [],
      methods: [],
      notes: '',
      isFavorite: false,
    };

  S.draft = {
    id: d.id,
    isNew: !d.id,
    dish: {
      ...d,
      images: [...(d.images || [])],
      tags: [...(d.tags || [])],
      seasonings: (d.seasonings || []).map((s) => ({ ...s })),
      methods: (d.methods || []).map((m) => ({
        name: m.name,
        // 老数据没有这个字段，补空数组，菜谱不会少东西
        seasonings: (m.seasonings || []).map((s) => ({ ...s })),
        steps: [...(m.steps || [])],
      })),
    },
  };

  const catOptions = sortedCategories()
    .map(
      (c) =>
        `<option value="${esc(c.name)}" ${d.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`
    )
    .join('');

  openSheet({
    title: dish ? '编辑菜品' : '记一道菜',
    body: `
      <div class="field">
        <label class="field-label">菜名 *</label>
        <input class="input" id="fName" value="${esc(d.name)}" placeholder="例如：红烧排骨" />
      </div>
      <div class="field">
        <label class="field-label">分类</label>
        <select class="select" id="fCat">${catOptions}<option value="其他">其他</option></select>
      </div>
      <div class="field">
        <label class="field-label">一句话介绍<span class="field-hint">家人一看就知道是什么</span></label>
        <input class="input" id="fDesc" value="${esc(d.description)}" placeholder="酸甜开胃，零失败" />
      </div>

      <div class="field">
        <label class="field-label">图片<span class="field-hint">第一张作为封面，最多 9 张</span></label>
        <div class="img-grid" id="fImgs">
          ${d.images
            .map(
              (u, i) => `<div class="img-thumb">
                <img src="${esc(u)}" alt="" />
                ${i === 0 ? '<span class="cover-tag">封面</span>' : ''}
                <button class="img-del" data-act="rm-img" data-idx="${i}">✕</button>
              </div>`
            )
            .join('')}
          <label class="img-add" title="添加图片">＋
            <input type="file" id="fImgFile" accept="image/*" multiple class="img-input" />
          </label>
        </div>
        ${
          aiReady()
            ? `<label class="btn soft sm ai-btn" style="margin-top:10px">
                 📷 拍张照，AI 帮我写这道菜
                 <input type="file" id="fAiImgFile" accept="image/*" class="ai-file" />
               </label>
               <p class="field-hint" style="margin-top:6px">
                 AI 认完会把菜名、调料、步骤填进表单，<b>由你确认后再保存</b>，它认错了可以直接改。
               </p>`
            : ''
        }
      </div>

      <div class="row-2">
        <div class="field"><label class="field-label">份量</label>
          <input class="input" id="fServ" value="${esc(d.servings)}" placeholder="2-3 人份" /></div>
        <div class="field"><label class="field-label">耗时（分钟）</label>
          <input class="input" id="fDur" type="number" min="0" value="${esc(d.duration) || ''}" placeholder="30" /></div>
      </div>
      <div class="field">
        <label class="field-label">难度</label>
        <select class="select" id="fDiff">
          ${['简单', '中等', '有点难']
            .map((v) => `<option ${d.difficulty === v ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field">
        <label class="field-label">标签<span class="field-hint">逗号分隔，如：下饭, 快手</span></label>
        <input class="input" id="fTags" value="${esc((d.tags || []).join(', '))}" />
      </div>

      <div class="field">
        <label class="field-label">通用调料<span class="field-hint">每种做法都要用的主料和基础调料</span></label>
        <div id="fSeasons">
          ${d.seasonings
            .map(
              (s, i) => `<div class="row-2" style="margin-bottom:8px">
                <input class="mini-input" data-act="season-name" data-i="${i}" value="${esc(s.name)}" placeholder="调料名" />
                <input class="mini-input" data-act="season-amt" data-i="${i}" value="${esc(s.amount)}" placeholder="用量" />
                <button class="del-btn" data-act="rm-season" data-i="${i}">✕</button>
              </div>`
            )
            .join('')}
        </div>
        <button class="btn ghost sm" data-act="add-season">＋ 加一味调料</button>
      </div>

      <div class="field">
        <label class="field-label">做法步骤<span class="field-hint">可以写多种做法</span></label>
        <div id="fMethods">
          ${d.methods.map(methodCardHtml).join('')}
        </div>
        <button class="btn ghost sm" data-act="add-method">＋ 加一种做法</button>
      </div>

      <div class="field">
        <label class="field-label">备注<span class="field-hint">经验、禁忌、替换方案…</span></label>
        <textarea class="textarea" id="fNotes" placeholder="例如：花生一定最后放，久炒会软">${esc(d.notes)}</textarea>
      </div>
      ${
        aiReady()
          ? `<button class="btn soft sm ai-btn" data-act="ai-normalize" style="margin:4px 0 16px">
               🧹 让 AI 把这份菜谱整理规范（用量、步骤格式）
             </button>`
          : ''
      }
      <div class="field">
        <label class="field-label" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="fFav" ${d.isFavorite ? 'checked' : ''} style="width:18px;height:18px" />
          标记为拿手菜（显示星标）
        </label>
      </div>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-dish">${dish ? '保存' : '添加'}</button>`,
    // 填到一半被误关掉不该白填：内容变了会拦一下，并留草稿
    draftKey: dish ? dish.id : '__new__',
  });

  $('#fName').focus();
}

/**
 * 拍一张照，AI 认出菜谱并填进当前表单。
 *
 * 关键约束：AI 的结果<b>只填表单、不入库</b>。它认错用量、认错配料是常事，
 * 直接写库就是往你的菜谱里掺假数据。所以填完只弹一句「记得检查」，
 * 保存动作仍然由用户点「保存」触发。
 */
async function recognizeDishFromImage(file) {
  aiBusy('AI 认菜中', '正在看这张图，大概 10-30 秒');
  let dataUrl;
  try {
    // 认图用压缩图就够了：1400px 太费 token，1024 足够看清配料和摆盘
    dataUrl = await compressImage(file, 1024, 0.82);
  } catch (_) {
    aiBusyDone();
    return toast('这张图读不出来，换一张试试');
  }
  // askAI 失败会自己 toast 并返回 null，这里只要把遮罩撤掉
  const r = await askAI(
    'recipe-from-image',
    '这是我要收录的一道菜。请给出菜名、分类、调料用量、做法步骤。',
    dataUrl
  );
  aiBusyDone();
  if (!r) return;

  applyAIResult(r);
  toast('AI 填好了，认错了直接改，然后点保存', 3200);
}

/** 把 AI 返回的菜谱灌进当前编辑表单 */
function applyAIResult(r) {
  const g = (id) => $('#' + id);
  if (!g('fName')) return; // 表单已经关了

  if (r.name) g('fName').value = String(r.name).slice(0, 40);
  if (r.category) {
    const sel = g('fCat');
    const wanted = String(r.category);
    const has = [...sel.options].some((o) => o.value === wanted);
    if (has) sel.value = wanted;
    else sel.value = '其他';
  }
  if (r.description) g('fDesc').value = String(r.description).slice(0, 60);
  if (r.servings) g('fServ').value = String(r.servings).slice(0, 30);
  if (r.duration) g('fDur').value = Number(r.duration) || 0;
  if (r.difficulty) {
    const sel = g('fDiff');
    const wanted = String(r.difficulty);
    if ([...sel.options].some((o) => o.value === wanted)) sel.value = wanted;
  }
  if (Array.isArray(r.tags) && r.tags.length) {
    g('fTags').value = r.tags.slice(0, 8).join(', ');
  }

  // 调料 / 步骤走结构化数据，再触发既有重绘
  if (Array.isArray(r.seasonings) && r.seasonings.length) {
    S.draft.dish.seasonings = r.seasonings
      .filter((s) => s && s.name)
      .slice(0, 40)
      .map((s) => ({ name: String(s.name).slice(0, 30), amount: String(s.amount || '').slice(0, 30) }));
    redrawSeasons();
  }
  if (Array.isArray(r.methods) && r.methods.length) {
    S.draft.dish.methods = r.methods
      .filter((m) => m && Array.isArray(m.steps) && m.steps.length)
      .slice(0, 6)
      .map((m, i) => ({
        name: String(m.name || '做法 ' + (i + 1)).slice(0, 24),
        // AI 可能给做法单独配调料，也可能不配；不配就是空的，不影响步骤
        seasonings: (Array.isArray(m.seasonings) ? m.seasonings : [])
          .filter((s) => s && s.name)
          .slice(0, 40)
          .map((s) => ({ name: String(s.name).slice(0, 30), amount: String(s.amount || '').slice(0, 30) })),
        steps: m.steps.map((s) => String(s).slice(0, 200)).slice(0, 30),
      }));
    redrawMethods();
  }
  if (r.notes) g('fNotes').value = String(r.notes).slice(0, 300);
}

function collectDish() {
  const g = (id) => $('#' + id);
  const d = S.draft.dish;
  d.name = g('fName').value.trim();
  d.category = g('fCat').value;
  d.description = g('fDesc').value.trim();
  d.servings = g('fServ').value.trim();
  d.duration = Number(g('fDur').value) || 0;
  d.difficulty = g('fDiff').value;
  d.tags = g('fTags').value.split(/[,，\s]+/).filter(Boolean);
  d.notes = g('fNotes').value.trim();
  d.isFavorite = g('fFav').checked;
  d.seasonings = d.seasonings.filter((s) => s.name.trim());
  d.methods = d.methods
    .map((m) => ({
      name: m.name.trim() || '做法',
      // 没写调料名的那一行直接丢掉，别留空壳进 JSON
      seasonings: (m.seasonings || []).filter((s) => s.name.trim()),
      steps: m.steps.map((s) => s.trim()).filter(Boolean),
    }))
    .filter((m) => m.steps.length);
  return d;
}

/** 局部重绘调料/做法区，保留其它字段 */
function redrawSeasons() {
  $('#fSeasons').innerHTML = S.draft.dish.seasonings
    .map(
      (s, i) => `<div class="row-2" style="margin-bottom:8px">
        <input class="mini-input" data-act="season-name" data-i="${i}" value="${esc(s.name)}" placeholder="调料名" />
        <input class="mini-input" data-act="season-amt" data-i="${i}" value="${esc(s.amount)}" placeholder="用量" />
        <button class="del-btn" data-act="rm-season" data-i="${i}">✕</button>
      </div>`
    )
    .join('');
}

/**
 * 一个做法卡片的 HTML（编辑器里用）。
 *
 * 每种做法可以带自己的调料：一道菜常有几种做法甚至几种口味
 * （红烧/清蒸、甜口/辣口），用到的调料本来就不一样。
 * 通用调料写在菜品级，这里只放这个做法独有的那些。
 */
function methodCardHtml(m, i) {
  const seasons = m.seasonings || [];
  return `<div class="sub-card">
    <div class="sub-card-head">
      <input class="mini-input" data-act="method-name" data-i="${i}" value="${esc(m.name)}" placeholder="做法名称（如：红烧 / 清蒸 / 微辣版）" />
      <button class="del-btn" data-act="rm-method" data-i="${i}">✕</button>
    </div>
    <div class="mseason">
      <div class="mseason-label">这个做法独有的调料<span class="field-hint">上面的通用调料它也能用，这里只写它额外要的</span></div>
      ${seasons
        .map(
          (s, j) => `<div class="row-2" style="margin-bottom:6px">
        <input class="mini-input" data-act="mseason-name" data-i="${i}" data-j="${j}" value="${esc(s.name)}" placeholder="调料名" />
        <input class="mini-input" data-act="mseason-amt" data-i="${i}" data-j="${j}" value="${esc(s.amount)}" placeholder="用量" />
        <button class="del-btn" data-act="rm-mseason" data-i="${i}" data-j="${j}">✕</button>
      </div>`
        )
        .join('')}
      <button class="btn ghost sm" data-act="add-mseason" data-i="${i}">＋ 加一味</button>
    </div>
    <textarea class="textarea" data-act="method-steps" data-i="${i}"
      placeholder="一行一步">${esc(m.steps.join('\n'))}</textarea>
  </div>`;
}

function redrawMethods() {
  $('#fMethods').innerHTML = S.draft.dish.methods.map(methodCardHtml).join('');
}

function redrawImages() {
  const imgs = S.draft.dish.images;
  $('#fImgs').innerHTML =
    imgs
      .map(
        (u, i) => `<div class="img-thumb">
          <img src="${esc(u)}" alt="" />
          ${i === 0 ? '<span class="cover-tag">封面</span>' : ''}
          <button class="img-del" data-act="rm-img" data-idx="${i}">✕</button>
        </div>`
      )
      .join('') +
    '<label class="img-add" title="添加图片">＋' +
    '<input type="file" id="fImgFile" accept="image/*" multiple class="img-input" />' +
    '</label>';
}

/* ---------------- 图片压缩上传 ---------------- */

function compressImage(file, maxSize = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // 透明 PNG 转 JPG 不会变黑
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   分类 / 设置
   ========================================================= */

function openCatEditor(cat) {
  openSheet({
    title: cat ? '重命名分类' : '新增分类',
    body: `<div class="field">
      <label class="field-label">分类名称</label>
      <input class="input" id="catName" value="${cat ? esc(cat.name) : ''}" placeholder="例如：夜宵" />
    </div>
    ${cat ? '' : '<p class="section-sub">新分类会自动出现在菜单顶部的筛选条上。</p>'}`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-cat" data-id="${cat ? esc(cat.id) : ''}">保存</button>`,
  });
  $('#catName').focus();
}

function openSettings() {
  const s = S.data.settings;
  openSheet({
    title: '家庭设置',
    body: `
      <div class="field"><label class="field-label">店名<span class="field-hint">所有家庭共用</span></label>
        <input class="input" id="setName" value="${esc(s.shopName)}" /></div>
      <div class="field"><label class="field-label">欢迎语</label>
        <input class="input" id="setWelcome" value="${esc(s.welcome || '')}" /></div>
      <div class="field"><label class="field-label">管理口令<span class="field-hint">${
        s.hasPin
          ? '已开启。填新口令即可更换；不知道旧口令的话找回来在 data/settings.json 里删掉 adminPin'
          : '留空表示不锁；开启后只有知道口令的人能改菜谱和家庭'
      }</span></label>
        <input class="input" id="setPin" type="password" placeholder="${
          s.hasPin ? '已设置口令，留空表示不修改' : '例如 1234'
        }" />
        ${
          s.hasPin
            ? `<label class="field-label" style="display:flex;align-items:center;gap:8px;margin-top:10px">
                 <input type="checkbox" id="setPinClear" style="width:18px;height:18px" />
                 取消口令保护（勾上后保存即刻生效）
               </label>`
            : ''
        }</div>
      <p class="section-sub">每个家庭的成员在「管理 → 家庭成员」里单独维护。</p>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-settings">保存</button>`,
  });
}

/* =========================================================
 * 家庭成员管理
 * ========================================================= */

const QUICK_EMOJI = ['🙋', '👩', '👨', '👧', '👦', '🧒', '👵', '👴', '🐱', '🐶', '😋', '🧑‍🍳'];

function openMemberEditor(member) {
  const m =
    member || { id: null, name: '', emoji: QUICK_EMOJI[memberList().length % QUICK_EMOJI.length] };
  openSheet({
    title: member ? '编辑成员' : '添加成员',
    body: `
      <div class="field">
        <label class="field-label">称呼<span class="field-hint">点餐时会显示这个名字</span></label>
        <input class="input" id="mName" value="${esc(m.name)}" placeholder="例如：外婆" />
      </div>
      <div class="field">
        <label class="field-label">头像</label>
        <div class="emoji-grid">
          ${QUICK_EMOJI.map(
            (e) =>
              `<button class="emoji-opt ${e === m.emoji ? 'on' : ''}" data-act="pick-emoji" data-e="${e}">${e}</button>`
          ).join('')}
        </div>
        <input class="input" id="mEmoji" value="${esc(m.emoji)}" placeholder="也可以直接输入任意表情" style="margin-top:8px" />
      </div>
      ${
        member && memberStats(m.name).count
          ? `<p class="section-sub">${esc(m.name)} 已点过 ${memberStats(m.name).count} 次。删除成员不会删掉 TA 的历史点餐记录。</p>`
          : ''
      }`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-member" data-id="${member ? esc(member.id) : ''}">保存</button>`,
  });
  $('#mName').focus();
}

async function saveMembers(list) {
  const h = currentHousehold();
  if (!h) return toast('还没有家庭');
  await api('PUT', `/api/households/${h.id}`, { members: list });
  await loadState(true);
  render();
}

/* =========================================================
 * 渲染主循环
 * ========================================================= */

function render() {
  const s = S.data.settings || {};
  document.title = s.shopName || '家庭菜单';
  $('#brandName').textContent = s.shopName || '家庭菜单';
  $('#brandSub').textContent = s.welcome || '今天想吃点什么？';

  renderHouseBtn();

  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.view === S.view;
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });

  const badge = $('#orderBadge');
  const n = pendingOrders().length;
  badge.hidden = n === 0;
  badge.textContent = n;

  // 计划页签角标 = 本周（和下周）排了几道菜
  const planBadge = $('#planBadge');
  const planN = planItems(planWeek()).length + planItems(addDays(planWeek(), 7)).length;
  planBadge.hidden = planN === 0;
  planBadge.textContent = planN;

  // 库存角标只报「该处理」的：过期 + 临期
  const pb = $('#pantryBadge');
  const pantryList = householdPantry();
  const urgent = pantryList.filter((p) => {
    const k = shelfStatus(p).key;
    return k === 'expired' || k === 'soon' || k === 'today';
  }).length;
  pb.hidden = urgent === 0;
  pb.textContent = urgent;
  pb.classList.toggle('warn', pantryList.some((p) => shelfStatus(p).key === 'expired'));

  const view = $('#view');
  if (S.view === 'menu') view.innerHTML = viewMenu();
  else if (S.view === 'plan') view.innerHTML = viewPlan();
  else if (S.view === 'order') view.innerHTML = viewOrder();
  else if (S.view === 'pantry') view.innerHTML = viewPantry();
  else view.innerHTML = viewManage();

  // 悬浮窗面板头上那行「当前页面 · 当前家庭」跟着一起更新
  redrawChat();
}

/** 顶栏上的「当前家庭」按钮 */
function renderHouseBtn() {
  const emoji = $('#houseEmoji');
  const name = $('#houseName');
  if (!emoji || !name) return;
  const h = currentHousehold();
  emoji.textContent = h ? h.emoji : '🏠';
  name.textContent = h ? h.name : '家庭';
  const pending = pendingOrders().length;
  const urgent = householdPantry().filter((p) => {
    const k = shelfStatus(p).key;
    return k === 'expired' || k === 'soon' || k === 'today';
  }).length;
  const badge = householdBadge();
  const btn = emoji.closest('.house-btn');
  if (btn) {
    btn.title = [h ? h.name : '', pending ? `${pending} 道待做` : '', urgent ? `${urgent} 样要处理` : '']
      .filter(Boolean)
      .join(' · ');
  }
  // 角标显示在顶栏按钮的后面
  let dot = btn && btn.parentElement.querySelector('.house-btn-badge');
  if (!pending && !urgent) {
    if (dot) dot.remove();
    return;
  }
  if (!dot && btn) {
    dot = document.createElement('span');
    dot.className = 'house-btn-badge';
    btn.parentElement.insertBefore(dot, btn);
  }
  if (dot) {
    dot.textContent = urgent ? `${pending}/${urgent}` : `${pending}`;
    dot.title = urgent ? `${pending} 道待做 / ${urgent} 样食材临期或过期` : `${pending} 道待做`;
    dot.classList.toggle('cold', urgent > 0);
  }
}

function householdBadge() {
  const pending = pendingOrders().length;
  const urgent = householdPantry().filter((p) => {
    const k = shelfStatus(p).key;
    return k === 'expired' || k === 'soon' || k === 'today';
  }).length;
  return { pending, urgent };
}

/** 家庭选择弹层：一眼看到每家的待做和库存状况 */
function openHouseholdPicker() {
  const list = households();
  const body = `
    <p class="section-sub" style="margin:-2px 0 14px">
      菜谱所有家庭共享，点餐和库存各记各的。选一个切过去。
    </p>
    ${list
      .map((h) => {
        const orders = householdOrders(h.id);
        const pending = orders.filter((o) => o.status === 'pending' || o.status === 'cooking').length;
        const food = householdPantry(h.id);
        const urgent = food.filter((p) => {
          const k = shelfStatus(p).key;
          return k === 'expired' || k === 'soon' || k === 'today';
        }).length;
        const bits = [`${h.members.length} 位家人`, `${pending} 道待做`, `${food.length} 样库存`];
        return `<button class="house-pick" data-act="pick-house" data-id="${esc(h.id)}"
          aria-pressed="${h.id === S.householdId}">
          <span class="house-pick-emoji">${esc(h.emoji)}</span>
          <span class="house-pick-main">
            <span class="house-pick-name">${esc(h.name)}</span>
            <span class="house-pick-sub">${esc(bits.join(' · '))}${urgent ? ` · ⚠ ${urgent} 样要处理` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</span>
          </span>
          ${h.id === S.householdId ? '<span class="house-pick-tag">✓</span>' : ''}
        </button>`;
      })
      .join('')}`;
  openSheet({
    title: '切换家庭',
    body,
    foot: `<button class="btn soft" data-act="new-household">＋ 添加家庭</button>
           <button class="btn ghost" data-act="edit-settings">服务设置</button>`,
  });
}

/* =========================================================
   事件
   ========================================================= */

const ACTIONS = {
  /* 导航 */
  nav(el) {
    const v = el.dataset.view;
    if (v === 'manage' && S.data.settings.hasPin && !S.authed) {
      S.view = 'manage';
      render();
      promptPin();
      return;
    }
    S.view = v;
    closeSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render();
  },
  reload() {
    S.loading = true;
    render();
    loadState();
  },

  /* 搜索 */
  'open-search'() {
    $('#searchbar').hidden = false;
    $('#searchInput').focus();
  },
  'close-search'() {
    $('#searchbar').hidden = true;
    S.keyword = '';
    $('#searchInput').value = '';
    render();
  },

  /* 菜单 */
  'filter-cat'(el) {
    S.category = el.dataset.cat;
    render();
  },
  'filter-status'(el) {
    S.orderStatus = el.dataset.status;
    render();
  },
  'filter-member'(el) {
    S.memberFilter = el.dataset.name || '';
    render();
  },
  'toggle-group'() {
    S.groupByMember = !S.groupByMember;
    render();
  },
  'open-dish'(el) {
    openDish(el.dataset.id);
  },
  async random() {
    const list = S.data.dishes;
    if (!list.length) return toast('还没有菜可以抽哦');
    openDish(list[Math.floor(Math.random() * list.length)].id);
  },

  /* 厨房助手：把待做的几道菜排成并行下厨的顺序 */
  async 'ai-cook-plan'() {
    if (!aiReady()) return toast('还没配置 AI');
    const scope = pendingOrders().filter((o) => !S.memberFilter || o.requester === S.memberFilter);
    // 去重：同一道菜被两个人点了，仍然只是一道菜
    const dishes = [];
    const seen = new Set();
    for (const o of scope) {
      const k = o.dishId || o.dishName;
      if (seen.has(k)) continue;
      seen.add(k);
      const d = o.dishId ? dishById(o.dishId) : null;
      dishes.push({
        name: o.dishName,
        duration: d ? d.duration : 0,
        servings: d ? d.servings : o.people + ' 人份',
        seasonings: d ? collectDishSeasonings(d).map((s) => `${s.name} ${s.amount}`).join('；') : '',
        steps: d ? (d.methods || []).flatMap((m) => m.steps || []) : [],
      });
    }
    if (dishes.length < 2) return toast('至少有两道待做的菜才需要排顺序');

    aiBusy('厨房助手在想', `${dishes.length} 道菜，大概 5-15 秒`);

    const brief =
      '今天要一起做这几道菜：\n\n' +
      dishes
        .map(
          (d, i) =>
            `${i + 1}. ${d.name}${d.duration ? `（约 ${d.duration} 分钟）` : ''}` +
            (d.seasonings ? `\n   调料：${d.seasonings}` : '') +
            (d.steps.length ? `\n   步骤：${d.steps.join(' ')}` : '')
        )
        .join('\n');
    const r = await askAI('prep-timeline', brief);
    aiBusyDone();
    if (!r) return;
    openCookPlanSheet(r);
  },

  async 'copy-cook-plan'() {
    if (!S.cookPlanText) return;
    closeSheet();
    copyText(S.cookPlanText);
  },

  /* 菜品编辑 */
  'new-dish'() {
    openDishEditor(null);
  },
  'edit-dish'(el) {
    const d = dishById(el.dataset.id);
    if (d) openDishEditor(d);
  },
  /* 菜谱规范化：让 AI 把现有菜谱整理成规范格式，逐字段给建议 */
  async 'ai-normalize'() {
    if (!aiReady()) return toast('还没配置 AI');
    if (aiBusyOn) return;
    // 先把当前表单里的内容收上来，AI 看到的是你眼前这份
    collectDish();
    const d = S.draft.dish;
    const brief = [
      `菜名：${d.name || '(空)'}`,
      `分类：${d.category}`,
      `介绍：${d.description || '(空)'}`,
      `份量：${d.servings || '(空)'}`,
      `耗时：${d.duration || '(空)'}`,
      `难度：${d.difficulty}`,
      `标签：${(d.tags || []).join('、') || '(空)'}`,
      d.seasonings.length ? `通用调料：${d.seasonings.map((s) => s.name + ' ' + s.amount).join('；')}` : '通用调料：(空)',
      d.methods.length
        ? `做法：${d.methods
            .map(
              (m) =>
                `[${m.name}]` +
                ((m.seasonings || []).length
                  ? ` 额外调料：${m.seasonings.map((s) => s.name + ' ' + s.amount).join('；')}；`
                  : '') +
                ` ${m.steps.join(' ')}`
            )
            .join(' | ')}`
        : '做法：(空)',
      d.notes ? `备注：${d.notes}` : '',
    ].filter(Boolean).join('\n');

    aiBusy('AI 整理中', '大概 5-15 秒');
    const r = await askAI('recipe-normalize', brief);
    aiBusyDone();
    if (!r) return;
    // 同样只填表单、不入库，由用户看过再决定
    applyAIResult(r);
    toast('整理好了，改动过的地方你再扫一眼', 3200);
  },
  async 'dup-dish'(el) {
    const d = await api('POST', `/api/dishes/${el.dataset.id}/duplicate`, {});
    await loadState(true);
    toast(`已复制「${d.name}」`);
    render();
  },
  async 'del-dish'(el) {
    const d = dishById(el.dataset.id);
    if (!d) return;
    if (!confirm(`确定删除「${d.name}」？\n相关的待做点餐也会一起删掉，此操作不可撤销。`)) return;
    await api('DELETE', `/api/dishes/${el.dataset.id}`);
    await loadState(true);
    toast('已删除');
    render();
  },
  'rm-img'(el) {
    S.draft.dish.images.splice(Number(el.dataset.idx), 1);
    redrawImages();
  },
  'add-season'() {
    collectDish();
    S.draft.dish.seasonings.push({ name: '', amount: '' });
    redrawSeasons();
  },
  'rm-season'(el) {
    collectDish();
    S.draft.dish.seasonings.splice(Number(el.dataset.i), 1);
    redrawSeasons();
  },
  'add-method'() {
    collectDish();
    S.draft.dish.methods.push({
      name: `做法 ${S.draft.dish.methods.length + 1}`,
      seasonings: [],
      steps: [],
    });
    redrawMethods();
  },
  'rm-method'(el) {
    collectDish();
    S.draft.dish.methods.splice(Number(el.dataset.i), 1);
    redrawMethods();
  },
  'add-mseason'(el) {
    collectDish();
    const m = S.draft.dish.methods[Number(el.dataset.i)];
    if (!m) return;
    m.seasonings = m.seasonings || [];
    m.seasonings.push({ name: '', amount: '' });
    redrawMethods();
  },
  'rm-mseason'(el) {
    collectDish();
    const m = S.draft.dish.methods[Number(el.dataset.i)];
    if (!m) return;
    m.seasonings.splice(Number(el.dataset.j), 1);
    redrawMethods();
  },
  async 'save-dish'() {
    const d = collectDish();
    if (!d.name) return toast('先给这道菜起个名字吧');
    try {
      if (S.draft.isNew) {
        await api('POST', '/api/dishes', d);
        toast(`「${d.name}」已加入菜单`);
        // 新菜已经有自己的 id 了，__new__ 草稿顺手清掉，
        // 否则下次「记一道菜」会捞出刚存进去的那份
        dishDrafts.delete('__new__');
      } else {
        await api('PUT', `/api/dishes/${S.draft.id}`, d);
        toast('已保存');
        dishDrafts.delete(S.draft.id);
      }
      closeSheet();
      await loadState(true);
      render();
    } catch (err) {
      toast('保存失败：' + err.message);
    }
  },

  /* 点餐 */
  'order-dish'(el) {
    openOrderForm(dishById(el.dataset.id));
  },
  'new-order'() {
    openOrderForm(null);
  },
  'pick-dish'(el) {
    collectOrder();
    const d = dishById(el.dataset.id);
    if (!d) return;
    S.draftOrder.dishId = d.id;
    S.draftOrder.dishName = d.name;
    $('#ordName').value = d.name;
    document.querySelectorAll('.picker-item').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.id === d.id);
    });
  },
  'pick-member'(el) {
    $('#ordWho').value = el.dataset.name;
    const card = el.closest('.member-cards');
    if (card) {
      card.querySelectorAll('.member-card').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.name === el.dataset.name);
      });
    }
  },
  async 'submit-order'() {
    const o = collectOrder();
    if (!o.dishName) return toast('先选一道菜，或者写上想吃的名字');
    try {
      await api('POST', '/api/orders', o);
      closeSheet();
      await loadState(true);
      S.view = 'order';
      S.orderStatus = 'pending';
      render();
      toast(`🔔 已下单：${o.dishName}`);
    } catch (err) {
      toast('提交失败：' + err.message);
    }
  },
  async 'set-status'(el) {
    await api('PATCH', `/api/orders/${el.dataset.id}`, { status: el.dataset.status });
    await loadState(true);
    toast(el.dataset.status === 'done' ? '开吃！🍚' : '开始做菜了');
    render();
  },
  async 'del-order'(el) {
    if (!confirm('删除这条点餐？')) return;
    await api('DELETE', `/api/orders/${el.dataset.id}`);
    await loadState(true);
    render();
  },
  async 'clear-done'() {
    const h = currentHousehold();
    if (!confirm(`清空「${h ? h.name : ''}」所有已完成的点餐记录？`)) return;
    await api('DELETE', `/api/orders/done?householdId=${encodeURIComponent(S.householdId)}`);
    await loadState(true);
    render();
  },
  async 'toggle-shop'(el) {
    const name = el.dataset.name;
    if (S.shoppingChecked.has(name)) S.shoppingChecked.delete(name);
    else S.shoppingChecked.add(name);
    await api('PUT', '/api/settings', { shoppingChecked: [...S.shoppingChecked] });
    S.data.settings.shoppingChecked = [...S.shoppingChecked];
    render();
  },
  async 'copy-shopping'() {
    const text = buildShoppingList()
      .map((i) => `□ ${i.name}（${i.parts.join(' + ')}）`)
      .join('\n');
    if (!text) return toast('暂时没有要买的东西');
    await copyText(text);
  },

  /* 家庭成员 */
  'new-member'() {
    openMemberEditor(null);
  },
  'edit-member'(el) {
    openMemberEditor(memberList().find((m) => m.id === el.dataset.id));
  },
  'pick-emoji'(el) {
    $('#mEmoji').value = el.dataset.e;
    el.closest('.emoji-grid')
      .querySelectorAll('.emoji-opt')
      .forEach((b) => b.classList.toggle('on', b.dataset.e === el.dataset.e));
  },
  async 'save-member'(el) {
    const name = $('#mName').value.trim();
    if (!name) return toast('给家人起个称呼');
    const emoji = $('#mEmoji').value.trim() || '🙋';
    const list = memberList().map((m) => ({ id: m.id, name: m.name, emoji: m.emoji }));
    const id = el.dataset.id;
    const hit = list.find((m) => m.id === id);
    if (hit) {
      hit.name = name;
      hit.emoji = emoji;
    } else {
      if (list.some((m) => m.name === name)) return toast(`已经有叫「${name}」的成员了`);
      list.push({ id: 'm_' + Date.now().toString(36), name, emoji });
    }
    await saveMembers(list);
    closeSheet();
    toast(hit ? '已保存' : `已添加 ${name}`);
  },
  async 'del-member'(el) {
    const m = memberList().find((x) => x.id === el.dataset.id);
    if (!m) return;
    const st = memberStats(m.name);
    const msg = st.count
      ? `删除成员「${m.name}」？\nTA 的 ${st.count} 条历史点餐记录会保留，但分组显示时不再带头像。`
      : `删除成员「${m.name}」？`;
    if (!confirm(msg)) return;
    await saveMembers(
      memberList()
        .filter((x) => x.id !== el.dataset.id)
        .map((x) => ({ id: x.id, name: x.name, emoji: x.emoji }))
    );
    if (S.memberFilter === m.name) S.memberFilter = '';
    render();
    toast('已删除');
  },

  /* 分类 */
  'new-cat'() {
    openCatEditor(null);
  },
  'edit-cat'(el) {
    openCatEditor(S.data.categories.find((c) => c.id === el.dataset.id));
  },
  async 'save-cat'(el) {
    const name = $('#catName').value.trim();
    if (!name) return toast('给分类起个名字');
    const id = el.dataset.id;
    await (id ? api('PUT', `/api/categories/${id}`, { name }) : api('POST', '/api/categories', { name }));
    closeSheet();
    await loadState(true);
    render();
    toast('已保存');
  },
  async 'del-cat'(el) {
    const c = S.data.categories.find((x) => x.id === el.dataset.id);
    if (!c) return;
    const n = S.data.dishes.filter((d) => d.category === c.name).length;
    const msg = n
      ? `删除分类「${c.name}」？\n该分类下 ${n} 道菜会移到「其他」，菜品不会丢。`
      : `删除分类「${c.name}」？`;
    if (!confirm(msg)) return;
    await api('DELETE', `/api/categories/${el.dataset.id}`);
    if (S.category === c.name) S.category = '全部';
    await loadState(true);
    render();
  },

  /* 家庭 */
  'open-houses'() {
    openHouseholdPicker();
  },
  'pick-house'(el) {
    const id = el.dataset.id;
    if (id === S.householdId) return;
    S.householdId = id;
    localStorage.setItem(LS_HOUSE, id);
    // 换家庭后原来的筛选多半没意义了，清掉免得看着空
    S.memberFilter = '';
    S.pantryCat = '全部';
    S.pantryFilter = 'all';
    closeSheet();
    render();
    const h = currentHousehold();
    if (h) toast(`已切到 ${h.emoji} ${h.name}`);
  },
  'new-household'() {
    openHouseholdEditor(null);
  },
  'edit-household'(el) {
    openHouseholdEditor(households().find((h) => h.id === el.dataset.id));
  },
  'pick-house-emoji'(el) {
    $('#hName').dataset.emoji = el.dataset.e;
    el.closest('.emoji-grid')
      .querySelectorAll('.emoji-opt')
      .forEach((b) => b.classList.toggle('on', b.dataset.e === el.dataset.e));
  },
  async 'save-household'(el) {
    const name = $('#hName').value.trim();
    if (!name) return toast('给家庭起个名字或填个房号');
    const emoji =
      $('#hName').dataset.emoji ||
      ($('#hEmoji') && $('#hEmoji').value.trim()) ||
      HOUSE_EMOJI[households().length % HOUSE_EMOJI.length];
    const body = { name, emoji, note: $('#hNote').value.trim() };
    const id = el.dataset.id;
    const saved = await (id
      ? api('PUT', `/api/households/${id}`, body)
      : api('POST', '/api/households', body));
    closeSheet();
    await loadState(true);
    if (!id) {
      S.householdId = saved.id;
      localStorage.setItem(LS_HOUSE, saved.id);
      S.memberFilter = '';
      render();
      toast(`已添加 ${saved.name}`);
    } else {
      render();
      toast('已保存');
    }
  },
  async 'del-household'(el) {
    const h = households().find((x) => x.id === el.dataset.id);
    if (!h) return;
    if (households().length <= 1) return toast('至少要保留一个家庭');
    const nOrder = householdOrders(h.id).length;
    const nFood = householdPantry(h.id).length;
    const extra = nOrder || nFood ? `\n它名下的 ${nOrder} 条点餐、${nFood} 样库存会一起删掉，` : '';
    if (!confirm(`删除家庭「${h.name}」？${extra}删了找不回来。`)) return;
    await api('DELETE', `/api/households/${h.id}`);
    if (S.householdId === h.id) {
      S.householdId = '';
      localStorage.removeItem(LS_HOUSE);
      S.memberFilter = '';
    }
    await loadState(true);
    render();
    toast('已删除');
  },

  /* 本周计划 */
  'week-shift'(el) {
    const n = Number(el.dataset.n) || 0;
    S.planWeek = addDays(planWeek(), n * 7);
    render();
  },
  'add-plan-dish'() {
    openPlanPicker(planWeek());
  },
  async 'pick-plan-dish'(el) {
    const dish = dishById(el.dataset.id);
    if (!dish) return;
    await addToPlan({ dishId: dish.id, name: dish.name, servings: dish.servings }, planWeek());
  },
  async 'toggle-plan-dish'(el) {
    const dish = dishById(el.dataset.id);
    if (!dish) return;
    const week = el.dataset.week || planWeek();
    const hit = planItems(week).find((it) => it.dishId === dish.id);
    if (hit) {
      await api('DELETE', `/api/plans/items/${hit.id}`);
      await loadState(true);
      // 详情弹层还开着，重开一次让按钮状态跟上
      openDish(dish.id);
      render();
      toast(`已从${planWeekTitle(week)}拿掉`);
    } else {
      await addToPlan({ dishId: dish.id, name: dish.name, servings: dish.servings }, week, () =>
        openDish(dish.id)
      );
    }
  },
  async 'save-plan-custom'(el) {
    const name = ($('#planName').value || '').trim();
    if (!name) return toast('写上想做的菜名');
    await addToPlan({ name }, el.dataset.week || planWeek());
  },
  async 'rm-plan'(el) {
    await api('DELETE', `/api/plans/items/${el.dataset.id}`);
    await loadState(true);
    render();
  },
  async 'clear-plan'() {
    const week = planWeek();
    const n = planItems(week).length;
    if (!n) return;
    if (!confirm(`清空${planWeekTitle(week)}里的 ${n} 道菜？`)) return;
    await api(
      'DELETE',
      `/api/plans?householdId=${encodeURIComponent(S.householdId)}&weekOf=${encodeURIComponent(week)}`
    );
    await loadState(true);
    render();
    toast('已清空');
  },
  async 'copy-plan-shopping'() {
    const dishIds = planItems(planWeek()).map((it) => it.dishId).filter(Boolean);
    const list = shoppingFromDishIds(dishIds);
    if (!list.length) return toast('计划里的菜还没写调料用量');
    await copyText(list.map((i) => `□ ${i.name}（${i.parts.join(' + ')}）`).join('\n'));
  },

  /* 库存 */
  'new-food'() {
    openFoodEditor(null);
  },
  'edit-food'(el) {
    openFoodEditor(householdPantry().find((p) => p.id === el.dataset.id));
  },
  'filter-pantry'(el) {
    S.pantryFilter = el.dataset.filter || 'all';
    S.pantryCat = '全部';
    render();
  },
  'filter-pcat'(el) {
    S.pantryCat = el.dataset.cat || '全部';
    render();
  },
  'pick-preset'(el) {
    const { name, cat, unit, exp } = el.dataset;
    $('#fFoodName').value = name;
    if (cat) $('#fFoodCat').value = cat;
    if (unit) $('#fFoodUnit').value = unit;
    if (exp) $('#fFoodExp').value = exp;
    if (!$('#fFoodNote').value.trim()) $('#fFoodNote').value = '';
    toast(`已填入「${name}」`);
  },
  'exp-preset'(el) {
    const d = Number(el.dataset.days) || 0;
    $('#fFoodExp').value = d > 0 ? dayOffset(d) : '';
  },
  async 'save-food'(el) {
    const name = $('#fFoodName').value.trim();
    if (!name) return toast('先写上食材名');
    const body = {
      householdId: S.householdId,
      name,
      category: $('#fFoodCat').value,
      quantity: Number($('#fFoodQty').value) || 0,
      unit: $('#fFoodUnit').value.trim() || '份',
      expireAt: $('#fFoodExp').value || '',
      note: $('#fFoodNote').value.trim(),
    };
    const id = el.dataset.id;
    await (id ? api('PUT', `/api/pantry/${id}`, body) : api('POST', '/api/pantry', body));
    closeSheet();
    await loadState(true);
    render();
    toast(id ? '已保存' : `已记下 ${name}`);
  },
  async 'del-food'(el) {
    const p = householdPantry().find((x) => x.id === el.dataset.id);
    if (!p) return;
    if (!confirm(`从「${currentHousehold() ? currentHousehold().name : ''}」的库存里删掉「${p.name}」？`)) return;
    await api('DELETE', `/api/pantry/${p.id}`);
    await loadState(true);
    render();
    toast('已删除');
  },
  async 'qty-inc'(el) {
    await bumpQty(el.dataset.id, 1);
  },
  async 'qty-dec'(el) {
    await bumpQty(el.dataset.id, -1);
  },
  async 'purge-pantry'(el) {
    const scope = el.dataset.scope || 'expired';
    const label = scope === 'expired' ? '已过期' : '临期（3 天内到期）';
    if (!confirm(`清理「${currentHousehold() ? currentHousehold().name : ''}」库存里${label}的食材？`)) return;
    const r = await api(
      'DELETE',
      `/api/pantry?householdId=${encodeURIComponent(S.householdId)}&scope=${scope}`
    );
    await loadState(true);
    render();
    toast(r.removed ? `已清理 ${r.removed} 样` : '没有需要清理的');
  },

  /* ---- 库存批量删除 ---- */

  'pick-on'() {
    S.pantryPick = true;
    S.pantrySel = new Set();
    render();
  },
  'pick-cancel'() {
    S.pantryPick = false;
    S.pantrySel = new Set();
    render();
  },
  'pick-food'(el) {
    const id = el.dataset.id;
    if (S.pantrySel.has(id)) S.pantrySel.delete(id);
    else S.pantrySel.add(id);
    render();
  },
  /** 全选/全不选只针对「当前看得到的那批」，不是整个库存 */
  'pick-all'(el) {
    const visible = visiblePantryIds();
    const allOn = visible.length > 0 && visible.every((id) => S.pantrySel.has(id));
    if (allOn) visible.forEach((id) => S.pantrySel.delete(id));
    else visible.forEach((id) => S.pantrySel.add(id));
    render();
  },
  async 'pick-delete'() {
    const ids = [...S.pantrySel];
    if (!ids.length) return toast('还没勾选任何一样');
    // 只把名字念出来，不念「家里有 12 样」这种会吓人的总数
    const names = pantryNames(ids);
    const preview = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 样` : '');
    if (!confirm(`删掉「${currentHousehold() ? currentHousehold().name : ''}」库存里的 ${preview}？删了就找不回来了。`))
      return;
    const r = await api('DELETE', `/api/pantry?ids=${ids.map(encodeURIComponent).join(',')}`);
    S.pantrySel = new Set();
    await loadState(true);
    // 先刷新再判断：原来在刷新前比数量，筛选状态下会误判「全删光了」
    if (!householdPantry().length) S.pantryPick = false;
    render();
    toast(r.removed ? `已删掉 ${r.removed} 样` : '没删掉任何东西');
  },

  /* ---- 点餐一键开做 ---- */

  async 'start-all'() {
    const list = pendingOrders().filter((o) => o.status === 'pending');
    if (!list.length) return toast('没有待做的菜了');
    const names = [...new Set(list.map((o) => o.dishName))];
    const preview = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 道` : '');
    if (!confirm(`把 ${list.length} 条待做全部标成制作中？\n${preview}`)) return;
    const r = await api('PATCH', '/api/orders', {
      ids: list.map((o) => o.id),
      status: 'cooking',
    });
    // 全部开做之后自动切到「制作中」，不然用户还停在空的「待做」页
    if (r.changed) S.orderStatus = 'cooking';
    await loadState(true);
    render();
    toast(r.changed ? `${r.changed} 道菜开始做了` : '没有改动');
  },

  'show-changelog'() {
    openChangelogSheet();
  },
  /** 买菜清单里「入库」：把买回来的东西记进当前家庭库存 */
  async 'stock-it'(el) {
    const name = el.dataset.name;
    const parts = (el.dataset.parts || '').split('|').filter(Boolean);
    const { quantity, unit } = guessAmount(parts);
    let category = '其他';
    if (S.presets && S.presets.presets) {
      const hit = S.presets.presets.find((p) => p.name === name);
      if (hit) category = hit.category;
    }
    await api('POST', '/api/pantry', {
      householdId: S.householdId,
      name,
      category,
      quantity,
      unit,
      expireAt: '',
      note: '从买菜清单入库',
    });
    await loadState(true);
    render();
    toast(`已入库：${name} ${fmtQty(quantity)}${unit}`);
  },

  /* 设置 */
  'edit-settings'() {
    openSettings();
  },
  async 'save-settings'() {
    const v = (id) => $('#' + id).value.trim();
    const body = {
      shopName: v('setName'),
      welcome: v('setWelcome'),
    };
    // 口令只有两种改法：填了新值就换，或者勾「清除口令」彻底取消。
    // 留空 = 什么都不做（服务端认这个三态）。
    const pin = v('setPin');
    const clear = $('#setPinClear') && $('#setPinClear').checked;
    if (clear) body.clearAdminPin = true;
    else if (pin) body.adminPin = pin;
    try {
      await api('PUT', '/api/settings', body);
    } catch (err) {
      toast('保存失败：' + err.message);
      return;
    }
    // 换了口令服务端会作废所有会话，这里跟着重新解锁一次免得下一步就 401
    if (clear) {
      setAuthToken('');
      S.authed = true;
    } else if (pin) {
      const r = await api('POST', '/api/auth', { pin }).catch(() => null);
      setAuthToken(r && r.token ? r.token : '');
      S.authed = !!(r && r.token);
    }
    closeSheet();
    await loadState(true);
    render();
    toast('设置已保存');
  },
  unlock() {
    promptPin();
  },

  /* 对话式 AI：底部悬浮窗 */
  'chat-toggle'() {
    if (S.chatOpen) closeChat();
    else openChat();
  },
  'chat-collapse'() {
    closeChat();
  },
  async 'chat-chip'(el) {
    await sendChat(el.dataset.q);
  },
  'chat-clear'() {
    S.chatTurns = [];
    S.chatDot = false;
    redrawChat();
    toast('对话已清空');
  },
  'chat-run'(el) {
    return runChatAction(Number(el.dataset.t), Number(el.dataset.a));
  },
  'chat-dismiss'(el) {
    const t = S.chatTurns[Number(el.dataset.t)];
    const a = t && t.actions && t.actions[Number(el.dataset.a)];
    if (!a || a.state === 'busy') return;
    a.state = 'skipped';
    a.done = '没有执行';
    redrawChat();
  },
  'chat-view'(el) {
    const d = dishById(el.dataset.d);
    if (!d) return toast('这道菜已经不在菜单里了');
    openDish(d.id);
  },
  /* 数据 */

  /**
   * 把服务端返回的附件存到本地。
   * window.open / <a download> 带不了 X-Auth-Token，只能 fetch 下来再存。
   */
  async saveAttachment(url, fallbackName) {
    const t = authToken();
    const res = await fetch(url, t ? { headers: { 'X-Auth-Token': t } } : undefined);
    if (res.status === 401) {
      setAuthToken('');
      S.authed = false;
      toast('需要管理口令，请先解锁');
      promptPin();
      throw new Error('需要管理口令');
    }
    if (!res.ok) {
      let msg = `下载失败(${res.status})`;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (_) {
        /* 不是 JSON 就算了 */
      }
      throw new Error(msg);
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  async 'export-data'() {
    // 备份文件里含口令明文 + 照片，所以服务端要求认证
    try {
      await this.saveAttachment('/api/export', 'menu-backup.zip');
      toast('备份已下载（含照片）');
    } catch (err) {
      if (err.message !== '需要管理口令') toast('导出失败：' + err.message);
    }
  },

  async 'backup-now'() {
    try {
      const r = await api('POST', '/api/backups');
      await loadBackups();
      render();
      toast(`已存一份：${r.name}`);
    } catch (err) {
      toast('备份失败：' + err.message);
    }
  },

  async 'restore-latest'() {
    const b = S.backups;
    const latest = b && b.list && b.list[0];
    if (!latest) return toast('还没有自动备份');
    // 回退会丢掉「这一份备份之后」的所有改动，弹窗里必须说清楚是哪一份
    if (
      !confirm(
        `回到最近一次自动备份（${latest.name.slice(8, 12)} ${latest.name.slice(14, 16)}:${latest.name.slice(16, 18)} 前后）。\n\n` +
          `这之后录入的菜、改的点餐、库存变动都会没掉。\n` +
          `（服务端会先给当前状态再自动存一份，回退错了还能退回去。）\n\n确定回退？`
      )
    ) {
      return;
    }
    try {
      const r = await api('POST', '/api/backups/' + encodeURIComponent(latest.name) + '/restore');
      await loadBackups();
      await loadState(true);
      S.view = 'menu';
      render();
      toast(`已回退：菜谱 ${r.dishes} 道${r.written ? `，照片 ${r.written} 张` : ''}`);
    } catch (err) {
      toast('回退失败：' + err.message);
    }
  },
  'import-data'() {
    $('#importFile').click();
  },

  'close-sheet'() {
    // 走守卫：填了一半也走这里，草稿照样存下来
    requestCloseSheet();
  },
};

/* 口令 */
function promptPin() {
  openSheet({
    title: '请输入管理口令',
    body: `<input class="input" id="pinInput" type="password" inputmode="numeric" placeholder="口令" />`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="check-pin">进入</button>`,
  });
  $('#pinInput').focus();
}

ACTIONS['check-pin'] = async function () {
  const el = $('#pinInput');
  if (!el) return;
  const v = el.value.trim();
  try {
    const r = await api('POST', '/api/auth', { pin: v });
    setAuthToken(r.token || '');
    S.authed = true;
    closeSheet();
    render();
    toast('已解锁');
  } catch (err) {
    toast(err.message || '口令不对');
    el.value = '';
    el.focus();
  }
};

/* 事件绑定 */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el)).catch((err) => toast('出错了：' + err.message));
});

/* 编辑器里的输入同步 */
document.addEventListener('input', (e) => {
  const el = e.target;
  const act = el.dataset && el.dataset.act;
  if (!act || !S.draft) return;
  const i = Number(el.dataset.i);
  const j = Number(el.dataset.j);
  const m = S.draft.dish.methods[i];
  if (act === 'season-name') S.draft.dish.seasonings[i].name = el.value;
  else if (act === 'season-amt') S.draft.dish.seasonings[i].amount = el.value;
  else if (act === 'method-name' && m) m.name = el.value;
  else if (act === 'method-steps' && m) m.steps = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
  else if (act === 'mseason-name' && m && m.seasonings[j]) m.seasonings[j].name = el.value;
  else if (act === 'mseason-amt' && m && m.seasonings[j]) m.seasonings[j].amount = el.value;
});

/* 搜索输入 */
document.addEventListener('input', (e) => {
  if (e.target.id === 'searchInput') {
    S.keyword = e.target.value.trim();
    render();
  }
  if (e.target.id === 'fPresetSearch') renderPresetGrid();
});

/* 悬浮窗里的输入框回车就发（form 自带，不用再单独挂 keydown） */
document.addEventListener('submit', (e) => {
  const f = e.target.closest && e.target.closest('#chatForm');
  if (!f) return;
  e.preventDefault();
  const inp = $('#chatInput');
  if (inp && inp.value.trim()) sendChat(inp.value);
});

/* 改分类时，常见食材快选跟着换 */
document.addEventListener('change', (e) => {
  if (e.target.id === 'fFoodCat') renderPresetGrid();
});

/* 图片选择 */
document.addEventListener('change', async (e) => {
  if (e.target.id === 'fImgFile') {
    const files = [...e.target.files];
    e.target.value = ''; // 清空，方便再次选择同一个文件
    if (!files.length || !S.draft) return;
    toast('图片处理中…', 6000);
    for (const f of files) {
      try {
        const dataUrl = await compressImage(f);
        const { url } = await api('POST', '/api/upload', { dataUrl });
        S.draft.dish.images.push(url);
      } catch (err) {
        toast('图片上传失败：' + err.message);
      }
    }
    redrawImages();
    toast('图片已添加');
  }

  if (e.target.id === 'fAiImgFile') {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    await recognizeDishFromImage(f);
  }

  if (e.target.id === 'importFile') {
    const f = e.target.files[0];
    if (!f) return;
    if (!confirm('恢复备份会覆盖当前全部菜单、分类、点餐记录和库存照片，确定继续？')) {
      e.target.value = '';
      return;
    }
    try {
      // 原样上传：zip 就让服务端解，老的纯 JSON 也能收（服务端按字节嗅探）
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await api('POST', '/api/import', bytes, 'application/octet-stream');
      S.authed = true;
      await loadState(true);
      S.view = 'menu';
      render();
      const pics = r && r.written ? `，照片 ${r.written} 张` : '';
      toast(`备份已恢复：菜谱 ${r.dishes} 道${pics}`);
    } catch (err) {
      toast('恢复失败：' + err.message);
    }
    e.target.value = '';
  }
});

/* 菜品卡片、计划条目、点餐条目都能用键盘回车/空格打开菜谱 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card =
    e.target.closest &&
    e.target.closest(
      '.card[data-act="open-dish"], .plan-main[data-act="open-dish"],' +
        ' .order-main[data-act="open-dish"], .food-main[data-act="edit-food"]'
    );
  if (!card) return;
  e.preventDefault();
  if (card.dataset.act === 'open-dish') openDish(card.dataset.id);
  else ACTIONS['edit-food'](card);
});

/* 滚动方向控制悬浮按钮显隐 */
let lastScrollY = 0;
window.addEventListener(
  'scroll',
  () => {
    const fab = $('.fab');
    if (!fab) return;
    const y = window.scrollY;
    const down = y > lastScrollY && y > 90;
    const up = y < lastScrollY - 4 || y < 40;
    if (down) fab.classList.add('fab-hide');
    else if (up) fab.classList.remove('fab-hide');
    lastScrollY = y;
  },
  { passive: true }
);

/* 启动 */
loadAIStatus(); // 和 loadState 并行，不阻塞首屏
loadVersion(); // 版本信息同理，拉不到也不影响使用
loadBackups(); // 自动备份列表同理
loadState();