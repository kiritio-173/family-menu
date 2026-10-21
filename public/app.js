/* =========================================================
   家庭菜单 · 前端
   ========================================================= */

'use strict';

/* ---------------- 状态 ---------------- */

const S = {
  view: 'home',
  category: '全部',
  dishScope: 'all', // 菜单归属筛选：all / shared / own
  keyword: '',
  orderStatus: 'pending',
  groupByMember: true,
  memberFilter: '',
  pantryCat: '全部',
  pantryFilter: 'all', // all | soon | expired
  shoppingGroups: {}, // 采购分类折叠状态：{ 调料: false }
  pantryGroups: {}, // 库存分类折叠状态：{ 蔬菜: false }
  pick: '', // 正在多选哪个区域：'' | pantry | orders | plan | dishes | notes
  sel: {}, // 各区域勾中的 id：{ [区域]: Set }
  noteSticker: '', // 写留言时挑的贴纸
  shopList: [], // 当前页面渲染出来的那张买菜清单，批量入库时要用
  shopContext: null, // 当前清单来源：计划入库需要带周次，点餐页则为空
  stocking: new Set(), // 正在提交的库存项目，阻止快速重复点击
  planShopSelected: new Set(), // 计划采购仅用于当前周的批量操作选择
  planShopSelectionWeek: '',
  orderPickSel: new Set(), // 点餐弹层里勾中的几道菜
  planPickSel: new Set(), // 计划弹层里勾中的几道菜
  planPickWeek: '', // 计划弹层是给哪一周开的
  planWeek: '', // 正在看的周（周一日期），空 = 本周
  authed: false, // 是否已解锁管理区（没设口令时恒为 true）
  cookPlanText: '', // 厨房助手结果的纯文本版，给「复制」用
  version: null, // /api/version 的结果，管理页显示版本和更新内容
  backups: null, // /api/backups 的结果，管理页显示自动备份状态
  access: [], // 加入申请（/api/join-requests），管理页审批、管理员之外的人看自己的状态
  householdId: '', // 当前家庭，存在本机 localStorage：每台设备各选各的
  meName: '', // 「我是谁」；没认领过就是 GUEST，不替任何人冒名
  whoamiStep: '', // 向导停在哪一步（'' = 不显示）：house / member / pin
  whoamiPick: '', // 向导里选中的成员 id，正要给它设/输 PIN
  whoamiFrom: '', // 是从哪儿点进来的（note-me / meBtn），回头好退回去
  verifiedToken: '', // 刚验过成员密码换来的 5 分钟凭证，只在内存里
  verifiedExp: 0, // 到期时间戳，过期就不发了
  noteReplyTo: '', // 正在回复哪条留言的 id（空 = 只是新建一条）
  data: {
    categories: [], dishes: [], orders: [], settings: {},
    households: [], pantry: [], ingredients: [], pantryCategories: [], plans: [], shoppingStatus: { householdId: '', items: {} },
    notes: { notes: [], votes: {} },
  },
  presets: null, // 食材预设，按需从 /api/ingredient-presets 拉一次
  draft: null, // 菜品编辑草稿
  draftOrder: null, // 点餐草稿
  shoppingChecked: new Set(),
  loading: true,
  // 全局账户会话。账户令牌与超级管理员令牌分开保存，切换家庭不会丢失身份。
  accountToken: '',
  account: null,
  accountView: 'login', // login | register
  accountBusy: false,
  manageKeyword: '',
  manageGroups: { family: true, menu: true, system: true },
  randomFilters: null,
  batchImport: [], // 图片批量识别后等待用户审核的菜谱草稿
  batchExportSel: new Set(), // 批量导出图片时选中的菜品
};

/** 老的 households.json 还没建时，历史数据都落在 h_home 上 */
const FALLBACK_HOUSE = 'h_home';
const LS_HOUSE = 'familyMenu.householdId';
const LS_CONTEXT = 'familyMenu.context';
const LS_ACCOUNT = 'familyMenu.accountToken';
const LS_CLIENT_DEVICE = 'familyMenu.clientDeviceId';
const LS_MEMBER = 'familyMenu.memberIds';
// 走过一次「你是谁」向导就别再拦着人家。设备级的，不跟家庭走 ——
// 认领过 A 家再切到 B 家，B 家没登记过还得再问一次，那是对的。
const LS_ONBOARD = 'familyMenu.onboarded';
// 已经报过名、还没被批的人的名字。批下来之前他还不是成员，没有成员 id 可认，
// 但也没必要让他在顶栏显示成「还没登记」—— 那看着像谁都不认识他。
const LS_PENDING = 'familyMenu.pendingNames';
// 「先随便看看」的人用的占位名。不是任何人的真名，所以不会冒名。
const GUEST = '还没登记';

function accountToken() {
  return S.accountToken || localStorage.getItem(LS_ACCOUNT) || '';
}

// 家庭选择只是当前账户的界面上下文，按账户隔离保存；它不能成为设备身份。
function householdStorageKey() {
  const u = accountUser();
  const uid = u && (u.id || u.userId);
  return uid ? `${LS_HOUSE}.${uid}` : LS_HOUSE;
}

function selectedHouseholdId() {
  return localStorage.getItem(householdStorageKey()) || '';
}

function saveSelectedHousehold(id) {
  const key = householdStorageKey();
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
}

function contextStorageKey() {
  const u = accountUser();
  const uid = u && (u.id || u.userId);
  return uid ? `${LS_CONTEXT}.${uid}` : '';
}

function loadAccountContext() {
  const key = contextStorageKey();
  if (!key) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveAccountContext() {
  const key = contextStorageKey();
  if (!key) return;
  const ctx = {
    householdId: S.householdId || '',
    view: S.view || 'home',
    dishScope: S.dishScope || 'all',
    category: S.category || '全部',
    keyword: S.keyword || '',
    planWeek: S.planWeek || '',
    pantryFilter: S.pantryFilter || 'all',
    pantryCat: S.pantryCat || '全部',
    shoppingGroups: S.shoppingGroups || {},
    pantryGroups: S.pantryGroups || {},
    manageKeyword: S.manageKeyword || '',
    manageGroups: S.manageGroups || { family: true, menu: true, system: true },
  };
  localStorage.setItem(key, JSON.stringify(ctx));
}

function clientDeviceId() {
  let id = localStorage.getItem(LS_CLIENT_DEVICE) || '';
  if (!id) {
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') || `${Date.now()}-${Math.random()}`;
    localStorage.setItem(LS_CLIENT_DEVICE, id);
  }
  return id;
}

function setAccountToken(token) {
  S.accountToken = token || '';
  if (token) localStorage.setItem(LS_ACCOUNT, token);
  else localStorage.removeItem(LS_ACCOUNT);
}

function accountUser() {
  return S.account && (S.account.user || S.account) || null;
}

function accountFamilies() {
  const a = S.account || {};
  const list = a.households || a.families || a.memberships || a.data?.households;
  // 账户登录后，家庭关系由服务端单独返回；公开目录不能冒充“我的家庭”。
  return Array.isArray(list) ? list : [];
}

function accountHouseholdCount() {
  const u = accountUser();
  const uid = u && (u.id || u.userId);
  const a = S.account || {};
  const fromAccount = a.households || a.families || a.memberships;
  if (Array.isArray(fromAccount)) return fromAccount.length;
  if (uid) return households().filter((h) => (h.members || []).some((m) => typeof m !== 'string' && (m.userId === uid || m.id === uid))).length;
  return households().length;
}

function hasAccount() {
  return !!accountToken();
}

function accountRoleFor(h) {
  if (!h) return 'member';
  return h.role || h.memberRole || h.membership?.role || (h.owner ? 'owner' : 'member');
}

function superExpiry() {
  const raw = S.account && (S.account.superExpiresAt || S.account.superExp || S.account.authExpiresAt);
  return Number(raw) || 0;
}

function superRemainingText() {
  const left = superExpiry() - Date.now();
  if (left <= 0) return '';
  const mins = Math.ceil(left / 60000);
  if (mins < 60) return `约 ${mins} 分钟`;
  return `约 ${Math.ceil(mins / 60)} 小时`;
}

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

/* =========================================================
   菜单归属：共享菜 + 本家私菜
   ------------------------------------------------------------
   householdId 为空 = 共享，全体家庭都看得见；
   有值 = 只属于那一家，别人家看不到也搜不到。
   升级前的老数据没有这个字段，一律当共享 —— 升级后跟以前一模一样。
   ========================================================= */

function canSee(ownerId) {
  // 未选择家庭时只能浏览共享内容，不能因为“随便看看”而看到任何家庭的私菜。
  return !ownerId || (!!S.householdId && ownerId === S.householdId);
}

/** 这道菜 / 这个分类是不是「只有本家看得见」 */
function isPrivate(o) {
  return !!(o && o.householdId);
}

/** 私有东西在列表上的角标，不然用户会纳闷「这道菜别人家怎么没有」 */
function ownTag(o) {
  return isPrivate(o) ? `<span class="pill-own" title="只有本家看得见">🔒 仅本家</span>` : '';
}

/** 当前家庭看得见的全部菜品（还没套分类 / 搜索筛选） */
function scopeDishes() {
  return menuProjection();
}

/**
 * 菜单页和管理页共用的唯一菜品投影。任何页面都先从这里取当前家庭可见
 * 的菜品，再叠加自己的展示筛选，避免两页各自拼出不同的名称或归属。
 */
function menuProjection(options) {
  const o = options || {};
  let list = (S.data.dishes || []).filter((d) => canSee(d.householdId));
  if (o.scope === 'shared') list = list.filter((d) => !d.householdId);
  if (o.scope === 'own') list = list.filter((d) => !!d.householdId);
  if (o.category && o.category !== '全部') list = list.filter((d) => d.category === o.category);
  if (o.keyword) list = list.filter((d) => matchKeyword(d, o.keyword));
  if (o.sort) {
    list = [...list].sort((a, b) =>
      String(a.category || '').localeCompare(String(b.category || ''), 'zh') ||
      String(a.name || '').localeCompare(String(b.name || ''), 'zh')
    );
  }
  return list;
}

/**
 * 同名折叠：共享里有这道，就只露共享那份。
 *
 * 为什么共享优先：共享菜是管理员维护的、全家共用的那一版，改一次全家受益；
 * 私房那版是某个人自己的一手菜。菜名一样时并排放两张卡，等于让人对着两道
 * 长得一样的菜猜哪道是真的 —— 所以只留共享的，把私房那份收起来。
 *
 * 折叠不是删除：被收起来的那几道还完整地在「🔒 我家私房」里，展开就看得见。
 * 万一有人就是想留一版自己的（比如自己的辣度），那里进得去。
 */
function sameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

/** 按归属过滤：全部 / 只有共享 / 只有本家私房 */
function byScope(list, scope) {
  if (scope === 'shared') return list.filter((d) => !d.householdId);
  if (scope === 'own') return list.filter((d) => !!d.householdId);
  return list;
}

/**
 * 折叠同名菜。返回 [{ dish, folded: [被折叠的那些] }]
 * 「我家私房」那个视角不做折叠 —— 那本来就是来看自己那几道的。
 */
function collapseDupes(list, scope) {
  if (scope === 'own') return list.map((d) => ({ dish: d, folded: [] }));
  const shared = new Map();
  for (const d of list) {
    if (!d.householdId) {
      const k = sameKey(d.name);
      if (!shared.has(k)) shared.set(k, d);
    }
  }
  const out = [];
  const foldedByKey = new Map();
  for (const d of list) {
    if (d.householdId) {
      const k = sameKey(d.name);
      const s = shared.get(k);
      if (s) {
        if (!foldedByKey.has(k)) foldedByKey.set(k, []);
        foldedByKey.get(k).push(d);
        continue;
      }
    }
    out.push({ dish: d, folded: [] });
  }
  for (const item of out) item.folded = foldedByKey.get(sameKey(item.dish.name)) || [];
  return out;
}

/** 有多少道同名菜被折叠了 —— 给「展开」提示用 */
function foldedCount(items) {
  return items.reduce((n, i) => n + i.folded.length, 0);
}

/**
 * 改一道菜 —— 按权限走不同端点。
 *
 * 两端的守卫是一样的（都走服务端的 canWrite），区别只在裸接口不认成员令牌。
 * patch 里只需要给要改的字段，归属不在其中时原样带过去。
 */
async function saveDishBody(dish, patch) {
  const body = { ...dish, ...patch };
  if (isHouseAdmin(dish.householdId) || !dish.householdId) {
    await api('PUT', `/api/dishes/${encodeURIComponent(dish.id)}`, body);
    return body;
  }
  return api(
    'PUT',
    `/api/my-dishes/${encodeURIComponent(dish.id)}?householdId=${encodeURIComponent(S.householdId)}`,
    body
  );
}

/* ---------------- 谁能改什么（三层身份） ----------------
   三种凭证各管一段，服务端收到请求后按同样的顺序重算一遍：

     超级管理员  全局口令换的会话   管所有家庭 + 共享菜单 + 系统设置/AI/备份
     家庭管理员  某个家的口令换的   管共享菜单 + 本家所有私菜 + 本家成员
     普通成员    成员 PIN 换的令牌   只能改「作者是自己」的那些

   这一层的用途只有一个：别让界面亮出按下去必然报错的按钮。
   真的能不能改，以服务端为准 —— 前端说能不代表能。 */

/** 超级管理员。没设全局口令时一律算 —— 保持「装了就能用」。 */
function isSuper() {
  if (S.authed && superExpiry() && superExpiry() <= Date.now()) {
    S.authed = false;
    setAuthToken('');
  }
  return hasAccount() ? !!S.authed : !S.data.settings.hasPin || S.authed;
}

/** 家庭管理员只由当前账户在家庭成员关系中的 owner 角色决定。 */
function isHouseAdmin(householdId, member) {
  if (isSuper()) return true;
  if (!householdId) return false;
  const h = households().find((x) => x.id === householdId);
  if (!h) return false;
  const me = member || memberOf(householdId);
  return !!me && me.role === 'owner';
}

/** 至少管着一家 —— 决定能不能碰共享菜单、能不能改点餐状态、能不能建/删家庭 */
function anyHouseAdmin() {
  if (isSuper()) return true;
  return households().some((h) => {
    const me = memberOf(h.id);
    return !!me && me.role === 'owner';
  });
}

/** 我是不是这家的成员（不管是不是管理员） */
function isMemberOf(householdId) {
  return householdId === S.householdId && !!meMember();
}

/** 能不能往共享菜单里加东西 */
function canWriteShared() {
  return anyHouseAdmin();
}

function newDishHouseholdId() {
  if (S.dishScope === 'own' && S.householdId) return S.householdId;
  if (canWriteShared()) return null;
  return S.householdId || null;
}

/**
 * 这道菜 / 这个分类能不能改、能删。
 *
 * 共享的：任意管理员。自家的：管理员随便改，普通成员只能动作者是自己的。
 * 查不到作者的（老数据没记 authorId）放开 —— 宁可让人改一条，
 * 也不把主人锁在自己家门外。跟服务端 canWrite 是同一套规则。
 */
function canEdit(o) {
  if (!o) return false;
  if (!o.householdId) {
    if (isSuper()) return true;
    const uid = accountUser() && (accountUser().id || accountUser().userId);
    return !!(uid && o.authorUserId && o.authorUserId === uid);
  }
  const me = memberOf(o.householdId);
  if (!me || o.householdId !== S.householdId) return false;
  if (isSuper()) return true;
  const uid = accountUser() && (accountUser().id || accountUser().userId);
  if (o.authorUserId && uid) return o.authorUserId === uid;
  return !!(o.authorId && o.authorId === me.id);
}

/** 这个人的身份在界面上叫什么 —— 顶栏、菜品作者、报错提示都用它 */
function myRole() {
  if (isSuper()) return 'super';
  if (isHouseAdmin(S.householdId)) return 'house';
  if (meMember()) return 'member';
  return 'guest';
}

const ROLE_LABEL = { super: '超级管理员', house: '家庭管理员', member: '普通成员', guest: '还没登记' };

/** 这道菜是谁写的 —— 作者没了就明说「不知道谁写的」，不瞎编 */
function dishAuthor(d) {
  if (!d.authorName) return d.householdId ? '不知道谁加的' : '不知道谁加的（老数据）';
  return d.authorName;
}

/** 不能改的共享菜上，改挂这个按钮 */
function adoptBtn(d, cls) {
  if (!d || d.householdId || !S.householdId) return '';
  // 收进我家只能落到当前已加入的家庭；超级管理员在当前选定家庭中也可代办。
  if (!isMemberOf(S.householdId) && !isHouseAdmin(S.householdId)) return '';
  if ((S.data.dishes || []).some((item) => item.householdId === S.householdId && item.copySourceDishId === d.id)) {
    return `<button class="${cls || 'btn ghost'}" disabled>已收进我家</button>`;
  }
  return `<button class="${cls || 'btn ghost'}" data-act="adopt-dish" data-id="${esc(d.id)}">👇 收进我家</button>`;
}

function copyToSharedBtn(d, cls) {
  if (!d || !d.householdId || d.householdId !== S.householdId || !isHouseAdmin(d.householdId)) return '';
  if ((S.data.dishes || []).some((item) => !item.householdId && item.copySourceDishId === d.id)) {
    return `<button class="${cls || 'btn ghost'}" disabled>已添加到共享</button>`;
  }
  return `<button class="${cls || 'btn ghost'}" data-act="copy-dish-to-shared" data-id="${esc(d.id)}">＋ 添加到共享</button>`;
}

function canManageDishStatus(d) {
  if (!d) return false;
  return d.householdId ? isHouseAdmin(d.householdId) : canWriteShared();
}

function dishStatusTag(d) {
  return d && d.dishStatus === 'paused'
    ? '<span class="tag own" title="暂停供应，暂时不能新建点餐">⏸ 暂停供应</span>'
    : '<span class="tag" title="正常供应">✓ 正常供应</span>';
}

function dishStatusAction(d) {
  if (!canManageDishStatus(d)) return '';
  const paused = d.dishStatus === 'paused';
  return `<button class="ib ${paused ? 'on' : ''}" data-act="toggle-dish-status" data-id="${esc(d.id)}" title="${paused ? '恢复供应' : '暂停供应'}">${paused ? '▶ 恢复供应' : '⏸ 暂停供应'}</button>`;
}

/** 当前家庭看得见的分类，按 order 排 */
function sortedCategories() {
  return (S.data.categories || [])
    .filter((c) => canSee(c.householdId))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
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
  return S.householdId ? list.find((h) => h.id === S.householdId) || null : null;
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

function householdIngredients(id) {
  const hid = id || S.householdId;
  return (S.data.ingredients || []).filter((ingredient) => ingredient.householdId === hid);
}

function householdPantryCategories(id) {
  const hid = id || S.householdId;
  const roots = PANTRY_ORDER.map((name, index) => ({ id: `pantry-root-${index + 1}`, name, householdId: null, parentId: null, builtin: true }));
  return roots.concat((S.data.pantryCategories || []).filter((category) => category.householdId === hid));
}

function ingredientById(id, householdId) {
  return householdIngredients(householdId).find((ingredient) => ingredient.id === id) || null;
}

function ingredientByName(name, householdId) {
  const key = String(name || '').trim().toLocaleLowerCase();
  if (!key) return null;
  return householdIngredients(householdId).find((ingredient) =>
    ingredient.name.toLocaleLowerCase() === key || (ingredient.aliases || []).some((alias) => alias.toLocaleLowerCase() === key)) || null;
}

function pantryCategoryPath(category, categories) {
  const list = categories || householdPantryCategories();
  const parts = [];
  let current = list.find((item) => item.id === category);
  while (current) {
    parts.unshift(current.name);
    current = list.find((item) => item.id === current.parentId);
  }
  return parts.join(' > ');
}

function ingredientNameDatalist(id) {
  const options = householdIngredients().flatMap((ingredient) => [ingredient.name, ...(ingredient.aliases || [])]);
  return `<datalist id="${esc(id)}">${[...new Set(options)].map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
}

function ingredientCategoryOptions(selectedId) {
  const categories = householdPantryCategories();
  return categories.map((category) => {
    const path = pantryCategoryPath(category, categories);
    return path ? `<option value="${esc(category.id)}" ${category.id === selectedId ? 'selected' : ''}>${esc(path)}</option>` : '';
  }).join('');
}

function openQuickIngredientCreator(dish) {
  if (!dish.householdId) return toast('先把菜品可见范围切换为「仅本家」，才能关联家庭原料');
  S.quickIngredientDraft = dish;
  const defaultCategory = householdPantryCategories().find((category) => category.name === '其他');
  openSheet({
    title: '新建家庭原料',
    body: `<div class="field"><label class="field-label">原料名称 *</label><input class="input" id="quickIngredientName" placeholder="例如：牛里脊" /></div>
      <div class="field"><label class="field-label">分类</label><select class="select" id="quickIngredientCategory">${ingredientCategoryOptions(defaultCategory && defaultCategory.id)}</select></div>
      ${isHouseAdmin(S.householdId) ? `<div class="field"><label class="field-label">新增子分类 <span class="field-hint">可选；分类仅归类，不会合并不同原料</span></label>
        <input class="input" id="quickIngredientChild" placeholder="留空则使用上面的分类" /></div>` : ''}
      <div class="field"><label class="field-label">默认库存方式</label><select class="select" id="quickIngredientMode"><option value="quantity">按数量</option><option value="presence">只记录有 / 没有</option></select></div>
      <div class="field"><label class="field-label">参考单位 <span class="field-hint">数量管理时使用</span></label><input class="input" id="quickIngredientUnit" list="unitList" placeholder="g、个、份…" /><datalist id="unitList">${UNITS.map((unit) => `<option value="${esc(unit)}"></option>`).join('')}</datalist></div>`,
    foot: '<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="save-quick-ingredient">保存原料</button>',
    onMount() { $('#quickIngredientName')?.focus(); },
  });
}

/** 当前家庭某一周的计划条目（找不到就是空数组） */
function planItems(weekOf, id) {
  const hid = id || S.householdId;
  const wk = mondayOf(weekOf);
  const plan = (S.data.plans || []).find((p) => p.householdId === hid && p.weekOf === wk);
  return plan ? plan.items : [];
}

function planRecord(weekOf, id) {
  const hid = id || S.householdId;
  const wk = mondayOf(weekOf);
  return (S.data.plans || []).find((p) => p.householdId === hid && p.weekOf === wk) || null;
}

function planItemDate(it, weekOf) {
  const week = mondayOf(weekOf);
  const raw = it && it.plannedFor ? String(it.plannedFor).slice(0, 10) : week;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && mondayOf(raw) === week ? raw : week;
}

function planDayLabel(date, weekOf) {
  const week = mondayOf(weekOf);
  const offset = Math.round((parseDay(date) - parseDay(week)) / 86400000);
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return `${names[Math.max(0, Math.min(6, offset))]} ${date.slice(5)}`;
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
        ? {
            id: 'legacy_' + i,
            name: m,
            loginId: m,
            emoji: ['🙋', '👩', '👨', '👧', '👦'][i % 5],
            role: 'member',
          }
        : {
            id: m.id || 'm_' + i,
            userId: m.userId || m.userID || '',
            name: m.name,
            loginId: m.loginId || m.name,
            emoji: m.emoji || '🙋',
            role: m.role || 'member',
          }
    )
    .filter((m) => m.name);
}

function memberByName(name) {
  return memberList().find((m) => m.name === name) || null;
}

function memberById(id) {
  return memberList().find((m) => m.id === id) || null;
}

function memberEmoji(name) {
  const m = memberByName(name);
  return m ? m.emoji : '👤';
}

/* ---------------- 留言板 / 菜品互动 ---------------- */

const REACT_EMOJI = ['👍', '❤️', '😂', '😋', '🙏', '🔥'];
const STICKER_EMOJI = ['🍳', '🛒', '🌶️', '🍚', '🎉', '⚠️', '💤', '🧊'];

function allNotes() {
  const b = S.data.notes;
  return (b && Array.isArray(b.notes) ? b.notes : []).slice();
}

/** 留言板上的留言：当前家庭、不是菜品留言 */
function boardNotes() {
  return allNotes().filter((n) => n.kind !== 'dish' && n.householdId === S.householdId);
}

/** 某道菜下面的留言 */
function dishNotes(dishId) {
  return allNotes().filter((n) => n.kind === 'dish' && n.dishId === dishId);
}

function noteById(id) {
  return allNotes().find((n) => n.id === id) || null;
}

/** 这道菜的「想吃 / 我来做」投票 */
function dishVote(dishId) {
  const v = S.data.notes && S.data.notes.votes;
  const hit = v && v[dishId];
  return { want: (hit && hit.want) || [], cook: (hit && hit.cook) || [] };
}

/**
 * 认领过的身份：{ 家庭id: 成员id }
 *
 * 存的是**成员 id** 不是名字。名字会重名（爸爸和儿子都叫「小明」），
 * 服务端判「这道菜是不是你写的」也对的是 authorId，不是显示名。
 * 老版本存的是名字，读的时候顺手换成 id —— 换一次就干净了。
 */
function memberSelections() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_MEMBER) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
}

/** 老数据里的名字 → 当下的成员 id。找不到就是 null（不硬凑）。 */
function nameToMemberId(name) {
  const m = memberList().find((x) => x.name === name);
  return m ? m.id : '';
}

/** 当前家庭认领的是哪个成员（对象）；没认领 / 成员被删了都是 null */
function meMember() {
  const saved = S.householdId ? memberSelections()[S.householdId] : '';
  if (!saved) {
    const uid = accountUser()?.id || accountUser()?.userId;
    if (uid) {
      const linked = memberList().find((m) => m.userId === uid || m.id === uid);
      if (linked) {
        rememberMeId(linked.id);
        return linked;
      }
    }
    return null;
  }
  const byId = memberById(saved);
  if (byId) return byId;
  // 存的是老格式的名字，认到人就升级成 id
  const legacy = memberByName(saved);
  if (legacy) {
    rememberMeId(legacy.id);
    return legacy;
  }
  return null;
}

/**
 * 「我在**这一家**是谁」。
 *
 * 认领是按家记的：A 家的成员 id 在 B 家是没意义的。所以问别的家的时候
 * 必须显式说清楚是哪一家，答不上来就是 null —— 宁可少算一个管理员，
 * 也不能把「我在这家是管理员」张冠李戴到别的家去。
 */
function memberOf(householdId) {
  if (householdId && householdId !== S.householdId) return null;
  return meMember();
}

function meMemberId() {
  const m = meMember();
  return m ? m.id : '';
}

function rememberMeId(id) {
  if (!id || !S.householdId) return;
  const map = memberSelections();
  map[S.householdId] = id;
  localStorage.setItem(LS_MEMBER, JSON.stringify(map));
}

function forgetMeId() {
  const map = memberSelections();
  if (S.householdId) delete map[S.householdId];
  localStorage.setItem(LS_MEMBER, JSON.stringify(map));
  S.meName = '';
}

/**
 * 「我是谁」—— 显示用的名字。
 *
 * 以前这里是「猜」的：没选过身份就默认成成员列表里的第一个人。
 * 那意味着你妈在自己手机上发的留言，署的是户主的名字 —— 在留言板上看着
 * 像家里人在回话，其实是个从没登记过的人。现在没认领过就明说「还没登记」，
 * 不替任何人冒名。
 *
 * 认领过、但后来管理员把这个成员删了：不再自动写回一个假身份 ——
 * 身份认的是人，管理员那边的一次删除不该让你变成别人。
 */
function meName() {
  const m = meMember();
  const global = accountUser()?.displayName || accountUser()?.loginId || '';
  S.meName = m ? global || m.name : GUEST;
  return S.meName;
}

/** 这个人是登记过的成员，还是只是「先随便看看」 */
function isRegistered() {
  return !!meMember();
}

/**
 * 改不动的时候，说清楚是哪一条、归谁、谁能改。
 *
 * 一句「没权限」只会让人以为是程序坏了 —— 共享菜、本家别人的菜、
 * 还没认领身份，是三种完全不同的处境，给出的下一步也不一样。
 */
function denyWhy(o) {
  if (!o) return '这道菜已经不在了';
  if (!o.householdId) return '共享菜谱由管理员维护。想改成自己的版本，用「👇 收进我家」。';
  if (!meMember()) return '先在右上角认领身份，才知道哪些是你自己的菜。';
  if (o.authorId && o.authorId !== meMemberId()) {
    return `这道菜是「${o.authorName || '别人'}」加的，只有他本人和${householdName(o.householdId)}的管理员能改。`;
  }
  return `这道菜属于${householdName(o.householdId)}，得那个家的管理员才能改。`;
}

/** 这台设备走过一次「你是谁」没有 */
function onboarded() {
  return localStorage.getItem(LS_ONBOARD) === '1';
}

function markOnboarded() {
  localStorage.setItem(LS_ONBOARD, '1');
}

function forgetOnboard() {
  localStorage.removeItem(LS_ONBOARD);
}

/**
 * 首次进入要不要拦一下。
 *
 * 只有两种情况：这台设备从没走过向导；或者它记着的那个家庭已经不存在了
 * （被管理员删了、或者恢复过备份）。其余一律不打扰 ——
 * 一个人天天被问「你是谁」，比不问更烦。
 */
function needWhoami() {
  const list = households();
  if (!list.length) return false; // 一个家庭都没有，问了也白问
  if (!onboarded()) return true;
  const savedHouse = selectedHouseholdId();
  if (savedHouse && !list.some((h) => h.id === savedHouse)) {
    // 记着的家没了。别自作主张顶到 list[0] —— 那是另一个人的家，
    // 让人家以为自己进了别人家，看到不属于自己的点餐单。
    forgetOnboard();
    return true;
  }
  return false;
}

/**
 * 认领一个成员身份 —— 用登录 ID + 密码换这台设备的令牌（30 天滑动续期）。
 *
 * 这是整个权限体系的地基：称呼是公开信息，登录 ID 是本家唯一标识，密码才是凭证。
 * 服务端第一次收到某个成员的密码时是「设」，之后就是「验」。
 */
async function claimMember(memberId, loginId, password) {
  const data = await api('POST', '/api/claim', {
    householdId: S.householdId,
    memberId,
    loginId,
    password,
  });
  if (data && data.deviceToken) setDeviceToken(S.householdId, data.deviceToken);
  rememberMeId(memberId);
  clearPendingName();
  return data;
}

/** 申请已提交但还没批下来的人用的名字 */
function pendingName() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PENDING) || '{}');
    return (raw && raw[S.householdId]) || '';
  } catch (_) {
    return '';
  }
}

function rememberPendingName(name) {
  const next = String(name || '').trim();
  if (!next) return;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PENDING) || '{}');
    if (S.householdId) raw[S.householdId] = next;
    localStorage.setItem(LS_PENDING, JSON.stringify(raw));
  } catch (_) {
    /* 存不下就算了 */
  }
}

function clearPendingName() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PENDING) || '{}');
    if (S.householdId) delete raw[S.householdId];
    localStorage.setItem(LS_PENDING, JSON.stringify(raw));
  } catch (_) {
    /* 同上 */
  }
}

/** 顶栏上显示的名字：认领了用真名，申请中用报的名字，都没有就说没登记 */
function displayName() {
  const global = accountUser()?.displayName || accountUser()?.loginId || '';
  if (global && meMember()) return global;
  const m = meMember();
  if (m) return m.name;
  return pendingName() || GUEST;
}

/** 谁点过这个表情 —— 用来在 title 里念出来 */
function reactWho(list) {
  const names = (list || []).map((n) => memberByName(n) || { name: n, emoji: '👤' });
  return names.map((m) => m.emoji + m.name).join('、');
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
  if (!isSuper()) {
    toast('AI 助手由超级管理员使用');
    return null;
  }
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

// 家庭口令换来的会话。分家庭存：解了 A 家的锁不等于解了 B 家的。
const LS_HOUSE_AUTH = 'familyMenu.houseTokens';
function houseToken(householdId) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_HOUSE_AUTH) || '{}');
    return (raw && raw[householdId]) || '';
  } catch (_) {
    return '';
  }
}
function setHouseToken(householdId, t) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_HOUSE_AUTH) || '{}');
    if (t) raw[householdId] = t;
    else delete raw[householdId];
    localStorage.setItem(LS_HOUSE_AUTH, JSON.stringify(raw));
  } catch (_) {
    /* 存不下就算了，不该因此让整个页面打不开 */
  }
}

// 成员 PIN 换来的设备令牌（「登录一次，记住这台设备」）。
// 按家庭存：一个家认了身份，不代表在另一个家也认了 —— 成员名单是各家的。
const LS_DEVICE = 'familyMenu.deviceTokens';
function deviceToken(householdId) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DEVICE) || '{}');
    return (raw && raw[householdId]) || '';
  } catch (_) {
    return '';
  }
}
function setDeviceToken(householdId, t) {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DEVICE) || '{}');
    if (t) raw[householdId] = t;
    else delete raw[householdId];
    localStorage.setItem(LS_DEVICE, JSON.stringify(raw));
  } catch (_) {
    /* 同上 */
  }
}

async function api(method, path, body, rawContentType) {
  const opts = { method, headers: {} };
  opts.headers['X-Device-Id'] = clientDeviceId();
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
  const at = accountToken();
  if (at) opts.headers['X-Account-Token'] = at;
  // 当前家庭的两种凭证：家庭会话（解了本家管理锁）+ 设备令牌（认领了身份）
  const hh = S.householdId;
  if (hh) {
    const h = houseToken(hh);
    if (h) opts.headers['X-House-Token'] = h;
    const d = deviceToken(hh);
    if (d) opts.headers['X-Device-Token'] = d;
  }
  // 「刚验过密码」的凭证只放 5 分钟、只对危险动作有效，所以压根不落盘 ——
  // 关掉页面就没了，这正是我们要的。
  if (S.verifiedToken && Date.now() < S.verifiedExp) opts.headers['X-Verified-Token'] = S.verifiedToken;
  const res = await fetch(path, opts);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    throw new Error('服务器返回异常');
  }
  // 401 = 口令不对或会话过期。账户令牌失效时回登录页，避免继续显示旧家庭数据。
  if (res.status === 401) {
    setAuthToken('');
    S.authed = false;
    const msg = String(json.error || '');
    const accountEndpoint = /^\/api\/account\//.test(path) || /^\/api\/state(?:\?|$)/.test(path);
    const accountFailure = accountEndpoint || /账户|登录|账号令牌|account token|account session/i.test(msg);
    if (accountFailure && path !== '/api/account/login' && path !== '/api/account/register') {
      setAccountToken('');
      S.account = null;
      S.loading = false;
      S.view = 'menu';
      render();
    }
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败(${res.status})`);
  return json.data;
}

async function loadState(silent) {
  if (!hasAccount()) {
    S.loading = false;
    if (!silent) render();
    return null;
  }
  try {
    // 普通用户只请求当前家庭的数据；管理员会话由服务端自动返回全量状态。
    // 登录/刷新默认不选择家庭；只有本次会话里用户主动点击家庭后才带 householdId 请求。
    const savedHouse = S.householdId || '';
    // 账户令牌已经识别用户，不再读取设备级成员选择或成员密码。
    const savedMember = '';
    const query = new URLSearchParams();
    if (savedHouse) query.set('householdId', savedHouse);
    if (savedMember) query.set('memberName', savedMember);
    const data = await api('GET', `/api/state${query.toString() ? '?' + query.toString() : ''}`);
    S.data = data;
    if (data.account) S.account = data.account;
    if (S.account && (data.superExpiresAt || data.superExp || data.authExpiresAt)) {
      S.account.superExpiresAt = data.superExpiresAt || data.superExp || data.authExpiresAt;
    }
    const shoppingItems = data.shoppingStatus && data.shoppingStatus.items && typeof data.shoppingStatus.items === 'object'
      ? data.shoppingStatus.items
      : {};
    S.data.shoppingStatus = data.shoppingStatus || { householdId: '', items: {} };
    S.shoppingChecked = new Set(Object.entries(shoppingItems).filter(([, item]) => item && item.state === 'completed').map(([name]) => name));
    S.access = data.access && Array.isArray(data.access.requests) ? data.access.requests : [];
    // 没设全局口令 → 开放超级管理员模式；设了 → 看本机有没有有效会话
    if (!data.settings.hasPin) S.authed = true;
    else if (!authToken()) S.authed = false;
    // 当前家庭记在这台设备上：A 家选 301、B 家选 502，互不影响
    const list = households();
    if (!savedHouse || !list.some((h) => h.id === savedHouse)) S.householdId = '';
    if (S.householdId !== savedHouse) {
      saveSelectedHousehold(S.householdId);
    }
    saveAccountContext();
    meName();
    S.loading = false;
    // 全局账户已经完成身份识别，不再启动旧的「你是哪家的 / 你是谁」向导。
    S.whoamiStep = '';
    if (!silent) render();
  } catch (err) {
    S.loading = false;
    if (!hasAccount()) {
      if (!silent) render();
    } else if (!silent) {
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
let pendingStockInputResolve = null;

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
      'input[id], textarea[id], select[id], input[data-act="season-name"], input[data-act="season-amt"], select[data-act="season-type"], input[data-act="method-name"], textarea[data-act="method-steps"], input[data-act="mseason-name"], input[data-act="mseason-amt"], select[data-act="mseason-type"]'
    )
    .forEach((el) => {
      const k = el.id || `${el.dataset.act}:${el.dataset.i || ''}:${el.dataset.j || ''}`;
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
      'input[id], textarea[id], select[id], input[data-act="season-name"], input[data-act="season-amt"], select[data-act="season-type"], input[data-act="method-name"], textarea[data-act="method-steps"], input[data-act="mseason-name"], input[data-act="mseason-amt"], select[data-act="mseason-type"]'
    )
    .forEach((el) => {
      const k = el.id || `${el.dataset.act}:${el.dataset.i || ''}:${el.dataset.j || ''}`;
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
  if (pendingStockInputResolve) return closeSheet();
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
  cancelPinCheck(); // 密码弹层被关掉 = 放弃验证，别让等着的人永远挂着
  const pendingStock = pendingStockInputResolve;
  pendingStockInputResolve = null;
  const root = $('#modalRoot');
  root.hidden = true;
  root.innerHTML = '';
  document.body.style.overflow = '';
  sheetOnMount = null;
  sheetBaseline = null;
  sheetDraftKey = null;
  if (pendingStock) pendingStock(null);
}

/** 内置浏览器不支持原生 prompt，采购入库统一使用应用自己的弹层。 */
function askStockInput(name, defaultQty, defaultUnit) {
  return new Promise((resolve) => {
    pendingStockInputResolve = resolve;
    openSheet({
      title: `入库「${name}」`,
      body: `<div class="field">
          <label class="field-label" for="stockQty">实际购买数量</label>
          <input class="input" id="stockQty" type="number" min="0.001" step="any" inputmode="decimal" value="${esc(defaultQty)}" />
          <div class="field-hint">默认填入当前采购缺口，按实际买回的数量修改。</div>
        </div>
        <div class="field">
          <label class="field-label" for="stockUnit">单位</label>
          <input class="input" id="stockUnit" value="${esc(defaultUnit || '份')}" placeholder="个、袋、瓶、斤…" />
        </div>`,
      foot: `<button class="btn ghost" data-act="cancel-stock-input">取消</button>
             <button class="btn" data-act="confirm-stock-input">确认入库</button>`,
      onMount(root) {
        root.querySelector('#stockQty')?.focus();
        root.querySelector('#stockQty')?.select();
      },
    });
  });
}

function resolveStockInput(value) {
  const resolve = pendingStockInputResolve;
  pendingStockInputResolve = null;
  closeSheet();
  if (resolve) resolve(value);
}

document.addEventListener('click', (e) => {
  if (e.target === $('#modalRoot')) requestCloseSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modalRoot').hidden) requestCloseSheet();
});

/* =========================================================
   通用多选

   原来只有库存能做批量删除，选择状态也写死在 S.pantrySel 里。
   这里抽成通用的：每个「区域」一个 key（pantry / orders / plan / dishes），
   勾选集合放在 S.sel[key]，工具条统一由 pickBarHtml 渲染。

   一条铁律：**全选只针对「当前看得见的那批」**，不是整个区域。
   否则筛了「临期」再全选，就会出现「全选显示 10 样、删掉却是 12 样」。
   ========================================================= */

/** 各区域量词，用于确认弹窗里念名字（「删掉哪几样」） */
const PICK_UNIT = { pantry: '样', orders: '条', plan: '道', dishes: '道', notes: '条' };

function pickSel(key) {
  return S.sel[key] || (S.sel[key] = new Set());
}
function pickHas(key, id) {
  const s = S.sel[key];
  return !!(s && s.has(id));
}
function pickIds(key) {
  return [...(S.sel[key] || [])];
}
/** 当前多选模式下，哪些 id 是「看得见且勾中了」的 —— 算 N/M 和执行都用它 */
function pickVisibleSel(key, visibleIds) {
  const s = S.sel[key] || new Set();
  return visibleIds.filter((id) => s.has(id));
}
function picking(key) {
  return S.pick === key;
}
function pickOn(key) {
  S.pick = key;
  S.sel[key] = new Set();
  render();
}
function pickOff() {
  if (S.pick) S.sel[S.pick] = new Set();
  S.pick = '';
  render();
}
function pickToggle(key, id) {
  const s = pickSel(key);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  render();
}
function pickSetAll(key, visibleIds) {
  const s = pickSel(key);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => s.has(id));
  visibleIds.forEach((id) => (allOn ? s.delete(id) : s.add(id)));
  render();
}

/** 各区域「当前看得见」的那一批。全选和 已选 N/M 都以它为准，不会和列表对不上。 */
function pickVisibleIds(key) {
  if (key === 'pantry') return visiblePantryIds();
  if (key === 'orders') return visibleOrders().map((o) => o.id);
  if (key === 'plan') return planItems(planWeek()).map((it) => it.id);
  if (key === 'dishes') return manageDishRows().map((x) => x.id);
  if (key === 'notes') return boardNotes().map((n) => n.id);
  return [];
}

/** 点餐页当前真正列出来的那批（状态页签 + 成员筛选之后） */
function visibleOrders() {
  return householdOrders().filter(
    (o) => o.status === S.orderStatus && (!S.memberFilter || o.requester === S.memberFilter)
  );
}

/** 管理页「菜品管理」那一列的排序，渲染和多选必须用同一份 */
function manageDishRows() {
  return menuProjection({ sort: true });
}

/** 库存可选的分类：预设顺序在前，家里自建的在后 */
function pantryCategories() {
  const extra = [...new Set(householdPantry().map((p) => p.category))]
    .filter((c) => c && !PANTRY_ORDER.includes(c))
    .sort((a, b) => a.localeCompare(b, 'zh'));
  return PANTRY_ORDER.concat(extra);
}

/** 采购条目的分类：先看当前家庭库存，再看食材预设，最后归到其他。 */
function ingredientCategory(name, stock) {
  const rows = Array.isArray(stock) ? stock : findStock(name);
  const own = rows.find((p) => p && p.category && p.category !== '其他');
  if (own) return own.category;
  const key = ingredientMatchKey(name);
  const preset = S.presets && Array.isArray(S.presets.presets)
    ? S.presets.presets.find((p) => p && ingredientMatchKey(p.name) === key)
    : null;
  if (['盐', '糖'].includes(key)) return '调味干货';
  return (preset && preset.category) || (rows[0] && rows[0].category) || '其他';
}

/** 采购和库存共用的分类顺序；未知分类放到最后。 */
function categoryRank(name) {
  const i = PANTRY_ORDER.indexOf(name);
  return i < 0 ? PANTRY_ORDER.length : i;
}

function groupedByCategory(list, categoryFn) {
  const groups = new Map();
  (list || []).forEach((item) => {
    const category = categoryFn(item) || '其他';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });
  return [...groups.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0], 'zh'));
}

/** 进入多选的入口按钮 */
function pickOnBtn(key, label) {
  return `<button class="btn ghost sm" data-act="pick-on" data-k="${esc(key)}">${esc(label || '☑ 批量操作')}</button>`;
}

/**
 * 多选工具条。全选 / 已选 N / M / 批量动作 / 退出。
 * 没勾东西时批量按钮自动禁用；N 和 M 都取自当前看得见的那一批，跟列表永远对得上。
 */
function pickBarHtml(key, visibleIds, buttons) {
  const vis = pickVisibleSel(key, visibleIds);
  const allOn = visibleIds.length > 0 && vis.length === visibleIds.length;
  const dis = vis.length ? '' : 'disabled';
  return `<div class="pick-bar">
    <button class="btn ghost sm" data-act="pick-all" data-k="${esc(key)}">${allOn ? '☑ 全不选' : '☐ 全选'}</button>
    <span class="pick-count">${visibleIds.length ? `已选 ${vis.length} / ${visibleIds.length}` : '没有可选的'}</span>
    ${(buttons || [])
      .map(
        (b) =>
          `<button class="btn ${b.cls || 'ghost'} sm" data-act="${esc(b.act)}" data-k="${esc(key)}"${
            b.status ? ` data-status="${esc(b.status)}"` : ''
          } ${dis}>${esc(b.label)}</button>`
      )
      .join('')}
    <button class="btn ghost sm" data-act="pick-cancel">退出</button>
  </div>`;
}

/** 多选模式下的一行：整行变成一个可点的勾选框 */
function pickRowHtml(key, id, cls, inner) {
  const on = pickHas(key, id);
  return `<div class="${esc(cls)} pick ${on ? 'on' : ''}" role="checkbox" tabindex="0" aria-checked="${on}"
    data-act="pick-item" data-k="${esc(key)}" data-id="${esc(id)}" aria-label="选择 ${esc(PICK_LABEL_OF(key, id))}">
    <span class="pick-box">${on ? '✓' : ''}</span>
    ${inner}
  </div>`;
}

/** 勾选框的无障碍名字，得说清楚选中的是谁 */
function PICK_LABEL_OF(key, id) {
  const src =
    key === 'pantry'
      ? householdPantry()
      : key === 'orders'
      ? householdOrders()
      : key === 'plan'
      ? planItems(planWeek())
      : key === 'dishes'
      ? scopeDishes()
      : key === 'notes'
      ? allNotes()
      : [];
  const hit = src.find((x) => x.id === id);
  return hit ? hit.name || hit.dishName || hit.text || '' : '';
}

/** 确认弹窗里念名字：只念前三个，别刷屏 */
function pickPreview(names, unit) {
  return names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} ${unit}` : '');
}

/** 当前这张买菜清单里勾上了哪几样（点餐页和计划页是两张不同的单子） */
function shopItemsForScope(scope) {
  const list = S.shopList || [];
  if (scope === 'plan-purchase') return list.filter((it) => !it.isSeasoning);
  if (scope === 'plan-seasonings') return list.filter((it) => it.isSeasoning);
  return list;
}

function shopCheckedItems(scope) {
  const selected = activeShopChecks();
  return shopItemsForScope(scope).filter((it) => selected.has(it.name));
}

function activeShopChecks() {
  return S.shopContext && S.shopContext.kind === 'plan' ? S.planShopSelected : S.shoppingChecked;
}

/** 「已买」的勾要存到服务端，刷新页面才不会丢 */
async function saveShoppingChecked() {
  if (!S.householdId) return;
  const items = (S.shopList || []).map((it) => ({
    name: it.name,
    state: S.shoppingChecked.has(it.name) ? 'completed' : 'needed',
  }));
  const data = await api('PUT', '/api/shopping-status', { householdId: S.householdId, items });
  S.data.shoppingStatus = data;
}

async function setShoppingStatus(name, state) {
  if (!S.householdId) throw new Error('请先选择家庭');
  const data = await api('PUT', '/api/shopping-status', { householdId: S.householdId, name, state });
  S.data.shoppingStatus = data;
  S.shoppingChecked = new Set(Object.entries(data.items || {}).filter(([, item]) => item && item.state === 'completed').map(([n]) => n));
}

/**
 * 把一样买菜清单上的东西记进当前家庭的库存。
 * 单条「入库」和批量「全部入库」共用这一份，免得两处逻辑走偏。
 */
async function stockOne(name, parts, options) {
  const lockKey = `${S.shopContext?.weekOf || 'shopping'}::${ingredientMatchKey(name)}`;
  if (S.stocking.has(lockKey)) return null;
  S.stocking.add(lockKey);
  try {
    return await stockOneUnlocked(name, parts, options);
  } finally {
    S.stocking.delete(lockKey);
  }
}

async function stockOneUnlocked(name, parts, options) {
  const opts = options || {};
  const item = opts.item || (S.shopList || []).find((x) => x.name === name) || null;
  if (item && item.trackingMode === 'presence') {
    const stock = findStock(name);
    if (stock.length) {
      for (const pantry of stock) await api('PUT', `/api/pantry/${pantry.id}`, { ...pantry, trackingMode: 'presence', hasStock: true });
    } else {
      await api('POST', '/api/pantry', {
        householdId: S.householdId,
        name,
        category: item.category || '调味干货',
        trackingMode: 'presence',
        hasStock: true,
        quantity: 0,
        minQuantity: 0,
        unit: '',
        note: '从计划确认家中有',
      });
    }
    await setShoppingStatus(name, 'completed');
    return { name, hasStock: true };
  }
  const guessed = guessAmount(parts || []);
  const assessment = item ? stockAssessment(item) : null;
  const defaultQty = assessment && assessment.shortageQty != null
    ? assessment.shortageQty
    : (item && item.isSeasoning ? 1 : item && item.requiredQty != null ? item.requiredQty : guessed.quantity);
  const preset = S.presets && S.presets.presets
    ? S.presets.presets.find((p) => ingredientMatchKey(p.name) === ingredientMatchKey(name))
    : null;
  const defaultUnit = (item && item.isSeasoning && item.stock.find((p) => p.quantity > 0)?.unit)
    || (item && item.requiredUnit)
    || (item && item.isSeasoning && preset && preset.unit)
    || guessed.unit
    || '份';
  const entered = await askStockInput(name, defaultQty, defaultUnit);
  if (!entered) return null;
  const { quantity, unit } = entered;
  let category = '其他';
  if (S.presets && S.presets.presets) {
    const hit = S.presets.presets.find((p) => p.name === name);
    if (hit) category = hit.category;
  }
  const context = S.shopContext;
  if (context && context.kind === 'plan' && context.weekOf) {
    await api('POST', '/api/plans/receive', {
      householdId: S.householdId,
      weekOf: context.weekOf,
      name,
      category,
      quantity,
      unit,
      requestId: (globalThis.crypto && crypto.randomUUID)
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      note: '从计划采购入库',
    });
  } else {
    await api('POST', '/api/pantry', {
      householdId: S.householdId,
      name,
      category,
      quantity,
      unit,
      expireAt: '',
      note: '从买菜清单入库',
      addToExisting: true,
    });
  }
  if (context && context.kind === 'plan') {
    S.planShopSelected.delete(name);
  } else if (S.householdId) {
    await api('PUT', '/api/shopping-status', { householdId: S.householdId, name, state: 'needed' });
    S.shoppingChecked.delete(name);
  }
  return { name, quantity, unit };
}

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
  return scopeDishes().filter((d) => {
    const inCat = S.category === '全部' || d.category === S.category;
    return inCat && matchKeyword(d, S.keyword);
  });
}

function randomTagList(value) {
  return String(value || '')
    .split(/[\s,，、]+/)
    .map((x) => x.trim().toLocaleLowerCase())
    .filter(Boolean);
}

function randomCandidates(filters) {
  const scope = byScope(scopeDishes(), filters.scope || 'all');
  const tags = randomTagList(filters.tags);
  const orders = householdOrders();
  const isSameDish = (order, dish) => order.dishId
    ? order.dishId === dish.id
    : sameKey(order.dishName) === sameKey(dish.name);
  const cookedToday = (dish) => orders.some((o) =>
    o.status === 'done' && String(o.date || o.createdAt || '').slice(0, 10) === todayStr() && isSameDish(o, dish)
  );
  const orderedNow = (dish) => orders.some((o) =>
    (o.status === 'pending' || o.status === 'cooking') && isSameDish(o, dish)
  );
  return scope.filter((d) => {
    if (d.dishStatus === 'paused') return false;
    if (filters.category && filters.category !== '全部' && d.category !== filters.category) return false;
    const dishTags = (d.tags || []).map((x) => String(x).toLocaleLowerCase());
    if (tags.length && !tags.every((tag) => dishTags.some((x) => x.includes(tag)))) return false;
    if (filters.notCooked && cookedToday(d)) return false;
    if (filters.excludeOrdered && orderedNow(d)) return false;
    return true;
  });
}

function openRandomSheet() {
  const cats = sortedCategories();
  S.randomFilters = { scope: 'all', category: '全部', tags: '', notCooked: false, excludeOrdered: false };
  openSheet({
    title: '随机来一道',
    body: `<div class="random-filter-grid">
      <div class="field"><label class="field-label">可见范围</label><select class="input" id="randomScope"><option value="all">全部可见</option><option value="shared">共享菜单</option><option value="own">我家私菜</option></select></div>
      <div class="field"><label class="field-label">分类</label><select class="input" id="randomCategory"><option value="全部">全部分类</option>${cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="field-label">标签</label><input class="input" id="randomTags" placeholder="快手、清淡、下饭…" /></div>
      <label class="check-row"><input type="checkbox" id="randomNotCooked" /> <span>今天没做过</span></label>
      <label class="check-row"><input type="checkbox" id="randomExcludeOrdered" /> <span>排除已点餐（待做/制作中）</span></label>
    </div>
    <p class="section-sub">条件会同时生效；没有符合条件的菜时不会放宽范围。</p>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="random-run">🎲 随机抽一道</button>`,
  });
}

/** 菜单页那一屏：先按归属筛，再按分类/搜索筛，最后折叠同名的 */
function visibleDishItems() {
  return collapseDupes(byScope(visibleDishes(), S.dishScope), S.dishScope);
}

/** 计数用的是「折叠之后」的数量，否则「全部 12 / 私房 5」会让人以为漏了 5 道 */
function dishScopeCounts() {
  const scoped = byScope(visibleDishes(), 'x'); // 分类/搜索筛过，还没按归属筛
  const all = collapseDupes(scoped, 'all');
  return {
    all: all.length,
    shared: all.filter((i) => !i.dish.householdId).length,
    own: all.reduce((n, i) => n + i.folded.length + (i.dish.householdId ? 1 : 0), 0),
  };
}

/**
 * 一条留言。
 *
 * 留言板页和「某道菜的留言」弹层用的是同一个渲染器 —— 两边的数据
 * 结构一样（正文 + 表情 + 认领 + 楼中楼），没必要写两套。
 * opts.pick   多选模式下整行变成勾选框（跟 v1.7 的通用多选一致）
 * opts.compact 菜品弹层里用，标题栏已经写了菜名，省掉重复信息
 */
function noteCard(n, opts) {
  const o = opts || {};
  const me = meName();
  const reacs = n.reactions || {};
  const claimedBy = n.claim && n.claim.by;
  const isMine = claimedBy === me;
  const dish = n.kind === 'dish' ? dishById(n.dishId) : null;

  const head = `<div class="note-head">
      <span class="note-who">${memberEmoji(n.author)} <b>${esc(n.author)}</b></span>
      ${dish ? `<span class="note-where">在「${esc(dish.name)}」</span>` : ''}
      <span class="note-time">${esc(relTime(n.createdAt))}</span>
    </div>`;

  const body = `<div class="note-text">${n.sticker ? `<span class="note-sticker">${n.sticker}</span>` : ''}${esc(n.text)}</div>`;

  // 表情：已有的直接点（再点一次取消），没有的走「＋」挑
  const reactRow = `<div class="note-reacts">
      ${Object.keys(reacs)
        .map(
          (e) =>
            `<button class="react ${(reacs[e] || []).includes(me) ? 'on' : ''}"
               data-act="note-react" data-id="${esc(n.id)}" data-emoji="${esc(e)}"
               title="${esc(reactWho(reacs[e]))}">${esc(e)}${(reacs[e] || []).length}</button>`
        )
        .join('')}
      <button class="react add" data-act="note-react-pick" data-id="${esc(n.id)}"
        aria-label="加个表情">＋</button>
    </div>`;

  // 认领：一个人一条，别人点的置灰并告诉你是谁认领了
  const claimRow = `<div class="note-claim">
      ${
        claimedBy
          ? `<span class="claim-on ${isMine ? '' : 'other'}">✅ ${esc(claimedBy)}${isMine ? '来' : '认领了'}
               ${isMine ? '<button class="claim-x" data-act="note-claim" data-id="' + esc(n.id) + '">取消</button>' : ''}
             </span>`
          : `<button class="btn ghost sm" data-act="note-claim" data-id="${esc(n.id)}">🙋 我来</button>`
      }
    </div>`;

  const replies = n.replies || [];
  const replyRow = replies.length
    ? `<div class="note-replies">
        ${replies
          .map(
            (r) => `<div class="reply">
              <span class="reply-who">${memberEmoji(r.author)} <b>${esc(r.author)}</b></span>
              <span class="reply-text">${esc(r.text)}</span>
              <span class="reply-time">${esc(relTime(r.createdAt))}</span>
              <button class="reply-x" data-act="note-reply-del" data-id="${esc(n.id)}"
                data-rid="${esc(r.id)}" aria-label="删掉这条回复">✕</button>
            </div>`
          )
          .join('')}
      </div>`
    : '';

  const replyBox =
    S.noteReplyTo === n.id
      ? `<div class="note-replybox">
          <input class="input" id="replyInput-${esc(n.id)}" placeholder="回一句…"
            data-note-reply="${esc(n.id)}" maxlength="300" />
          <button class="btn soft" data-act="note-reply-send" data-id="${esc(n.id)}">回复</button>
          <button class="btn ghost" data-act="note-reply-cancel">取消</button>
        </div>`
      : '';

  const inner = `<div class="note-in">${head}${body}${reactRow}${claimRow}${replyRow}${replyBox}
      <div class="note-foot">
        <button class="btn ghost sm" data-act="note-reply-open" data-id="${esc(n.id)}">
          ${replies.length ? `💬 回复（${replies.length}）` : '💬 回复'}
        </button>
        <button class="btn ghost sm danger" data-act="note-del" data-id="${esc(n.id)}">🗑</button>
      </div></div>`;

  if (o.pick) return pickRowHtml('notes', n.id, `note ${o.compact ? 'compact' : ''}`, inner);
  return `<article class="note ${o.compact ? 'compact' : ''}" data-note="${esc(n.id)}">${inner}</article>`;
}

function dishCard(d, folded) {
  const cover = d.images && d.images[0];
  const img = cover
    ? `<img src="${esc(cover)}" alt="${esc(d.name)}" loading="lazy" />`
    : `<span>${dishEmoji(d.name)}</span>`;
  const meta = [];
  if (d.duration) meta.push(`<span class="tag">⏱ ${d.duration}′</span>`);
  if (d.servings) meta.push(`<span class="tag">👥 ${esc(d.servings)}</span>`);
  if ((d.tags || []).length) meta.push(`<span class="tag hot">${esc(d.tags[0])}</span>`);
  meta.push(dishStatusTag(d));

  // 同名折叠的提示。共享那版优先露出来，但得让人知道自家那份没丢 ——
  // 默默藏起来会让人以为自己的菜被谁删了。
  const dupes = (folded || []).length
    ? `<div class="card-dupes" data-stop="1">
        <span>共享里已有这道，你家的 ${folded.length} 版私房菜收在这儿</span>
        <button class="btn ghost sm" data-act="unfold-dish" data-id="${esc(d.id)}">展开</button>
      </div>`
    : '';

  // 菜品互动条：想吃 / 我来做 / 留言。
  // 卡片整块是「打开做法」，所以这里每个按钮都带 stop，点了不该顺手把菜谱也打开。
  const v = dishVote(d.id);
  const me = meName();
  const dn = dishNotes(d.id).length;
  const iWant = v.want.includes(me);
  const iCook = v.cook.includes(me);
  const cookBy = v.cook.length ? v.cook[0] : '';
  const scopeAction = d.householdId ? copyToSharedBtn(d, 'ib') : adoptBtn(d, 'ib');
  const interact = `<div class="card-interact" data-stop="1">
      <button class="ib ${iWant ? 'on' : ''}" data-act="dish-vote" data-id="${esc(d.id)}" data-role="want"
        title="${esc(v.want.length ? reactWho(v.want) : '点一下表示想吃')}">🍽 想吃 ${v.want.length || ''}</button>
      <button class="ib ${iCook ? 'on' : ''}" ${cookBy && !iCook ? 'disabled' : ''}
        data-act="dish-vote" data-id="${esc(d.id)}" data-role="cook"
        title="${esc(cookBy ? (iCook ? '点一下取消认领' : cookBy + ' 已经认领了') : '我来下厨这道')}">
        👩‍🍳 ${iCook ? '我来做' : cookBy ? cookBy + ' 来做' : '我来做'}</button>
      <button class="ib ${dn ? 'has' : ''}" data-act="open-dish-notes" data-id="${esc(d.id)}"
        aria-label="${dn ? dn + ' 条留言' : '留个言'}">💬${dn ? ' ' + dn : ''}</button>
      ${scopeAction}
      ${dishStatusAction(d)}
    </div>`;
  const renderedInteract = S.householdId
    ? interact
    : '<div class="card-interact"><span class="section-sub">公开共享菜单 · 只读</span></div>';

  return `<article class="card" role="button" tabindex="0" aria-label="查看 ${esc(d.name)} 做法"
    data-act="open-dish" data-id="${esc(d.id)}">
    <div class="card-cover">
      ${img}
      ${d.isFavorite ? `<span class="card-fav">⭐</span>` : ''}
      ${d.category ? `<span class="card-badge">${esc(d.category)}</span>` : ''}
      ${isPrivate(d) ? '<span class="card-own" title="只有本家看得见">🔒</span>' : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${esc(d.name)}</div>
      ${d.description ? `<div class="card-desc">${esc(d.description)}</div>` : ''}
      <div class="card-meta">${meta.join('')}</div>
    </div>
    ${dupes}
    ${renderedInteract}
  </article>`;
}

function viewMenu() {
  const noHousehold = !S.householdId;
  const cats = sortedCategories();
  const items = visibleDishItems();
  const counts = dishScopeCounts();
  const hidden = foldedCount(items);
  const activeCount = noHousehold ? 0 : pendingOrders().length;
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

  const accountMenuEntry = `<section class="account-menu-entry" aria-label="共享菜单导航">
      <div class="account-menu-entry-head"><span class="account-menu-entry-icon">🌐</span><div>
        <h2 class="section-title">共享菜单</h2>
        <p class="section-sub">当前没有选择家庭，以下内容只读浏览。</p>
      </div></div>
      <p class="account-menu-entry-text">创建或加入家庭后，就能点菜、排计划并管理自己的私菜。账户身份会保留，不需要重新注册。</p>
      <div class="account-menu-entry-actions">
        <button class="btn" data-act="new-household">＋ 创建家庭</button>
        <button class="btn soft" data-act="open-join-family">申请加入家庭</button>
        <button class="btn ghost" data-act="open-account-home">返回账户首页</button>
      </div>
    </section>`;

  const all = scopeDishes();
  const chips = [{ name: '全部', count: all.length }]
    .concat(
      cats.map((c) => ({
        name: c.name,
        count: all.filter((d) => d.category === c.name).length,
      }))
    )
    .map(
      (c) => `<button class="chip" data-act="filter-cat" data-cat="${esc(c.name)}"
        aria-pressed="${S.category === c.name}">${esc(c.name)}<span class="chip-count">${c.count}</span></button>`
    )
    .join('');

  // 归属筛选：共享 / 我家私房。放分类前面 —— 先决定看谁的那本，再决定看哪一类。
  const scopes = [
    ['all', '全部', counts.all],
    ['shared', '🌐 共享', counts.shared],
    ['own', '🔒 我家私房', counts.own],
  ]
    .map(
      ([k, label, n]) => `<button class="chip chip-scope" data-act="filter-scope" data-scope="${k}"
        aria-pressed="${S.dishScope === k}">${label}<span class="chip-count">${n}</span></button>`
    )
    .join('');

  let body;
  if (S.loading) {
    body = `<div class="grid">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
  } else if (!items.length) {
    body = `<div class="empty">
      <span class="empty-emoji">${S.keyword ? '🔍' : '🍳'}</span>
      <p class="empty-title">${S.keyword ? '没找到这道菜' : S.dishScope === 'own' ? '我家还没有私房菜' : '还没有菜'}</p>
      <p class="empty-text">${
        S.keyword
          ? '换个词试试'
          : S.dishScope === 'own'
          ? '共享菜单里已有的菜，直接抄一份到你家，改成自己的做法'
          : '点右下角「记一道菜」，把家里常做的录进来'
      }</p>
      ${
        S.dishScope === 'own' && !S.keyword
          ? '<button class="btn soft" style="margin-top:16px" data-act="filter-scope" data-scope="shared">看共享菜单</button>'
          : ''
      }
    </div>`;
  } else {
    body = `<div class="grid">${items.map((i) => dishCard(i.dish, i.folded)).join('')}</div>`;
  }

  return `
    ${noHousehold ? accountMenuEntry : planCard}
    <div class="chip-row">${scopes}</div>
    <div class="chip-row">${chips}</div>
    ${
      hidden && S.dishScope === 'all'
        ? `<p class="section-sub" style="margin:2px 0 10px">
             🌐 共享里有的菜只露共享那一版，${hidden} 道同名的私房版收在「🔒 我家私房」里。
           </p>`
        : ''
    }
    ${
      activeCount
        ? `<div class="section-head">
             <h2 class="section-title">今晚 ${activeCount} 道待做</h2>
             <button class="btn soft sm" data-act="nav" data-view="order">去点餐单 →</button>
           </div>`
        : ''
    }
    ${body}
    <button class="fab" data-act="new-dish">${S.dishScope === 'own' || !canWriteShared() ? '＋ 记我家私菜' : '＋ 记共享菜'}</button>`;
}

/* ---------------- 菜品详情 ---------------- */

/* =========================================================
   菜品详情
   ========================================================= */

/** 往某一周的计划里加一道菜；after 用来让调用方刷新自己的界面 */
async function addToPlan(entry, weekOf, after) {
  const week = mondayOf(weekOf);
  try {
    await api('POST', '/api/plans/items', {
      householdId: S.householdId,
      weekOf: week,
      plannedFor: entry.plannedFor || week,
      ...entry,
    });
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
  // 别人家的私菜不该被打开（虽然 UI 上点不到，这里再挡一道，防止 id 被手工拼出来）
  if (!canSee(d.householdId)) return toast('这道菜是别人家的私菜');

  const cover = d.images && d.images[0];
  const hero = cover
    ? `<div class="hero"><img src="${esc(cover)}" alt="${esc(d.name)}" /></div>`
    : `<div class="hero"><div class="hero-empty">${dishEmoji(d.name)}</div></div>`;

  const meta = [];
  if (d.category) meta.push(`<span class="tag">${esc(d.category)}</span>`);
  meta.push(dishStatusTag(d));
  if (isPrivate(d)) meta.push('<span class="tag own">🔒 只有本家看得见</span>');
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
      ${
        canEdit(d)
          ? `<button class="btn ghost" data-act="edit-dish" data-id="${esc(d.id)}">编辑</button>`
          : adoptBtn(d, 'btn ghost')
      }
      ${copyToSharedBtn(d, 'btn ghost')}
      ${S.householdId ? `<button class="btn soft" data-act="toggle-plan-dish" data-id="${esc(d.id)}" data-week="${esc(planWeek())}">${inPlan ? '✓ 已在计划里' : '＋ 加入计划'}</button>${dishStatusAction(d)}${d.dishStatus === 'paused' ? '<button class="btn" disabled title="暂停供应，暂时不能新建点餐">⏸ 暂停供应</button>' : `<button class="btn" data-act="order-dish" data-id="${esc(d.id)}">今天想吃这个</button>`}` : '<button class="btn ghost" data-act="open-account-home">返回账户首页</button>'}`,
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
  if (!anyHouseAdmin()) {
    actions = '<span class="section-sub">管理员更新状态</span>';
  } else if (o.status === 'pending') {
    actions = `<button class="btn soft sm" data-act="set-status" data-id="${esc(o.id)}" data-status="cooking">开做</button>`;
  } else if (o.status === 'cooking') {
    actions = `<button class="btn green sm" data-act="set-status" data-id="${esc(o.id)}" data-status="done">完成</button>`;
  } else {
    actions = `<button class="btn ghost sm" data-act="del-order" data-id="${esc(o.id)}">删除</button>`;
  }

  // 多选模式：状态按钮先让位，整行变成勾选框
  if (picking('orders')) {
    const on = pickHas('orders', o.id);
    return `<div class="order-item pick ${on ? 'on' : ''}" role="checkbox" tabindex="0"
      aria-checked="${on}" data-act="pick-item" data-k="orders" data-id="${esc(o.id)}"
      aria-label="选择 ${esc(o.dishName)}">
      <span class="pick-box">${on ? '✓' : ''}</span>
      <div class="order-thumb">${thumb}</div>
      <div class="order-main">
        <div class="order-name">${esc(o.dishName)}</div>
        <div class="order-meta">${esc(o.requester)} · ${o.people} 人份 · ${relTime(o.createdAt)}</div>
        ${o.note ? `<div class="order-note">📝 ${esc(o.note)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <span class="status-pill status-${o.status}">${STATUS_TEXT[o.status]}</span>
      </div>
    </div>`;
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

/** 把常见的中英文单位统一，避免「克」和「g」被当成两种单位。 */
function normalizeAmountUnit(unit) {
  const u = String(unit || '').trim().toLowerCase();
  const aliases = {
    克: 'g', 公克: 'g', 千克: 'kg', 公斤: 'kg',
    毫升: 'ml', 升: 'l', '毫克': 'mg',
    个: '个', 只: '只', 条: '条', 盒: '盒', 包: '包',
    瓶: '瓶', 袋: '袋', 勺: '勺', 小勺: '小勺', 大勺: '大勺',
    片: '片', 瓣: '瓣', 根: '根', 把: '把', 颗: '颗', 块: '块',
    丝: '丝', 份: '份', 斤: '斤', 两: '两',
  };
  return aliases[u] || u;
}

/** 从「2 个」「20g」「番茄炒蛋 2 个」中提取数量和单位。 */
function parseAmountText(text) {
  const raw = String(text || '').trim();
  if (!raw) return { quantity: null, unit: '' };
  const m = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+|[\u4e00-\u9fff]{1,4})/.exec(raw);
  if (!m || Number(m[1]) <= 0) return { quantity: null, unit: '' };
  return { quantity: Number(m[1]), unit: normalizeAmountUnit(m[2]) || '份' };
}

/** 从「番茄炒蛋 2 个」这类用量里猜出数量和单位，用来一键入库 */
function guessAmount(parts) {
  for (const p of parts) {
    const amount = parseAmountText(p);
    if (amount.quantity != null) return amount;
  }
  return { quantity: 1, unit: '份' };
}

/** 采购、库存和计划共用的食材标准化键；只收录明确同义词，避免把红糖误并到白糖。 */
const INGREDIENT_ALIASES = Object.freeze({
  生抽酱油: '生抽',
  酱油: '生抽',
  老抽酱油: '老抽',
  食盐: '盐',
  食用盐: '盐',
  精盐: '盐',
  盐巴: '盐',
  白砂糖: '糖',
  白糖: '糖',
});

function ingredientMatchKey(name) {
  if (window.PantryLogic && window.PantryLogic.normalizeName) return window.PantryLogic.normalizeName(name);
  const key = String(name || '')
    .toLowerCase()
    .replace(/[\s\u3000、，。；：:（）()【】\[\]\/\\·'"“”‘’\-_.]/g, '');
  return INGREDIENT_ALIASES[key] || key;
}

/** 在当前家庭库存里找同义名称；模糊包含只用于双方至少两个字符的名称。 */
function findStock(name, ingredientId) {
  const list = householdPantry();
  if (ingredientId) {
    return list.filter((item) => item.ingredientId === ingredientId);
  }
  const wanted = ingredientMatchKey(name);
  const exact = list.filter((p) => ingredientMatchKey(p.name) === wanted);
  if (exact.length) return exact;
  return list.filter((p) => {
    const other = ingredientMatchKey(p.name);
    return other.length >= 2 && wanted.length >= 2 && (other.includes(wanted) || wanted.includes(other));
  });
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
    if (s.name) out.push({ name: (ingredientById(s.ingredientId) || {}).name || s.name, ingredientId: s.ingredientId || '', amount: s.amount, purchaseType: s.purchaseType || '', method: '' });
  });
  (d.methods || []).forEach((m) => {
    (m.seasonings || []).forEach((s) => {
      if (s.name) out.push({ name: (ingredientById(s.ingredientId) || {}).name || s.name, ingredientId: s.ingredientId || '', amount: s.amount, purchaseType: s.purchaseType || '', method: m.name || '' });
    });
  });
  return out;
}

/** 把一批「菜名 + 调料」汇总成采购条目，同名的合并 */
function mergeSeasonings(rows) {
  return window.PantryLogic.aggregatePlanMaterials(rows, {
    normalizeName: ingredientMatchKey,
    inferTrackingMode(row) {
      const stock = findStock(row.name, row.ingredientId);
      const explicit = stock.find((p) => p.trackingMode === 'presence' || p.trackingMode === 'quantity');
      return window.PantryLogic.inferTrackingMode({ ...row, trackingMode: explicit && explicit.trackingMode });
    },
    parseAmount: parseAmountText,
    stockFor: (name, ingredientId) => findStock(name, ingredientId),
    categoryFor(name, stock, ingredientId) {
      const ingredient = ingredientById(ingredientId);
      if (!ingredient) return ingredientCategory(name, stock);
      const categories = householdPantryCategories();
      const parts = [];
      let current = categories.find((category) => category.id === ingredient.categoryId);
      while (current) {
        parts.unshift(current.name);
        current = categories.find((category) => category.id === current.parentId);
      }
      return parts.join(' > ') || ingredientCategory(name, stock);
    },
  }).map((item) => ({
    ...item,
    stockQty: item.stock.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0),
    stockUnit: item.stock.length === 1
      ? item.stock[0].unit
      : item.stock.map((p) => p.unit).filter((v, i, a) => a.indexOf(v) === i).join('/'),
  }));
}

function shoppingIngredientKey(name, unit) {
  const key = ingredientMatchKey(name);
  return unit ? `${key}|${normalizeAmountUnit(unit)}` : key;
}

/** 采购数量统一保留三位小数，避免浮点误差把 0.3 显示成 0.30000000000000004。 */
function roundQty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000) / 1000) : 0;
}

/** 根据需求量和当前家庭库存，判断采购条目的真实状态。 */
function stockAssessment(item) {
  if (window.PantryLogic) return window.PantryLogic.assessStock(item);
  const stock = Array.isArray(item.stock) ? item.stock : [];
  const positive = stock.filter((p) => Number(p.quantity) > 0);
  if (item.isSeasoning) {
    return {
      key: positive.length ? 'enough' : 'staple',
      stockQty: null,
      stockMinQty: 0,
      targetQty: null,
      shortageQty: null,
    };
  }
  const requiredUnit = normalizeAmountUnit(item.requiredUnit);
  const stockQty = positive.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
  const unitRows = positive.length ? positive : stock;
  const units = [...new Set(unitRows.map((p) => normalizeAmountUnit(p.unit)).filter(Boolean))];
  const comparableUnit = requiredUnit && units.length === 1 && units[0] === requiredUnit;
  const stockMinQty = comparableUnit
    ? unitRows.reduce((sum, p) => sum + (Number(p.minQuantity) > 0 ? Number(p.minQuantity) : 0), 0)
    : 0;
  const comparableStock = positive.length > 0 && comparableUnit;

  // 没有库存时仍然给出可比较的目标数量；常备调料保留「请确认」语义，
  // 但入库按钮可以把实际买到的数量记入库存。
  if (!positive.length) {
    const targetComparable = item.requiredComparable && item.requiredQty != null && requiredUnit
      && (!stock.length || comparableUnit);
    const targetQty = targetComparable
      ? roundQty(item.requiredQty + stockMinQty)
      : null;
    return {
      key: item.isStaple ? 'staple' : 'needed',
      stockQty: 0,
      stockMinQty,
      targetQty,
      shortageQty: targetQty,
    };
  }

  if (!item.requiredComparable || item.requiredQty == null || !requiredUnit || !comparableStock) {
    return { key: 'uncertain', stockQty, stockMinQty, targetQty: null, shortageQty: null };
  }

  const targetQty = roundQty(item.requiredQty + stockMinQty);
  if (stockQty >= targetQty) {
    return { key: 'enough', stockQty, stockMinQty, targetQty, shortageQty: 0 };
  }
  return {
    key: 'shortage',
    stockQty,
    stockMinQty,
    targetQty,
    shortageQty: Math.max(0, roundQty(targetQty - stockQty)),
  };
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
 * 买菜清单的批量工具条。
 *
 * 这里刻意不另起一个「多选模式」：每行那个 ✓ 就是「已经买了」，也是勾选。
 * 勾上一个就冒出这条工具条，买完一袋一袋点「全部入库」，入库完自动清掉勾选。
 * 多造一个「选中但没买」的概念反而更容易点错。
 */
function shopBatchBar(list, scope) {
  const selected = activeShopChecks();
  const checked = list.filter((it) => selected.has(it.name));
  if (!checked.length) return '';
  const allOn = checked.length === list.length;
  const canStock = checked.some((it) => stockAssessment(it).key !== 'enough');
  return `<div class="pick-bar">
    <button class="btn ghost sm" data-act="shop-all" data-scope="${esc(scope || 'default')}" data-on="${allOn ? '0' : '1'}">${allOn ? '☑ 全不勾' : '☐ 全勾'}</button>
    <span class="pick-count">已勾 ${checked.length} / ${list.length}</span>
    <button class="btn soft sm" data-act="shop-stock" data-scope="${esc(scope || 'default')}" ${canStock ? '' : 'disabled'}>🧊 全部入库</button>
    <button class="btn ghost sm" data-act="shop-copy" data-scope="${esc(scope || 'default')}">复制勾中的</button>
    <button class="btn ghost sm" data-act="shop-uncheck" data-scope="${esc(scope || 'default')}">取消勾选</button>
  </div>`;
}

function shoppingGroupOpen(category, scope) {
  const key = `${scope || 'default'}::${category}`;
  return S.shoppingGroups[key] !== false;
}

function shopItemHtml(it) {
  const done = S.shoppingChecked.has(it.name);
  const assessment = stockAssessment(it);
  const planMode = S.shopContext && S.shopContext.kind === 'plan';
  const inventoryComplete = planMode && assessment.key === 'enough';
  const selected = planMode ? S.planShopSelected.has(it.name) : done;
  const stateKey = planMode
    ? assessment.key
    : it.received
      ? 'received'
      : (inventoryComplete || (done && ['needed', 'staple', 'uncertain'].includes(assessment.key)))
      ? 'completed'
      : assessment.key;
  const stateLabel = {
    enough: planMode ? '已完成' : '已有', shortage: '库存不足', uncertain: '需确认', staple: '请确认', completed: '已完成', received: '已入库', needed: '待购买',
  }[stateKey];
  const displayUnit = it.stockUnit || it.requiredUnit || '';
  const reserveHint = assessment.stockMinQty > 0
    ? `（最低保有量 ${esc(fmtQty(assessment.stockMinQty))}${esc(displayUnit)}）`
    : '';
  const stockHtml = it.isSeasoning
    ? `<span class="shop-stock">${stateKey === 'staple' ? '🧂 家中没有库存记录 · 请确认是否需要补充' : '🧂 已确认家中有，无需比较用量'}</span>`
    : it.stock.length || ['needed', 'staple'].includes(stateKey)
    ? `<span class="shop-stock" title="家里已经有 ${esc(it.stock.map((p) => p.name + ' ' + p.quantity + p.unit).join('、') || '暂无库存')}">
        ${stateKey === 'needed'
          ? `⚠️ 库存已用完${assessment.shortageQty != null ? `，还需 ${esc(fmtQty(assessment.shortageQty))}${esc(displayUnit)}` : ''}`
          : stateKey === 'staple'
            ? `🧂 暂无库存 · ${assessment.shortageQty != null ? `建议备 ${esc(fmtQty(assessment.shortageQty))}${esc(displayUnit)}` : '请确认是否需要补充'}`
            : `${stateKey === 'shortage' ? '⚠️' : '🏠'} 家里有 ${esc(fmtQty(assessment.stockQty))}${esc(displayUnit)}`}
        ${stateKey === 'shortage' ? `，还需 ${esc(fmtQty(assessment.shortageQty))}${esc(it.requiredUnit)}` : ''}
        ${stateKey === 'uncertain' ? ' · 请确认余量' : ''}
        ${['enough', 'shortage'].includes(stateKey) ? reserveHint : ''}
      </span>`
    : '';
  const restockHtml = ['enough', 'received'].includes(stateKey)
    ? ''
    : `<button class="btn soft sm" data-act="stock-it" data-name="${esc(it.name)}"
         data-parts="${esc(it.parts.join('|'))}">入库</button>`;
  const checked = planMode ? selected || inventoryComplete : done || stateKey === 'received';
  const rowDone = planMode ? inventoryComplete : checked || (stateKey === 'completed' && done);
  return `<div class="shop-item ${rowDone ? 'done' : ''} shop-state-${stateKey}">
    <div class="shop-check" role="checkbox" tabindex="0" aria-checked="${checked}"
      aria-label="${esc(it.name)} 是否已买" data-act="toggle-shop" data-name="${esc(it.name)}">✓</div>
    <div class="shop-main">
      <div class="shop-name">${esc(it.name)} <span class="tag ${stateKey === 'enough' ? 'own' : stateKey === 'completed' ? 'done' : stateKey}">${stateLabel}</span></div>
      <div class="shop-from">${it.isSeasoning ? '调料 · 只确认家中是否有' : `${it.requiredQty != null ? `本周需 ${esc(fmtQty(it.requiredQty))}${esc(it.requiredUnit)} · ` : ''}${it.useCount > 1 ? `使用 ${it.useCount} 次 · ` : ''}`}${esc(it.isSeasoning ? '' : it.parts.join(' · '))}</div>
    </div>
    <div class="shop-side">${stockHtml}${restockHtml}</div>
  </div>`;
}

function shopGroupHtml(category, items, scope) {
  const open = shoppingGroupOpen(category, scope);
  const ids = items.map((it) => it.name);
  const selectedSet = activeShopChecks();
  const selected = ids.filter((name) => selectedSet.has(name));
  const allOn = ids.length > 0 && selected.length === ids.length;
  const need = items.filter((it) => stockAssessment(it).key !== 'enough').length;
  return `<section class="category-group shop-category-group ${open ? 'is-open' : 'is-closed'}">
    <div class="category-group-head">
      <button class="category-group-toggle" data-act="toggle-shopping-group" data-cat="${esc(category)}" data-scope="${esc(scope || 'default')}" aria-expanded="${open}">
        <span class="category-group-caret">${open ? '⌄' : '›'}</span>
        <span class="category-group-title">${catEmoji(category)} ${esc(category)}</span>
        <span class="category-group-count">${items.length} 样${need ? ` · ${need} 待补` : ''}</span>
      </button>
      <button class="category-group-select" data-act="select-shopping-group" data-cat="${esc(category)}" data-scope="${esc(scope || 'default')}" data-on="${allOn ? '0' : '1'}" role="checkbox" aria-checked="${allOn}">${allOn ? '☑' : '☐'} 全选</button>
      <button class="btn soft sm category-group-stock" data-act="stock-shopping-group" data-cat="${esc(category)}" data-scope="${esc(scope || 'default')}" ${need ? '' : 'disabled'}>本组入库</button>
    </div>
    ${open ? `<div class="category-group-body">${items.map(shopItemHtml).join('')}</div>` : ''}
  </section>`;
}

/**
 * 采购清单的通用渲染：点餐页和计划页共用
 * opts: { title, sub, hint, bare（不画标题行，直接接在别的小标题下面） }
 */
function shopListHtml(list, opts) {
  const o = opts || {};
  // 记住当前这张单子：批量入库、复制勾中的都得按它来。
  if (o.remember !== false) {
    S.shopList = list;
    S.shopContext = o.context || null;
  } else {
    // 计划页会把“需要采购”和“常备调料”分成两个视觉区域，事件处理仍共用一张完整清单。
    S.shopList = [...(S.shopList || []), ...list];
  }
  if (!list.length) {
    return o.bare
      ? ''
      : `<div class="section-head">
        <h2 class="section-title">${esc(o.title || '买菜清单')}</h2>
      </div>
      <div class="empty" style="padding:30px 20px"><p class="empty-text">${esc(o.empty || '暂时没有需要买菜的东西')}</p></div>`;
  }
  const head = o.bare
    ? ''
    : `<div class="section-head">
      <h2 class="section-title">${esc(o.title || '买菜清单')}</h2>
      <span class="section-sub">${esc(o.sub || `${list.length} 样待买`)}</span>
      <button class="btn ghost sm" style="margin-left:auto" data-act="copy-shopping" data-scope="${esc(o.scope || '')}">复制</button>
    </div>`;
  const groups = groupedByCategory(list, (it) => ingredientCategory(it.name, it.stock));
  return `${head}${shopBatchBar(list, o.groupScope)}${groups.map(([category, items]) => shopGroupHtml(category, items, o.groupScope)).join('')}
    ${o.hint ? `<p class="section-sub" style="margin-top:6px">${esc(o.hint)}</p>` : ''}`;
}

function viewOrder() {
  const all = householdOrders();
  const today = todayStr();
  const house = currentHousehold();
  const admin = anyHouseAdmin();

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
  const list = visibleOrders();
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
        admin && S.orderStatus === 'done' && doneCount
          ? `<button class="btn ghost sm" style="margin-left:auto" data-act="clear-done">清空已完成</button>`
          : ''
      }
      ${
        admin && pendingCount
          ? `<button class="btn green sm" style="margin-left:${
              S.orderStatus === 'done' && doneCount ? '8px' : 'auto'
            }"
              data-act="start-all" title="待做的全部开始做">🔥 一键开做 ${pendingCount}</button>`
          : ''
      }
      ${
        admin && aiReady() && pendingOrders().length >= 2
          ? `<button class="btn soft sm" style="margin-left:${
              S.orderStatus === 'done' && doneCount || pendingCount ? '8px' : 'auto'
            }"
              data-act="ai-cook-plan" title="看这几道菜怎么并行着做最快">👨‍🍳 厨房助手</button>`
          : ''
      }
    </div>
    <div class="status-tabs">${tabs}</div>
    ${!admin ? '<p class="section-sub" style="margin:10px 0 0">点餐由全家提交，做饭状态由管理员统一更新。</p>' : ''}
    ${memberFilterHtml}
    ${
      admin && picking('orders')
        ? pickBarHtml(
            'orders',
            list.map((o) => o.id),
            [
              S.orderStatus === 'pending'
                ? { act: 'batch-status', status: 'cooking', cls: 'soft', label: '🔥 开做' }
                : '',
              S.orderStatus === 'cooking'
                ? { act: 'batch-status', status: 'done', cls: 'green', label: '✓ 完成' }
                : '',
              { act: 'pick-delete', cls: 'danger', label: '🗑 删除' },
            ].filter(Boolean)
          )
        : admin && list.length
        ? `<div class="list-toolbar">
             <span class="section-sub">${S.groupByMember ? '按家人分组' : '按时间排序'}</span>
             ${pickOnBtn('orders', '☑ 批量操作')}
             <button class="btn ghost sm" data-act="toggle-group">
               ${S.groupByMember ? '⇅ 改成按时间' : '👨‍👩‍👧‍👦 按家人分组'}
             </button>
           </div>`
        : ''
    }
    ${listHtml}
    ${admin && S.pick === 'orders' ? '' : '<button class="fab" data-act="new-order">＋ 我要点餐</button>'}`;
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
    requester: meName(),
    people: 2,
    note: '',
  };
  // 弹层里的多选：点一下勾上，提交时一次下好几道
  S.orderPickSel = new Set(d ? [d.id] : []);

  const picker = scopeDishes()
    .map((x) => {
      const on = d && x.id === d.id;
      const paused = x.dishStatus === 'paused';
      const t = x.images && x.images[0] ? `<img src="${esc(x.images[0])}" alt="" />` : dishEmoji(x.name);
      return `<button class="picker-item" ${paused ? 'disabled' : ''} data-act="pick-dish" data-id="${esc(x.id)}" aria-pressed="${!!on}" title="${paused ? '暂停供应' : '正常供应'}">
        <span class="picker-thumb">${t}</span>
        <span style="flex:1;min-width:0">
          <span class="picker-name">${esc(x.name)}</span>
          ${x.category ? `<span class="tag">${esc(x.category)}</span>` : ''} ${paused ? dishStatusTag(x) : ''}
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
        <label class="field-label">选菜<span class="field-hint">可以多选，一次下好几道</span></label>
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
           <button class="btn" data-act="submit-order" id="ordSubmitBtn">提交点餐</button>`,
  });

  syncOrderPickBtn();
  const name = $('#ordName');
  if (name && !d) name.focus();
}

/** 提交按钮上的道数跟着勾选走 */
function syncOrderPickBtn() {
  const b = $('#ordSubmitBtn');
  if (!b) return;
  const n = (S.orderPickSel || new Set()).size;
  b.textContent = n > 1 ? `提交点餐（${n} 道）` : '提交点餐';
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
  const plannedFor = planItemDate(it, planWeek());
  meta.push(`📅 ${planDayLabel(plannedFor, planWeek())}`);
  meta.push(it.status === 'done' ? '✅ 已完成，库存已扣' : '待做');
  if (it.servings) meta.push(esc(it.servings));
  if (d && d.duration) meta.push(`⏱ ${d.duration}′`);
  if (it.note) meta.push(esc(it.note));

  // 多选模式：✕ 先让位，整行变成勾选框
  if (picking('plan')) {
    return pickRowHtml(
      'plan',
      it.id,
      'plan-item',
      `<div class="plan-thumb">${thumb}</div>
      <div class="plan-main">
        <div class="plan-name">${esc(it.name)}</div>
        ${meta.length ? `<div class="plan-meta">${meta.join(' · ')}</div>` : ''}
      </div>`
    );
  }

  const planAction = it.status === 'done'
    ? '<span class="section-sub">已完成</span>'
    : isHouseAdmin(S.householdId)
      ? `<button class="btn green sm" data-act="complete-plan-item" data-id="${esc(it.id)}">完成并扣库存</button>`
      : '<span class="section-sub">管理员完成并扣库存</span>';
  return `<div class="plan-item">
    <div class="plan-thumb">${thumb}</div>
    <div class="plan-main" role="button" tabindex="0" ${d ? `data-act="open-dish" data-id="${esc(d.id)}"` : ''}
      ${d ? `aria-label="查看 ${esc(it.name)} 做法"` : ''}>
      <div class="plan-name">${esc(it.name)}</div>
      ${meta.length ? `<div class="plan-meta">${meta.join(' · ')}</div>` : ''}
    </div>
    <div class="plan-actions">${planAction}<button class="icon-mini" data-act="rm-plan" data-id="${esc(it.id)}" aria-label="从计划里拿掉 ${esc(it.name)}">✕</button></div>
  </div>`;
}

function viewPlan() {
  const week = planWeek();
  if (S.planShopSelectionWeek !== week) {
    S.planShopSelected.clear();
    S.planShopSelectionWeek = week;
  }
  S.shopList = [];
  S.shopContext = { kind: 'plan', weekOf: week };
  const offset = planWeekOffset(week);
  const house = currentHousehold();
  const items = [...planItems(week)].sort((a, b) =>
    planItemDate(a, week).localeCompare(planItemDate(b, week)) ||
    String(a.addedAt || '').localeCompare(String(b.addedAt || ''))
  );
  const names = items.map((it) => it.name).join('、');

  // 只有能查到调料的菜才进采购汇总（自己随手写的那道不算）
  // 已完成的计划菜已经实际扣过库存，不再重复计入本周待采购需求。
  const dishIds = items.filter((it) => it.status !== 'done').map((it) => it.dishId).filter(Boolean);
  const shop = shoppingFromDishIds(dishIds);
  const received = (planRecord(week) || {}).received || {};
  shop.forEach((it) => {
    it.received = Boolean(received[shoppingIngredientKey(it.name)]);
  });
  const purchaseMaterials = shop.filter((it) => !it.isSeasoning);
  const purchaseShop = shop.filter((it) => !it.isSeasoning && stockAssessment(it).key !== 'enough');
  const stapleShop = shop.filter((it) => it.isSeasoning);
  const missing = purchaseShop.filter((it) => ['needed', 'shortage'].includes(stockAssessment(it).key));

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
        ${
          picking('plan')
            ? ''
            : `<button class="btn ghost sm" style="margin-left:auto" data-act="clear-plan">清空这一周</button>`
        }
      </div>
      ${
        picking('plan')
          ? pickBarHtml(
              'plan',
              items.map((it) => it.id),
              [{ act: 'pick-delete', cls: 'danger', label: '✕ 拿掉' }]
            )
          : `<div class="list-toolbar">
               <span class="section-sub">点一下 ✕ 拿掉一道</span>
               ${pickOnBtn('plan', '☑ 批量操作')}
             </div>`
      }
      ${items.map(planRow).join('')}`;
  }

  const shopSection = items.length
    ? `${purchaseMaterials.length || stapleShop.length ? `<div class="section-head">
        <h2 class="section-title">${purchaseMaterials.length ? '食材采购' : '备菜确认'}</h2>
        <span class="section-sub">${purchaseShop.length ? `${purchaseShop.length} 样待采购${missing.length ? ` · ${missing.length} 样库存不足` : ''}` : purchaseMaterials.length ? '没有待购食材 · 库存可覆盖' : `${stapleShop.length} 样调料待确认`}</span>
        ${isSuper() && aiReady() && shop.length ? `<button class="btn soft sm" style="margin-left:auto" data-act="ai-plan-analysis">✨ AI 备菜分析</button>` : ''}
        ${shop.length ? `<button class="btn soft sm" style="margin-left:auto" data-act="copy-plan-shopping">复制清单</button>` : ''}
      </div>` : ''}
      ${purchaseShop.length
        ? shopListHtml(purchaseShop, {
            bare: true,
            groupScope: 'plan-purchase',
            context: { kind: 'plan', weekOf: week },
            hint: '填写实际购买数量后入库；新增菜品造成新缺口时可再次补货。',
          })
        : ''}
      ${stapleShop.length ? `<div class="section-head" style="margin-top:18px">
        <h3 class="section-title" style="font-size:1.05rem">调料库存确认</h3>
        <span class="section-sub">${stapleShop.length} 样 · 不累计菜谱用量</span>
      </div>${shopListHtml(stapleShop, {
        bare: true,
        remember: false,
        groupScope: 'plan-seasonings',
        hint: '调料只确认家中是否有；没有时可手动勾选完成，或按实际购买数量入库。',
      })}` : ''}
      ${!shop.length ? '<p class="section-sub">给计划里的菜谱补充食材和调料名称，这里会按食材用量计算缺口，并单独提示调料库存。</p>' : ''}`
    : '';

  return `
    ${weekNav}
    ${listHtml}
    ${shopSection}
    ${S.pick === 'plan' ? '' : '<button class="fab" data-act="add-plan-dish">＋ 加一道菜</button>'}`;
}

/**
 * 加菜：先选菜谱里的（可多选），也能自己写一道临时的。
 * 周末排一周的菜，原来一道道点太慢，改成勾几道一次加进去。
 */
function openPlanPicker(weekOf) {
  const week = weekOf || planWeek();
  const plannedCount = new Map();
  planItems(week).forEach((it) => plannedCount.set(it.name, (plannedCount.get(it.name) || 0) + 1));
  S.planPickWeek = week;
  S.planPickSel = new Set();

  const picker = scopeDishes()
    .map((x) => {
      const count = plannedCount.get(x.name) || 0;
      const t = x.images && x.images[0] ? `<img src="${esc(x.images[0])}" alt="" />` : dishEmoji(x.name);
      return `<button class="picker-item" data-act="pick-plan-dish" data-id="${esc(x.id)}"
        aria-pressed="false">
        <span class="picker-thumb">${t}</span>
        <span style="flex:1;min-width:0">
          <span class="picker-name">${esc(x.name)}${count ? ` · 已排 ${count} 次` : ''}</span>
          ${x.category ? `<span class="tag">${esc(x.category)}</span>` : ''}
        </span>
      </button>`;
    })
    .join('');

  openSheet({
    title: `加到${planWeekTitle(week)}`,
    body: `
      <div class="field">
        <label class="field-label">安排日期<span class="field-hint">同一道菜可以在一周内重复安排</span></label>
        <input class="input" id="planDate" type="date" min="${esc(week)}" max="${esc(addDays(week, 6))}" value="${esc(week)}" />
      </div>
      <div class="field">
        <label class="field-label">从菜单里选<span class="field-hint">可以多选</span></label>
        <div class="picker-list">${picker}</div>
      </div>
      <div class="field">
        <label class="field-label">或者自己写一道<span class="field-hint">菜单里没有的，比如「楼下那家的烤鸭」</span></label>
        <input class="input" id="planName" placeholder="例如：红烧排骨" />
      </div>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-plan-picks" id="planAddBtn" disabled>加进去</button>`,
    onMount: syncPlanPickBtn,
  });
  $('#planName').focus();
}

/** 「加进去」按钮上的数量要跟着勾选实时变 */
function syncPlanPickBtn() {
  const b = $('#planAddBtn');
  if (!b) return;
  const n = (S.planPickSel || new Set()).size;
  b.disabled = n === 0;
  b.textContent = n ? `加 ${n} 道进去` : '加进去';
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
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'g') return 50;
  if (u === 'ml') return 100;
  if (u === 'kg' || u === 'l' || u === '斤') return 0.5;
  return 1;
}

function foodRow(p) {
  const presence = window.PantryLogic.inferTrackingMode(p) === 'presence';
  const st = shelfStatus(p);
  const low = Number(p.minQuantity) > 0 && Number(p.quantity) < Number(p.minQuantity);
  const flagText = presence ? (p.hasStock ? '家里有' : '家里没有') : Number(p.quantity) <= 0
    ? '用完，待补'
    : low ? `低于最低量 ${fmtQty(p.minQuantity)}${p.unit}`
    : st.key === 'none' ? (p.expireAt || '未填保质期') : st.label;
  const flagKey = low && st.key === 'none' ? 'low' : st.key;

  // 多选模式：整行变成一个勾选框，数量加减暂时让位（批量操作不需要先调数量）
  if (picking('pantry')) {
    const on = pickHas('pantry', p.id);
    return `<div class="food-row pick ${on ? 'on' : ''}" role="checkbox" tabindex="0"
      aria-checked="${on}" data-act="pick-item" data-k="pantry" data-id="${esc(p.id)}"
      aria-label="选择 ${esc(p.name)}">
      <span class="pick-box">${on ? '✓' : ''}</span>
      <div class="food-main">
        <div class="food-name">${esc(p.name)}
          ${presence ? '<span class="food-qty-inline">有 / 无</span>' : `<span class="food-qty-inline">${esc(fmtQty(p.quantity))}${esc(p.unit)}</span>`}
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
        ${presence ? '<span class="food-qty-inline">有 / 无' + '</span>' : `<span class="food-qty-inline">${esc(fmtQty(p.quantity))}${esc(p.unit)}</span>`}
      </div>
      <div class="food-sub">${esc(p.category)}${p.note ? ' · ' + esc(p.note) : ''}</div>
    </div>
    <div class="food-ops">
      <span class="food-flag flag-${flagKey}">${esc(flagText)}</span>
      ${presence
        ? `<button class="btn soft sm" data-act="toggle-presence" data-id="${esc(p.id)}" data-has="${p.hasStock ? '1' : '0'}">${p.hasStock ? '✓ 家里有' : '标记家里有'}</button>`
        : `<div class="stepper">
        <button class="step-btn" data-act="qty-dec" data-id="${esc(p.id)}" aria-label="减少 ${esc(p.name)}">−</button>
        <span class="step-val">${esc(fmtQty(p.quantity))}</span>
        <button class="step-btn" data-act="qty-inc" data-id="${esc(p.id)}"
          aria-label="增加 ${esc(p.name)}">${qtyStep(p.unit) === 1 ? '＋' : `+${esc(fmtQty(qtyStep(p.unit)))}`}</button>
      </div>`}
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
  const result = await api('PUT', `/api/pantry/${p.id}`, { ...p, quantity: next });
  await loadState(true);
  render();
  if (result.deleted) toast(`${p.name}已用完，已从库存移除`);
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

function pantryGroupOpen(category) {
  return S.pantryGroups[category] !== false;
}

function pantryGroupHtml(category, items) {
  const open = pantryGroupOpen(category);
  const ids = items.map((p) => p.id);
  const selected = ids.filter((id) => pickHas('pantry', id));
  const allOn = ids.length > 0 && selected.length === ids.length;
  const emptyCount = items.filter((p) => window.PantryLogic.inferTrackingMode(p) === 'presence'
    ? !p.hasStock
    : Number(p.quantity) <= 0).length;
  const select = picking('pantry')
    ? `<button class="category-group-select" data-act="select-pantry-group" data-cat="${esc(category)}" data-on="${allOn ? '0' : '1'}" role="checkbox" aria-checked="${allOn}">${allOn ? '☑' : '☐'} 全选</button>`
    : '';
  return `<section class="category-group pantry-category-group ${open ? 'is-open' : 'is-closed'}">
    <div class="category-group-head">
      <button class="category-group-toggle" data-act="toggle-pantry-group" data-cat="${esc(category)}" aria-expanded="${open}">
        <span class="category-group-caret">${open ? '⌄' : '›'}</span>
        <span class="category-group-title">${catEmoji(category)} ${esc(category)}</span>
        <span class="category-group-count">${items.length} 样${emptyCount ? ` · ${emptyCount} 用完` : ''}</span>
      </button>
      ${select}
    </div>
    ${open ? `<div class="category-group-body">${items.map(foodRow).join('')}</div>` : ''}
  </section>`;
}

const pantryNames = (ids) => {
  const set = new Set(ids);
  return householdPantry()
    .filter((p) => set.has(p.id))
    .map((p) => p.name);
};

/* ---------------- 留言板页 ---------------- */

/** 写留言的那一栏：选「我是谁」+ 挑贴纸 + 输入 */
function noteComposer() {
  const picked = S.noteSticker || '';
  const user = accountUser() || {};
  const identity = user.displayName || user.loginId || '当前账户';
  return `<div class="composer">
      <div class="composer-who">
        <span class="who on" aria-label="当前登录账户">${esc(user.emoji || '🙋')} ${esc(identity)}</span>
      </div>
      <div class="composer-stickers">
        ${STICKER_EMOJI.map(
          (s) =>
            `<button class="sticker ${s === picked ? 'on' : ''}" data-act="note-sticker" data-s="${esc(s)}"
              aria-pressed="${s === picked}">${s}</button>`
        ).join('')}
      </div>
      <div class="composer-row">
        <textarea class="textarea" id="noteText" rows="2" maxlength="500"
          placeholder="说点什么…「今晚我做饭」「冰箱里还有排骨」「谁去买菜？」"></textarea>
        <button class="btn" data-act="note-send">发一条</button>
      </div>
    </div>`;
}

function viewBoard() {
  const list = boardNotes();
  const house = currentHousehold();

  const toolbar = picking('notes')
    ? pickBarHtml('notes', list.map((n) => n.id), [
        { act: 'pick-delete', cls: 'danger', label: '🗑 删除' },
      ])
    : list.length
    ? `<div class="list-toolbar">
         <span class="section-sub">${list.length} 条留言</span>
         ${pickOnBtn('notes')}
       </div>`
    : '';

  return `
    <div class="section-head">
      <h2 class="section-title">留言板</h2>
      <span class="section-sub">${house ? esc(house.emoji + ' ' + house.name) : ''}</span>
    </div>
    ${noteComposer()}
    ${toolbar}
    ${
      list.length
        ? list.map((n) => noteCard(n, { pick: picking('notes') })).join('')
        : `<div class="empty">
             <span class="empty-emoji">💬</span>
             <p class="empty-title">还没人留言</p>
             <p class="empty-text">上面写一条，比如「今晚我做饭」「谁去买菜」</p>
           </div>`
    }
    ${
      picking('notes')
        ? ''
        : '<button class="fab" data-act="note-focus">💬 写一条</button>'
    }`;
}

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
    const rank = { expired: 0, today: 1, soon: 2, ok: 3, none: 4 };
    const groups = groupedByCategory(list, (p) => p.category).map(([cat, items]) => {
      items.sort(
        (a, b) => rank[shelfStatus(a).key] - rank[shelfStatus(b).key] || a.name.localeCompare(b.name, 'zh')
      );
      return [cat, items];
    });
    body = groups.map(([cat, items]) => pantryGroupHtml(cat, items)).join('');
  }

  // 多选模式的工具条：全选、已选几样、批量改、删掉
  const pickBar = picking('pantry')
    ? pickBarHtml(
        'pantry',
        list.map((p) => p.id),
        [
          { act: 'batch-expire', cls: 'soft', label: '📅 改保质期' },
          { act: 'batch-cat', cls: 'soft', label: '🏷 改分类' },
          { act: 'pick-delete', cls: 'danger', label: '🗑 删除' },
        ]
      )
    : all.length
    ? `<div class="list-toolbar">
        <span class="section-sub">${all.length} 样食材</span>
        ${pickOnBtn('pantry', '☑ 批量操作')}
      </div>`
    : '';

  return `
    ${alertHtml}
    ${pickBar}
    ${isSuper() && aiReady() && all.length ? `<div class="list-toolbar"><span class="section-sub">分类只用于分组，跟踪方式决定是否比较数量</span><button class="btn soft sm" data-act="ai-pantry-classify">✨ AI 整理分类</button></div>` : ''}
    <div class="stat-row">
      <div class="stat"><div class="stat-num">${all.length}</div><div class="stat-label">样食材</div></div>
      <div class="stat${soon.length ? ' warn' : ''}"><div class="stat-num">${soon.length}</div><div class="stat-label">快过期</div></div>
      <div class="stat${expired.length ? ' bad' : ''}"><div class="stat-num">${expired.length}</div><div class="stat-label">已过期</div></div>
    </div>
    <div class="chip-row">${filterChips}</div>
    <div class="chip-row">${catChips}</div>
    ${body}
    ${S.pick === 'pantry' ? '' : '<button class="fab" data-act="new-food">＋ 记一样食材</button>'}`;
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

function foodCategoryPickerHtml(category, categoryId) {
  const categories = householdPantryCategories();
  const current = categories.find((item) => item.id === categoryId) || categories.find((item) => pantryCategoryPath(item.id, categories) === category) ||
    categories.find((item) => item.name === category && !item.parentId) || categories.find((item) => item.name === '其他');
  const currentPath = current ? pantryCategoryPath(current.id, categories) : '其他';
  return `<input type="hidden" id="fFoodCat" value="${esc(currentPath)}" />
    <input type="hidden" id="fFoodCategoryId" value="${esc(current ? current.id : '')}" />
    <div class="pantry-category-picker" role="listbox" aria-label="库存分类">
      ${categories.map((item) => {
        const path = pantryCategoryPath(item.id, categories);
        return `<button type="button" class="pantry-category-option ${item.id === (current && current.id) ? 'on' : ''}"
        data-act="pick-food-category" data-cat="${esc(path)}" data-category-id="${esc(item.id)}" aria-pressed="${item.id === (current && current.id)}">
        <span>${catEmoji(item.name)}</span><span>${esc(path)}</span>
      </button>`;
      }).join('')}
    </div>`;
}

function syncFoodCategoryPicker(category, categoryId) {
  document.querySelectorAll('.pantry-category-option').forEach((btn) => {
    const on = categoryId ? btn.dataset.categoryId === categoryId : btn.dataset.cat === category;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

async function openFoodEditor(item) {
  await ensurePresets();
  const p = item || {
    id: null,
    name: '',
    category: '蔬菜',
    quantity: 1,
    minQuantity: 0,
    unit: '份',
    trackingMode: 'quantity',
    hasStock: false,
    expireAt: '',
    note: '',
  };
  const selectedIngredient = ingredientById(p.ingredientId) || ingredientByName(p.name);

  openSheet({
    title: item ? '编辑食材' : '记一样食材',
    body: `
      <div class="field">
        <label class="field-label">食材名 *</label>
        ${ingredientNameDatalist('pantryIngredients')}
        <input class="input" id="fFoodName" list="pantryIngredients" value="${esc(p.name)}" placeholder="例如：鸡蛋" />
        <input type="hidden" id="fFoodIngredientId" value="${esc(selectedIngredient ? selectedIngredient.id : '')}" />
      </div>
      <div class="field">
        <label class="field-label">常见食材<span class="field-hint">点一下自动填分类、单位、保质期</span></label>
        <input class="input" id="fPresetSearch" type="search" placeholder="搜食材名…" autocomplete="off" />
        <div class="preset-grid" id="fPresets"></div>
      </div>
      <div class="field">
        <label class="field-label">分类</label>
        ${foodCategoryPickerHtml(p.category, selectedIngredient && selectedIngredient.categoryId)}
      </div>
      <div class="field">
        <label class="field-label">库存记录方式</label>
        <select class="input" id="fFoodTracking">
          <option value="quantity" ${window.PantryLogic.inferTrackingMode(p) === 'quantity' ? 'selected' : ''}>按数量记录</option>
          <option value="presence" ${window.PantryLogic.inferTrackingMode(p) === 'presence' ? 'selected' : ''}>只记录家里有 / 没有</option>
        </select>
      </div>
      <div id="fFoodQuantityFields" ${window.PantryLogic.inferTrackingMode(p) === 'presence' ? 'hidden' : ''}>
      <div class="field">
        <label class="field-label">家里还有多少</label>
        <div class="row-2">
          <input class="input" id="fFoodQty" type="number" min="0" step="0.01" value="${esc(fmtQty(p.quantity))}" />
          <input class="input" id="fFoodUnit" value="${esc(p.unit)}" list="unitList" placeholder="单位" />
        </div>
        <datalist id="unitList">${UNITS.map((u) => `<option value="${esc(u)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">最低保有量<span class="field-hint">低于这个数量时提示补货，可不填</span></label>
        <div class="row-2">
          <input class="input" id="fFoodMin" type="number" min="0" step="0.01" value="${esc(fmtQty(p.minQuantity || 0))}" />
          <div class="input" style="background:var(--bg-soft);color:var(--muted)">${esc(p.unit || '份')}</div>
        </div>
      </div>
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

/**
 * 不是超级管理员时看到的「管理」页。
 *
 * 分两种人，差别很大：
 *   家庭管理员 —— 能管成员、家庭设置、做饭状态和自己创建的菜
 *   普通成员   —— 只能动自己写的那几道；别人的和共享的都是只读，
 *                 想改成自己的做法就按「👇 收进我家」抄一份
 */
function manageSearchText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function manageSearchHtml() {
  return `<div class="manage-search">
    <span class="manage-search-icon">⌕</span>
    <input class="input" id="manageKeyword" type="search" value="${esc(S.manageKeyword)}" placeholder="模糊搜索管理项：成员、备份、AI…" autocomplete="off" />
    <button class="icon-mini" data-act="clear-manage-search" title="清除搜索" ${S.manageKeyword ? '' : 'hidden'}>✕</button>
  </div>`;
}

function manageGroupHidden(terms) {
  const keyword = manageSearchText(S.manageKeyword);
  return keyword && !manageSearchText(terms).includes(keyword) ? ' hidden' : '';
}

function manageGroup(key, title, subtitle, body, terms = '') {
  const keyword = manageSearchText(S.manageKeyword);
  const hay = manageSearchText([title, subtitle, terms].join(' '));
  if (keyword && !hay.includes(keyword)) return '';
  const open = S.manageGroups[key] !== false;
  return `<details class="manage-group" data-manage-group="${esc(key)}" ${open ? 'open' : ''}>
    <summary><span><b>${esc(title)}</b><small>${esc(subtitle)}</small></span><span class="manage-group-caret">⌄</span></summary>
    <div class="manage-group-body">${body}</div>
  </details>`;
}

function joinRequestRows(requests) {
  if (!requests.length) return '';
  return `<div class="join-box">
    <div class="join-title">📨 ${requests.length} 个加入申请</div>
    ${requests.map((r) => {
      const h = households().find((x) => x.id === r.householdId);
      const requestedRole = r.requestedRole === 'owner' ? '申请成为管理员' : '申请成为成员';
      return `<div class="list-row join-request-row">
        <span class="member-avatar">🙋</span>
        <span class="list-row-main">
          <span class="list-row-title">${esc(r.name)} 想加入 ${esc(h ? h.name : '（已删除）')}</span>
          <span class="list-row-sub">${esc(requestedRole)} · ${esc(relTime(r.at))}${r.note ? ' · ' + esc(r.note) : ''}</span>
        </span>
        <span class="join-request-actions">
          <button class="btn sm" data-act="join-decide" data-id="${esc(r.id)}" data-role="member" data-ok="1">批准为成员</button>
          <button class="btn soft sm" data-act="join-decide" data-id="${esc(r.id)}" data-role="owner" data-ok="1">批准为管理员</button>
          <button class="icon-mini" data-act="join-decide" data-id="${esc(r.id)}" data-role="member" data-ok="0" title="拒绝">✕</button>
        </span>
      </div>`;
    }).join('')}
  </div>`;
}

function viewManageMember() {
  const admin = anyHouseAdmin();
  const house = currentHousehold();
  const ownWaiting = admin
    ? (S.access || []).filter((r) => r.status === 'pending' && r.householdId === S.householdId)
    : [];

  const row = (x) => {
    const ok = canEdit(x);
    return `<div class="list-row" role="button" tabindex="0" data-act="open-dish" data-id="${esc(x.id)}" title="打开这道菜的详情">
      <span class="icon-mini act">${x.images && x.images[0] ? '🖼️' : dishEmoji(x.name)}</span>
      <span class="list-row-main">
        <span class="list-row-title">${esc(x.name)}${ownTag(x)}${
          x.authorName ? `<span class="pill-now" title="作者">${esc(memberEmoji(x.authorName))} ${esc(dishAuthor(x))}</span>` : ''
        }</span>
        <span class="list-row-sub">${esc(x.category)} · ${(x.methods || []).length} 种做法 · ${(x.seasonings || []).length} 样调料 · ${dishStatusTag(x)}</span>
      </span>
      ${dishStatusAction(x)}
      ${
        ok
          ? `<button class="icon-mini" data-act="edit-dish" data-id="${esc(x.id)}" title="编辑">✏️</button>
             <button class="icon-mini" data-act="del-dish" data-id="${esc(x.id)}" title="删除">🗑️</button>`
          : adoptBtn(x, 'btn soft sm')
      }
      ${copyToSharedBtn(x, 'btn soft sm')}
    </div>`;
  };

  const dishes = manageDishRows();
  const mine = dishes.filter((x) => canEdit(x));
  const shared = dishes.filter((x) => !canEdit(x));
  const myCats = sortedCategories().filter((c) => canEdit(c));
  const publicCats = sortedCategories().filter((c) => !canEdit(c));

  const roleLine = admin
    ? `你是「${house ? house.name : ''}」的家庭管理员：可以审批成员、修改家庭设置和做饭状态；菜谱仍由作者本人维护。`
    : `这里是 <b>你自己写的</b>那几道菜。共享菜单和别人的私菜只能查看；需要自己的版本请在本家私菜中手动新建。`;

  return `
    <div class="admin-warn" style="background:#f1f6f2;border-color:#cfe3d4">
      <div class="admin-warn-title" style="color:#2f6b45">
        ${admin ? '🔑' : '🏠'} ${esc(house ? house.name : '')}的厨房
        <span class="pill-now" style="margin-left:8px">${esc(ROLE_LABEL[myRole()])}</span>
      </div>
      <p class="admin-warn-text" style="color:var(--text-mid)">${esc(roleLine)}</p>
    </div>
    ${familySquareHtml()}

    ${
      house && house.status !== 'approved'
        ? `<div class="admin-warn" style="background:#fdf6ec;border-color:#f0e0c8">
             <div class="admin-warn-title" style="color:#8a5a12">⏳ 这是一个「普通家庭」</div>
             <p class="admin-warn-text" style="color:var(--text-mid)">
               自己用没问题，但往共享菜单放东西、拉人进家，得超级管理员点头升级成「正式家庭」。
             </p>
           </div>`
        : ''
    }

    <details class="manage-group" open>
      <summary class="manage-group-title"><span>菜单与日常数据</span><span class="manage-chevron">⌄</span></summary>
    ${
      admin
        ? `<div class="section-head">
             <h2 class="section-title">共享菜单<span class="section-sub" style="margin-left:8px">全体家庭共用</span></h2>
             <button class="btn soft sm" style="margin-left:auto" data-act="new-dish">＋ 记一道</button>
           </div>
           ${
             shared.length
               ? shared.map(row).join('')
               : '<div class="empty" style="padding:24px"><p class="empty-text">共享菜单还是空的</p></div>'
           }`
        : ''
    }

    <div class="section-head">
      <h2 class="section-title">${admin ? '我家私菜' : '我写的菜'}</h2>
      <div class="dish-tools"><button class="btn ghost sm" data-act="batch-export-open">🖼 批量导出</button><button class="btn soft sm" data-act="new-dish">＋ 记一道</button></div>
    </div>
    ${
      mine.length
        ? mine.map(row).join('')
        : `<div class="empty" style="padding:28px"><p class="empty-text">${
            admin ? '还没记过自家私菜。' : '你还没写过菜。'
          }点上面「＋ 记一道」${
            shared.length ? '，或者从下面的共享菜单抄一份' : ''
          }</p></div>`
    }

    ${
      !admin && shared.length
        ? `<div class="section-head">
             <h2 class="section-title">共享菜单<span class="section-sub" style="margin-left:8px">只读</span></h2>
           </div>
           ${shared.map(row).join('')}`
        : ''
    }

    <div class="section-head">
      <h2 class="section-title">我的分类</h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-cat">＋ 新增</button>
    </div>
    ${
      myCats.length
        ? myCats
            .map(
              (c) => `<div class="list-row">
                <span class="list-row-main">
                  <span class="list-row-title">${esc(c.name)}${ownTag(c)}</span>
                  <span class="list-row-sub">${scopeDishes().filter((x) => x.category === c.name).length} 道菜 · 只有本家看得见</span>
                </span>
                <button class="icon-mini" data-act="edit-cat" data-id="${esc(c.id)}">✏️</button>
                <button class="icon-mini" data-act="del-cat" data-id="${esc(c.id)}">🗑️</button>
              </div>`
            )
            .join('')
        : '<div class="empty" style="padding:24px"><p class="empty-text">还没有私有分类</p></div>'
    }

    ${
      publicCats.length
        ? `<div class="section-head"><h2 class="section-title">共享分类<span class="section-sub" style="margin-left:8px">只读</span></h2></div>
           ${publicCats
             .map(
               (c) => `<div class="list-row">
                 <span class="list-row-main">
                   <span class="list-row-title">${esc(c.name)}</span>
                   <span class="list-row-sub">全体共享 · 管理员维护</span>
                 </span>
               </div>`
             )
             .join('')}`
        : ''
    }

    ${
      admin
        ? `<div class="section-head"><h2 class="section-title">这个家的设置</h2></div>
           <div class="list-row"><span class="icon-mini">🏠</span><span class="list-row-main">
             <span class="list-row-title">家庭名称与图标</span>
             <span class="list-row-sub">${esc(house ? house.name : '')}${house && house.note ? ' · ' + esc(house.note) : ''}</span>
           </span><button class="btn ghost sm" data-act="edit-household" data-id="${esc(S.householdId)}">编辑</button></div>
           <div class="list-row"><span class="icon-mini">👨‍👩‍👧</span><span class="list-row-main">
             <span class="list-row-title">家庭成员</span>
             <span class="list-row-sub">${memberList().length} 位 · 通过成员关系设置家庭管理员权限</span>
           </span><button class="btn ghost sm" data-act="open-members">管理</button></div>
           ${joinRequestRows(ownWaiting)}`
        : `<div class="section-head"><h2 class="section-title">管理员入口</h2></div>
           <div class="list-row"><span class="icon-mini">🔐</span><span class="list-row-main">
             <span class="list-row-title">超级管理员设置</span>
             <span class="list-row-sub">成员关系、家庭设置和做饭状态由家庭管理员维护</span>
           </span><button class="btn ghost sm" data-act="unlock">输入管理口令</button></div>`
    }
    </details>`;
}

function viewManage() {
  // 前端拿不到口令明文了，改成看 hasPin 标记 + 本机有没有会话 token
  if (!isSuper()) return accountSettingsHtml() + viewManageMember();

  const s = S.data.settings;
  const admin = isSuper();
  const d = scopeDishes();
  const nPrivate = d.filter((x) => isPrivate(x)).length;

  const dishRows = manageDishRows()
    .map((x) => {
      // 多选模式：编辑/复制/删除先让位，整行变成勾选框
      if (picking('dishes')) {
        return pickRowHtml(
          'dishes',
          x.id,
          'list-row',
          `<span class="icon-mini act">${x.images && x.images[0] ? '🖼️' : dishEmoji(x.name)}</span>
          <span class="list-row-main">
            <span class="list-row-title">${esc(x.name)}${ownTag(x)}</span>
          <span class="list-row-sub">${esc(x.category)} · ${(x.methods || []).length} 种做法 · ${(x.seasonings || []).length} 样调料 · ${dishStatusTag(x)}</span>
          </span>`
        );
      }
      return `<div class="list-row" role="button" tabindex="0" data-act="open-dish" data-id="${esc(x.id)}" title="打开这道菜的详情">
        <span class="icon-mini act">${x.images && x.images[0] ? '🖼️' : dishEmoji(x.name)}</span>
        <span class="list-row-main">
          <span class="list-row-title">${esc(x.name)}${ownTag(x)}</span>
        <span class="list-row-sub">${esc(x.category)} · ${(x.methods || []).length} 种做法 · ${(x.seasonings || []).length} 样调料 · ${dishStatusTag(x)}${x.authorName ? ` · ${esc(dishAuthor(x))}` : ''}</span>
        </span>
        ${dishStatusAction(x)}
        ${
          canEdit(x)
            ? `<button class="icon-mini" data-act="edit-dish" data-id="${esc(x.id)}" title="编辑">✏️</button>
               <button class="icon-mini" data-act="dup-dish" data-id="${esc(x.id)}" title="复制">⧉</button>
               <button class="icon-mini" data-act="del-dish" data-id="${esc(x.id)}" title="删除">🗑️</button>`
            : adoptBtn(x, 'btn soft sm')
        }
      </div>`;
    })
    .join('');

  const catRows = sortedCategories()
    .map(
      (c) => `<div class="list-row">
        <span class="list-row-main">
          <span class="list-row-title">${esc(c.name)}${ownTag(c)}</span>
          <span class="list-row-sub">${d.filter((x) => x.category === c.name).length} 道菜${isPrivate(c) ? ' · 只有本家看得见' : ' · 全体共享'}</span>
        </span>
        ${
          canEdit(c)
            ? `<button class="icon-mini" data-act="edit-cat" data-id="${esc(c.id)}">✏️</button>
               <button class="icon-mini" data-act="del-cat" data-id="${esc(c.id)}">🗑️</button>`
            : '<span class="pill-own" title="公共分类由管理员维护">🔒 管理员</span>'
        }
      </div>`
    )
    .join('');

  // 等管理员点头的加入申请
  const waiting = (S.access || []).filter((r) => r.status === 'pending');
  const joinRows = joinRequestRows(waiting);

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
        ${
          admin
            ? `<button class="icon-mini" data-act="edit-household" data-id="${esc(h.id)}" title="重命名">✏️</button>
               <button class="icon-mini" data-act="del-household" data-id="${esc(h.id)}" title="删除">🗑️</button>`
            : ''
        }
      </div>`
    )
    .join('');

  return accountSettingsHtml() + familySquareHtml() + manageSearchHtml() + `
    <details class="manage-group${manageGroupHidden('家庭 家庭名称 图标 成员 管理员 权限 申请 加入 口令') }" data-manage-group="family" data-manage-search="家庭 家庭名称 图标 成员 管理员 权限 申请 加入 口令" ${S.manageGroups.family === false ? '' : 'open'}>
      <summary><span><b>家庭与成员</b><small>家庭列表、改名、成员权限、加入申请</small></span><span class="manage-group-caret">⌄</span></summary>
      <div class="manage-group-body">
    ${
      s.hasPin
        ? ''
        : `<div class="admin-warn">
             <div class="admin-warn-title">⚠️ 还没设管理口令</div>
             <p class="admin-warn-text">
               现在<b>局域网里任何人都能改菜谱、加分类、删菜</b>。设一个口令之后，
               就只有知道口令的那几位家人能编辑菜单 —— 其余人照样能浏览菜谱、点餐、留言、管库存。
             </p>
             <button class="btn sm" data-act="edit-settings">去设口令</button>
           </div>`
    }
    <div class="section-head">
      <h2 class="section-title">家庭</h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-household">＋ 添加家庭</button>
    </div>
    <p class="section-sub" style="margin:-6px 0 12px">菜单分共享菜和本家私菜：共享的全体家庭都看得见，私的只有本家看得见；点餐和库存一直各记各的。</p>
    ${joinRows}
    ${houseRows}
      </div>
    </details>

    <details class="manage-group${manageGroupHidden('菜单 菜品 分类 做饭 批量 数据') }" data-manage-group="menu" data-manage-search="菜单 菜品 分类 做饭 批量 数据" ${S.manageGroups.menu === false ? '' : 'open'}>
      <summary><span><b>菜单与日常数据</b><small>菜品、分类、做饭和批量管理</small></span><span class="manage-group-caret">⌄</span></summary>
      <div class="manage-group-body">
    <div class="stat-row">
      <div class="stat"><div class="stat-num">${d.length}</div><div class="stat-label">道菜</div></div>
      <div class="stat"><div class="stat-num">${sortedCategories().length}</div><div class="stat-label">个分类</div></div>
      <div class="stat"><div class="stat-num">${pendingOrders().length}</div><div class="stat-label">道待做</div></div>
    </div>

    <div class="section-head">
      <h2 class="section-title">菜品管理</h2>
      ${
        picking('dishes')
          ? ''
          : `<div class="dish-tools"><button class="btn ghost sm" data-act="batch-import-open">🖼 批量导入</button><button class="btn ghost sm" data-act="batch-export-open">🖼 批量导出</button><button class="btn soft sm" data-act="new-dish">＋ ${admin ? '新增' : '记我家私菜'}</button></div>`
      }
    </div>
    ${
      picking('dishes')
        ? pickBarHtml(
            'dishes',
            manageDishRows().map((x) => x.id),
            [
              { act: 'batch-cat', cls: 'soft', label: '🏷 改分类' },
              { act: 'batch-tags', cls: 'soft', label: '🏷 标签' },
              { act: 'pick-delete', cls: 'danger', label: '🗑 删除' },
            ]
          )
        : d.length
        ? `<div class="list-toolbar">
             <span class="section-sub">${d.length} 道菜${nPrivate ? `（其中 ${nPrivate} 道仅本家可见）` : ''}</span>
             ${pickOnBtn('dishes', '☑ 批量操作')}
           </div>`
        : ''
    }
    ${dishRows || '<div class="empty"><p class="empty-text">还没有菜</p></div>'}
    ${
      admin || !nPrivate
        ? ''
        : `<p class="section-sub" style="margin-top:12px">
             上面标着 🔒 的是公共菜谱，由管理员维护。看得见改不了 —— 想要自己的版本，按「👇 收进我家」抄一份再改。
           </p>`
    }

    <div class="section-head">
      <h2 class="section-title">家庭成员<span class="section-sub" style="margin-left:8px">${esc(currentHousehold() ? currentHousehold().name : '')}</span></h2>
    </div>
    ${membersHtml()}

    <div class="section-head">
      <h2 class="section-title">分类管理</h2>
      <button class="btn soft sm" style="margin-left:auto" data-act="new-cat">＋ ${admin ? '新增' : '新增私有分类'}</button>
    </div>
    ${catRows || '<div class="empty" style="padding:24px"><p class="empty-text">还没有分类</p></div>'}
      </div>
    </details>

    <details class="manage-group${manageGroupHidden('系统 口令 AI 版本 关于 数据 导出 恢复 备份') }" data-manage-group="system" data-manage-search="系统 口令 AI 版本 关于 数据 导出 恢复 备份" ${S.manageGroups.system === false ? '' : 'open'}>
      <summary><span><b>系统与备份</b><small>全局口令、AI、版本、导出和恢复</small></span><span class="manage-group-caret">⌄</span></summary>
      <div class="manage-group-body">
    <div class="section-head"><h2 class="section-title">家庭设置</h2></div>
    <div class="list-row"><span class="icon-mini">🍽️</span><span class="list-row-main">
      <span class="list-row-title">店名与欢迎语</span>
      <span class="list-row-sub">${esc(s.shopName)} · 共 ${households().length} 个家庭</span>
    </span><button class="icon-mini" data-act="edit-settings">✏️</button></div>
    <div class="list-row"><span class="icon-mini">🔐</span><span class="list-row-main">
      <span class="list-row-title">管理口令</span>
      <span class="list-row-sub">${
        s.hasPin ? '已开启 · 只有知道口令的人能改菜单' : '未开启 · 现在谁都能改菜单'
      }</span>
    </span><button class="icon-mini" data-act="edit-settings">✏️</button></div>
    <div class="list-row"><span class="icon-mini">🤖</span><span class="list-row-main">
      <span class="list-row-title">AI 助手</span>
      <span class="list-row-sub">${
        aiReady()
          ? `已就绪 · ${esc(aiInfo.model)} · 只做菜谱录入（拍照 / 粘贴文字）和厨房调度建议`
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
    <input type="file" id="importFile" accept="application/zip,application/json,.zip,.json" hidden />
      </div>
    </details>`;
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
  const editing = !!house;
  openSheet({
    title: editing ? `编辑「${house.name}」` : '添加家庭',
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
              `<button class="emoji-opt ${e === h.emoji ? 'on' : ''}" data-act="pick-house-emoji" data-e="${esc(e)}">${esc(e)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label">备注<span class="field-hint">住哪、几口人，随你写</span></label>
        <input class="input" id="hNote" value="${esc(h.note)}" placeholder="例如：3 号楼 502" />
      </div>
      ${
        editing
          ? `<div class="field">
              <label class="field-label">家庭状态</label>
              <div class="list-row static">
                <span class="list-row-title">${
                  h.status === 'approved' ? '✅ 正式家庭' : '⏳ 普通家庭（待启用）'
                }</span>
                <span class="list-row-sub">${
                  h.status === 'approved'
                    ? '可以进共享菜单、拉人进家'
                    : '能用，但共享菜单和拉人得超级管理员点头'
                }</span>
              </div>
              ${
                isSuper() && h.status !== 'approved'
                  ? '<button class="btn soft sm" style="margin-top:8px" data-act="approve-household" data-id="' +
                    esc(h.id) +
                    '">✅ 升级为正式家庭</button>'
                  : ''
              }
              ${
                isSuper() && h.status === 'approved'
                  ? '<button class="btn ghost sm" style="margin-top:8px" data-act="downgrade-household" data-id="' +
                    esc(h.id) +
                    '">降回普通家庭</button>'
                  : ''
              }
            </div>
            <p class="section-sub">家庭权限由成员角色控制：owner 是家庭管理员，member 只能使用家庭功能。</p>`
          : `<p class="section-sub">
              新建的家庭从零开始：没有点餐记录、库存是空的。菜谱是所有家庭共享的，不用重复录。
            </p>
            <p class="section-sub" style="margin-top:8px">
              新建家庭立即可用，创建者自动成为管理员；之后可以在成员设置里增加其他管理员。
            </p>`
      }`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="save-household" data-id="${house ? esc(house.id) : ''}">保存</button>`,
  });
  $('#hName').focus();
}

/* =========================================================
   菜品编辑
   ========================================================= */

function seasoningTypeSelect(type, attrs) {
  const v = ['staple', 'purchase'].includes(type) ? type : '';
  return `<select class="mini-input" ${attrs || ''} aria-label="调料采购类型">
    <option value="" ${v === '' ? 'selected' : ''}>自动判断</option>
    <option value="staple" ${v === 'staple' ? 'selected' : ''}>常备调料</option>
    <option value="purchase" ${v === 'purchase' ? 'selected' : ''}>需要采购</option>
  </select>`;
}

function openDishEditor(dish) {
  const cats = sortedCategories();
  const newHouseholdId = dish ? dish.householdId : newDishHouseholdId();
  const availableCats = cats.filter((category) => !category.householdId || category.householdId === newHouseholdId);
  const d =
    dish ||
    {
      id: null,
      name: '',
      category: availableCats[0] ? availableCats[0].name : '家常菜',
      // 新菜归属由当前菜单栏目决定；已有菜编辑时保留原归属。
      householdId: newHouseholdId,
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

  const catList = cats.filter((category) => !category.householdId || category.householdId === d.householdId);
  // 分类可能已经不存在了（老数据、或手工改过 json）。
  // 少了这一项的话 select 会静默显示第一项，用户随便改个别的字段保存，这道菜的分类就被偷偷改掉了
  if (d.category && !catList.some((c) => c.name === d.category)) {
    catList.push({ name: d.category, householdId: null, orphan: true });
  }
  const catOptions = catList
    .map(
      (c) =>
        `<option value="${esc(c.name)}" ${d.category === c.name ? 'selected' : ''}>${esc(c.name)}${c.orphan ? '（分类已不存在）' : isPrivate(c) ? '（仅本家）' : ''}</option>`
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
          admin && aiReady()
            ? `<div style="display:flex;gap:8px;margin-top:10px">
                 <label class="btn soft sm ai-btn" style="flex:1">
                   📷 拍张照，AI 帮我写这道菜
                   <input type="file" id="fAiImgFile" accept="image/*" class="ai-file" />
                 </label>
                 <button class="btn soft sm ai-btn" style="flex:1" data-act="ai-text-open">📋 粘贴文字，AI 帮我写</button>
               </div>
               <div id="aiPasteBox" hidden style="margin-top:10px">
                 <textarea class="textarea" id="fAiText" rows="8"
                   placeholder="把菜单/做法整段贴进来，纸质菜单、外卖页面、群里转发的做法都行"></textarea>
                 <button class="btn sm block" style="margin-top:8px" data-act="ai-from-text">让 AI 整理成菜谱</button>
               </div>
               <p class="field-hint" style="margin-top:6px">
                 AI 只负责把照片或文字<b>填进这个表单</b>，<b>不会自己加进菜单</b>；
                 它不知道你家已经有哪些菜，填完由你确认、保存。
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
        <label class="field-label">通用调料<span class="field-hint">“自动判断”会把「调味干货」当常备；可逐项切换为常备或需要采购</span></label>
        ${ingredientNameDatalist('dishIngredients')}
        <div id="fSeasons">
          ${d.seasonings
            .map(
              (s, i) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 112px auto;gap:6px;margin-bottom:8px">
                <input class="mini-input" list="dishIngredients" data-act="season-name" data-i="${i}" value="${esc(s.name)}" placeholder="原料名（可搜索家庭原料）" />
                <input class="mini-input" data-act="season-amt" data-i="${i}" value="${esc(s.amount)}" placeholder="用量" />
                ${seasoningTypeSelect(s.purchaseType, `data-act="season-type" data-i="${i}"`)}
                <button class="del-btn" data-act="rm-season" data-i="${i}">✕</button>
              </div>`
            )
            .join('')}
        </div>
        <button class="btn ghost sm" data-act="add-season">＋ 加一味调料</button>
        ${S.householdId ? '<button class="btn soft sm" data-act="quick-add-ingredient">＋ 新建家庭原料</button>' : ''}
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
        admin && aiReady()
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

/* ---------------- 菜谱图片批量导入 / 导出 ---------------- */

function batchDishFromAI(result, imageUrl) {
  const r = result || {};
  const householdId = newDishHouseholdId();
  const cats = sortedCategories().filter((category) => !category.householdId || category.householdId === householdId);
  const wantedCat = String(r.category || '').trim();
  const category = cats.some((c) => c.name === wantedCat) ? wantedCat : cats[0]?.name || '家常菜';
  const toText = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const tags = Array.isArray(r.tags)
    ? r.tags.map((x) => toText(x, 24)).filter(Boolean).slice(0, 12)
    : toText(r.tags, 160).split(/[,，、]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const seasonings = Array.isArray(r.seasonings)
    ? r.seasonings.map((s) => ({ name: toText(s && s.name, 40), amount: toText(s && s.amount, 40), purchaseType: s && ['staple', 'purchase'].includes(s.purchaseType) ? s.purchaseType : '' })).filter((s) => s.name)
    : [];
  const methods = Array.isArray(r.methods)
    ? r.methods.map((m, i) => ({
        name: toText(m && m.name, 40) || `做法 ${i + 1}`,
        seasonings: Array.isArray(m && m.seasonings)
          ? m.seasonings.map((s) => ({ name: toText(s && s.name, 40), amount: toText(s && s.amount, 40), purchaseType: s && ['staple', 'purchase'].includes(s.purchaseType) ? s.purchaseType : '' })).filter((s) => s.name)
          : [],
        steps: Array.isArray(m && m.steps) ? m.steps.map((x) => toText(x, 240)).filter(Boolean).slice(0, 30) : [],
      })).filter((m) => m.steps.length || m.seasonings.length)
    : [];
  return {
    id: null,
    name: toText(r.name, 80),
    category,
    description: toText(r.description, 240),
    images: imageUrl ? [imageUrl] : [],
    servings: toText(r.servings, 40),
    duration: Number.isFinite(Number(r.duration)) ? Math.max(0, Math.round(Number(r.duration))) : '',
    difficulty: ['简单', '中等', '有点难'].includes(r.difficulty) ? r.difficulty : '简单',
    tags,
    seasonings,
    methods,
    notes: toText(r.notes, 500),
    isFavorite: false,
    householdId,
    _selected: true,
  };
}

function batchImportRowsHtml() {
  return S.batchImport.map((d, i) => `<div class="batch-recipe-row">
    <label class="batch-recipe-check"><input type="checkbox" data-batch-act="batch-import-toggle" data-i="${i}" ${d._selected ? 'checked' : ''} />
      <span class="batch-recipe-thumb">${d.images && d.images[0] ? `<img src="${esc(d.images[0])}" alt="" />` : '🍳'}</span></label>
    <div class="batch-recipe-main">
      <input class="input batch-recipe-name" data-batch-act="batch-import-name" data-i="${i}" value="${esc(d.name || '')}" placeholder="菜名" />
      <select class="select batch-recipe-cat" data-batch-act="batch-import-category" data-i="${i}">
        ${sortedCategories().map((c) => `<option value="${esc(c.name)}" ${d.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        <option value="其他" ${d.category === '其他' ? 'selected' : ''}>其他</option>
      </select>
      <span class="section-sub">${d.methods.length ? `${d.methods.length} 种做法` : '未识别到做法'}${d.duration ? ` · ${d.duration} 分钟` : ''}</span>
    </div>
    <button class="icon-mini" data-act="batch-import-remove" data-i="${i}" title="移除">✕</button>
  </div>`).join('');
}

function batchExportRowsHtml() {
  const list = manageDishRows();
  return list.length ? list.map((d) => `<label class="batch-recipe-row batch-export-row">
    <input type="checkbox" data-batch-act="batch-export-toggle" data-id="${esc(d.id)}" ${S.batchExportSel.has(d.id) ? 'checked' : ''} />
    <span class="batch-recipe-thumb">${d.images && d.images[0] ? `<img src="${esc(d.images[0])}" alt="" />` : dishEmoji(d.name)}</span>
    <span class="batch-recipe-main"><b>${esc(d.name)}</b><span class="section-sub">${esc(d.category || '其他')} · ${d.householdId ? '我家私菜' : '共享菜'}</span></span>
  </label>`).join('') : '<p class="section-sub">当前没有可导出的菜谱。</p>';
}

function openBatchImportReview() {
  openSheet({
    title: '审核批量导入菜谱',
    body: `<p class="section-sub">已识别 ${S.batchImport.length} 道。勾选要保存的菜，菜名和分类可以直接修改；做法、调料和原图会一起保存。</p>
      <div id="batchImportRows" class="batch-recipe-list">${batchImportRowsHtml()}</div>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="batch-import-save">保存勾选菜谱</button>`,
  });
}

async function importBatchRecipeImages(files) {
  if (!S.householdId) return toast('请先创建或加入一个家庭');
  if (!isSuper()) return toast('批量图片识别需要超级管理员权限');
  if (!aiReady()) return toast('还没配置 AI（data/ai.json 里填 API Key）');
  S.batchImport = [];
  openSheet({
    title: '批量识别菜谱图片',
    body: '<div id="batchImportProgress" class="batch-progress">准备识别图片…</div>',
    foot: '<button class="btn ghost" data-act="close-sheet">取消</button>',
  });
  aiBusy('批量识别中', `共 ${files.length} 张，正在逐张读取`);
  let failed = 0;
  try {
    for (let i = 0; i < files.length; i += 1) {
      if ($('#modalRoot')?.hidden) break;
      const progress = $('#batchImportProgress');
      if (progress) progress.textContent = `正在识别第 ${i + 1} / ${files.length} 张：${files[i].name}`;
      try {
        const dataUrl = await compressImage(files[i], 1024, 0.82);
        const result = await askAI('recipe-from-image', '这是要批量收录的一道菜谱图片。请识别菜名、分类、调料用量、做法步骤、份量和耗时。', dataUrl);
        if (!result) { failed += 1; continue; }
        let imageUrl = '';
        try { imageUrl = (await api('POST', '/api/upload', { dataUrl })).url || ''; } catch (_) { /* 原图上传失败不影响文字审核 */ }
        S.batchImport.push(batchDishFromAI(result, imageUrl));
      } catch (_) { failed += 1; }
    }
  } finally {
    aiBusyDone();
  }
  if ($('#modalRoot')?.hidden) {
    S.batchImport = [];
    return;
  }
  if (!S.batchImport.length) {
    closeSheet();
    return toast('没有识别出可保存的菜谱，请换清晰一点的图片');
  }
  openBatchImportReview();
  if (failed) toast(`已识别 ${S.batchImport.length} 道，${failed} 张失败`, 3600);
}

function openBatchExportSheet() {
  if (!S.householdId) return toast('请先创建或加入一个家庭');
  const list = manageDishRows();
  S.batchExportSel = new Set(list.map((d) => d.id));
  openSheet({
    title: '导出菜谱图片',
    body: `<p class="section-sub">选择要导出的菜谱，将生成一张张适合分享的图片卡片。</p><div id="batchExportRows" class="batch-recipe-list">${batchExportRowsHtml()}</div><p class="section-sub">已选 <b id="batchExportCount">${S.batchExportSel.size}</b> 道</p>`,
    foot: `<button class="btn ghost" data-act="batch-export-all">全选/全不选</button><button class="btn" data-act="batch-export-selected">下载选中图片</button>`,
  });
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text || '').split('');
  let line = '';
  let lines = [];
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = ch; } else line = next;
  }
  if (line) lines.push(line);
  if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

async function dishShareCard(d) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffaf4'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e0763a'; ctx.fillRect(0, 0, canvas.width, 18);
  ctx.fillStyle = '#3a2a20'; ctx.font = '700 54px system-ui, sans-serif';
  let y = 100;
  y = wrapCanvasText(ctx, d.name || '未命名菜谱', 80, y, 1040, 68, 2) + 28;
  ctx.fillStyle = '#92745e'; ctx.font = '26px system-ui, sans-serif';
  ctx.fillText(`${d.category || '其他'}${d.servings ? ` · ${d.servings}` : ''}${d.duration ? ` · ${d.duration} 分钟` : ''}`, 80, y); y += 62;
  ctx.fillStyle = '#5e4b3d'; ctx.font = '28px system-ui, sans-serif';
  y = wrapCanvasText(ctx, d.description || '家常菜谱', 80, y, 1040, 40, 3) + 35;
  ctx.strokeStyle = '#ead8c6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(1120, y); ctx.stroke(); y += 50;
  ctx.fillStyle = '#3a2a20'; ctx.font = '700 30px system-ui, sans-serif'; ctx.fillText('调料', 80, y); y += 42;
  ctx.fillStyle = '#5e4b3d'; ctx.font = '25px system-ui, sans-serif';
  const seasons = (d.seasonings || []).map((s) => `${s.name}${s.amount ? ` ${s.amount}` : ''}`).join('、') || '按口味准备';
  y = wrapCanvasText(ctx, seasons, 80, y, 1040, 36, 4) + 35;
  for (const m of (d.methods || []).slice(0, 3)) {
    ctx.fillStyle = '#3a2a20'; ctx.font = '700 30px system-ui, sans-serif'; ctx.fillText(m.name || '做法', 80, y); y += 40;
    ctx.fillStyle = '#5e4b3d'; ctx.font = '24px system-ui, sans-serif';
    for (let i = 0; i < (m.steps || []).slice(0, 8).length; i += 1) {
      y = wrapCanvasText(ctx, `${i + 1}. ${(m.steps || [])[i]}`, 90, y, 1030, 34, 2) + 8;
      if (y > 1450) break;
    }
    if (y > 1450) break;
    y += 18;
  }
  ctx.fillStyle = '#b18a6d'; ctx.font = '22px system-ui, sans-serif'; ctx.fillText('家庭菜单 · 菜谱分享卡', 80, 1530);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/**
 * 把一段文字（纸质菜单、外卖页面、群里转发的做法）变成菜谱草稿。
 *
 * 和拍照那条一个规矩：**只填表单、不入库**。AI 不知道这个家里已经有哪些菜，
 * 也不会替用户决定这道菜该不该进菜单，填完照样由人逐项看过再保存。
 */
async function recognizeDishFromText() {
  const box = $('#fAiText');
  const text = (box ? box.value : '').trim();
  if (!text) return toast('先把菜单文字贴进来');
  if (text.length < 4) return toast('这段太短了，多贴一点');
  aiBusy('AI 在整理这段文字', '大概 5-15 秒');
  const r = await askAI('recipe-from-text', text);
  aiBusyDone();
  if (!r) return;
  applyAIResult(r);
  if (box) box.value = '';
  const wrap = $('#aiPasteBox');
  if (wrap) wrap.hidden = true;
  toast('AI 填好了，对不上原文的地方直接改，然后点保存', 3200);
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
      (s, i) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 112px auto;gap:6px;margin-bottom:8px">
        <input class="mini-input" list="dishIngredients" data-act="season-name" data-i="${i}" value="${esc(s.name)}" placeholder="原料名（可搜索家庭原料）" />
        <input class="mini-input" data-act="season-amt" data-i="${i}" value="${esc(s.amount)}" placeholder="用量" />
        ${seasoningTypeSelect(s.purchaseType, `data-act="season-type" data-i="${i}"`)}
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
          (s, j) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 112px auto;gap:6px;margin-bottom:6px">
        <input class="mini-input" list="dishIngredients" data-act="mseason-name" data-i="${i}" data-j="${j}" value="${esc(s.name)}" placeholder="原料名（可搜索家庭原料）" />
        <input class="mini-input" data-act="mseason-amt" data-i="${i}" data-j="${j}" value="${esc(s.amount)}" placeholder="用量" />
        ${seasoningTypeSelect(s.purchaseType, `data-act="mseason-type" data-i="${i}" data-j="${j}"`)}
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
  const houseName = (currentHousehold() || {}).name || '当前家庭';
  const admin = canWriteShared();
  openSheet({
    title: cat ? '重命名分类' : '新增分类',
    body: `<div class="field">
      <label class="field-label">分类名称</label>
      <input class="input" id="catName" value="${cat ? esc(cat.name) : ''}" placeholder="例如：夜宵" />
    </div>
    <div class="field">
      <label class="field-label">谁看得见<span class="field-hint">${
        admin
          ? '私有分类只有本家看得见，别人家连这个名字都看不到'
          : '你建的分类只有本家看得见。公共分类由管理员维护'
      }</span></label>
      ${
        admin
          ? `<select class="select" id="catScope">
               <option value="shared" ${isPrivate(cat) ? '' : 'selected'}>🌏 共享 · 所有家庭</option>
               <option value="own" ${isPrivate(cat) ? 'selected' : ''} ${S.householdId ? '' : 'disabled'}>🔒 仅本家 · ${esc(houseName)}</option>
             </select>`
          : `<div class="scope-fixed">🔒 仅本家 · ${esc(houseName)}</div>`
      }
    </div>
    ${
      cat
        ? ''
        : '<p class="section-sub">新分类会自动出现在菜单顶部的筛选条上。同一个名字只能有一个。</p>'
    }`,
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
          ? '已开启。输入后当前账户获得 12 小时超级管理员权限；家庭管理员仍由成员关系中的 owner 决定。换口令填新的即可。'
          : '尚未设置。当前为开放超级管理员模式，可以先保存一个全局管理口令；设置后需要重新输入才能获得超级管理员权限。'
      }</span></label>
        <input class="input" id="setPin" type="password" placeholder="${
          s.hasPin ? '已设置口令，留空表示不修改' : '例如：家庭厨房口令'
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

/**
 * 成员列表。管理页和家庭管理员的弹层共用一份 ——
 * 两边看到的必须是同一套东西，不然会出现「页面上写着管理员，点进去却不是」。
 */
function membersHtml() {
  if (!memberList().length) return '<div class="empty" style="padding:28px"><p class="empty-text">还没有登记成员，点右上角添加</p></div>';
  return memberList()
    .map((m) => {
      const st = memberStats(m.name);
      const bits = [st.count ? `点过 ${st.count} 次` : '还没点过'];
      if (m.role === 'owner') bits.push('管理员');
      bits.push(m.userId ? '已绑定全局账户' : '待账户申请绑定');
      return `<div class="list-row">
        <span class="member-avatar">${esc(m.emoji)}</span>
        <span class="list-row-main">
          <span class="list-row-title">${esc(m.name)}${
            m.id === meMemberId() ? ' <span class="pill-now">这台设备</span>' : ''
          }</span>
        <span class="list-row-sub">${esc(m.loginId || '未绑定账户')} · ${esc(bits.join(' · '))}</span>
        </span>
        <button class="icon-mini" data-act="edit-member" data-id="${esc(m.id)}" title="编辑">✏️</button>
        <button class="icon-mini" data-act="del-member" data-id="${esc(m.id)}" title="删除">🗑️</button>
      </div>`;
    })
    .join('');
}

/**
 * 危险动作前的二次验证。
 *
 * 改成员、重置密码、改家庭口令、删家庭 —— 这几件事能改「谁是谁」，
 * 就等于能冒充谁。手上那把 30 天的设备令牌证明的是「这台设备以前是你」，
 * 不是「此刻可以替这个家做主」，所以危险动作必须配一张刚刚用密码换来的凭证。
 *
 * 问谁，取决于这一家有什么秘密：
 *   设了家庭口令 → 问家庭口令（它才是这一家的管理员凭证）
 *   没设口令、这个人自己有密码 → 问他的成员密码
 *   谁都没设 → 没什么可冒充的，直接放行（跟服务端同一条规矩）
 *
 * 服务端 /api/verify-pin、/api/households/:id/auth 会再验一遍 ——
 * 这里只是提前问清楚，别让人输完才发现还是不行。
 */
let pendingPinCheck = null;
let pendingPinTarget = null;

function askPinDialog(title, hint, placeholder, onOk) {
  return new Promise((resolve) => {
    pendingPinCheck = resolve;
    pendingPinOnOk = onOk;
    openSheet({
      title,
      body: `<p class="section-sub" style="margin:0 0 12px">${hint}</p>
        <input class="input" id="dangerPin" type="password" placeholder="${esc(placeholder)}" autocomplete="off" />
        <p class="whoami-err" id="dangerErr" hidden></p>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
             <button class="btn" data-act="danger-pin-ok">确认</button>`,
    });
    const input = $('#dangerPin');
    if (input) input.focus();
  });
}

let pendingPinOnOk = null;

/** 用家庭口令换会话 */
function askHousePin(house, what) {
  return askPinDialog(
    '输一下家庭口令',
    `${what}是危险操作，需要「${house.name}」的管理口令。`,
    '家庭口令',
    async (pin) => {
      const r = await api('POST', `/api/households/${house.id}/auth`, { pin });
      if (r && r.token) setHouseToken(house.id, r.token);
    }
  );
}

/** 用成员密码换那张 5 分钟的「刚验过」凭证 */
function askMemberPassword(house, member, what) {
  pendingPinTarget = member;
  return askPinDialog(
    '再确认一下',
    `${what}是危险操作。请输入「${member.name}」的密码再继续。`,
    '成员密码',
    async (pin) => {
      const r = await api('POST', '/api/verify-pin', {
        householdId: house.id,
        memberId: member.id,
        password: pin,
      });
      // 收下这张 5 分钟的凭证，接下来那个危险动作才走得通
      if (r && r.verifiedToken) {
        S.verifiedToken = r.verifiedToken;
        S.verifiedExp = Date.now() + 5 * 60 * 1000;
      }
    }
  );
}

/** 按「这一家有什么秘密」决定问哪个密码 */
async function askSensitiveAuth(house, what, member) {
  if (!house) return false;
  if (isSuper()) return true;
  // 家庭权限只看 owner 关系；历史家庭口令不再参与授权。
  return !!member && member.role === 'owner';
}

function clearPinCheck() {
  pendingPinCheck = null;
  pendingPinOnOk = null;
  pendingPinTarget = null;
}

/** 关掉弹层也算放弃：把等着的人叫醒，不然调用方会一直挂着 */
function cancelPinCheck() {
  const done = typeof pendingPinCheck === 'function' ? pendingPinCheck : null;
  clearPinCheck();
  if (done) done(false);
}

/** 危险动作的统一入口：先验身份，再跑真正的操作 */
async function withDangerPin(member, what, run) {
  const house = currentHousehold();
  const ok = await askSensitiveAuth(house, what, member);
  if (!ok) return;
  try {
    await run();
  } catch (e) {
    toast(e.message || '没做成');
  }
}

function openMemberEditor(member) {
  const m =
    member || { id: null, name: '', emoji: QUICK_EMOJI[memberList().length % QUICK_EMOJI.length] };
  const dupes = member && memberList().filter((x) => x.name === m.name && x.id !== m.id).length;
  openSheet({
    title: member ? '编辑成员' : '添加成员',
    body: `
      <div class="field">
        <label class="field-label">称呼<span class="field-hint">点餐时会显示这个名字</span></label>
        <input class="input" id="mName" value="${esc(m.name)}" placeholder="例如：外婆" />
        ${
          dupes
            ? `<p class="field-hint" style="margin-top:6px">家里已经有人叫「${esc(m.name)}」了。可以重名 —— 身份认的是人不是名字，别人拿不到密码就冒充不了。</p>`
            : ''
        }
      </div>
      <div class="field">
        <label class="field-label">头像</label>
        <div class="emoji-grid">
          ${QUICK_EMOJI.map(
            (e) =>
              `<button class="emoji-opt ${e === m.emoji ? 'on' : ''}" data-act="pick-emoji" data-e="${esc(e)}">${esc(e)}</button>`
          ).join('')}
        </div>
        <input class="input" id="mEmoji" value="${esc(m.emoji)}" placeholder="也可以直接输入任意表情" style="margin-top:8px" />
      </div>
      ${`<div class="field">
              <label class="field-label">权限</label>
              <div class="seg" role="radiogroup">
                <button class="seg-opt ${m.role !== 'owner' ? 'on' : ''}" data-act="m-role" data-v="member"
                  aria-pressed="${m.role !== 'owner'}">普通成员</button>
                <button class="seg-opt ${m.role === 'owner' ? 'on' : ''}" data-act="m-role" data-v="owner"
                  aria-pressed="${m.role === 'owner'}">管理员</button>
              </div>
              <p class="field-hint" style="margin-top:6px">${
                m.role === 'owner'
                  ? '能改共享菜谱、改这家所有私菜、管理成员和申请。'
                  : '只能改自己写的私菜；共享菜单和做饭状态只读。'
              }</p>
            </div>
            </div>`}
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

/**
 * 存成员。成员 id 是唯一键，所以：
 *   - 不查重名（爸爸和儿子可以都叫「小明」）
 *   - 角色和密码分成两次 PUT —— 改密码要二次验证，混在一起会被一起挡掉
 */
async function saveMembers(list) {
  const h = currentHousehold();
  if (!h) return toast('还没有家庭');
  await api('PUT', `/api/households/${h.id}`, { members: list });
  await loadState(true);
  render();
}

/* =========================================================
 * 全局账户与家庭工作区
 * ========================================================= */

function accountProfileSummary() {
  const u = accountUser();
  if (!u) return '';
  const id = u.loginId || u.id || '';
  const name = u.displayName || u.name || id;
  return `<div class="account-profile"><span class="account-avatar">${esc(u.emoji || '🙋')}</span>
    <div><b>${esc(name)}</b><span class="account-id">登录 ID：${esc(id)}</span></div></div>`;
}

function renderAccountGate() {
  const app = $('#app');
  const view = $('#view');
  if (!app || !view) return;
  app.classList.add('account-gate-mode');
  document.querySelectorAll('.topbar, .tabbar, #searchbar, #whoami').forEach((el) => { el.hidden = true; });
  const register = S.accountView === 'register';
  const title = register ? '创建你的家庭菜单账号' : '登录家庭菜单';
  const subtitle = register
    ? '新设备先创建账号，之后可以加入或创建多个家庭。'
    : '登录后才能查看家庭菜单和你的私菜。';
  view.innerHTML = `<div class="account-page">
    <div class="account-hero"><div class="account-logo">🍚</div><h1>${title}</h1><p>${subtitle}</p></div>
    <form class="account-card" data-account-form>
      <label class="field-label" for="accountLoginId">登录 ID <span class="field-hint">可用汉字、字母或数字</span></label>
      <input class="input" id="accountLoginId" name="loginId" maxlength="32" autocomplete="username" placeholder="${register ? '留空自动生成，例如：用户-AB12' : '输入登录 ID'}" />
      <label class="field-label" for="accountPassword">密码</label>
      <input class="input" id="accountPassword" name="password" type="password" maxlength="64" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? '留空使用初始密码 123456' : '输入密码'}" />
      ${register ? '<p class="account-risk">初始密码为 <b>123456</b>，可以继续使用，但建议登录后尽快修改。</p>' : ''}
      <p class="account-error" id="accountError" hidden></p>
      <button class="btn block account-submit" type="submit">${register ? '创建账号并进入' : '登录'}</button>
      <button class="btn ghost block" type="button" data-act="account-toggle">${register ? '已有账号，去登录' : '首次使用，创建账号'}</button>
    </form>
  </div>`;
}

function viewHouseholdHome() {
  const list = accountFamilies();
  const joined = new Set(list.map((h) => h.id));
  const directory = households().filter((h) => !joined.has(h.id));
  const user = accountUser() || {};
  const label = user.displayName || user.loginId || '我的账号';
  const rows = list.length
    ? list.map((h) => {
        const me = memberForHouse(h);
        const role = me && (me.role === 'owner' ? '家庭管理员' : '普通成员');
        return `<button class="account-house-row" data-act="pick-house" data-id="${esc(h.id)}">
          <span class="house-pick-emoji">${esc(h.emoji || '🏠')}</span><span class="house-pick-main">
          <span class="house-pick-name">${esc(h.name)}</span><span class="house-pick-sub">${esc(role || '已加入')} · ${(h.members || []).length} 位成员</span></span><span class="house-pick-tag">›</span></button>`;
      }).join('')
    : '<div class="account-empty"><span>🏠</span><b>还没有加入家庭</b><p>你可以创建一个家庭，或从公开家庭目录申请加入。</p></div>';
  const publicRows = directory.length
    ? directory.map((h) => `<div class="account-public-house"><span class="house-pick-emoji">${esc(h.emoji || '🏠')}</span><span class="house-pick-main"><b>${esc(h.name)}</b><span class="house-pick-sub">${esc(h.note || '公开家庭')} · ${(h.members || []).length} 位成员</span></span><button class="btn ghost sm" data-act="browse-public-house" data-id="${esc(h.id)}">查看共享菜单</button><button class="btn soft sm" data-act="open-join-family" data-id="${esc(h.id)}">申请加入</button></div>`).join('')
    : '<p class="section-sub">暂时没有其他公开家庭。</p>';
  return `<div class="account-workspace"><div class="account-profile-head"><div><span class="section-sub">当前账号</span><h2>${esc(label)}</h2></div><button class="btn ghost sm" data-act="account-logout">退出登录</button></div>
    <div class="section-head"><h2 class="section-title">我的家庭</h2><span class="section-sub">${accountHouseholdCount()}/5 个</span></div>
    <div class="account-house-list">${rows}</div>
    <div class="account-home-actions"><button class="btn" data-act="new-household">＋ 创建家庭</button><button class="btn soft" data-act="open-shared-menu">查看共享菜单</button><button class="btn ghost" data-act="open-account-settings">账户设置</button></div>
    <p class="account-hint">创建家庭后你会自动成为家庭管理员，不需要等待平台批准。</p>
    <div class="section-head" style="margin-top:18px"><h2 class="section-title">公开家庭目录</h2><span class="section-sub">可浏览共享菜单并申请加入</span></div>
    <div class="account-public-list">${publicRows}</div></div>`;
}

function familySquareHtml() {
  const joined = new Set(accountFamilies().map((h) => h.id));
  const directory = households().filter((h) => !joined.has(h.id));
  const rows = directory.length
    ? directory.map((h) => `<div class="account-public-house"><span class="house-pick-emoji">${esc(h.emoji || '🏠')}</span><span class="house-pick-main"><b>${esc(h.name)}</b><span class="house-pick-sub">${esc(h.note || '公开家庭')} · ${(h.members || []).length} 位成员</span></span><button class="btn ghost sm" data-act="browse-public-house" data-id="${esc(h.id)}">浏览共享菜</button><button class="btn soft sm" data-act="open-join-family" data-id="${esc(h.id)}">申请加入</button></div>`).join('')
    : '<p class="section-sub">暂时没有其他公开家庭。</p>';
  return `<div class="family-square" style="margin-top:18px"><div class="section-head"><h2 class="section-title">家庭广场</h2><span class="section-sub">只读浏览其他家庭的公开共享菜</span></div><div class="account-public-list">${rows}</div><p class="section-sub" style="margin-top:8px">浏览其他家庭时不能点菜、排计划、查看库存或留言；感兴趣的共享菜可以收进当前家庭。</p></div>`;
}

function memberForHouse(h) {
  const u = accountUser();
  if (!h || !u) return null;
  const uid = u.id || u.userId;
  return (h.members || []).find((m) => typeof m !== 'string' && (m.userId === uid || m.id === uid)) || null;
}

async function accountSubmit(form) {
  const loginId = String(form.loginId?.value || '').trim();
  const password = String(form.password?.value || '');
  const register = S.accountView === 'register';
  const err = $('#accountError');
  const fail = (msg) => { if (err) { err.hidden = false; err.textContent = msg; } };
  if (!register && !loginId) return fail('请输入登录 ID。');
  if (!register && !password) return fail('请输入密码。');
  S.accountBusy = true;
  const submit = form.querySelector('.account-submit');
  if (submit) { submit.disabled = true; submit.textContent = register ? '创建中…' : '登录中…'; }
  try {
    const r = await api('POST', register ? '/api/account/register' : '/api/account/login', {
      ...(loginId ? { loginId } : {}),
      ...(password ? { password } : {}),
    });
    setAccountToken(r.accountToken || r.token || r.data?.accountToken || '');
    S.account = r.account || r.user ? { ...(r.account || {}), user: r.user || r.account?.user, households: r.households || r.families || r.account?.households } : null;
    if (S.account && (register && !password || password === '123456')) S.account.usingDefaultPassword = true;
    if (!accountToken()) throw new Error('服务器没有返回账户令牌');
    // 账户身份已经由服务端确认；恢复这个账户在本设备上次关闭时的工作区。
    const context = loadAccountContext();
    S.householdId = typeof context.householdId === 'string' ? context.householdId : '';
    S.view = typeof context.view === 'string' ? context.view : 'home';
    S.dishScope = context.dishScope || 'all';
    S.category = context.category || '全部';
    S.keyword = context.keyword || '';
    S.planWeek = context.planWeek || '';
    S.pantryFilter = context.pantryFilter || 'all';
    S.pantryCat = context.pantryCat || '全部';
    S.shoppingGroups = context.shoppingGroups && typeof context.shoppingGroups === 'object' ? { ...context.shoppingGroups } : {};
    S.pantryGroups = context.pantryGroups && typeof context.pantryGroups === 'object' ? { ...context.pantryGroups } : {};
    S.manageKeyword = context.manageKeyword || '';
    if (context.manageGroups && typeof context.manageGroups === 'object') S.manageGroups = { ...S.manageGroups, ...context.manageGroups };
    saveSelectedHousehold(S.householdId);
    S.accountView = 'login';
    if (!S.view) S.view = 'home';
    S.loading = true;
    await loadState(true);
    if (['plan', 'order'].includes(S.view) && !S.presets) await ensurePresets();
    await Promise.allSettled([loadAIStatus(), loadVersion(), loadBackups()]);
    render();
    toast(register ? '账号已创建' : '登录成功');
  } catch (e) {
    fail(e.message || '登录失败，请重试');
    if (submit) { submit.disabled = false; submit.textContent = register ? '创建账号并进入' : '登录'; }
  } finally {
    S.accountBusy = false;
  }
}

function accountLogout() {
  const t = accountToken();
  // 退出接口失败也要清理本地身份，避免用户卡在旧会话。
  api('POST', '/api/account/logout').catch(() => {}).finally(() => {
    setAccountToken(''); setAuthToken(''); S.account = null; S.data = { categories: [], dishes: [], orders: [], settings: {}, households: [], pantry: [], plans: [], notes: { notes: [], votes: {} } }; S.householdId = ''; saveSelectedHousehold(''); localStorage.removeItem(LS_HOUSE); S.authed = false; S.view = 'home'; render(); toast('已退出登录');
  });
}

function accountSettingsHtml() {
  const u = accountUser() || {};
  const expiry = superRemainingText();
  const current = currentHousehold();
  const currentRelation = current ? memberForHouse(current) : null;
  const ownerCount = current ? (current.members || []).filter((m) => m && m.role === 'owner').length : 0;
  const soleOwner = !!currentRelation && currentRelation.role === 'owner' && ownerCount <= 1;
  const onlyMember = !!current && (current.members || []).filter(Boolean).length <= 1;
  const familyRows = accountFamilies().map((h) => {
    const rel = memberForHouse(h);
    const r = rel && rel.role === 'owner' ? '管理员' : '成员';
    return `<button class="account-house-row compact" data-act="pick-house" data-id="${esc(h.id)}"><span class="house-pick-emoji">${esc(h.emoji || '🏠')}</span><span class="house-pick-main"><span class="house-pick-name">${esc(h.name)}${h.id === S.householdId ? ' <span class="pill-now">当前</span>' : ''}</span><span class="house-pick-sub">${r}</span></span><span class="house-pick-tag">›</span></button>`;
  }).join('');
  return `<div class="account-settings-card">
    <div class="section-head"><h2 class="section-title">我的账号</h2><span class="pill-now">全局账户</span></div>
    ${accountProfileSummary()}
    <p class="account-risk compact">${u.legacyDefaultPassword || u.usingDefaultPassword || u.passwordRisk ? '⚠️ 当前仍在使用初始密码 123456，建议修改。' : '账户密码只用于登录，不会显示给其他成员。'}</p>
    <div class="row-2"><button class="btn ghost" data-act="account-profile">编辑资料</button><button class="btn ghost" data-act="account-password">修改密码</button></div>
    <button class="btn ghost block" data-act="account-logout">退出登录</button>
    <div class="section-head" style="margin-top:18px"><h2 class="section-title">超级管理员</h2></div>
    ${expiry ? `<div class="super-status">🛡️ 超级管理员已授权 · 还剩 ${esc(expiry)}</div>` : `<p class="section-sub">输入全局管理令牌后，当前账号可临时管理所有家庭和平台配置，有效 12 小时。</p>`}
    <button class="btn ${expiry ? 'soft' : ''} block" data-act="unlock">${expiry ? '重新输入全局管理令牌' : '输入全局管理令牌'}</button>
    <div class="section-head" style="margin-top:18px"><h2 class="section-title">我的家庭</h2><span class="section-sub">${accountHouseholdCount()}/5</span></div>
    <div class="account-settings-families">${familyRows || '<p class="section-sub">还没有加入家庭。</p>'}</div>
    ${current ? onlyMember && soleOwner
      ? `<button class="btn danger block" style="margin-top:10px" data-act="dissolve-household">解散「${esc(current.name)}」</button><p class="section-sub" style="margin-top:8px">这是这个家庭最后一名成员。解散后家庭菜单、私菜、点餐、库存和计划都会删除，但你的账户不会受影响。</p>`
      : soleOwner
      ? `<button class="btn ghost block" style="margin-top:10px" data-act="open-members">先指定其他家庭管理员</button><p class="section-sub" style="margin-top:8px">你是当前唯一管理员，至少指定一名成员为管理员后才能退出家庭。</p>`
      : `<button class="btn ghost block" style="margin-top:10px" data-act="leave-household">退出「${esc(current.name)}」</button>` : ''}
    <div class="row-2" style="margin-top:10px"><button class="btn soft" data-act="new-household">＋ 创建家庭</button><button class="btn ghost" data-act="open-join-family">申请加入</button></div>
  </div>`;
}

/* =========================================================
 * 渲染主循环
 * ========================================================= */

function render() {
  if (!hasAccount()) {
    renderAccountGate();
    return;
  }
  $('#app')?.classList.remove('account-gate-mode');
  const s = S.data.settings || {};
  document.title = s.shopName || '家庭菜单';
  $('#brandName').textContent = s.shopName || '家庭菜单';
  $('#brandSub').textContent = s.welcome || '今天想吃点什么？';

  renderHouseBtn();
  renderMeBtn();

  // 登录后默认停在账户首页；只有用户主动选择家庭才进入家庭工作区。
  if (!S.householdId) {
    document.querySelectorAll('.topbar, #searchbar').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('.tabbar').forEach((el) => { el.hidden = false; });
    document.querySelectorAll('.tabbar .tab').forEach((tab) => {
      const allowed = ['menu', 'settings'].includes(tab.dataset.view);
      tab.disabled = !allowed;
      tab.classList.toggle('disabled', !allowed);
      tab.title = allowed
        ? (tab.dataset.view === 'menu' ? '浏览共享菜单' : '账户设置与家庭管理')
        : '请先创建或加入家庭';
    });
    const menuTab = document.querySelector('.tab[data-view="menu"]');
    if (menuTab) {
      const icon = menuTab.querySelector('.tab-icon');
      const label = menuTab.querySelector('.tab-label');
      if (icon) icon.textContent = '🌐';
      if (label) label.textContent = '共享';
    }
    const settingsTab = document.querySelector('.tab[data-view="settings"]');
    if (settingsTab) {
      const label = settingsTab.querySelector('.tab-label');
      if (label) label.textContent = '家庭';
    }
    document.querySelectorAll('.tab').forEach((t) => {
      const on = (t.dataset.view === 'settings' && (S.view === 'settings' || S.view === 'manage')) || t.dataset.view === S.view;
      t.setAttribute('aria-current', on ? 'page' : 'false');
    });
    const home = $('#view');
    if (home) {
      if (S.view === 'settings' || S.view === 'manage') home.innerHTML = viewManage();
      else if (S.view === 'menu') home.innerHTML = viewMenu();
      else home.innerHTML = viewHouseholdHome();
    }
    renderWhoami();
    return;
  }
  document.querySelectorAll('.topbar, .tabbar').forEach((el) => { el.hidden = false; });
  document.querySelectorAll('.tabbar .tab').forEach((tab) => {
    tab.disabled = false;
    tab.classList.remove('disabled');
    tab.title = '';
  });

  const manageTab = document.querySelector('.tab[data-view="settings"]');
  if (manageTab) {
    const admin = isSuper();
    const icon = manageTab.querySelector('.tab-icon');
    const label = manageTab.querySelector('.tab-label');
    if (icon) icon.textContent = '🏠';
    if (label) label.textContent = '家庭';
    manageTab.title = admin ? '成员、家庭广场与家庭配置' : '家庭成员、申请与家庭广场';
  }
  const menuTab = document.querySelector('.tab[data-view="menu"]');
  if (menuTab) {
    const icon = menuTab.querySelector('.tab-icon');
    const label = menuTab.querySelector('.tab-label');
    if (icon) icon.textContent = '🍽️';
    if (label) label.textContent = '菜单';
  }

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

  // 留言角标报「今天」：做不了「未读」（没这个概念），但今天家里说了几句
  // 是真的想知道的事，总条数只会越滚越大、越滚越没意义
  const bb = $('#boardBadge');
  if (bb) {
    const today = todayStr();
    const todayN = boardNotes().filter((n) => String(n.createdAt || '').slice(0, 10) === today).length;
    bb.hidden = todayN === 0;
    bb.textContent = todayN;
  }

  const view = $('#view');
  if (S.view === 'menu') view.innerHTML = viewMenu();
  else if (S.view === 'plan') view.innerHTML = viewPlan();
  else if (S.view === 'order') view.innerHTML = viewOrder();
  else if (S.view === 'board') view.innerHTML = viewBoard();
  else if (S.view === 'pantry') view.innerHTML = viewPantry();
  else if (S.view === 'settings' || S.view === 'manage') view.innerHTML = viewManage();
  else view.innerHTML = viewManage();

  renderWhoami();
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

/**
 * 顶栏的「我是谁」。
 *
 * 以前身份只藏在留言板的输入栏里，切到别的页就忘了自己是以谁的名义在点餐、
 * 在看谁的库存。常驻一个按钮，「我在这儿是谁」永远看得见，也随时能换。
 *
 * 三种状态说三件事：
 *   认领了   → 名字 + 角色（超级管理员 / 家庭管理员 / 普通成员）
 *   申请中   → 报了名但还没批，顶栏明说「等批准」，别让人以为没提交上
 *   都没登记 → 虚线高亮 inviting 点一下，这是最容易漏掉的一步
 */
function renderMeBtn() {
  const btn = $('#meBtn');
  if (!btn) return;
  const u = accountUser();
  const accountLabel = u && (u.displayName || u.loginId);
  const avatar = $('#meEmoji');
  const label = $('#meName');
  const role = $('#meRole');
  if (avatar) avatar.textContent = u?.emoji || '👤';
  if (label) label.textContent = accountLabel || '当前账户';
  if (role) {
    role.hidden = !accountLabel;
    role.textContent = isSuper() ? '超级管理员' : '全局账户';
  }
  btn.classList.remove('pending', 'waiting');
  btn.title = `${accountLabel || '当前账户'} · 点一下查看账户资料和家庭`;
}

/* ---------------- 「你是谁」向导 ---------------- */

/** 打开展向。step = house / member / pin；from 记一下是哪儿点进来的 */
function openWhoami(step, from) {
  S.whoamiStep = step || 'house';
  if (from !== undefined) S.whoamiFrom = from || '';
  renderWhoami();
}

function closeWhoami() {
  S.whoamiStep = '';
  S.whoamiPick = '';
  S.whoamiFrom = '';
  renderWhoami();
}

function whoamiHouseRow(h) {
  const mem = (h.members || []).map((m) => (typeof m === 'string' ? m : m.name)).filter(Boolean);
  const here = h.id === S.householdId;
  const sub = [
    mem.length ? `${mem.length} 位家人` : '还没登记成员',
    h.status === 'normal' ? '待启用' : '',
    here ? '' : h.note || '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<button class="whoami-row" data-act="who-house" data-id="${esc(h.id)}">
      <span class="whoami-row-emoji">${esc(h.emoji || '🏠')}</span>
      <span class="whoami-row-main">
        <span class="whoami-row-name">${esc(h.name)}${here ? ' <span class="pill-now">当前</span>' : ''}</span>
        <span class="whoami-row-sub">${esc(sub)}</span>
      </span>
      <span class="whoami-row-go" aria-hidden="true">›</span>
    </button>`;
}

/** 这台设备是不是已经认领过这个成员（有令牌就是认过了） */
function claimedOn(hid, mid) {
  return !!(hid && mid && deviceToken(hid));
}

function renderWhoami() {
  const box = $('#whoami');
  if (!box) return;
  const step = S.whoamiStep;
  if (!step) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;

  if (step === 'house') {
    const list = households();
    box.innerHTML = `<div class="whoami-card">
      <div class="whoami-emoji">🏠</div>
      <h2 class="whoami-title">你是哪家的？</h2>
      <p class="whoami-sub">
        这台设备会记住你的选择，以后打开就直接进你家。<br/>
        先看看别人的菜谱也行 —— 下面可以跳过。
      </p>
      <div class="whoami-list">${list.length ? list.map(whoamiHouseRow).join('') : '<p class="whoami-sub">还没有任何家庭。</p>'}</div>
      <button class="btn ghost block" data-act="who-skip">先随便看看</button>
    </div>`;
    return;
  }

  const h = currentHousehold();

  /* --- 第三步：设 / 输密码 --- */
  if (step === 'pin') {
    const m = memberById(S.whoamiPick);
    if (!m) {
      // 成员被删了，别把人卡在这一步
      S.whoamiPick = '';
      S.whoamiStep = 'member';
      return renderWhoami();
    }
    const first = !m.hasPassword;
    box.innerHTML = `<div class="whoami-card">
      <div class="whoami-emoji">${esc(m.emoji)}</div>
      <h2 class="whoami-title">${first ? '给「' + esc(m.name) + '」设个登录密码' : '「' + esc(m.name) + '」的登录密码'}</h2>
      <p class="whoami-sub">
        ${
          first
            ? '登录 ID 可以是汉字或字母；密码支持汉字、字母、数字和符号，4 到 64 个字符。<br/>以后你加的菜、发的留言才算在你自己名下，别的成员改不动。'
            : '这个成员还没在这台设备上登录过。输对密码才认得你 —— 别人拿到这台设备也冒充不了。'
        }
      </p>
      <div class="whoami-row">
        <input class="input" id="whoLoginId" value="${esc(m.loginId || m.name)}" maxlength="32" placeholder="登录 ID，例如：厨房大管家" />
      </div>
      <div class="whoami-row">
        <input class="input" id="whoPassword" type="password" autocomplete="off"
          placeholder="${first ? '设个 4-64 个字符的密码' : '输密码'}" maxlength="64" />
      </div>
      <p class="whoami-err" id="whoPasswordErr" hidden></p>
      <button class="btn block" data-act="who-password" data-id="${esc(m.id)}">${first ? '设好了' : '记下我'}</button>
      <div class="whoami-row-btns">
        <button class="btn ghost" data-act="who-password-back">← 换一个</button>
        <button class="btn ghost" data-act="who-skip">先随便看看</button>
      </div>
    </div>`;
    const input = $('#whoPassword');
    if (input) input.focus();
    return;
  }

  /* --- 第二步：选成员 --- */
  const list = memberList();
  const me = meMemberId();
  box.innerHTML = `<div class="whoami-card">
    <div class="whoami-emoji">🙋</div>
    <h2 class="whoami-title">你是「${esc(h ? h.name : '')}」的谁？</h2>
    <p class="whoami-sub">选一个，这台设备就记成他。忘了密码找管理员重设。</p>
    ${
      list.length
        ? `<div class="whoami-grid">${list
            .map(
              (m) => `<button class="whoami-pick${m.id === me ? ' on' : ''}" data-act="who-member" data-id="${esc(m.id)}">
          <span class="whoami-pick-emoji">${esc(m.emoji)}</span>
          <span class="whoami-pick-name">${esc(m.name)}</span>
          ${m.role === 'owner' ? '<span class="whoami-pick-role">管理员</span>' : ''}
          ${m.hasPassword ? '<span class="whoami-pick-lock">🔑</span>' : '<span class="whoami-pick-lock">未设密码</span>'}
        </button>`
            )
            .join('')}</div>`
        : '<p class="whoami-sub">这个家还没登记成员。你可以先随便看看，或者报个名让管理员加上你。</p>'
    }
    <button class="btn soft block" data-act="who-apply" data-id="${esc(S.householdId)}">我不在名单上，报个名</button>
    <div class="whoami-row-btns">
      <button class="btn ghost" data-act="who-back">← 换一个家庭</button>
      <button class="btn ghost" data-act="who-skip">先随便看看</button>
    </div>
  </div>`;
}

function householdBadge() {
  const pending = pendingOrders().length;
  const urgent = householdPantry().filter((p) => {
    const k = shelfStatus(p).key;
    return k === 'expired' || k === 'soon' || k === 'today';
  }).length;
  return { pending, urgent };
}

/**
 * 家庭选择弹层。
 *
 * 管理员想切哪切哪；家里人只能待在自己是成员的那几家，
 * 想进别人家得发申请 —— 申请由管理员批，批了才真的是成员。
 */
function openHouseholdPicker() {
  const list = households();
  const admin = anyHouseAdmin();
  const me = meName();
  const myId = meMemberId();
  const uid = accountUser()?.id || accountUser()?.userId;
  // 成员 id 是各家各一份的：同一个「爸爸」在 A 家和 B 家是两个 id，
  // 所以切到别家时要拿「我认领过的那些 id」去比，而不是只认当前这家。
  const mine = (h) => !!(uid && (h.members || []).some((m) => typeof m !== 'string' && (m.userId === uid || m.id === uid))) || !!(myId && (h.members || []).some((m) => m.id === myId)) || (h.members || []).some((m) => (typeof m === 'string' ? m : m.name) === me);
  const myAccess = (h) => admin || mine(h);
  const pendingFor = (h) => (S.access || []).filter((r) => r.householdId === h.id && r.status === 'pending' && r.name === me);

  const body = `
    <p class="section-sub" style="margin:-2px 0 14px">
      ${
        admin
          ? '菜谱分共享菜和本家私菜；点餐和库存各记各的。选一个切过去。'
          : '共享的菜谱所有家庭都能翻；点餐和库存各记各的。想进别人家，发个申请等管理员点头。'
      }
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
        const here = h.id === S.householdId;
        const mine = myAccess(h);
        const waiting = !mine && !here && pendingFor(h).length;
        return `<button class="house-pick" data-act="pick-house" data-id="${esc(h.id)}"
          aria-pressed="${here}">
          <span class="house-pick-emoji">${esc(h.emoji)}</span>
          <span class="house-pick-main">
            <span class="house-pick-name">${esc(h.name)}${
              here ? '' : mine ? '' : waiting ? ' <span class="pill-now">等批准</span>' : ' <span class="pill-own">未加入</span>'
            }</span>
            <span class="house-pick-sub">${esc(bits.join(' · '))}${urgent ? ` · ⚠ ${urgent} 样要处理` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</span>
          </span>
          ${here ? '<span class="house-pick-tag">✓</span>' : waiting ? '<span class="house-pick-tag">…</span>' : ''}
        </button>`;
      })
      .join('')}`;
  openSheet({
    title: '切换家庭',
    body,
    foot: `<button class="btn soft" data-act="new-household">＋ 添加家庭</button>
         <button class="btn ghost" data-act="edit-settings">服务设置</button>`
      ,
  });
}

/** 申请加入某个家庭（非管理员点别人家时走这条） */
function openJoinSheet(houseId) {
  const h = households().find((x) => x.id === houseId);
  if (!h) return;
  openSheet({
    title: `申请加入「${h.name}」`,
    body: `
      <div class="account-profile" style="margin-bottom:14px">
        <span class="account-avatar">${esc(accountUser()?.emoji || '🙋')}</span>
        <div><b>${esc(accountUser()?.displayName || accountUser()?.loginId || '当前账户')}</b><span class="account-id">申请身份由当前登录账户自动识别</span></div>
      </div>
      <div class="field">
        <label class="field-label">想说的话<span class="field-hint">选填</span></label>
        <textarea class="textarea" id="joinNote" rows="3" maxlength="100" placeholder="例如：我来做饭的时候想看看你家的菜谱"></textarea>
      </div>
      <div class="field">
        <label class="field-label">申请身份</label>
        <select class="input" id="joinRole">
          <option value="member">普通成员</option>
          <option value="owner">家庭管理员（由管理员最终决定）</option>
        </select>
      </div>
      <p class="section-sub">
        申请会送到管理员那里，批准之后你就是这个家的成员了。在那之前，
        你只能浏览共享菜谱 —— 别人家的私菜本来就看不见。
      </p>`,
    foot: `<button class="btn ghost" data-act="close-sheet">取消</button>
           <button class="btn" data-act="send-join" data-id="${esc(houseId)}">发出申请</button>`,
  });
}

/* =========================================================
   事件
   ========================================================= */

const ACTIONS = {
  /* 导航 */
  async nav(el) {
    const v = el.dataset.view;
    if (!S.householdId && !['menu', 'settings'].includes(v)) {
      return toast('请先创建或加入一个家庭，才能使用这个栏目');
    }
    S.view = v;
    saveAccountContext();
    closeSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 顺手重新拉一次。这是个多人一起用的页面：妈刚在另一台手机上点了菜，
    // 爸这边不重拉就还看着进页面那一刻的旧数据，只能靠手动刷新网页才发现。
    // 顺带把「切家庭之后忘了刷新」的那类脏显示一起治好。
    await loadState(true);
    if (['plan', 'order'].includes(v) && !S.presets) await ensurePresets();
    render();
  },
  reload() {
    S.loading = true;
    render();
    loadState();
  },

  'account-toggle'() {
    S.accountView = S.accountView === 'register' ? 'login' : 'register';
    render();
    const input = $('#accountLoginId');
    if (input) input.focus();
  },
  'account-logout'() {
    accountLogout();
  },
  'open-account-settings'() {
    S.view = 'settings';
    render();
  },
  'open-account-home'() {
    S.view = 'home';
    closeSheet();
    render();
  },
  'open-shared-menu'() {
    S.view = 'menu';
    render();
  },
  'browse-public-house'(el) {
    const h = households().find((x) => x.id === el.dataset.id);
    if (!h) return toast('公开家庭不存在');
    const dishes = (S.data.dishes || []).filter((d) => !d.householdId).slice(0, 12);
    openSheet({
      title: `${h.emoji || '🏠'} ${h.name} · 共享菜单`,
      body: `<p class="section-sub">${esc(h.note || '这是公开家庭，只能浏览共享菜单。')}</p><div class="dup-list">${dishes.length ? dishes.map((d) => `<div class="dup-row"><button class="dup-row-main" data-act="open-dish" data-id="${esc(d.id)}"><span class="dup-row-name">${esc(d.name)}</span><span class="dup-row-sub">${esc(d.category || '家常菜')} · 作者：${esc(dishAuthor(d))}</span></button>${S.householdId ? `<button class="btn soft sm" data-act="adopt-dish" data-id="${esc(d.id)}">收进我家</button>` : ''}</div>`).join('') : '<p class="section-sub">暂时没有共享菜。</p>'}</div><p class="section-sub" style="margin-top:10px">这里只能看公开共享菜，不能查看该家庭私菜、点菜、计划、库存或留言。</p>`,
      foot: `<button class="btn ghost" data-act="close-sheet">关闭</button><button class="btn" data-act="open-join-family" data-id="${esc(h.id)}">申请加入这个家庭</button>`,
    });
  },
  'account-profile'() {
    const u = accountUser() || {};
    openSheet({
      title: '编辑账户资料',
      body: `<div class="field"><label class="field-label">登录 ID</label><input class="input" id="accountProfileLoginId" maxlength="32" value="${esc(u.loginId || '')}" /></div><div class="field"><label class="field-label">账户姓名</label><input class="input" id="accountProfileDisplayName" maxlength="40" value="${esc(u.displayName || u.loginId || '')}" /></div><div class="field"><label class="field-label">头像</label><input class="input" id="accountProfileEmoji" maxlength="4" value="${esc(u.emoji || '🙋')}" /></div><p class="section-sub">账户姓名是全局统一资料，修改后会同步到你加入的所有家庭、申请记录和菜品作者显示。</p>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="save-account-profile">保存</button>`,
    });
    $('#accountProfileDisplayName')?.focus();
  },
  async 'save-account-profile'() {
    const loginId = String($('#accountProfileLoginId')?.value || '').trim();
    const displayName = String($('#accountProfileDisplayName')?.value || '').trim();
    const emoji = String($('#accountProfileEmoji')?.value || '').trim();
    if (!loginId || !displayName) return toast('登录 ID 和账户姓名不能为空');
    try {
      const r = await api('PUT', '/api/account/profile', { loginId, displayName, emoji });
      S.account = { ...(S.account || {}), user: r.user || r.account?.user, households: r.households || S.account?.households };
      closeSheet();
      await loadState(true);
      render();
      toast('账户资料已更新');
    } catch (e) { toast('保存失败：' + e.message); }
  },
  async 'account-password'() {
    openSheet({
      title: '修改账户密码',
      body: `<div class="field"><label class="field-label">新密码</label><input class="input" id="accountNewPassword" type="password" maxlength="64" placeholder="4 到 64 个字符" /></div><p class="section-sub">修改后其他设备上的账户登录会话可能需要重新登录。</p>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="save-account-password">保存</button>`,
    });
    $('#accountNewPassword')?.focus();
  },
  async 'save-account-password'() {
    const password = String($('#accountNewPassword')?.value || '');
    if (!/^\S{4,64}$/.test(password)) return toast('密码要 4 到 64 个字符');
    try {
      const r = await api('PUT', '/api/account/password', { password });
      if (r && (r.accountToken || r.token)) setAccountToken(r.accountToken || r.token);
      closeSheet();
      await loadState(true);
      render();
      toast('密码已更新');
    } catch (e) { toast('修改失败：' + e.message); }
  },
  async 'leave-household'() {
    const h = currentHousehold();
    if (!h) return;
    if (!confirm(`退出「${h.name}」？你的账户和其他家庭不会受影响。`)) return;
    try {
      await api('DELETE', `/api/households/${encodeURIComponent(h.id)}/members/me`);
      S.householdId = '';
      saveSelectedHousehold('');
      S.view = 'menu';
      await loadState(true);
      render();
      toast(`已退出「${h.name}」`);
    } catch (e) { toast('退出失败：' + e.message); }
  },
  'dissolve-household'() {
    const h = currentHousehold();
    if (!h) return;
    return ACTIONS['del-household']({ dataset: { id: h.id, dissolve: '1' } });
  },
  'open-join-family'(el) {
    const user = accountUser() || {};
    const preset = el && el.dataset ? el.dataset.id || '' : '';
    openSheet({
      title: '申请加入家庭',
      body: `<div class="field"><label class="field-label">家庭 ID 或名称</label><input class="input" id="joinFamilyTarget" value="${esc(preset)}" placeholder="输入家庭名称或 ID" /></div><div class="account-profile"><span class="account-avatar">${esc(user.emoji || '🙋')}</span><div><b>${esc(user.displayName || user.loginId || '当前账户')}</b><span class="account-id">申请人由当前登录账户自动识别</span></div></div><div class="field"><label class="field-label">留言（选填）</label><textarea class="textarea" id="joinNote" rows="3" maxlength="100" placeholder="告诉管理员你是谁"></textarea></div><div class="field"><label class="field-label">申请身份</label><select class="input" id="joinRole"><option value="member">普通成员</option><option value="owner">家庭管理员（由管理员最终决定）</option></select></div>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="send-join-family">提交申请</button>`,
    });
  },
  async 'send-join-family'() {
    const target = String($('#joinFamilyTarget')?.value || '').trim();
    if (!target) return toast('请输入家庭名称或 ID');
    const h = households().find((x) => x.id === target || x.name === target);
    const householdId = h ? h.id : target;
    try {
      await api('POST', '/api/join-requests', {
        householdId,
        note: String($('#joinNote')?.value || '').trim(),
        requestedRole: String($('#joinRole')?.value || 'member') === 'owner' ? 'owner' : 'member',
      });
      closeSheet();
      toast('申请已提交，等待家庭管理员批准', 3200);
    } catch (e) { toast('提交失败：' + e.message); }
  },

  /* 「你是谁」 */
  'open-me'() {
    // 新账户只有一个全局身份，账户入口不再打开成员认领或家庭密码向导。
    if (accountUser()) {
      S.view = 'settings';
      return render();
    }
    if (accountUser() && !meMember()) {
      S.view = 'settings';
      return render();
    }
    // 已经认领过的人走一步就够了：直接改身份，不用再输一遍密码。
    // 换家庭、换人才需要重新认证 —— 那时才进向导。
    const m = meMember();
    if (m && deviceToken(S.householdId)) {
      return openWhoami('member');
    }
    openWhoami(S.householdId ? 'member' : 'house');
  },
  'who-house'(el) {
    S.householdId = el.dataset.id;
    saveSelectedHousehold(S.householdId);
    S.memberFilter = '';
    S.pantryCat = '全部';
    S.pantryFilter = 'all';
    S.category = '全部';
    openWhoami('member');
    // 换了家庭就得重新拉：现在选的这家的成员名单，跟刚才那家不是一回事
    loadState(true).then(() => {
      S.whoamiStep = 'member';
      render();
    });
  },
  'who-member'(el) {
    const id = el.dataset.id;
    const m = memberById(id);
    if (!m) return;
    // 这台设备已经认过他了（令牌还在）→ 直接切，不问密码。
    if (meMemberId() === id && deviceToken(S.householdId)) {
      markOnboarded();
      closeWhoami();
      return toast(`记下了：${currentHousehold().name} · ${m.name}`);
    }
    S.whoamiPick = id;
    S.whoamiStep = 'pin';
    renderWhoami();
  },
  async 'who-password'(el) {
    const id = el.dataset.id || S.whoamiPick;
    const m = memberById(id);
    if (!m) return;
    const loginId = (($('#whoLoginId') || {}).value || '').trim();
    const password = (($('#whoPassword') || {}).value || '').trim();
    const err = $('#whoPasswordErr');
    const say = (t) => {
      if (err) {
        err.hidden = false;
        err.textContent = t;
      }
    };
    if (!loginId) return say('先填写登录 ID，可以使用汉字或字母。');
    if (loginId.length > 32) return say('登录 ID 最多 32 个字符。');
    if (!/^\S{4,64}$/.test(password)) return say('密码要 4 到 64 个字符，可以使用汉字、字母、数字和符号。');
    try {
      await claimMember(id, loginId, password);
      markOnboarded();
      const house = currentHousehold();
      closeWhoami();
      render();
      toast(`记下了：${house ? house.name : ''} · ${m.name}（${ROLE_LABEL[myRole()]}）`, 3200);
      await loadState(true);
      render();
    } catch (e) {
      say(e.message || '不对，再试一次');
    }
  },
  'who-password-back'() {
    S.whoamiPick = '';
    S.whoamiStep = 'member';
    renderWhoami();
  },
  'who-back'() {
    openWhoami('house');
  },
  'who-apply'(el) {
    closeWhoami();
    openJoinSheet(el.dataset.id || S.householdId);
  },
  'who-skip'() {
    markOnboarded();
    closeWhoami();
    toast('先随便看看。想认领身份，点右上角「还没登记」那个按钮', 3600);
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
  'clear-manage-search'() {
    S.manageKeyword = '';
    render();
    $('#manageKeyword')?.focus();
  },

  /* 菜单 */
  'filter-scope'(el) {
    S.dishScope = el.dataset.scope || 'all';
    render();
  },
  /** 同名的私房版本，按名字列出来让人自己挑 */
  'unfold-dish'(el) {
    const d = dishById(el.dataset.id);
    if (!d) return;
    const twins = byScope(visibleDishes(), 'own').filter((x) => sameKey(x.name) === sameKey(d.name));
    if (!twins.length) {
      S.dishScope = 'own';
      return render();
    }
    openSheet({
      title: `「${d.name}」的私房版本`,
      body: `<p class="section-sub" style="margin:0 0 12px">
          共享里已有这道菜，默认显示共享那一版。这里是你家的 ${twins.length} 个版本，改成什么样只有你看得到。</p>
        <div class="dup-list">${twins
          .map(
            (t) => `<button class="dup-row" data-act="open-dish" data-id="${esc(t.id)}">
          <span class="dup-row-main">
            <span class="dup-row-name">${esc(t.name)}</span>
            <span class="dup-row-sub">${esc([t.authorName ? dishAuthor(t) : '', t.category, t.duration ? t.duration + ' 分钟' : ''].filter(Boolean).join(' · '))}</span>
          </span>
          <span class="dup-row-go">›</span>
        </button>`
          )
          .join('')}</div>`,
      foot: `<button class="btn ghost" data-act="filter-scope" data-scope="own">看我全部私房菜</button>
             <button class="btn" data-act="close-sheet">知道了</button>`,
    });
  },
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
  random() {
    openRandomSheet();
  },
  'random-run'() {
    const filters = {
      scope: $('#randomScope')?.value || 'all',
      category: $('#randomCategory')?.value || '全部',
      tags: $('#randomTags')?.value || '',
      notCooked: !!$('#randomNotCooked')?.checked,
      excludeOrdered: !!$('#randomExcludeOrdered')?.checked,
    };
    const list = randomCandidates(filters);
    if (!list.length) return toast('没有符合条件的菜，换个范围或条件试试', 3200);
    S.randomFilters = filters;
    closeSheet();
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
  'batch-import-open'() {
    if (!S.householdId) return toast('请先创建或加入一个家庭');
    if (!isSuper()) return toast('批量图片识别需要超级管理员权限');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files || [])];
      if (files.length) importBatchRecipeImages(files);
    };
    input.click();
  },
  'batch-import-toggle'(el) {
    const d = S.batchImport[Number(el.dataset.i)];
    if (d) d._selected = !!el.checked;
  },
  'batch-import-name'(el) {
    const d = S.batchImport[Number(el.dataset.i)];
    if (d) d.name = el.value;
  },
  'batch-import-category'(el) {
    const d = S.batchImport[Number(el.dataset.i)];
    if (d) d.category = el.value;
  },
  'batch-import-remove'(el) {
    S.batchImport.splice(Number(el.dataset.i), 1);
    if (!S.batchImport.length) return closeSheet();
    const rows = $('#batchImportRows');
    if (rows) rows.innerHTML = batchImportRowsHtml();
  },
  async 'batch-import-save'() {
    const list = S.batchImport.filter((d) => d._selected && String(d.name || '').trim());
    if (!list.length) return toast('至少勾选一道并填写菜名');
    const q = `?householdId=${encodeURIComponent(S.householdId)}`;
    let saved = 0; let failed = 0;
    for (const d of list) {
      try {
        const body = { ...d, name: String(d.name).trim() };
        delete body._selected;
        if (body.householdId) await api('POST', `/api/my-dishes${q}`, body);
        else await api('POST', '/api/dishes', body);
        saved += 1;
      } catch (_) { failed += 1; }
    }
    closeSheet();
    S.batchImport = [];
    await loadState(true);
    render();
    toast(`已保存 ${saved} 道菜谱${failed ? `，${failed} 道失败` : ''}`, 3600);
  },
  'batch-export-open'() {
    openBatchExportSheet();
  },
  'batch-export-toggle'(el) {
    if (el.checked) S.batchExportSel.add(el.dataset.id);
    else S.batchExportSel.delete(el.dataset.id);
    const count = $('#batchExportCount');
    if (count) count.textContent = S.batchExportSel.size;
  },
  'batch-export-all'() {
    const list = manageDishRows();
    const all = list.length && list.every((d) => S.batchExportSel.has(d.id));
    S.batchExportSel = all ? new Set() : new Set(list.map((d) => d.id));
    const rows = $('#batchExportRows');
    if (rows) rows.innerHTML = batchExportRowsHtml();
    const count = $('#batchExportCount');
    if (count) count.textContent = S.batchExportSel.size;
  },
  async 'batch-export-selected'() {
    const list = manageDishRows().filter((d) => S.batchExportSel.has(d.id));
    if (!list.length) return toast('至少选择一道菜谱');
    closeSheet();
    toast(`正在生成 ${list.length} 张菜谱图片…`, 5000);
    for (const d of list) {
      const blob = await dishShareCard(d);
      if (blob) downloadBlob(blob, `${String(d.name || '菜谱').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)}.png`);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    toast(`已下载 ${list.length} 张菜谱图片`, 3200);
  },
  'edit-dish'(el) {
    const d = dishById(el.dataset.id);
    if (d) openDishEditor(d);
  },
  /** 展开「粘贴菜单文字」那块 */
  'ai-text-open'() {
    const box = $('#aiPasteBox');
    if (box) box.hidden = false;
    const ta = $('#fAiText');
    if (ta && !('ontouchstart' in window)) ta.focus();
  },
  async 'ai-from-text'() {
    if (!aiReady()) return toast('还没配置 AI');
    if (aiBusyOn) return;
    await recognizeDishFromText();
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
    // 复制只继承归属，不继承「共享」：复制我家私菜不该把它变成全体共享
    toast(`已复制「${d.name}」${isPrivate(d) ? '，仍是仅本家可见' : ''}`);
    render();
  },
  /**
   * 「收进我家」：普通人碰公共菜谱的唯一正当途径。
   * 不是改它，是抄一份到自家名下 —— 管理员维护的那份原样保留。
   */
  async 'adopt-dish'(el) {
    const src = dishById(el.dataset.id);
    if (!src) return toast('这道菜已经不在菜单里了');
    try {
      const r = await api(
        'POST',
        `/api/my-dishes/${encodeURIComponent(src.id)}/adopt?householdId=${encodeURIComponent(S.householdId)}`,
        {}
      );
      await loadState(true);
      render();
      closeSheet();
      toast(`「${r.name}」已经收进你家了，改成你自己的做法吧`, 3200);
      openDishEditor(r);
    } catch (err) {
      toast('收不进来：' + err.message);
    }
  },
  async 'copy-dish-to-shared'(el) {
    const src = dishById(el.dataset.id);
    if (!src || !src.householdId || src.householdId !== S.householdId) return toast('这道私房菜已经不在当前家庭了');
    if (!isHouseAdmin(src.householdId)) return toast('只有当前家庭管理员可以添加到共享菜单');
    try {
      const r = await api(
        'POST',
        `/api/dishes/${encodeURIComponent(src.id)}/copy-to-shared?householdId=${encodeURIComponent(src.householdId)}`,
        {}
      );
      await loadState(true);
      render();
      closeSheet();
      toast(r.category === src.category
        ? `「${r.name}」已复制到共享菜单，原私房菜保留不变`
        : `「${r.name}」已复制到共享菜单，分类调整为「${r.category}」，原私房菜保留不变`, 4200);
    } catch (err) {
      toast('添加到共享失败：' + err.message);
    }
  },
  async 'toggle-dish-status'(el) {
    const d = dishById(el.dataset.id);
    if (!d) return;
    if (!canManageDishStatus(d)) return toast('只有管理员能修改菜品供应状态');
    const next = d.dishStatus === 'paused' ? 'active' : 'paused';
    try {
      await api('PATCH', '/api/dishes/' + encodeURIComponent(d.id) + '/status', { dishStatus: next });
      await loadState(true);
      render();
      toast(next === 'paused' ? '已暂停供应' : '已恢复供应');
    } catch (err) {
      toast('状态更新失败：' + err.message);
    }
  },
  async 'del-dish'(el) {
    const d = dishById(el.dataset.id);
    if (!d) return;
    if (!canEdit(d)) return toast(denyWhy(d));
    if (!confirm(`确定删除「${d.name}」？\n相关的待做点餐也会一起删掉，此操作不可撤销。`)) return;
    const q = `?householdId=${encodeURIComponent(S.householdId)}`;
    if (!d.householdId || isHouseAdmin(d.householdId)) await api('DELETE', `/api/dishes/${el.dataset.id}`);
    else await api('DELETE', `/api/my-dishes/${el.dataset.id}${q}`);
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
    S.draft.dish.seasonings.push({ name: '', amount: '', purchaseType: '' });
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
    m.seasonings.push({ name: '', amount: '', purchaseType: '' });
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
    // 新菜沿用打开编辑器时的栏目范围；跨范围通过独立副本操作完成。
    // 改菜：本来是共享的、或我家我能当管理员的，走 /api/dishes；
    //       普通成员改自己写的那几道，走 /api/my-dishes（服务端再验一遍作者）
    const target = S.draft.isNew ? null : dishById(S.draft.id);
    const mine = target ? !!target.householdId : !!d.householdId;
    const q = `?householdId=${encodeURIComponent(S.householdId)}`;
    try {
      if (S.draft.isNew) {
        if (mine) await api('POST', `/api/my-dishes${q}`, d);
        else await api('POST', '/api/dishes', d);
        toast(mine ? `「${d.name}」记进你家了` : `「${d.name}」已加入菜单`);
        // 新菜已经有自己的 id 了，__new__ 草稿顺手清掉，
        // 否则下次「记一道菜」会捞出刚存进去的那份
        dishDrafts.delete('__new__');
      } else {
        if (!canEdit(target)) return toast(denyWhy(target));
        if (mine) await api('PUT', `/api/my-dishes/${S.draft.id}${q}`, d);
        else await api('PUT', `/api/dishes/${S.draft.id}`, d);
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
    if (!S.householdId) return toast('请先选择一个已加入的家庭');
    const d = dishById(el.dataset.id);
    if (d && d.dishStatus === 'paused') return toast('这道菜目前暂停供应，不能新建点餐');
    openOrderForm(d);
  },
  'new-order'() {
    openOrderForm(null);
  },
  /** 点餐弹层：勾选而不是单选，勾几道就下几道 */
  'pick-dish'(el) {
    const id = el.dataset.id;
    if (!S.orderPickSel) S.orderPickSel = new Set();
    if (S.orderPickSel.has(id)) S.orderPickSel.delete(id);
    else S.orderPickSel.add(id);
    const names = [...S.orderPickSel].map((x) => (dishById(x) || {}).name).filter(Boolean);
    document
      .querySelectorAll('.sheet-body .picker-item[data-act="pick-dish"]')
      .forEach((b) => b.setAttribute('aria-pressed', String(S.orderPickSel.has(b.dataset.id))));
    const box = $('#ordName');
    if (box && names.length) box.value = names.join('、');
    syncOrderPickBtn();
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
    const picks = [...(S.orderPickSel || new Set())]
      .map((id) => dishById(id))
      .filter(Boolean);
    if (!picks.length && !o.dishName) return toast('先勾几道菜，或者写上想吃的名字');
    try {
      // 勾了几道就下几道：谁点的、几份、备注这些对每道都一样，统一填一次就行
      const targets = picks.length ? picks : [{ id: null, name: o.dishName }];
      for (const t of targets) {
        await api('POST', '/api/orders', {
          ...o,
          dishId: t.id || null,
          dishName: t.name,
        });
      }
      closeSheet();
      await loadState(true);
      S.view = 'order';
      S.orderStatus = 'pending';
      render();
      toast(targets.length > 1 ? `🔔 已下单 ${targets.length} 道` : `🔔 已下单：${targets[0].name}`);
    } catch (err) {
      toast('提交失败：' + err.message);
    }
  },
  async 'set-status'(el) {
    if (!anyHouseAdmin()) return toast('只有管理员能更新做饭状态');
    await api('PATCH', `/api/orders/${el.dataset.id}`, { status: el.dataset.status });
    await loadState(true);
    toast(el.dataset.status === 'done' ? '开吃！🍚' : '开始做菜了');
    render();
  },
  async 'del-order'(el) {
    if (!anyHouseAdmin()) return toast('只有管理员能删除点餐记录');
    if (!confirm('删除这条点餐？')) return;
    await api('DELETE', `/api/orders/${el.dataset.id}`);
    await loadState(true);
    render();
  },
  async 'clear-done'() {
    if (!anyHouseAdmin()) return toast('只有管理员能清空已完成记录');
    const h = currentHousehold();
    if (!confirm(`清空「${h ? h.name : ''}」所有已完成的点餐记录？`)) return;
    await api('DELETE', `/api/orders/done?householdId=${encodeURIComponent(S.householdId)}`);
    await loadState(true);
    render();
  },
  async 'toggle-shop'(el) {
    const name = el.dataset.name;
    const item = (S.shopList || []).find((row) => row.name === name);
    if (S.shopContext?.kind === 'plan' && (!item || item.trackingMode !== 'presence')) {
      if (S.planShopSelected.has(name)) S.planShopSelected.delete(name);
      else S.planShopSelected.add(name);
      render();
      return;
    }
    try {
      if (item && item.trackingMode === 'presence') {
        const currentlyDone = S.shoppingChecked.has(name);
        const stock = findStock(name);
        if (stock.length) {
          for (const pantry of stock) await api('PUT', `/api/pantry/${pantry.id}`, { ...pantry, trackingMode: 'presence', hasStock: !currentlyDone });
        } else if (!currentlyDone) {
          await api('POST', '/api/pantry', {
            householdId: S.householdId, name, category: item.category || '调味干货',
            trackingMode: 'presence', hasStock: true, quantity: 0, minQuantity: 0, unit: '',
          });
        }
      }
      await setShoppingStatus(name, S.shoppingChecked.has(name) ? 'needed' : 'completed');
      await loadState(true);
      render();
    } catch (err) {
      toast(err.message || '采购状态保存失败');
    }
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
    toast('请让对方先登录全局账户，再从公开家庭目录申请加入');
  },
  /** 家庭管理员从自己的那页进来管成员 */
  'open-members'() {
    const h = currentHousehold();
    if (!isHouseAdmin(S.householdId)) return toast('只有这个家的管理员能管成员');
    openSheet({
      title: `${h ? h.name : ''}的成员`,
      body: `<p class="section-sub" style="margin:0 0 12px">
          成员由全局账户登录后申请加入，管理员在这里审批关系和设置家庭权限；账户密码不在家庭内设置。</p>
        ${membersHtml()}
        <p class="section-sub" style="margin-top:14px">
          家里人登录自己的账户后，可以从公开家庭目录申请加入；批了就会自动出现在这份名单里。</p>`,
      foot: `<button class="btn ghost" data-act="close-sheet">关闭</button>`,
    });
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
  /** 成员权限：普通成员 / 管理员 */
  'm-role'(el) {
    el
      .closest('.seg')
      .querySelectorAll('.seg-opt')
      .forEach((b) => {
        const on = b.dataset.v === el.dataset.v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
  },
  /** 兼容旧页面的成员密码入口已停用；账户密码只能在账户设置中修改。 */
  'm-password-clear'() {
    toast('账户密码请在账户设置中修改');
  },
  'm-pin-clear'() {
    return ACTIONS['m-password-clear']();
  },
  async 'save-member'(el) {
    const name = $('#mName').value.trim();
    if (!name) return toast('给家人起个称呼');
    const emoji = $('#mEmoji').value.trim() || '🙋';
    const id = el.dataset.id;
    const existing = id ? memberList().find((m) => m.id === id) : null;
    const loginId = existing ? (existing.loginId || '') : '';
    // 成员 id 是唯一键，名字只是显示 —— 爸爸和儿子都叫「小明」是允许的
    const list = memberList().map((m) => ({
      id: m.id,
      name: m.name,
      loginId: m.loginId || m.name,
      emoji: m.emoji,
      role: m.role,
    }));
    const seg = el.closest('.sheet').querySelector('.seg-opt.on');
    const role = seg && seg.dataset.v === 'owner' ? 'owner' : 'member';
    let hit;
    if (existing) {
      hit = list.find((m) => m.id === id);
      hit.name = name;
      if (loginId) hit.loginId = loginId;
      hit.emoji = emoji;
      hit.role = role;
    } else {
      hit = { id: 'm_' + Date.now().toString(36), name, loginId, emoji, role };
      list.push(hit);
    }
    // 一个 owner 都不留的话，服务端会把第一个成员顶上去当管理员 —— 那是替用户做决定，
    // 得先问一句，不然「取消最后一个管理员」会变成「静默换了个人当管理员」。
    const owners = list.filter((m) => m.role === 'owner');
    if (existing && existing.role === 'owner' && role !== 'owner' && owners.length === 0) {
      return toast('这个家还没别的管理员。取消 TA 的话，剩下的成员里得有人接手。');
    }
    closeSheet();
    // 改成员名单是危险动作 → 先过一次身份验证
    await withDangerPin(existing || { ...hit, hasPin: false }, '修改成员', async () => {
      try {
        await api('PUT', `/api/households/${currentHousehold().id}`, { members: list });
      } catch (err) {
        return toast('保存失败：' + err.message);
      }
      await loadState(true);
      toast(existing ? '已保存家庭权限' : `已添加 ${name}`);
      render();
    });
  },
  async 'del-member'(el) {
    const m = memberList().find((x) => x.id === el.dataset.id);
    if (!m) return;
    const st = memberStats(m.name);
    const owned = scopeDishes().filter((d) => d.authorId === m.id).length;
    const owners = memberList().filter((x) => x.role === 'owner');
    let msg = '';
    if (st.count) msg += `TA 的 ${st.count} 条历史点餐记录会保留，但分组显示时不再带头像。`;
    if (owned) msg += `\n\nTA 写的 ${owned} 道私菜会变成「不知道谁写的」，之后谁都能改 —— 想留就先把菜转给别的成员。`;
    if (m.role === 'owner' && owners.length === 1) msg += '\n\nTA 是这个家唯一的管理员，删了之后剩下的成员里没人能管这个家了。';
    if (!confirm(`删除成员「${m.name}」？${msg}`)) return;
    await withDangerPin(m, '删除成员', async () => {
      try {
        await saveMembers(
          memberList()
            .filter((x) => x.id !== m.id)
            .map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, role: x.role }))
        );
      } catch (e) {
        return toast(e.message || '没删掉');
      }
      // 这台设备如果认的就是他 → 身份也一起清掉，别留着一个认不出来的身份
      if (meMemberId() === m.id) {
        forgetMeId();
        setDeviceToken(S.householdId, '');
        markOnboarded();
      }
      if (S.memberFilter === m.name) S.memberFilter = '';
      render();
      toast('已删除');
    });
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
    const cur = id ? S.data.categories.find((c) => c.id === id) : null;
    // 分类没有作者，只有归属。所以规则简单：共享的归管理员，
    // 自家的只认这家管理员（普通成员开出来的分类自己也改不了，那是全家的分类）。
    const mine = cur ? !(!cur.householdId || isHouseAdmin(cur.householdId)) : !canWriteShared();
    const sel = $('#catScope');
    const body = {
      name,
      householdId: mine
        ? S.householdId || null
        : sel && sel.value === 'own' && S.householdId
        ? S.householdId
        : null,
    };
    const q = `?householdId=${encodeURIComponent(S.householdId)}`;
    try {
      if (mine) await (id ? api('PUT', `/api/my-categories/${id}${q}`, body) : api('POST', `/api/my-categories${q}`, body));
      else await (id ? api('PUT', `/api/categories/${id}`, body) : api('POST', '/api/categories', body));
    } catch (err) {
      return toast('保存失败：' + err.message);
    }
    closeSheet();
    await loadState(true);
    render();
    toast('已保存');
  },
  async 'del-cat'(el) {
    const c = S.data.categories.find((x) => x.id === el.dataset.id);
    if (!c) return;
    if (!canEdit(c)) return toast(denyWhy(c));
    // 只数本家看得见的菜：服务端也只把同归属的菜挪走，提示得跟实际发生的一致
    const n = scopeDishes().filter((x) => x.category === c.name).length;
    const msg = n
      ? `删除分类「${c.name}」？\n该分类下 ${n} 道菜会移到「其他」，菜品不会丢。`
      : `删除分类「${c.name}」？`;
    if (!confirm(msg)) return;
    const q = `?householdId=${encodeURIComponent(S.householdId)}`;
    if (!c.householdId || isHouseAdmin(c.householdId)) await api('DELETE', `/api/categories/${el.dataset.id}`);
    else await api('DELETE', `/api/my-categories/${el.dataset.id}${q}`);
    if (S.category === c.name) S.category = '全部';
    await loadState(true);
    render();
  },

  /* 家庭 */
  'open-houses'() {
    openHouseholdPicker();
  },
  async 'pick-house'(el) {
    const id = el.dataset.id;
    if (id === S.householdId) return;
    const h = households().find((x) => x.id === id);
    // 家里人不能直接切进别人家 —— 得管理员批了才算成员。
    // 成员 id 各家一份，所以要比「我在这家认领过没有」，不能只比当前这家的。
    const myId = meMemberId();
    const uid = accountUser()?.id || accountUser()?.userId;
    const isMemberThere = (x) => !!((uid && (x.members || []).some((m) => typeof m !== 'string' && (m.userId === uid || m.id === uid))) || (myId && (x.members || []).some((m) => m.id === myId)));
    if (h && !isSuper() && !isMemberThere(h)) {
      return openJoinSheet(id);
    }
    S.householdId = id;
    saveSelectedHousehold(id);
    S.view = 'menu';
    saveAccountContext();
    // 换家庭后原来的筛选多半没意义了，清掉免得看着空。
    // 分类筛选也得清：当前选中的分类可能正是「只有刚离开那家看得见」的私有分类
    S.memberFilter = '';
    S.pantryCat = '全部';
    S.pantryFilter = 'all';
    S.category = '全部';
    closeSheet();
    if (!isSuper()) await loadState(true);
    render();
    const now = currentHousehold();
    if (now) toast(`已切到 ${now.emoji} ${now.name}`);
  },
  'new-household'() {
    if (!hasAccount()) return render();
    if (accountHouseholdCount() >= 5) return toast('一个账号最多加入 5 个家庭，请先退出一个家庭');
    openHouseholdEditor(null);
  },
  /** 申请加入别人家 */
  async 'send-join'(el) {
    // 申请是发给别家，不能把尚未加入的目标家庭写成当前家庭。
    const target = el.dataset.id || S.householdId;
    if (!target) return toast('请选择要申请的家庭');
    try {
      const r = await api('POST', '/api/join-requests', {
        householdId: target,
        note: (($('#joinNote') || {}).value || '').trim(),
        requestedRole: (($('#joinRole') || {}).value || 'member') === 'owner' ? 'owner' : 'member',
      });
      S.access = S.access || [];
      if (!S.access.some((x) => x.id === r.data.id)) S.access.unshift(r.data);
      closeSheet();
      S.householdId = '';
      saveSelectedHousehold('');
      S.view = 'home';
      await loadState(true);
      render();
      toast('申请已送到管理员那里，等他点头', 3200);
    } catch (err) {
      toast('没发出去：' + err.message);
    }
  },
  /** 管理员批准加入申请 */
  async 'join-decide'(el) {
    const id = el.dataset.id;
    try {
      const r = await api('PUT', `/api/join-requests/${encodeURIComponent(id)}`, {
        status: el.dataset.ok === '1' ? 'ok' : 'no',
        role: el.dataset.role === 'owner' ? 'owner' : 'member',
      });
      await loadState(true);
      render();
      toast(r.data.status === 'ok'
        ? `已批准，${r.data.name} 现在是${r.data.approvedRole === 'owner' ? '这个家的管理员' : '这个家的成员'}了`
        : '已拒绝');
    } catch (err) {
      toast('处理失败：' + err.message);
    }
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
    const target = id ? households().find((x) => x.id === id) : null;

    // 改家庭资料只需要当前家庭管理员或超级管理员；不再存在家庭口令分支。
    if (target && !isHouseAdmin(id, memberOf(id))) {
      return toast('只有这个家庭的管理员可以修改家庭资料');
    }
    const saved = await (id
      ? api('PUT', `/api/households/${id}`, body)
      : api('POST', '/api/households', body));
    closeSheet();
    await loadState(true);
    if (!id) {
      S.householdId = saved.id;
      saveSelectedHousehold(saved.id);
      S.memberFilter = '';
      render();
      toast(`已添加 ${saved.name}，你现在是家庭管理员`, 3600);
    } else {
      render();
      toast('已保存');
    }
  },
  /** 超级管理员：把普通家庭升级为正式 */
  async 'approve-household'(el) {
    if (!isSuper()) return toast('只有超级管理员能升级家庭');
    await withDangerPin(null, '升级家庭为正式', async () => {
      try {
        await api('PUT', `/api/households/${el.dataset.id}`, { status: 'approved' });
      } catch (e) {
        return toast(e.message || '没升级成');
      }
      closeSheet();
      await loadState(true);
      render();
      toast('已升级为正式家庭');
    });
  },
  async 'downgrade-household'(el) {
    if (!isSuper()) return toast('只有超级管理员能改家庭状态');
    if (!confirm('降回普通家庭？这一家之后就不能往共享菜单放东西了。')) return;
    try {
      await api('PUT', `/api/households/${el.dataset.id}`, { status: 'normal' });
    } catch (err) {
      return toast(err.message || '没改成');
    }
    await loadState(true);
    render();
    toast('已降为普通家庭');
  },
  /** 用家庭口令解锁这个家的管理员权限 */
  async 'unlock-house'() {
    const h = currentHousehold();
    if (!h) return;
    const r = await askHousePin(h, '解锁家庭管理员权限');
    if (!r) return;
    await loadState(true);
    render();
    toast(`已解锁「${h.name}」的管理员权限`, 3200);
  },
  async 'del-household'(el) {
    const h = households().find((x) => x.id === el.dataset.id);
    if (!h) return;
    const dissolving = el.dataset.dissolve === '1' || households().length <= 1;
    const nOrder = householdOrders(h.id).length;
    const nFood = householdPantry(h.id).length;
    const nDish = (S.data.dishes || []).filter((d) => d.householdId === h.id).length;
    const nCat = (S.data.categories || []).filter((c) => c.householdId === h.id).length;
    const mine = [];
    if (nDish) mine.push(`${nDish} 道私菜`);
    if (nCat) mine.push(`${nCat} 个私有分类`);
    if (nOrder || nFood) mine.push(`${nOrder} 条点餐、${nFood} 样库存`);
    // 共享菜不在其中：它们是全体家庭的，换一家照样看得到
    const extra = mine.length ? `\n只有「${h.name}」能看到的 ${mine.join('、')}会一起删掉，` : '';
    if (!confirm(`${dissolving ? '解散' : '删除'}家庭「${h.name}」？${extra}删了找不回来。`)) return;
    // 删家庭是这套权限里最危险的一步 —— 没有比「抹掉一整家人的数据」更大的事了
    await withDangerPin(meMember(), '删除家庭', async () => {
      try {
        await api('DELETE', `/api/households/${h.id}`);
      } catch (err) {
        return toast(err.message || '没删掉');
      }
      setDeviceToken(h.id, '');
      setHouseToken(h.id, '');
      if (S.householdId === h.id) {
        S.householdId = '';
        saveSelectedHousehold('');
        S.memberFilter = '';
      }
      await loadState(true);
      render();
      toast(dissolving ? `已解散「${h.name}」` : '已删除');
    });
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
  /** 计划弹层：点一下先勾上，不立刻加 —— 一次能勾好几道 */
  'pick-plan-dish'(el) {
    const id = el.dataset.id;
    if (!S.planPickSel) S.planPickSel = new Set();
    if (S.planPickSel.has(id)) S.planPickSel.delete(id);
    else S.planPickSel.add(id);
    document
      .querySelectorAll('.sheet-body .picker-item[data-act="pick-plan-dish"]')
      .forEach((b) => b.setAttribute('aria-pressed', String(S.planPickSel.has(b.dataset.id))));
    syncPlanPickBtn();
  },
  /** 勾好的几道一次加进这一周 */
  async 'save-plan-picks'() {
    const ids = [...(S.planPickSel || new Set())];
    if (!ids.length) return toast('先勾几道菜');
    const week = S.planPickWeek || planWeek();
    const plannedFor = ($('#planDate') && $('#planDate').value) || week;
    let n = 0;
    for (const id of ids) {
      const d = dishById(id);
      if (!d) continue;
      try {
        await addToPlan({ dishId: d.id, name: d.name, servings: d.servings, plannedFor }, week, () => {});
        n++;
      } catch (_) {
        /* 已经在计划里的那道跳过，不打断其余的 */
      }
    }
    S.planPickSel = new Set();
    closeSheet();
    await loadState(true);
    render();
    toast(n ? `已加入 ${n} 道` : '这几道都已经在计划里了');
  },
  async 'toggle-plan-dish'(el) {
    if (!S.householdId) return toast('请先选择一个已加入的家庭');
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
    const week = el.dataset.week || planWeek();
    await addToPlan({ name, plannedFor: ($('#planDate') && $('#planDate').value) || week }, week);
  },
  async 'complete-plan-item'(el) {
    if (!isHouseAdmin(S.householdId)) return toast('只有家庭管理员能完成计划并扣库存');
    const item = planItems(planWeek()).find((x) => x.id === el.dataset.id);
    if (!item) return toast('计划菜不存在');
    if (!confirm(`完成「${item.name}」并按菜谱用量扣除库存？`)) return;
    try {
      const result = await api('PATCH', `/api/plans/items/${encodeURIComponent(item.id)}`, { status: 'done' });
      await loadState(true);
      render();
      const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
      toast(warningCount ? `已完成，${warningCount} 项库存不足或需要确认` : '已完成，库存已扣除');
    } catch (err) {
      toast(err.message || '扣库存失败');
    }
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
    const dishIds = planItems(planWeek()).filter((it) => it.status !== 'done').map((it) => it.dishId).filter(Boolean);
    const list = shoppingFromDishIds(dishIds);
    if (!list.length) return toast('计划里的菜还没有记录食材');
    await copyText(list.map((i) => i.isSeasoning
      ? `□ ${i.name}（调料，确认库存）`
      : `□ ${i.name}（${i.parts.join(' + ')}）`).join('\n'));
  },

  /* 库存 */
  'quick-add-ingredient'() {
    openQuickIngredientCreator(collectDish());
  },
  async 'save-quick-ingredient'() {
    const name = $('#quickIngredientName').value.trim();
    if (!name) return toast('请填写原料名称');
    const parentId = $('#quickIngredientCategory').value;
    const childName = ($('#quickIngredientChild') || {}).value?.trim() || '';
    let categoryId = parentId;
    if (childName) {
      const category = await api('POST', `/api/pantry-categories?householdId=${encodeURIComponent(S.householdId)}`, { name: childName, parentId });
      categoryId = category.id;
    }
    const mode = $('#quickIngredientMode').value;
    const ingredient = await api('POST', `/api/ingredients?householdId=${encodeURIComponent(S.householdId)}`, {
      name,
      aliases: [],
      categoryId,
      defaultTrackingMode: mode,
      defaultUnit: mode === 'quantity' ? $('#quickIngredientUnit').value.trim() : '',
    });
    const dish = S.quickIngredientDraft;
    if (dish) dish.seasonings.push({ name: ingredient.name, ingredientId: ingredient.id, amount: '', purchaseType: '' });
    S.quickIngredientDraft = null;
    closeSheet();
    await loadState(true);
    if (dish) openDishEditor(dish);
    else render();
    toast(`已添加家庭原料「${ingredient.name}」`);
  },
  'new-food'() {
    openFoodEditor(null);
  },
  async 'ai-pantry-classify'() {
    const rows = householdPantry();
    const result = await askAI('ingredient-classify', JSON.stringify(rows.slice(0, 100).map((p) => ({
      inputName: p.name,
      category: p.category,
      trackingMode: p.trackingMode || window.PantryLogic.inferTrackingMode(p),
    }))));
    if (!result || !Array.isArray(result.items)) return;
    const options = PANTRY_ORDER.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
    const body = result.items.map((proposal, index) => {
      const pantry = rows.find((p) => ingredientMatchKey(p.name) === ingredientMatchKey(proposal.inputName));
      if (!pantry) return '';
      return `<div class="list-row">
        <input type="checkbox" id="aiPantryCheck${index}" data-pantry-id="${esc(pantry.id)}" />
        <span class="list-row-main"><span class="list-row-title">${esc(proposal.inputName)} · 标准名建议 ${esc(proposal.name)}</span>
          <span class="list-row-sub">置信度 ${Math.round(Number(proposal.confidence) * 100)}% · ${esc(proposal.reason || '')}</span></span>
        <input class="input" id="aiPantryName${index}" value="${esc(proposal.name)}" aria-label="标准名称" />
        <select class="input" id="aiPantryCategory${index}">${options}</select>
        <select class="input" id="aiPantryMode${index}"><option value="quantity">按数量</option><option value="presence">有 / 无</option></select>
      </div>`;
    }).join('');
    if (!body) return toast('AI 没有找到可对应的现有库存条目');
    openSheet({
      title: '确认 AI 分类建议',
      body: `<p class="section-sub">只保存勾选的条目；分类和跟踪方式可在保存前调整。</p>${body}`,
      foot: '<button class="btn ghost" data-act="close-sheet">取消</button><button class="btn" data-act="confirm-pantry-ai">保存勾选项</button>',
      onMount(root) {
        result.items.forEach((proposal, index) => {
          const category = root.querySelector(`#aiPantryCategory${index}`);
          const mode = root.querySelector(`#aiPantryMode${index}`);
          if (category && PANTRY_ORDER.includes(proposal.category)) category.value = proposal.category;
          if (mode && ['presence', 'quantity'].includes(proposal.trackingMode)) mode.value = proposal.trackingMode;
        });
      },
    });
  },
  async 'confirm-pantry-ai'() {
    const selected = [...document.querySelectorAll('#modalRoot [data-pantry-id]:checked')];
    if (!selected.length) return toast('先勾选要保存的建议');
    for (const checkbox of selected) {
      const pantry = householdPantry().find((p) => p.id === checkbox.dataset.pantryId);
      if (!pantry) continue;
      const index = checkbox.id.replace('aiPantryCheck', '');
      const name = $(`#aiPantryName${index}`).value.trim();
      if (!name) return toast('标准名不能为空');
      const collision = findStock(name).find((p) => p.id !== pantry.id);
      if (collision) return toast(`「${name}」已存在库存记录，请先合并后再整理`);
      const trackingMode = $(`#aiPantryMode${index}`).value;
      await api('PUT', `/api/pantry/${pantry.id}`, {
        ...pantry,
        name,
        category: $(`#aiPantryCategory${index}`).value,
        trackingMode,
        hasStock: trackingMode === 'presence' ? Boolean(pantry.hasStock || Number(pantry.quantity) > 0) : false,
        quantity: trackingMode === 'presence' ? 0 : pantry.quantity,
        minQuantity: trackingMode === 'presence' ? 0 : pantry.minQuantity,
        unit: trackingMode === 'presence' ? '' : pantry.unit,
      });
    }
    closeSheet();
    await loadState(true);
    render();
    toast(`已整理 ${selected.length} 项库存`);
  },
  async 'ai-plan-analysis'() {
    const items = (S.shopList || []).map((item) => {
      const assessment = stockAssessment(item);
      return {
        name: item.name,
        ingredientId: item.ingredientId || '',
        trackingMode: item.trackingMode,
        category: item.category,
        categoryId: item.categoryId || '',
        requiredQty: item.requiredQty,
        requiredUnit: item.requiredUnit,
        stockQty: assessment.stockQty,
        shortageQty: assessment.shortageQty,
        status: assessment.key,
        unitUncertain: assessment.key === 'uncertain',
      };
    });
    const ingredients = householdIngredients().map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      aliases: ingredient.aliases,
      categoryId: ingredient.categoryId,
      trackingMode: ingredient.defaultTrackingMode,
    }));
    const categories = householdPantryCategories().map((category) => ({ id: category.id, name: category.name, parentId: category.parentId || '' }));
    const result = await askAI('plan-analysis', JSON.stringify({ weekOf: planWeek(), items, ingredients, categories }));
    if (!result || !result.summary) return;
    const categoryOptions = (selectedId) => ingredientCategoryOptions(selectedId);
    const proposals = result.proposals || [];
    S.aiPlanProposals = proposals;
    openSheet({
      title: 'AI 备菜分析',
      body: `<p>${esc(result.summary)}</p>${(result.flags || []).map((flag) => `<div class="list-row"><span class="list-row-main"><span class="list-row-title">${esc(flag.name)}</span><span class="list-row-sub">${esc(flag.reason)} · ${esc(flag.suggestion)}</span></span></div>`).join('')}
        ${proposals.length ? `<div class="field"><label class="field-label">原料建议 <span class="field-hint">只保存勾选项；同分类不会合并不同原料</span></label>
          ${proposals.map((proposal, index) => {
            const existing = ingredientById(proposal.ingredientId) || ingredientByName(proposal.inputName);
            const categoryId = proposal.categoryId || (existing && existing.categoryId) || '';
            return `<div class="block" style="margin:8px 0;padding:10px">
              <label class="check-row"><input type="checkbox" data-ai-proposal="${index}" /><span><b>${esc(proposal.inputName)}</b> → ${esc(proposal.name)} <small>${Math.round(proposal.confidence * 100)}%</small></span></label>
              <div class="field"><label class="field-label" for="aiProposalName${index}">标准名称</label><input class="input" id="aiProposalName${index}" value="${esc(proposal.name)}" /></div>
              <div class="field"><label class="field-label" for="aiProposalAliases${index}">同义名</label><input class="input" id="aiProposalAliases${index}" value="${esc((proposal.aliases || []).join('、'))}" /></div>
              <div class="field"><label class="field-label" for="aiProposalCategory${index}">分类</label><select class="select" id="aiProposalCategory${index}">${categoryOptions(categoryId)}</select></div>
              <div class="field"><label class="field-label" for="aiProposalMode${index}">默认库存方式</label><select class="select" id="aiProposalMode${index}"><option value="quantity" ${proposal.trackingMode === 'quantity' ? 'selected' : ''}>按数量</option><option value="presence" ${proposal.trackingMode === 'presence' ? 'selected' : ''}>只记录有 / 没有</option></select></div>
              <span class="section-sub">${esc(proposal.reason || '')}</span>
            </div>`;
          }).join('')}</div>` : '<p class="section-sub">没有需要应用的原料建议。</p>'}
        <p class="section-sub">确认只会保存原料对应关系并重新计算计划，不会更改库存余量或购买状态。</p>`,
      foot: `<button class="btn ghost" data-act="close-sheet">关闭</button>${proposals.length ? '<button class="btn" data-act="apply-plan-proposals">保存勾选项</button>' : ''}`,
    });
  },
  async 'apply-plan-proposals'() {
    const selected = [...document.querySelectorAll('#modalRoot [data-ai-proposal]:checked')];
    if (!selected.length) return toast('先勾选要应用的原料建议');
    const proposals = selected.map((checkbox) => {
      const index = Number(checkbox.dataset.aiProposal);
      const source = (S.aiPlanProposals || [])[index] || {};
      return {
        inputName: source.inputName,
        ingredientId: source.ingredientId || '',
        name: $(`#aiProposalName${index}`).value.trim(),
        aliases: $(`#aiProposalAliases${index}`).value.split(/[、,，\s]+/).map((alias) => alias.trim()).filter(Boolean),
        categoryId: $(`#aiProposalCategory${index}`).value,
        trackingMode: $(`#aiProposalMode${index}`).value,
      };
    });
    await api('POST', '/api/ingredients/apply-proposals', { householdId: S.householdId, proposals });
    closeSheet();
    await loadState(true);
    render();
    toast(`已保存 ${proposals.length} 条原料建议，计划已重新计算`);
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
  'toggle-pantry-group'(el) {
    const cat = el.dataset.cat || '其他';
    S.pantryGroups[cat] = !pantryGroupOpen(cat);
    saveAccountContext();
    render();
  },
  'select-pantry-group'(el) {
    const cat = el.dataset.cat || '其他';
    const on = el.dataset.on === '1';
    const selected = pickSel('pantry');
    pantryVisible().filter((p) => p.category === cat).forEach((p) => {
      if (on) selected.add(p.id);
      else selected.delete(p.id);
    });
    render();
  },
  'pick-preset'(el) {
    const { name, cat, unit, exp } = el.dataset;
    $('#fFoodName').value = name;
    if (cat) {
      $('#fFoodCat').value = cat;
      const category = householdPantryCategories().find((item) => item.name === cat && !item.parentId);
      $('#fFoodCategoryId').value = category ? category.id : '';
      syncFoodCategoryPicker(cat, category && category.id);
    }
    if (unit) $('#fFoodUnit').value = unit;
    if (window.PantryLogic.inferTrackingMode({ name, category: cat }) === 'presence') {
      $('#fFoodTracking').dataset.manual = '';
      $('#fFoodTracking').value = 'presence';
      $('#fFoodQuantityFields').hidden = true;
    }
    if (exp) $('#fFoodExp').value = exp;
    if (!$('#fFoodNote').value.trim()) $('#fFoodNote').value = '';
    toast(`已填入「${name}」`);
  },
  'pick-food-category'(el) {
    const cat = el.dataset.cat || '其他';
    const categoryId = el.dataset.categoryId || '';
    const input = $('#fFoodCat');
    if (input) input.value = cat;
    const idInput = $('#fFoodCategoryId');
    if (idInput) idInput.value = categoryId;
    syncFoodCategoryPicker(cat, categoryId);
    renderPresetGrid();
  },
  'exp-preset'(el) {
    const d = Number(el.dataset.days) || 0;
    $('#fFoodExp').value = d > 0 ? dayOffset(d) : '';
  },
  async 'save-food'(el) {
    const name = $('#fFoodName').value.trim();
    if (!name) return toast('先写上食材名');
    const id = el.dataset.id;
    const trackingMode = $('#fFoodTracking').value;
    const quantity = Number($('#fFoodQty').value);
    if (trackingMode === 'quantity' && (!Number.isFinite(quantity) || quantity < 0)) return toast('库存数量不能小于 0');
    if (trackingMode === 'quantity' && quantity === 0) {
      if (!id) return toast('数量为 0，无需新增库存条目');
      await api('PUT', `/api/pantry/${id}`, { quantity: 0 });
      closeSheet();
      await loadState(true);
      render();
      toast(`${name}数量为 0，已从库存移除`);
      return;
    }
    const currentItem = householdPantry().find((p) => p.id === el.dataset.id);
    let ingredient = ingredientById($('#fFoodIngredientId').value) || ingredientByName(name);
    if (!ingredient) {
      const categoryId = $('#fFoodCategoryId').value;
      ingredient = await api('POST', `/api/ingredients?householdId=${encodeURIComponent(S.householdId)}`, {
        name,
        aliases: [],
        categoryId,
        defaultTrackingMode: $('#fFoodTracking').value,
        defaultUnit: $('#fFoodTracking').value === 'quantity' ? ($('#fFoodUnit').value.trim() || '份') : '',
      });
    } else if (ingredient.categoryId !== $('#fFoodCategoryId').value) {
      ingredient = await api('PUT', `/api/ingredients/${encodeURIComponent(ingredient.id)}?householdId=${encodeURIComponent(S.householdId)}`, {
        categoryId: $('#fFoodCategoryId').value,
      });
    }
    const body = {
      householdId: S.householdId,
      name,
      ingredientId: ingredient.id,
      category: $('#fFoodCat').value,
      trackingMode,
      hasStock: trackingMode === 'presence'
        ? Boolean(currentItem && (currentItem.hasStock || Number(currentItem.quantity) > 0))
        : false,
      quantity: trackingMode === 'presence' ? 0 : quantity,
      minQuantity: trackingMode === 'presence' ? 0 : Number($('#fFoodMin').value) || 0,
      unit: trackingMode === 'presence' ? '' : ($('#fFoodUnit').value.trim() || '份'),
      expireAt: $('#fFoodExp').value || '',
      note: $('#fFoodNote').value.trim(),
    };
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
  async 'toggle-presence'(el) {
    const p = householdPantry().find((row) => row.id === el.dataset.id);
    if (!p) return;
    await api('PUT', `/api/pantry/${p.id}`, { ...p, trackingMode: 'presence', hasStock: el.dataset.has !== '1' });
    await loadState(true);
    render();
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

  /* ---- 通用多选 ---- */

  'pick-on'(el) {
    pickOn(el.dataset.k);
  },
  'pick-cancel'() {
    pickOff();
  },
  'pick-item'(el) {
    pickToggle(el.dataset.k, el.dataset.id);
  },
  /** 全选/全不选只针对「当前看得到的那批」，不是整个区域 */
  'pick-all'(el) {
    pickSetAll(el.dataset.k, pickVisibleIds(el.dataset.k));
  },

  /* ---- 库存批量 ---- */

  async 'pick-delete'(el) {
    const key = (el && el.dataset.k) || 'pantry';
    const ids = pickIds(key);
    if (!ids.length) return toast('还没勾选任何一样');
    if (key === 'pantry') {
      const names = pantryNames(ids);
      const preview = pickPreview(names, '样');
      if (
        !confirm(
          `删掉「${currentHousehold() ? currentHousehold().name : ''}」库存里的 ${preview}？删了就找不回来了。`
        )
      )
        return;
      const r = await api('DELETE', `/api/pantry?ids=${ids.map(encodeURIComponent).join(',')}`);
      S.sel.pantry = new Set();
      await loadState(true);
      // 先刷新再判断：原来在刷新前比数量，筛选状态下会误判「全删光了」
      if (!householdPantry().length) S.pick = '';
      render();
      toast(r.removed ? `已删掉 ${r.removed} 样` : '没删掉任何东西');
      return;
    }
    if (key === 'orders') {
      const names = householdOrders().filter((o) => ids.includes(o.id)).map((o) => o.dishName);
      const preview = pickPreview(names, '条');
      if (!confirm(`删掉这 ${preview} 点餐？删了就找不回来了。`)) return;
      const r = await api('DELETE', `/api/orders?ids=${ids.map(encodeURIComponent).join(',')}`);
      S.sel.orders = new Set();
      await loadState(true);
      render();
      toast(r.removed ? `已删掉 ${r.removed} 条点餐` : '没删掉任何东西');
      return;
    }
    if (key === 'plan') {
      const names = planItems(planWeek()).filter((it) => ids.includes(it.id)).map((it) => it.name);
      const preview = pickPreview(names, '道');
      if (!confirm(`把 ${preview} 从本周计划里拿掉？`)) return;
      const r = await api('DELETE', `/api/plans/items?ids=${ids.map(encodeURIComponent).join(',')}`);
      S.sel.plan = new Set();
      await loadState(true);
      if (!planItems(planWeek()).length) S.pick = '';
      render();
      toast(r.removed ? `已拿掉 ${r.removed} 道` : '没拿掉任何东西');
      return;
    }
    if (key === 'dishes') {
      // 只批量处理真正有权动的那些：共享菜混在里面就跳过，
      // 而不是让服务端逐条报错（家人删个菜结果弹三次「公共菜谱改不了」太烦）
      const targets = ids
        .map((x) => dishById(x))
        .filter((d) => d && canEdit(d));
      const skipped = ids.length - targets.length;
      if (!targets.length) return toast(denyWhy(ids.map((x) => dishById(x)).find(Boolean)));
      const preview = pickPreview(targets.map((d) => d.name), '道');
      if (!confirm(`删掉 ${preview}？相关的点餐和计划里的这道菜也会一起去掉。`)) return;
      // 分两拨：走裸接口的是共享的 + 我家我能当管理员的；剩下的是普通成员自己的私菜。
      // 服务端的两端守卫一样，分开走只是为了少传一堆用不上的 householdId。
      const plain = targets.filter((d) => !d.householdId || isHouseAdmin(d.householdId));
      const mineOnly = targets.filter((d) => d.householdId && !isHouseAdmin(d.householdId));
      if (plain.length) {
        for (const d of plain) await api('DELETE', `/api/dishes/${encodeURIComponent(d.id)}`);
      }
      if (mineOnly.length) {
        await api(
          'DELETE',
          `/api/my-dishes?householdId=${encodeURIComponent(S.householdId)}&ids=${mineOnly
            .map((d) => encodeURIComponent(d.id))
            .join(',')}`
        );
      }
      S.sel.dishes = new Set();
      await loadState(true);
      if (!scopeDishes().length) S.pick = '';
      render();
      toast(
        `已删掉 ${targets.length} 道菜` + (skipped ? `，${skipped} 道不是你能改的，原样留着` : '')
      );
      return;
    }
    if (key === 'notes') {
      const names = boardNotes()
        .filter((n) => ids.includes(n.id))
        .map((n) => n.text);
      const preview = pickPreview(names, '条');
      if (!confirm(`删掉 ${preview} 留言？下面的回复也一起没了，删了就找不回来。`)) return;
      const r = await api('DELETE', `/api/notes?ids=${ids.map(encodeURIComponent).join(',')}`);
      S.sel.notes = new Set();
      await loadState(true);
      if (!boardNotes().length) S.pick = '';
      render();
      toast(r.removed ? `已删掉 ${r.removed} 条留言` : '没删掉任何东西');
    }
  },

  /* ---- 留言板 / 菜品互动 ---- */

  /**
   * 留言栏里换身份。
   *
   * 这台设备已经认过人了 → 直接切，不打扰。
   * 没认过 → 走一次完整认证：不能因为「在留言栏点了一下」就变成那个人。
   */
  'note-me'(el) {
    const id = el.dataset.id;
    const m = memberById(id);
    if (!m) return;
    if (meMemberId() === id && deviceToken(S.householdId)) {
      S.whoamiFrom = 'note';
      render();
      return;
    }
    S.whoamiPick = id;
    S.whoamiFrom = 'note';
    S.whoamiStep = 'pin';
    renderWhoami();
  },

  'note-sticker'(el) {
    const s = el.dataset.s || '';
    S.noteSticker = S.noteSticker === s ? '' : s;
    render();
  },

  /** 发一条留言（留言板页） */
  async 'note-send'() {
    const box = $('#noteText');
    const text = ((box && box.value) || '').trim();
    if (!text) return toast('写点什么再发吧');
    await api('POST', '/api/notes', {
      householdId: S.householdId,
      kind: 'board',
      author: meName(),
      text,
      sticker: S.noteSticker || '',
    });
    S.noteSticker = '';
    await loadState(true);
    render();
    const back = $('#noteText');
    if (back) back.value = '';
    toast('已发出去');
  },

  /** 右下角那个「💬 写一条」：滚回上面的输入框 */
  'note-focus'() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const box = $('#noteText');
    if (box) box.focus();
  },

  /** 点已有的表情：再点一次取消 */
  async 'note-react'(el) {
    const id = el.dataset.id;
    if (!noteById(id)) return;
    await api('POST', `/api/notes/${encodeURIComponent(id)}/react`, { emoji: el.dataset.emoji, who: meName() });
    closeSheet(); // 从「＋」弹层里挑完就把弹层收掉，回到留言本身
    await loadState(true);
    render();
  },

  /** 「＋」挑一个还没用过的表情 */
  'note-react-pick'(el) {
    const id = el.dataset.id;
    const n = noteById(id);
    if (!n) return;
    const used = n.reactions || {};
    openSheet({
      title: '回一个表情',
      body: `<div class="chip-row">
          ${REACT_EMOJI.map(
            (e) =>
              `<button class="chip ${(used[e] || []).includes(meName()) ? 'on' : ''}"
                data-act="note-react" data-id="${esc(id)}" data-emoji="${esc(e)}">${esc(e)}</button>`
          ).join('')}
        </div>`,
      foot: `<button class="btn ghost" data-act="close-sheet">关闭</button>`,
    });
  },

  /** 「我来」认领 / 取消认领 */
  async 'note-claim'(el) {
    const id = el.dataset.id;
    const n = noteById(id);
    if (!n) return;
    const me = meName();
    if (n.claim && n.claim.by !== me) return toast(`${n.claim.by} 已经认领了这条`);
    await api('POST', `/api/notes/${encodeURIComponent(id)}/claim`, { by: me });
    await loadState(true);
    render();
    toast(n.claim ? '取消认领了' : `${me} 认领了`);
  },

  async 'note-del'(el) {
    const n = noteById(el.dataset.id);
    if (!n) return;
    const preview = pickPreview([n.text], '条');
    const extra = (n.replies || []).length ? `下面的 ${n.replies.length} 条回复也会一起没了。` : '';
    if (!confirm(`删掉「${preview}」？${extra}删了就找不回来。`)) return;
    await api('DELETE', `/api/notes/${encodeURIComponent(n.id)}`);
    await loadState(true);
    render();
    toast('已删掉');
  },

  'note-reply-open'(el) {
    S.noteReplyTo = S.noteReplyTo === el.dataset.id ? '' : el.dataset.id;
    render();
    const box = document.querySelector(`[data-note-reply="${CSS.escape(S.noteReplyTo || '')}"]`);
    if (box) box.focus();
  },

  'note-reply-cancel'() {
    S.noteReplyTo = '';
    render();
  },

  async 'note-reply-send'(el) {
    const id = el.dataset.id;
    const box = document.querySelector(`[data-note-reply="${CSS.escape(id)}"]`);
    const text = ((box && box.value) || '').trim();
    if (!text) return toast('回复不能是空的');
    await api('POST', `/api/notes/${encodeURIComponent(id)}/replies`, { author: meName(), text });
    S.noteReplyTo = '';
    await loadState(true);
    render();
  },

  async 'note-reply-del'(el) {
    const id = el.dataset.id;
    const rid = el.dataset.rid;
    if (!confirm('删掉这条回复？')) return;
    await api('DELETE', `/api/notes/${encodeURIComponent(id)}/replies/${encodeURIComponent(rid)}`);
    await loadState(true);
    render();
  },

  /** 菜品互动：想吃 / 我来做 */
  async 'dish-vote'(el) {
    const dishId = el.dataset.id;
    const role = el.dataset.role === 'cook' ? 'cook' : 'want';
    const me = meName();
    const d = dishById(dishId);
    if (!d) return;
    if (role === 'cook') {
      const cook = dishVote(dishId).cook;
      if (cook.length && cook[0] !== me) return toast(`${cook[0]} 已经认领了「${d.name}」`);
    }
    await api('POST', '/api/dish-votes', { dishId, who: me, role });
    await loadState(true);
    render();
  },

  /** 某道菜的留言弹层 */
  'open-dish-notes'(el) {
    const d = dishById(el.dataset.id);
    if (!d) return;
    const draw = () => {
      const list = dishNotes(d.id);
      return `${
        list.length
          ? list.map((n) => noteCard(n, { compact: true })).join('')
          : '<div class="empty" style="padding:24px 16px"><p class="empty-text">这道菜还没人留言</p></div>'
      }
      <div class="dish-note-add">
        <textarea class="textarea" id="dishNoteText" rows="2" maxlength="500"
          placeholder="对这道菜说点什么…「少放辣」「上次太咸了」"></textarea>
        <button class="btn soft block" data-act="dish-note-send" data-id="${esc(d.id)}">留一句</button>
      </div>`;
    };
    openSheet({
      title: `「${d.name}」的留言`,
      body: draw(),
      foot: `<button class="btn ghost" data-act="close-sheet">关闭</button>`,
      onMount: () => {},
    });
  },

  async 'dish-note-send'(el) {
    const box = $('#dishNoteText');
    const text = ((box && box.value) || '').trim();
    if (!text) return toast('写点什么再发吧');
    const dishId = el.dataset.id;
    await api('POST', '/api/notes', {
      householdId: S.householdId,
      kind: 'dish',
      dishId,
      author: meName(),
      text,
    });
    await loadState(true);
    render();
    // 弹层还开着，重画一次列表（卡片上的留言数也要跟着变）
    ACTIONS['open-dish-notes']({ dataset: { id: dishId } });
    toast('已留言');
  },

  /** 批量改保质期：同一批买的，一次改完 */
  'batch-expire'() {
    const ids = pickIds('pantry');
    if (!ids.length) return toast('先勾几样');
    openSheet({
      title: `给 ${ids.length} 样改保质期`,
      body: `<div class="field">
          <label class="field-label">快捷<span class="field-hint">相对今天算</span></label>
          <div class="chip-row">
            ${[
              ['+3 天', 3],
              ['+1 周', 7],
              ['+2 周', 14],
              ['+1 个月', 30],
              ['+3 个月', 90],
            ]
              .map(
                ([l, n]) =>
                  `<button class="chip" data-act="set-ids-expire" data-days="${n}" data-k="pantry">${l}</button>`
              )
              .join('')}
          </div>
        </div>
        <div class="field">
          <label class="field-label">或者指定日期</label>
          <input class="input" type="date" id="batchExpireDate" />
          <button class="btn soft block" style="margin-top:8px" data-act="set-ids-expire" data-k="pantry">用它</button>
        </div>
        <div class="field">
          <button class="btn ghost block" data-act="set-ids-expire" data-k="pantry" data-clear="1">清空保质期</button>
        </div>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button>`,
    });
  },

  /** 批量改分类 */
  'batch-cat'() {
    const key = S.pick === 'dishes' ? 'dishes' : 'pantry';
    const ids = pickIds(key);
    if (!ids.length) return toast('先勾几样');
    const cats = key === 'dishes' ? sortedCategories().map((c) => c.name) : pantryCategories();
    openSheet({
      title: `给 ${ids.length} ${PICK_UNIT[key]}改分类`,
      body: `<div class="chip-row">
          ${cats
            .map(
              (c) =>
                `<button class="chip" data-act="set-ids-cat" data-k="${esc(key)}" data-cat="${esc(c)}">${esc(catEmoji(c) + ' ' + c)}</button>`
            )
            .join('')}
        </div>
        <div class="field" style="margin-top:14px">
          <label class="field-label">新开一个分类</label>
          <div style="display:flex;gap:8px">
            <input class="input" id="batchNewCat" placeholder="分类名" />
            <button class="btn" data-act="set-ids-cat" data-k="${esc(key)}" data-new="1">用这个</button>
          </div>
        </div>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button>`,
    });
  },

  async 'set-ids-expire'(el) {
    const ids = pickIds('pantry');
    if (!ids.length) return toast('先勾几样');
    let date = '';
    if (el.dataset.clear) date = '';
    else if (el.dataset.days) date = addDays(todayStr(), Number(el.dataset.days));
    else date = ($('#batchExpireDate') || {}).value || '';
    for (const id of ids) {
      const p = householdPantry().find((x) => x.id === id);
      if (p) await api('PUT', `/api/pantry/${encodeURIComponent(id)}`, { ...p, expireAt: date });
    }
    closeSheet();
    await loadState(true);
    render();
    toast(`${ids.length} 样的保质期改成 ${date || '（清空）'}`);
  },

  async 'set-ids-cat'(el) {
    const key = el.dataset.k;
    const ids = pickIds(key);
    if (!ids.length) return toast('先勾几样');
    let cat = el.dataset.cat || '';
    let toPrivate = false;
    // 公共菜谱不参与批量改：它不属于「自己家的菜」，混进来只会一半成功一半失败
    const dishTargets = key === 'dishes' ? ids.map((id) => dishById(id)).filter((d) => d && canEdit(d)) : null;
    if (dishTargets && !dishTargets.length) return toast('选中的都是公共菜谱，管理员才能改');
    try {
      if (el.dataset.new) {
        cat = (($('#batchNewCat') || {}).value || '').trim();
        if (!cat) return toast('写上分类名');
        // 新开的分类一律共享 —— 批量整理分类不该顺手把一批共享菜改成私有的
        if (key === 'pantry' && !pantryCategories().includes(cat)) {
          await api('POST', '/api/categories', { name: cat });
        }
        if (key === 'dishes' && !sortedCategories().some((c) => c.name === cat)) {
          // 家里人开的新分类只能是自己的私有分类
          if (canWriteShared()) await api('POST', '/api/categories', { name: cat });
          else await api('POST', `/api/my-categories?householdId=${encodeURIComponent(S.householdId)}`, { name: cat });
        }
        await loadState(true);
      }
      // 挪进私有分类的菜如果还是共享的，就跟着变成私菜 ——
      // 否则会撞上「共享菜 + 别人家私有分类」这个存了谁都看不到的组合
      const target = sortedCategories().find((c) => c.name === cat);
      toPrivate = !!(target && isPrivate(target));
      if (key === 'pantry') {
        for (const id of ids) {
          const p = householdPantry().find((x) => x.id === id);
          if (p) await api('PUT', `/api/pantry/${encodeURIComponent(id)}`, { ...p, category: cat });
        }
      } else {
        for (const d of dishTargets) {
          const body = { ...d, category: cat };
          if (toPrivate && !isPrivate(d)) body.householdId = target.householdId;
          await saveDishBody(d, body);
        }
      }
    } catch (err) {
      return toast('改不进去：' + err.message);
    }
    closeSheet();
    await loadState(true);
    render();
    const n = dishTargets ? dishTargets.length : ids.length;
    toast(
      `${n} ${PICK_UNIT[key]}归到「${cat}」了` +
        (toPrivate ? '，共享的那几道也跟着改成仅本家可见' : '') +
        (dishTargets && dishTargets.length < ids.length ? `，${ids.length - dishTargets.length} 道公共菜谱没动` : '')
    );
  },

  /** 批量加/去标签、标拿手菜 */
  'batch-tags'() {
    const ids = pickIds('dishes');
    if (!ids.length) return toast('先勾几道菜');
    const tags = [...new Set(scopeDishes().flatMap((d) => d.tags || []))];
    openSheet({
      title: `给 ${ids.length} 道菜加标签`,
      body: `<div class="field">
          <label class="field-label">加上<span class="field-hint">原来没有的才加</span></label>
          <div style="display:flex;gap:8px">
            <input class="input" id="batchTagIn" placeholder="下饭、快手、宴客…" />
            <button class="btn" data-act="set-ids-tags" data-mode="add">加上</button>
          </div>
        </div>
        <div class="field">
          <label class="field-label">去掉</label>
          <div class="chip-row">
            ${
              tags.length
                ? tags
                    .map(
                      (t) =>
                        `<button class="chip" data-act="set-ids-tags" data-mode="del" data-tag="${esc(t)}">✕ ${esc(t)}</button>`
                    )
                    .join('')
                : '<span class="field-hint">这些菜现在还没有任何标签</span>'
            }
          </div>
        </div>
        <div class="field">
          <label class="field-label">拿手菜星标</label>
          <div style="display:flex;gap:8px">
            <button class="btn soft" style="flex:1" data-act="set-ids-fav" data-v="1">⭐ 全标上</button>
            <button class="btn ghost" style="flex:1" data-act="set-ids-fav" data-v="0">全部取消</button>
          </div>
        </div>`,
      foot: `<button class="btn ghost" data-act="close-sheet">取消</button>`,
    });
  },

  async 'set-ids-tags'(el) {
    const ids = pickIds('dishes');
    if (!ids.length) return toast('先勾几道菜');
    const mode = el.dataset.mode;
    const tag = el.dataset.tag || (($('#batchTagIn') || {}).value || '').trim();
    if (!tag) return toast('写上标签');
    const targets = ids.map((id) => dishById(id)).filter((d) => d && canEdit(d));
    if (!targets.length) return toast('选中的都是公共菜谱，改不了');
    for (const d of targets) {
      const list = (d.tags || []).slice();
      const i = list.indexOf(tag);
      if (mode === 'add' && i < 0) list.push(tag);
      if (mode === 'del' && i >= 0) list.splice(i, 1);
      await saveDishBody(d, { tags: list.slice(0, 8) });
    }
    await loadState(true);
    render();
    // 加完把弹层重开一遍，不然「去掉」那栏还是加之前的标签，想反悔都找不到
    if (mode === 'del') closeSheet();
    else ACTIONS['batch-tags']();
    toast(
      `${targets.length} 道菜${mode === 'add' ? '加上了' : '去掉了'}「${tag}」` +
        (targets.length < ids.length ? `，${ids.length - targets.length} 道公共菜谱没动` : '')
    );
  },

  async 'set-ids-fav'(el) {
    const ids = pickIds('dishes');
    if (!ids.length) return toast('先勾几道菜');
    const on = el.dataset.v === '1';
    const targets = ids.map((id) => dishById(id)).filter((d) => d && canEdit(d));
    if (!targets.length) return toast('选中的都是公共菜谱，改不了');
    for (const d of targets) await saveDishBody(d, { isFavorite: on });
    closeSheet();
    await loadState(true);
    render();
    toast(on ? `${ids.length} 道菜标成拿手菜了` : `${ids.length} 道菜的星标取消了`);
  },

  /* ---- 点餐批量 ---- */

  async 'batch-status'(el) {
    if (!anyHouseAdmin()) return toast('只有管理员能更新做饭状态');
    const ids = pickIds('orders');
    if (!ids.length) return toast('先勾几条');
    const status = el.dataset.status;
    if (status !== 'cooking' && status !== 'done') return toast('不认识的状态');
    const r = await api('PATCH', '/api/orders', { status, ids });
    S.sel.orders = new Set();
    await loadState(true);
    render();
    const names = { cooking: '开始做', done: '完成' }[status] || status;
    toast(r.changed ? `已${names} ${r.changed} 条` : '没改成');
  },

  /* ---- 点餐一键开做 ---- */

  async 'start-all'() {
    if (!anyHouseAdmin()) return toast('只有管理员能更新做饭状态');
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
  'confirm-stock-input'() {
    const quantity = Number(String($('#stockQty')?.value || '').trim());
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast('购买数量必须大于 0');
      $('#stockQty')?.focus();
      return;
    }
    const rawUnit = String($('#stockUnit')?.value || '').trim();
    const unit = normalizeAmountUnit(rawUnit) || rawUnit;
    if (!unit) {
      toast('请填写单位');
      $('#stockUnit')?.focus();
      return;
    }
    resolveStockInput({ quantity, unit });
  },
  'cancel-stock-input'() {
    closeSheet();
  },
  async 'stock-it'(el) {
    const name = el.dataset.name;
    const parts = (el.dataset.parts || '').split('|').filter(Boolean);
    const item = (S.shopList || []).find((x) => x.name === name);
    if (!await stockOne(name, parts, { item })) return;
    await loadState(true);
    render();
  },

  /* ---- 买菜清单批量 ---- */

  async 'shop-all'(el) {
    const on = el.dataset.on === '1';
    const scope = el.dataset.scope || 'default';
    const selected = activeShopChecks();
    shopItemsForScope(scope).forEach((it) =>
      on ? selected.add(it.name) : selected.delete(it.name)
    );
    if (S.shopContext?.kind !== 'plan') await saveShoppingChecked();
    render();
  },
  async 'shop-uncheck'(el) {
    const scope = el.dataset.scope || 'default';
    const selected = activeShopChecks();
    shopCheckedItems(scope).forEach((it) => selected.delete(it.name));
    if (S.shopContext?.kind !== 'plan') await saveShoppingChecked();
    render();
  },
  /** 勾上的几样一起入库，入完把勾选清掉 —— 免得明天还带着今天的勾 */
  async 'shop-stock'(el) {
    const scope = el.dataset.scope || 'default';
    const items = shopCheckedItems(scope).filter((it) => stockAssessment(it).key !== 'enough');
    if (!items.length) return toast('勾上的这几样家里都有了，不用入库');
    const preview = pickPreview(items.map((i) => i.name), '样');
    if (!confirm(`把 ${preview} 记进「${currentHousehold() ? currentHousehold().name : ''}」的库存？`))
      return;
    const stocked = [];
    for (const it of items) {
      if (await stockOne(it.name, it.parts, { item: it })) stocked.push(it);
    }
    stocked.forEach((it) => activeShopChecks().delete(it.name));
    if (S.shopContext?.kind !== 'plan') await saveShoppingChecked();
    await loadState(true);
    render();
    toast(stocked.length ? `${stocked.length} 样已入库` : '没有入库任何东西');
  },
  'toggle-shopping-group'(el) {
    const cat = el.dataset.cat || '其他';
    const scope = el.dataset.scope || 'default';
    const key = `${scope}::${cat}`;
    S.shoppingGroups[key] = !shoppingGroupOpen(cat, scope);
    saveAccountContext();
    render();
  },
  async 'select-shopping-group'(el) {
    const cat = el.dataset.cat || '其他';
    const scope = el.dataset.scope || 'default';
    const on = el.dataset.on === '1';
    const selected = activeShopChecks();
    const items = shopItemsForScope(scope).filter((it) => ingredientCategory(it.name, it.stock) === cat);
    items.forEach((it) => on ? selected.add(it.name) : selected.delete(it.name));
    if (S.shopContext?.kind !== 'plan') await saveShoppingChecked();
    render();
  },
  async 'stock-shopping-group'(el) {
    const cat = el.dataset.cat || '其他';
    const scope = el.dataset.scope || 'default';
    const items = shopItemsForScope(scope).filter(
      (it) => ingredientCategory(it.name, it.stock) === cat && stockAssessment(it).key !== 'enough'
    );
    if (!items.length) return toast('本组没有需要入库的东西');
    const preview = pickPreview(items.map((i) => i.name), '样');
    if (!confirm(`把 ${preview} 记进「${currentHousehold() ? currentHousehold().name : ''}」的库存？`)) return;
    const stocked = [];
    for (const it of items) {
      if (await stockOne(it.name, it.parts, { item: it })) stocked.push(it);
    }
    stocked.forEach((it) => activeShopChecks().delete(it.name));
    if (S.shopContext?.kind !== 'plan') await saveShoppingChecked();
    await loadState(true);
    render();
    toast(stocked.length ? `${stocked.length} 样已入库` : '没有入库任何东西');
  },
  async 'shop-copy'(el) {
    const items = shopCheckedItems(el.dataset.scope || 'default');
    if (!items.length) return toast('还没勾任何一样');
    await copyText(items.map((i) => `□ ${i.name}（${i.parts.join(' + ')}）`).join('\n'));
  },

  /* 设置 */
  'edit-settings'() {
    // 店名、口令、AI 配置这些是管理员的活
    if (!isSuper()) return toast('服务设置要超级管理员口令');
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

  /* 数据 */

  /**
   * 把服务端返回的附件存到本地。
   * window.open / <a download> 带不了 X-Auth-Token，只能 fetch 下来再存。
   */
  async saveAttachment(url, fallbackName) {
    const t = authToken();
    const headers = {};
    if (t) headers['X-Auth-Token'] = t;
    const at = accountToken();
    if (at) headers['X-Account-Token'] = at;
    const res = await fetch(url, Object.keys(headers).length ? { headers } : undefined);
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
    body: `<input class="input" id="pinInput" type="password" placeholder="输入管理口令" />`,
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
    if (S.account) S.account.superExpiresAt = r.expiresAt || r.fixedExp || r.expires || (Date.now() + 12 * 60 * 60 * 1000);
    closeSheet();
    await loadState(true);
    render();
    toast('已解锁');
  } catch (err) {
    toast(err.message || '口令不对');
    el.value = '';
    el.focus();
  }
};

/* 危险动作的密码弹层：问家庭口令还是问成员密码，由 askSensitiveAuth 决定。
   注册放在这里 —— ACTIONS 是 const，声明之前写 ACTIONS[...] 会踩 TDZ。 */
ACTIONS['danger-pin-ok'] = async function () {
  const el = $('#dangerPin');
  const err = $('#dangerErr');
  const onOk = pendingPinOnOk;
  const fail = (t) => {
    if (err) {
      err.hidden = false;
      err.textContent = t;
    }
    if (el) {
      el.value = '';
      el.focus();
    }
  };
  const pin = (el ? el.value : '').trim();
  if (!pin) return fail('先输一下密码。');
  try {
    await onOk(pin);
  } catch (e) {
    // 输错了就把弹层留着继续试 —— 直接关掉等于让用户重新走一遍成员列表
    return fail(e.message || '密码不对');
  }
  const done = typeof pendingPinCheck === 'function' ? pendingPinCheck : null;
  clearPinCheck();
  closeSheet();
  if (done) done(true);
};

/* 事件绑定 */
document.addEventListener('submit', (e) => {
  const form = e.target.closest && e.target.closest('[data-account-form]');
  if (!form) return;
  e.preventDefault();
  accountSubmit(form);
});

document.addEventListener('click', (e) => {
  // 菜品卡片整块是「打开做法」，互动条是压在上面的。
  // 点互动条里的按钮照常走按钮自己的动作，但点到条上的空白处不能顺手把菜谱也打开。
  if (e.target.closest('[data-stop]') && !e.target.closest('.ib')) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el)).catch((err) => toast('出错了：' + err.message));
});

/* 身份向导密码框里回车 = 提交。密码是要手打的东西，让用户输完还得挪到鼠标上点按钮很别扭。 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.id !== 'whoPassword') return;
  e.preventDefault();
  Promise.resolve(ACTIONS['who-password']({ dataset: { id: S.whoamiPick } })).catch((err) =>
    toast('出错了：' + err.message)
  );
});

/* 编辑器里的输入同步 */
document.addEventListener('input', (e) => {
  if (e.target.id === 'fFoodName') {
    const ingredient = ingredientByName(e.target.value);
    const id = $('#fFoodIngredientId');
    if (id) id.value = ingredient ? ingredient.id : '';
    if (ingredient) {
      const category = $('#fFoodCategoryId');
      const label = $('#fFoodCat');
      if (category) category.value = ingredient.categoryId;
      if (label) label.value = pantryCategoryPath(ingredient.categoryId);
      syncFoodCategoryPicker(label && label.value, ingredient.categoryId);
      const tracking = $('#fFoodTracking');
      if (tracking && !tracking.dataset.manual) {
        tracking.value = ingredient.defaultTrackingMode;
        $('#fFoodQuantityFields').hidden = tracking.value === 'presence';
      }
    }
  }
  const el = e.target;
  const act = el.dataset && el.dataset.act;
  if (el.dataset && el.dataset.batchAct === 'batch-import-name') {
    const d = S.batchImport[Number(el.dataset.i)];
    if (d) d.name = el.value;
    return;
  }
  if (!act || !S.draft) return;
  const i = Number(el.dataset.i);
  const j = Number(el.dataset.j);
  const m = S.draft.dish.methods[i];
  if (act === 'season-name') {
    const row = S.draft.dish.seasonings[i];
    if (row) { row.name = el.value; row.ingredientId = (ingredientByName(el.value) || {}).id || ''; }
  }
  else if (act === 'season-amt') S.draft.dish.seasonings[i].amount = el.value;
  else if (act === 'method-name' && m) m.name = el.value;
  else if (act === 'method-steps' && m) m.steps = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
  else if (act === 'mseason-name' && m && m.seasonings[j]) {
    m.seasonings[j].name = el.value;
    m.seasonings[j].ingredientId = (ingredientByName(el.value) || {}).id || '';
  }
  else if (act === 'mseason-amt' && m && m.seasonings[j]) m.seasonings[j].amount = el.value;
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'fFoodTracking') e.target.dataset.manual = '1';
  const el = e.target;
  const act = el.dataset && el.dataset.act;
  if (!act || !S.draft) return;
  const i = Number(el.dataset.i);
  const j = Number(el.dataset.j);
  const m = S.draft.dish.methods[i];
  if (act === 'season-type' && S.draft.dish.seasonings[i]) S.draft.dish.seasonings[i].purchaseType = el.value;
  else if (act === 'mseason-type' && m && m.seasonings[j]) m.seasonings[j].purchaseType = el.value;
});

/* 搜索输入 */
document.addEventListener('input', (e) => {
  if (e.target.id === 'searchInput') {
    S.keyword = e.target.value.trim();
    render();
  }
  if (e.target.id === 'manageKeyword') {
    S.manageKeyword = e.target.value.trim();
    const keyword = manageSearchText(S.manageKeyword);
    document.querySelectorAll('.manage-group').forEach((group) => {
      const hay = manageSearchText(group.dataset.manageSearch || group.textContent);
      const match = !keyword || hay.includes(keyword);
      group.hidden = !match;
      if (match && keyword) group.open = true;
    });
    const clear = document.querySelector('.manage-search .icon-mini');
    if (clear) clear.hidden = !S.manageKeyword;
  }
  if (e.target.id === 'fPresetSearch') renderPresetGrid();
});

document.addEventListener('toggle', (e) => {
  const group = e.target;
  if (!group || !group.matches || !group.matches('.manage-group')) return;
  const key = group.dataset.manageGroup;
  if (key) S.manageGroups[key] = group.open;
}, true);

/* 改分类时，常见食材快选跟着换 */
document.addEventListener('change', (e) => {
  if (e.target.id === 'fFoodTracking') {
    e.target.dataset.manual = '1';
    const presence = e.target.value === 'presence';
    const fields = $('#fFoodQuantityFields');
    if (fields) fields.hidden = presence;
  }
  if (e.target.id === 'fFoodName' && !$('#fFoodTracking')?.dataset.manual) {
    const presence = window.PantryLogic.inferTrackingMode({ name: e.target.value }) === 'presence';
    $('#fFoodTracking').value = presence ? 'presence' : 'quantity';
    $('#fFoodQuantityFields').hidden = presence;
  }
  if (e.target.id === 'fFoodCat') renderPresetGrid();
  if (e.target.dataset && e.target.dataset.batchAct === 'batch-import-toggle') {
    const d = S.batchImport[Number(e.target.dataset.i)];
    if (d) d._selected = !!e.target.checked;
  }
  if (e.target.dataset && e.target.dataset.batchAct === 'batch-export-toggle') {
    if (e.target.checked) S.batchExportSel.add(e.target.dataset.id);
    else S.batchExportSel.delete(e.target.dataset.id);
    const count = $('#batchExportCount');
    if (count) count.textContent = S.batchExportSel.size;
  }
  if (e.target.dataset && e.target.dataset.batchAct === 'batch-import-category') {
    const d = S.batchImport[Number(e.target.dataset.i)];
    if (d) d.category = e.target.value;
  }
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
async function bootstrapAccount() {
  S.accountToken = localStorage.getItem(LS_ACCOUNT) || '';
  S.householdId = '';
  S.view = 'home';
  if (!S.accountToken) {
    S.loading = false;
    render();
    return;
  }
  try {
    const me = await api('GET', '/api/account/me');
    S.account = me && (me.account || me.user ? { ...me, user: me.user || me.account?.user } : me);
    const context = loadAccountContext();
    S.householdId = typeof context.householdId === 'string' ? context.householdId : '';
    S.view = typeof context.view === 'string' ? context.view : 'home';
    S.dishScope = context.dishScope || 'all';
    S.category = context.category || '全部';
    S.keyword = context.keyword || '';
    S.planWeek = context.planWeek || '';
    S.pantryFilter = context.pantryFilter || 'all';
    S.pantryCat = context.pantryCat || '全部';
    S.shoppingGroups = context.shoppingGroups && typeof context.shoppingGroups === 'object' ? { ...context.shoppingGroups } : {};
    S.pantryGroups = context.pantryGroups && typeof context.pantryGroups === 'object' ? { ...context.pantryGroups } : {};
    S.manageKeyword = context.manageKeyword || '';
    if (context.manageGroups && typeof context.manageGroups === 'object') S.manageGroups = { ...S.manageGroups, ...context.manageGroups };
    await loadState(true);
    if (['plan', 'order'].includes(S.view) && !S.presets) await ensurePresets();
    await Promise.allSettled([loadAIStatus(), loadVersion(), loadBackups()]);
    render();
  } catch (_) {
    setAccountToken('');
    S.account = null;
    S.householdId = '';
    saveSelectedHousehold('');
    S.loading = false;
    render();
  }
}
window.addEventListener('beforeunload', saveAccountContext);
bootstrapAccount();
setInterval(() => {
  if (!hasAccount() || !S.account || !superExpiry()) return;
  if (superExpiry() <= Date.now()) {
    S.authed = false;
    setAuthToken('');
    if (S.view === 'settings') render();
  } else if (S.view === 'settings') {
    // 设置页的剩余时间按分钟更新，不刷新业务数据。
    const status = document.querySelector('.super-status');
    if (status) status.textContent = `🛡️ 超级管理员已授权 · 还剩 ${superRemainingText()}`;
  }
}, 60000);
