'use strict';

/**
 * 自检脚本：在临时目录里跑一份独立的服务实例，不碰 data/ 里的真实数据。
 *   node _selftest.js
 * 跑完自动清理临时目录。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http'); // [14] 起假 AI 服务器用
const { spawn } = require('child_process');

const ROOT = __dirname;
const TMP = path.join(os.tmpdir(), 'family-menu-selftest-' + Date.now());
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` —— ${JSON.stringify(extra)}` : ''));
    console.log(`  [!!] ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`);
  }
}

const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

let DEFAULT_ACCOUNT_TOKEN = '';

async function req(method, p, body, token, dev, house, ver, account) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  if (token) opt.headers['X-Auth-Token'] = token;
  if (dev) opt.headers['X-Device-Token'] = dev;
  if (house) opt.headers['X-House-Token'] = house;
  if (ver) opt.headers['X-Verified-Token'] = ver;
  // 超级会话绑定账户；旧测试请求带超级 token 时模拟前端同时发送当前账户令牌。
  if (account || (token && DEFAULT_ACCOUNT_TOKEN)) opt.headers['X-Account-Token'] = account || DEFAULT_ACCOUNT_TOKEN;
  const res = await fetch(BASE + p, opt);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const get = (p, t, d, hh, vv, aa) => req('GET', p, undefined, t, d, hh, vv, aa);
const post = (p, b, t, d, hh, vv, aa) =>
  req('POST', p, b === undefined ? {} : b, t, d, hh, vv, aa || (p === '/api/auth' ? DEFAULT_ACCOUNT_TOKEN : ''));
const put = (p, b, t, d, hh, vv, aa) => req('PUT', p, b, t, d, hh, vv, aa);
const del = (p, t, d, hh, vv, aa) => req('DELETE', p, undefined, t, d, hh, vv, aa);

/**
 * 认领一个成员身份，换回设备令牌。
 * 「你是谁」从客户端自报的名字，改成服务端认的 PIN —— 这一步就是身份的地基。
 */
async function claim(householdId, memberId, pin) {
  const r = await post('/api/claim', { householdId, memberId, pin: pin || '1234' });
  return { status: r.status, token: r.body && r.body.data && r.body.data.deviceToken, body: r.body };
}

/** 新身份模型：用用户可见的登录 ID + 一般文本密码认领成员。 */
async function claimByLoginId(householdId, loginId, password) {
  const r = await post('/api/claim', { householdId, loginId, password });
  return { status: r.status, token: r.body && r.body.data && r.body.data.deviceToken, body: r.body };
}

/** 用家庭口令换家庭管理员会话（走 X-House-Token，跟超管那条头分开） */
async function houseAuth(householdId, pin) {
  const r = await post(`/api/households/${householdId}/auth`, { pin });
  return { status: r.status, token: r.body && r.body.data && r.body.data.token, body: r.body };
}

async function registerAccount(loginId) {
  const r = await post('/api/account/register', loginId ? { loginId } : {});
  return { status: r.status, token: r.body?.data?.accountToken, user: r.body?.data?.user, body: r.body };
}

async function loginAccount(loginId, password = '123456') {
  const r = await post('/api/account/login', { loginId, password });
  return { status: r.status, token: r.body?.data?.accountToken, user: r.body?.data?.user, body: r.body };
}

async function authorizeSuper(pin, accountToken) {
  const r = await req('POST', '/api/auth', { pin }, undefined, undefined, undefined, undefined, accountToken);
  return { status: r.status, token: r.body?.data?.token, body: r.body };
}

/**
 * 发原始字节并把响应也按字节拿回来。
 * 备份是 zip 本体，既不能 JSON.stringify 也不能按 text 读（读一次就没了）。
 */
async function reqRaw(method, p, buf, token, dev, house) {
  const opt = { method, headers: {} };
  if (buf !== undefined) {
    opt.headers['Content-Type'] = 'application/octet-stream';
    opt.body = buf;
  }
  if (token) opt.headers['X-Auth-Token'] = token;
  if (token && DEFAULT_ACCOUNT_TOKEN) opt.headers['X-Account-Token'] = DEFAULT_ACCOUNT_TOKEN;
  if (dev) opt.headers['X-Device-Token'] = dev;
  if (house) opt.headers['X-House-Token'] = house;
  const res = await fetch(BASE + p, opt);
  const ab = Buffer.from(await res.arrayBuffer());
  let json = {};
  try {
    json = ab.length ? JSON.parse(ab.toString('utf8')) : {};
  } catch (_) {
    json = {};
  }
  return { status: res.status, body: json, buf: ab, res };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等子进程真正退出，不然目录还占着删不掉 */
async function stop(child) {
  child.kill();
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    try {
      process.kill(child.pid, 0);
    } catch (_) {
      return;
    }
  }
}

async function waitReady(child) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/state');
      if (r.ok) return true;
    } catch (_) {
      /* 还没起来 */
    }
    await sleep(120);
  }
  return false;
}

function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 递归复制目录（fs.cpSync 在这台机器上会崩） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 起一份独立实例；writeData 用来预置旧版数据 */
async function boot(label, writeData) {
  const dir = path.join(TMP, label);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(dir, 'server.js'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  copyDir(path.join(ROOT, 'public'), path.join(dir, 'public'));
  if (writeData) writeData(path.join(dir, 'data'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const up = await waitReady(child);
  if (!up) {
    child.kill();
    throw new Error(`${label} 启动失败`);
  }
  // 每个临时服务实例都建立一枚本地测试账户，模拟新客户端登录；否则绑定
  // 账户的超级授权不能跨测试进程复用第一份实例的令牌。
  if (label !== 'main') {
    const ar = await fetch(BASE + '/api/account/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const aj = await ar.json();
    DEFAULT_ACCOUNT_TOKEN = aj?.data?.accountToken || '';
  }
  return child;
}

/* ================================================================ */

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
  fs.mkdirSync(TMP, { recursive: true });

  let child = await boot('main');

  /* ---------- 全局账户基础 ---------- */
  console.log('\n[0] 全局账户基础');
  const accountA = await registerAccount('绑定管理员');
  eq('账户注册成功', accountA.status, 200);
  ok('注册自动保留文本登录 ID', accountA.user && accountA.user.loginId === '绑定管理员', accountA.user);
  ok('注册响应不回传密码', accountA.user && accountA.user.password === undefined && accountA.user.passwordHash === undefined);
  DEFAULT_ACCOUNT_TOKEN = accountA.token || '';
  ok('拿到账户令牌', DEFAULT_ACCOUNT_TOKEN.length > 20, DEFAULT_ACCOUNT_TOKEN);
  const accountLogin = await loginAccount('绑定管理员');
  eq('默认密码 123456 可以登录', accountLogin.status, 200);
  eq('错误账户密码被拒', (await loginAccount('绑定管理员', '错误密码')).status, 401);
  const accountB = await registerAccount('第二账户');
  eq('第二个账户注册成功', accountB.status, 200);

  /* ---------- 初始状态 ---------- */
  console.log('\n[1] 初始状态');
  let st = (await get('/api/state')).body.data;
  eq('默认 1 个家庭「我家」', st.households.map((h) => h.name), ['我家']);
  ok('默认家庭带 1 位成员', st.households[0].members.length === 1, st.households[0].members);
  eq('库存为空', st.pantry, []);
  eq('计划为空', st.plans, []);
  ok('点餐已带 householdId 字段', 'currentHouseholdId' in st.settings, Object.keys(st.settings));
  eq('菜品是 4 道种子菜', st.dishes.length, 4);
  const DISH = st.dishes[0];

  /* ---------- 食材预设 ---------- */
  console.log('\n[2] 预置食材库');
  const pre = (await get('/api/ingredient-presets')).body.data;
  eq('13 个分类', pre.categories.length, 13);
  ok('预设数量 > 130', pre.presets.length > 130, pre.presets.length);
  const chicken = pre.presets.find((p) => p.name === '鸡蛋');
  eq('鸡蛋 → 蛋类/个/20天', [chicken.category, chicken.unit, chicken.shelfLife], ['蛋类', '个', 20]);
  eq('鸡蛋保质期已换算成日期', chicken.expireAt, dayOffset(20));
  const cats = new Set(pre.presets.map((p) => p.category));
  ok('预设分类都在分类表里', [...cats].every((c) => pre.categories.some((x) => x.name === c)), [...cats]);
  ok('预设名不重复', new Set(pre.presets.map((p) => p.name)).size === pre.presets.length);
  ok('覆盖肉蛋奶菜饮料', ['肉类', '蛋类', '奶制品', '蔬菜', '饮料'].every((c) => cats.has(c)));

  /* ---------- 家庭 CRUD ---------- */
  console.log('\n[3] 家庭');
  const h301 = (await post('/api/households', { name: '301' })).body.data;
  ok('创建家庭 301', h301 && h301.id, h301);
  eq('默认给了 emoji', h301.emoji, '🏡');
  eq('新家庭没有成员', h301.members, []);
  const h502 = (await post('/api/households', { name: '外婆家', emoji: '🚪', note: '5 号楼' })).body.data;
  eq('名字和备注原样保存', [h502.name, h502.note], ['外婆家', '5 号楼']);
  eq('空名被拒', (await post('/api/households', { name: '   ' })).status, 400);
  eq('缺名字被拒', (await post('/api/households', {})).status, 400);

  const renamed = (await put(`/api/households/${h301.id}`, { name: '302 室' })).body.data;
  eq('重命名保留 id', renamed.id, h301.id);
  eq('重命名结果', renamed.name, '302 室');
  eq('重命名不误伤成员', (await put(`/api/households/${h502.id}`, { name: '外婆家' })).status, 200);
  eq('改不存在的家庭返回 404', (await put('/api/households/nope', { name: 'x' })).status, 404);

  /* ---------- 点餐分家 ---------- */
  console.log('\n[4] 点餐按家庭分开');
  const o1 = (await post('/api/orders', { dishId: DISH.id, dishName: DISH.name, requester: '我', people: 2 })).body.data;
  eq('不传 householdId → 落到默认家庭', o1.householdId, st.households[0].id);
  const o2 = (await post('/api/orders', { dishId: DISH.id, dishName: DISH.name, householdId: h301.id })).body.data;
  eq('指定家庭就记到那个家', o2.householdId, h301.id);
  const o3 = (await post('/api/orders', { dishId: DISH.id, dishName: DISH.name, householdId: '幽灵家庭' })).body.data;
  ok('未知 householdId 不会丢数据', !!o3.householdId, o3.householdId);

  st = (await get('/api/state')).body.data;
  eq('三条点餐分散到不同家庭', st.orders.length, 3);
  eq('默认家庭 2 条', st.orders.filter((o) => o.householdId === st.households[0].id).length, 2);
  eq('302 室 1 条', st.orders.filter((o) => o.householdId === h301.id).length, 1);

  // 清空已完成只影响指定家庭
  await req('PATCH', `/api/orders/${o1.id}`, { status: 'done' });
  await req('PATCH', `/api/orders/${o2.id}`, { status: 'done' });
  const cleared = (await del(`/api/orders/done?householdId=${encodeURIComponent(h301.id)}`)).body.data;
  eq('按家庭清空已完成', cleared.removed, 1);
  st = (await get('/api/state')).body.data;
  eq('另一家的已完成还在', st.orders.filter((o) => o.status === 'done').length, 1);

  /* ---------- 本周计划 ---------- */
  console.log('\n[5b] 本周计划');
  const monday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const nextMonday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  // 用周三当 weekOf 传，服务端应该自己归到本周一
  const wednesday = (() => {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

  const add1 = (await post('/api/plans/items', { householdId: h301.id, weekOf: wednesday, dishId: DISH.id })).body.data;
  ok('加菜进计划', add1.item && add1.item.name === DISH.name, add1);
  eq('周三归到本周一', add1.plan.weekOf, monday);
  eq('自动带出份量', add1.item.servings, DISH.servings);
  eq('菜谱 id 也记下来', add1.item.dishId, DISH.id);

  const dupDish = await post('/api/plans/items', { householdId: h301.id, weekOf: wednesday, dishId: DISH.id });
  eq('同一道菜不重复加', dupDish.status, 400);
  ok('重复的提示说得清', /已经在/.test(dupDish.body.error || ''), dupDish.body);

  await post('/api/plans/items', { householdId: h301.id, weekOf: wednesday, name: '楼下那家的烤鸭' });
  await post('/api/plans/items', { householdId: h301.id, weekOf: nextMonday, dishId: DISH.id });
  await post('/api/plans/items', { householdId: st.households[0].id, weekOf: wednesday, dishId: DISH.id });

  let plans = (await get('/api/state')).body.data.plans;
  eq('一共 3 条计划记录（本周/下周 × 两个家庭）', plans.length, 3);
  const planThis = plans.find((p) => p.householdId === h301.id && p.weekOf === monday);
  eq('本周这家有 2 道', planThis.items.length, 2);
  eq('下周这家有 1 道', plans.find((p) => p.householdId === h301.id && p.weekOf === nextMonday).items.length, 1);
  eq('另一家本周也是 1 道（互不影响）',
    plans.find((p) => p.householdId === st.households[0].id && p.weekOf === monday).items.length, 1);

  eq('不存在的 dishId 要兜住', (await post('/api/plans/items', { householdId: h301.id, dishId: 'd_不存在' })).status, 400);
  eq('完全没内容被拒', (await post('/api/plans/items', { householdId: h301.id })).status, 400);
  eq('幽灵家庭拉回默认', (await post('/api/plans/items', { householdId: '幽灵', name: '测试菜' })).body.data.plan.householdId, st.households[0].id);

  const getPlan = (await get(`/api/plans?householdId=${h301.id}&weekOf=${monday}`)).body.data;
  eq('GET 单周计划', getPlan.items.length, 2);
  eq('查没有的一周返回 null', (await get(`/api/plans?householdId=${h301.id}&weekOf=1999-01-04`)).body.data, null);

  // 拿掉一道
  const target = planThis.items[0];
  const rm = (await del(`/api/plans/items/${target.id}`)).body.data;
  eq('拿掉后返回的是被删的那条', rm.id, target.id);
  eq('删不存在的计划项 404', (await del('/api/plans/items/p_不存在')).status, 404);
  eq('删完剩 1 道', (await get(`/api/plans?householdId=${h301.id}&weekOf=${monday}`)).body.data.items.length, 1);

  // 清空某一周
  const clearedPlan = (await del(`/api/plans?householdId=${h301.id}&weekOf=${monday}`)).body.data;
  eq('清空本周', clearedPlan.removed, 1);
  eq('本周空了', (await get(`/api/plans?householdId=${h301.id}&weekOf=${monday}`)).body.data.items.length, 0);
  eq('下周没被清掉', (await get(`/api/plans?householdId=${h301.id}&weekOf=${nextMonday}`)).body.data.items.length, 1);
  // 默认家庭里有 1 道菜谱菜 + 前面「幽灵家庭」用例兜回来的「测试菜」，共 2 道
  eq('另一家也没被清掉',
    (await get(`/api/plans?householdId=${st.households[0].id}&weekOf=${monday}`)).body.data.items.length, 2);

  // 删菜要连带清掉计划里的引用
  await post('/api/plans/items', { householdId: h301.id, weekOf: wednesday, dishId: DISH.id });
  const throwaway = (await post('/api/dishes', { name: '临时测试菜' })).body.data;
  await post('/api/plans/items', { householdId: h301.id, weekOf: wednesday, dishId: throwaway.id });
  await del(`/api/dishes/${throwaway.id}`);
  eq('删菜品时计划里的引用也清掉',
    (await get(`/api/plans?householdId=${h301.id}&weekOf=${monday}`)).body.data.items.filter((i) => i.dishId === throwaway.id).length, 0);

  /* ---------- 库存 ---------- */
  console.log('\n[5] 库存');
  const f1 = (await post('/api/pantry', {
    householdId: h301.id, name: '鸡蛋', category: '蛋类',
    quantity: 10, unit: '个', expireAt: dayOffset(5), note: '冰箱门',
  })).body.data;
  ok('新增库存条目', f1.id, f1);
  eq('字段原样保存', [f1.name, f1.category, f1.quantity, f1.unit, f1.note], ['鸡蛋', '蛋类', 10, '个', '冰箱门']);
  eq('保质期日期', f1.expireAt, dayOffset(5));

  const f2 = (await post('/api/pantry', { householdId: h301.id, name: '牛奶' })).body.data;
  eq('只给名字也能存', [f2.quantity, f2.unit], [1, '份']);
  eq('非法日期当没填', (await post('/api/pantry', { name: 'x', expireAt: '2024/13/45' })).body.data.expireAt, '');
  eq('非法日期 2', (await post('/api/pantry', { name: 'y', expireAt: 'tomorrow' })).body.data.expireAt, '');
  eq('非法分类归到「其他」', (await post('/api/pantry', { name: 'z', category: '外星食物' })).body.data.category, '其他');
  eq('负数数量裁到 0', (await post('/api/pantry', { name: 'w', quantity: -5 })).body.data.quantity, 0);
  eq('小数数量保留', (await post('/api/pantry', { name: 'v', quantity: 1.25 })).body.data.quantity, 1.25);
  eq('超大量封顶', (await post('/api/pantry', { name: 'u', quantity: 1e9 })).body.data.quantity, 99999);
  eq('空名被拒', (await post('/api/pantry', { name: '  ' })).status, 400);
  eq('幽灵家庭改写回默认', (await post('/api/pantry', { name: 'q', householdId: '幽灵' })).body.data.householdId, st.households[0].id);

  const updated = (await put(`/api/pantry/${f1.id}`, { quantity: 8 })).body.data;
  eq('数量改成 8', updated.quantity, 8);
  eq('数量改 8 不丢其它字段', [updated.name, updated.category, updated.expireAt], ['鸡蛋', '蛋类', dayOffset(5)]);

  await put(`/api/pantry/${f1.id}`, { expireAt: dayOffset(-2) });
  await put(`/api/pantry/${f2.id}`, { expireAt: dayOffset(1) });
  const purge = (await del(`/api/pantry?householdId=${encodeURIComponent(h301.id)}&scope=expired`)).body.data;
  eq('只清理过期的', purge.removed, 1);
  st = (await get('/api/state')).body.data;
  eq('临期的留下了', st.pantry.filter((p) => p.id === f2.id).length, 1);

  eq('删不存在的库存返回 404', (await del('/api/pantry/nope')).status, 404);

  /* ---------- 删家庭的级联 ---------- */
  console.log('\n[6] 删家庭');
  const delRes = (await del(`/api/households/${h301.id}`)).body.data;
  eq('级联删掉点餐', delRes.removedOrders, 0);
  // 302 室里被「清理过期」干掉一个，只剩 f2 了
  eq('级联删掉库存', delRes.removedPantry, 1);
  st = (await get('/api/state')).body.data;
  eq('302 室已消失', st.households.some((h) => h.id === h301.id), false);
  eq('它的库存也没了', st.pantry.filter((p) => p.householdId === h301.id).length, 0);
  eq('它的本周计划也没了', st.plans.filter((p) => p.householdId === h301.id).length, 0);
  eq('剩两个家庭', st.households.length, 2);

  await del(`/api/households/${h502.id}`);
  eq('最后一个家庭不让删', (await del(`/api/households/${st.households[0].id}`)).status, 400);
  eq('删完还剩 1 个', (await get('/api/state')).body.data.households.length, 1);

  /* ---------- 导出 / 导入往返 ---------- */
  console.log('\n[7] 导出导入');
  const before = (await get('/api/state')).body.data;
  const backupZip = await reqRaw('GET', '/api/export');
  ok('导出是 zip', backupZip.buf[0] === 0x50 && backupZip.buf[1] === 0x4b);
  ok('备份里含 households', Array.isArray(before.households), typeof before.households);
  ok('备份里含 pantry', Array.isArray(before.pantry), typeof before.pantry);
  ok('备份里含 plans', Array.isArray(before.plans), typeof before.plans);

  const hh = (await post('/api/households', { name: '临时户' })).body.data;
  await post('/api/pantry', { householdId: hh.id, name: '临时菜', category: '蔬菜', quantity: 3, unit: '把' });
  eq('导入前多了一户', (await get('/api/state')).body.data.households.length, 2);

  // zip 原样喂回去：前端走的就是这条路（不用在测试里解 zip）
  eq('zip 导入返回 200', (await reqRaw('POST', '/api/import', backupZip.buf)).status, 200);
  st = (await get('/api/state')).body.data;
  eq('导入后家庭数恢复', st.households.length, before.households.length);
  eq('导入后库存恢复', st.pantry.length, before.pantry.length);
  eq('导入后库存内容一致', st.pantry.map((p) => [p.name, p.quantity]), before.pantry.map((p) => [p.name, p.quantity]));
  eq('导入后计划恢复', st.plans.length, before.plans.length);
  eq('导入后菜谱恢复', st.dishes.length, before.dishes.length);

  // 备份里带了已删除的家庭 id 时，点餐要拉回有效家庭，不能悬空
  const orphan = Object.assign({}, before, {
    orders: [{ id: 'o_orphan', dishName: '测试菜', householdId: 'h_不存在', people: 2, status: 'pending', date: '2024-01-01', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  });
  await reqRaw('POST', '/api/import', Buffer.from(JSON.stringify(orphan), 'utf8'));
  st = (await get('/api/state')).body.data;
  eq('悬空 householdId 被兜住', st.orders[0].householdId, st.households[0].id);

  /* ---------- summary ---------- */
  console.log('\n[8] 汇总接口');
  await post('/api/pantry', { name: '过期奶', category: '奶制品', expireAt: dayOffset(-1) });
  await post('/api/pantry', { name: '临期奶', category: '奶制品', expireAt: dayOffset(2) });
  const sum = (await get('/api/summary')).body.data;
  ok('summary 有家庭数', typeof sum.householdCount === 'number', sum);
  ok('summary 有过期数', sum.expiredCount >= 1, sum);
  ok('summary 有临期数', sum.soonCount >= 1, sum);

  /* ---------- 坏数据 ---------- */
  console.log('\n[9] 健壮性');
  eq('坏 JSON 返回 500 而不是崩', (await req('POST', '/api/pantry', '__RAW__')).status >= 400, true);
  eq('未知接口 404', (await get('/api/nothing')).status, 404);
  eq('路径穿越被拦', (await fetch(BASE + '/uploads/../../server.js')).status, 404);

  /* ---------- 管理口令 ---------- */
  console.log('\n[10] 管理口令');
  // 得放在主实例还活着的时候跑：下面几组会反复停起子实例
  const noPin = await post('/api/dishes', { name: '开放期新增', category: '其他' });
  eq('没设口令时随便改', noPin.status, 200);
  await del(`/api/dishes/${noPin.body.data.id}`);

  // 首次设口令
  const setPin = await put('/api/settings', { adminPin: '2468' });
  eq('可以设置口令', setPin.status, 200);
  ok('设置响应不回显口令明文', !('adminPin' in (setPin.body.data || {})), setPin.body.data);
  eq('设置响应标记已加锁', setPin.body.data.hasPin, true);

  eq('没有账户令牌不能成为超级管理员', (await authorizeSuper('2468')).status, 401);
  const boundSuper = await authorizeSuper('2468', DEFAULT_ACCOUNT_TOKEN);
  eq('账户输入全局令牌成为超级管理员', boundSuper.status, 200);
  ok('超级授权令牌非空', (boundSuper.token || '').length > 20, boundSuper.body);
  const accountBLogin = await loginAccount('第二账户');
  eq('第二账户能登录', accountBLogin.status, 200);
  eq(
    '超级授权不能借给第二个账户',
    (await get('/api/state', boundSuper.token, undefined, undefined, undefined, accountBLogin.token)).status,
    401
  );
  ok(
    '超级授权约 12 小时后过期',
    boundSuper.body?.data?.expiresAt > Date.now() + 11 * 60 * 60 * 1000,
    boundSuper.body
  );

  // state 里也绝不能有明文
  const stLocked = (await get('/api/state')).body.data;
  ok('state 不下发口令明文', !('adminPin' in stLocked.settings), Object.keys(stLocked.settings));
  eq('state 只告诉前端有没有锁', stLocked.settings.hasPin, true);
  ok('整个 state 里搜不到口令值', JSON.stringify(stLocked).indexOf('2468') === -1, '泄漏');

  // 普通家人：先认领身份，再维护当前家庭的私有菜，但不能碰共享菜谱或管理设置。
  const ordinaryHouse = stLocked.households[0].id;
  const ordinaryMe = stLocked.households[0].members[0];
  const ordinaryDev = (await claim(ordinaryHouse, ordinaryMe.id, '1357')).token;
  ok('普通家人认领得到设备令牌', (ordinaryDev || '').length > 10, ordinaryDev);
  const ownCat = await post(
    `/api/my-categories?householdId=${encodeURIComponent(ordinaryHouse)}`,
    { name: '普通用户私房分类' },
    undefined,
    ordinaryDev
  );
  eq('普通用户可以新增本家私有分类', ownCat.status, 200);
  const ownDish = await post(
    `/api/my-dishes?householdId=${encodeURIComponent(ordinaryHouse)}`,
    { name: '普通用户私菜', category: ownCat.body.data.name },
    undefined,
    ordinaryDev
  );
  eq('普通用户可以新增本家私菜', ownDish.status, 200);
  eq(
    '普通用户不能通过管理员接口改共享菜',
    (await post('/api/dishes', { name: '普通用户越权共享菜', category: '其他' })).status,
    401
  );
  const sharedForOrdinary = stLocked.dishes.find((d) => !d.householdId);
  eq(
    '普通用户不能通过自家接口改共享菜',
    (
      await put(
        `/api/my-dishes/${encodeURIComponent(sharedForOrdinary.id)}?householdId=${encodeURIComponent(ordinaryHouse)}`,
        { ...sharedForOrdinary, description: '越权修改' }
      )
    ).status,
    403
  );
  eq('普通用户不能改系统设置', (await put('/api/settings', { shopName: '越权改名' })).status, 401);

  // 没 token 的写操作要被拒
  eq('没 token 改菜谱 401', (await post('/api/dishes', { name: '偷偷加的', category: '其他' })).status, 401);
  eq('没 token 删家庭 401', (await del(`/api/households/${h301.id}`)).status, 401);
  eq('没 token 改设置 401', (await put('/api/settings', { shopName: '被改了' })).status, 401);
  eq('没 token 导出 401', (await get('/api/export')).status, 401);
  eq('没 token 导入 401', (await post('/api/import', { dishes: [] })).status, 401);
  const afterFail = (await get('/api/state')).body.data;
  eq('被拒的操作没真的生效', afterFail.settings.shopName, stLocked.settings.shopName);
  eq('被拒的加菜没进菜单', afterFail.dishes.length, stLocked.dishes.length + 1);
  eq('被拒的删家庭没生效', afterFail.households.length, stLocked.households.length);

  // 口令不对
  eq('口令不对 401', (await post('/api/auth', { pin: '0000' })).status, 401);

  // 正常登录
  const login = await post('/api/auth', { pin: '2468' });
  eq('口令对就发 token', login.status, 200);
  const TOKEN = login.body.data.token;
  ok('拿到的是非空 token', typeof TOKEN === 'string' && TOKEN.length >= 32, TOKEN);
  eq('登录响应标了 hasPin', login.body.data.hasPin, true);

  // 带 token 就能改了
  const withTok = await post('/api/dishes', { name: '解锁后新增', category: '其他' }, TOKEN);
  eq('带 token 能加菜', withTok.status, 200);
  eq('菜真的加进去了', withTok.body.data.name, '解锁后新增');
  eq('带 token 能改设置', (await put('/api/settings', { shopName: '合法改名' }, TOKEN)).status, 200);
  eq('带 token 能导出', (await get('/api/export', TOKEN)).status, 200);

  // 乱 token 不行
  eq('伪造 token 401', (await post('/api/dishes', { name: 'x', category: '其他' }, 'deadbeef')).status, 401);

  // 家人的日常功能不该被口令挡住
  eq('没 token 也能点餐', (await post('/api/orders', { dishName: '随便点点', householdId: h301.id })).status, 200);
  eq('没 token 也能记库存', (await post('/api/pantry', { householdId: h301.id, name: '牛奶', category: '奶制品', quantity: 1, unit: '盒' })).status, 200);
  eq('没 token 也能排本周计划', (await post('/api/plans/items', { householdId: h301.id, name: '随手加的' })).status, 200);

  // 换口令 → 旧 token 作废
  eq('换口令', (await put('/api/settings', { adminPin: '1111' }, TOKEN)).status, 200);
  eq('旧 token 立刻失效', (await post('/api/dishes', { name: 'y', category: '其他' }, TOKEN)).status, 401);
  const relogin = await post('/api/auth', { pin: '1111' });
  eq('用新口令能重新登录', relogin.status, 200);
  const T2 = relogin.body.data.token;
  eq('新 token 可用', (await post('/api/dishes', { name: 'z', category: '其他' }, T2)).status, 200);

  // 取消口令 → 全部恢复开放
  eq('取消口令', (await put('/api/settings', { clearAdminPin: true }, T2)).status, 200);
  eq('取消后 hasPin 为 false', (await get('/api/state')).body.data.settings.hasPin, false);
  eq('取消后无需 token 也能改', (await post('/api/dishes', { name: '自由了', category: '其他' })).status, 200);
  eq('取消后无需 token 也能导出', (await get('/api/export')).status, 200);

  // 口令三态：不传 adminPin 不应误清空
  await put('/api/settings', { adminPin: '9999' });
  // 换过口令了，之前的会话都作废，得重新登录才动得了设置
  const T3 = (await post('/api/auth', { pin: '9999' })).body.data.token || '';
  const keep = await put('/api/settings', { shopName: '只改店名' }, T3);
  eq('不传 adminPin 时口令不变', (await get('/api/state')).body.data.settings.hasPin, true);
  eq('确实只改了店名', keep.body.data.shopName, '只改店名');

  // 收拾干净：把测试留下的菜删掉、口令取消
  for (const d of (await get('/api/state')).body.data.dishes) {
    if (['解锁后新增', 'z', '自由了', '开放期新增'].includes(d.name)) await del(`/api/dishes/${d.id}`, T3);
  }
  await put('/api/settings', { clearAdminPin: true }, T3);

  await stop(child);

  /* ---------- 旧数据迁移 ---------- */
  console.log('\n[11] 旧数据自动迁移');
  const legacy = await boot('legacy', (dataDir) => {
    fs.writeFileSync(path.join(dataDir, 'categories.json'), JSON.stringify([{ id: 'c1', name: '家常菜', order: 1 }]), 'utf8');
    fs.writeFileSync(
      path.join(dataDir, 'dishes.json'),
      JSON.stringify([
        { id: 'd_old1', name: '老菜一', category: '家常菜', images: [], seasonings: [], methods: [], tags: [] },
        { id: 'd_old2', name: '老菜二', category: '家常菜', images: [], seasonings: [], methods: [], tags: [] },
      ]),
      'utf8'
    );
    // 老版本的点餐：没有 householdId
    fs.writeFileSync(
      path.join(dataDir, 'orders.json'),
      JSON.stringify([
        { id: 'o_old1', dishId: 'd_old1', dishName: '老菜一', requester: '妈妈', people: 3, status: 'pending', date: '2024-05-01' },
        { id: 'o_old2', dishId: 'd_old2', dishName: '老菜二', requester: '爸爸', people: 2, status: 'done', date: '2024-05-01' },
      ]),
      'utf8'
    );
    // 老版本的设置：成员是字符串数组，且没有 currentHouseholdId
    fs.writeFileSync(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({ shopName: '老店名', members: ['妈妈', '爸爸', '我'], shoppingChecked: [] }),
      'utf8'
    );
  });

  st = (await get('/api/state')).body.data;
  eq('老店名保留', st.settings.shopName, '老店名');
  eq('生成了一个默认家庭', st.households.length, 1);
  eq('老成员被认领', st.households[0].members.map((m) => m.name), ['妈妈', '爸爸', '我']);
  ok('老成员拿到了头像', st.households[0].members.every((m) => !!m.emoji), st.households[0].members);
  eq('settings.members 被清理', 'members' in st.settings, false);
  eq('老点餐归到默认家庭', [...new Set(st.orders.map((o) => o.householdId))], [st.households[0].id]);
  eq('老点餐数量不变', st.orders.length, 2);
  eq('currentHouseholdId 已补上', st.settings.currentHouseholdId, st.households[0].id);
  ok('菜单没丢', st.dishes.length === 2, st.dishes.length);

  // 迁移结果要真的落盘
  await stop(legacy);
  const savedHouseholds = JSON.parse(fs.readFileSync(path.join(TMP, 'legacy', 'data', 'households.json'), 'utf8'));
  const savedPantry = fs.existsSync(path.join(TMP, 'legacy', 'data', 'pantry.json'));
  eq('households.json 已落盘', savedHouseholds[0].members.map((m) => m.name), ['妈妈', '爸爸', '我']);
  ok('pantry.json 已生成', savedPantry);

  /* ---------- 重复 id ---------- */
  console.log('\n[12] 重复 id 去重');
  const dup = await boot('dup', (dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'households.json'),
      JSON.stringify([
        { id: 'h_a', name: 'A', emoji: '🏠', members: [] },
        { id: 'h_a', name: 'A 重复', emoji: '🏠', members: [] },
        { id: 'h_b', name: 'B', emoji: '🏠', members: [] },
      ]),
      'utf8'
    );
    fs.writeFileSync(
      path.join(dataDir, 'pantry.json'),
      JSON.stringify([
        { id: 'f_1', householdId: 'h_a', name: '重复条目', category: '蔬菜', quantity: 1, unit: '份' },
        { id: 'f_1', householdId: 'h_a', name: '重复条目 2', category: '蔬菜', quantity: 2, unit: '份' },
      ]),
      'utf8'
    );
    fs.writeFileSync(
      path.join(dataDir, 'orders.json'),
      JSON.stringify([
        { id: 'o_1', dishName: '重复点餐', householdId: 'h_没了', status: 'pending', people: 2 },
        { id: 'o_1', dishName: '重复点餐 2', householdId: 'h_没了', status: 'pending', people: 2 },
      ]),
      'utf8'
    );
  });
  st = (await get('/api/state')).body.data;
  eq('家庭按 id 去重', st.households.map((h) => h.name), ['A', 'B']);
  eq('库存按 id 去重', st.pantry.length, 1);
  eq('点餐按 id 去重', st.orders.length, 1);
  eq('悬空 householdId 全部拉回 A', st.orders[0].householdId, 'h_a');
  await stop(dup);

  /* ---------- 坏文件自动备份 ---------- */
  console.log('\n[13] 坏文件不丢数据');
  const bad = await boot('bad', (dataDir) => {
    fs.writeFileSync(path.join(dataDir, 'dishes.json'), '{ 这不是 JSON', 'utf8');
  });
  const badState = (await get('/api/state')).body.data;
  ok('坏 dishes.json 退回默认菜', badState.dishes.length === 4, badState.dishes.length);
  const backups = fs.readdirSync(path.join(TMP, 'bad', 'data')).filter((f) => f.includes('.corrupt-'));
  ok('坏文件留了备份', backups.length === 1, backups);
  await stop(bad);

  /* ---------- AI 代理（用假 AI 服务器，不联网不花钱） ---------- */
  console.log('\n[14] AI 代理');
  // 起一个假的 AI 服务，验证代理逻辑：think 剥离、JSON 提取、错误降级、超时
  const MOCK_PORT = 8902;
  const mock = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (c) => (body += c));
    rq.on('end', () => {
      rs.setHeader('Content-Type', 'application/json');
      if (rq.url.includes('boom401')) {
        rs.statusCode = 401;
        return rs.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      }
      if (rq.url.includes('boom429')) {
        rs.statusCode = 429;
        return rs.end(JSON.stringify({ error: { message: 'rate limited' } }));
      }
      if (rq.url.includes('garbage')) {
        return rs.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '<think>想了一下</think>这不是 JSON' } }],
        }));
      }
      // 备餐时间轴：结构不一样，单独回一份，别混进 cook-plan 的字段里。
      // 认的是系统提示里独有的 startMinute —— 发给假服务器的是 messages，里面没有 task 名。
      if (body.indexOf('startMinute') >= 0) {
        return rs.end(JSON.stringify({
          model: 'MiniMax-M3',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"totalMinutes":38,"stages":[' +
                  '{"step":1,"startMinute":0,"minutes":8,"what":"洗菜切配","dish":"番茄炒蛋","parallel":true,"why":"先备好下锅就能炒"},' +
                  '{"step":2,"startMinute":8,"minutes":5,"what":"热油炒蛋盛出","dish":"番茄炒蛋","parallel":false,"why":"这一步要守着锅"}' +
                  '],"tips":["花生最后放"]}\n```',
              },
            },
          ],
          usage: { total_tokens: 200 },
        }));
      }
      // 「粘贴菜单文字 → 菜谱」：要的是一道菜的完整结构
      if (body.includes('麻婆豆腐')) {
        return rs.end(JSON.stringify({
          model: 'MiniMax-M3',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"name":"麻婆豆腐","category":"家常菜","description":"麻辣下饭，嫩豆腐配肉末",' +
                  '"servings":"2-3 人份","duration":20,"difficulty":"简单","tags":["下饭"],' +
                  '"seasonings":[{"name":"嫩豆腐","amount":"1 盒"},{"name":"郫县豆瓣酱","amount":"1 勺"}],' +
                  '"methods":[{"name":"家常做法","steps":["豆腐切块焯水","炒香豆瓣酱","下豆腐小火烧 5 分钟"],' +
                  '"seasonings":[{"name":"花椒粉","amount":"1 小勺"}]}],"notes":"麻婆豆腐的关键是豆瓣酱"}\n```',
              },
            },
          ],
          usage: { total_tokens: 96 },
        }));
      }
      // 拍照认菜：同样只出一份菜谱结构
      if (body.includes('data:image')) {
        return rs.end(JSON.stringify({
          model: 'MiniMax-M3',
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"name":"清蒸鲈鱼","category":"家常菜","description":"鲜嫩",' +
                  '"servings":"3 人份","duration":25,"difficulty":"中等","tags":["清淡"],' +
                  '"seasonings":[{"name":"鲈鱼","amount":"1 条"}],' +
                  '"methods":[{"name":"清蒸","steps":["鱼身划刀","铺姜丝","大火蒸 8 分钟"]}],"notes":""}\n```',
              },
            },
          ],
          usage: { total_tokens: 77 },
        }));
      }
      // 正常回复：思考过程混在 content 里，外面还套了 ```json 围栏
      return rs.end(JSON.stringify({
        model: 'MiniMax-M3',
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                '<think>用户要做调度，我先想步骤</think>\n\n```json\n{"name":"番茄炒蛋",' +
                '"sequence":[{"step":1,"what":"先炒蛋"}],"tips":["花生最后放"]}\n```\n\n以上供参考。',
            },
          },
        ],
        usage: { total_tokens: 123 },
      }));
    });
  });
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

  const ai = await boot('ai', (dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'ai.json'),
      JSON.stringify({
        enabled: true,
        baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
        model: 'MiniMax-M3',
        apiKey: 'test-key-not-real',
        timeoutMs: 3000,
      }),
      'utf8'
    );
  });

  // 状态接口：绝不能吐出 key
  const aiStatus = (await get('/api/ai')).body.data;
  ok('AI 状态说已配置', aiStatus.enabled === true && aiStatus.hasKey === true, aiStatus);
  ok('AI 状态不含 apiKey 字段', !('apiKey' in aiStatus), aiStatus);
  ok('AI 状态文件里没有 key 明文', JSON.stringify(aiStatus).indexOf('test-key') === -1, aiStatus);

  // 正常调用：think 被剥离、围栏被解开、JSON 被正确抽出
  const cook = await post('/api/ai/chat', { task: 'cook-plan', prompt: '今天做番茄炒蛋' });
  ok('AI 调用成功', cook.body.data.ok === true, cook.body.data);
  eq('think 内容被剥掉了', cook.body.data.result.name, '番茄炒蛋');
  eq('围栏里的 JSON 被正确解析', cook.body.data.result.sequence[0].what, '先炒蛋');
  eq('多字段都解析出来了', cook.body.data.result.tips[0], '花生最后放');
  ok('usage 被带回来', cook.body.data.usage.total_tokens === 123, cook.body.data.usage);

  // AI 不可用时要有话说人话，而不是崩
  const badTask = await post('/api/ai/chat', { task: '不存在的任务', prompt: 'x' });
  eq('未知 task 被拒', badTask.status, 400);

  const emptyPrompt = await post('/api/ai/chat', { task: 'cook-plan', prompt: '' });
  eq('空内容被拒', emptyPrompt.status, 400);

  // 备餐时间轴：厨房助手现在用的任务，要能拿到 minutes / parallel / startMinute
  const tl = await post('/api/ai/chat', { task: 'prep-timeline', prompt: '今天做番茄炒蛋和宫保鸡丁' });
  ok('备餐时间轴调用成功', tl.body.data.ok === true, tl.body.data);
  eq('总耗时被解析出来', tl.body.data.result.totalMinutes, 38);
  eq('第一步从第 0 分钟开始', tl.body.data.result.stages[0].startMinute, 0);
  eq('每步的耗时在', tl.body.data.result.stages[0].minutes, 8);
  eq('能不能并行有标记', tl.body.data.result.stages[0].parallel, true);
  eq('必须守灶的步骤标成不可并行', tl.body.data.result.stages[1].parallel, false);
  eq('步骤属于哪道菜', tl.body.data.result.stages[1].dish, '番茄炒蛋');

  // AI 现在的全部能力面：拍照认菜、粘贴文字生成菜谱、厨房助手排时间轴。
  // 刻意没有「对话助手」—— 它能看整个菜单、能自己加菜下单，权限太大，已经拿掉。
  const gone = await post('/api/ai/chat', { task: 'assistant-chat', prompt: '今晚吃什么' });
  eq('对话助手这个任务已经没了', gone.status, 400);

  const fromText = await post('/api/ai/chat', {
    task: 'recipe-from-text',
    prompt: '麻婆豆腐\n嫩豆腐1盒、郫县豆瓣酱1勺\n1. 豆腐焯水 2. 炒香豆瓣 3. 小火烧5分钟',
  });
  ok('粘贴文字生成菜谱调用成功', fromText.body.data.ok === true, fromText.body.data);
  eq('菜名解析出来了', fromText.body.data.result.name, '麻婆豆腐');
  eq('分类解析出来了', fromText.body.data.result.category, '家常菜');
  eq('通用调料解析出来了', fromText.body.data.result.seasonings.length, 2);
  eq('步骤解析出来了', fromText.body.data.result.methods[0].steps.length, 3);
  eq('做法独有的调料也分得开', fromText.body.data.result.methods[0].seasonings[0].name, '花椒粉');
  ok('AI 只给菜谱，不给可执行动作', fromText.body.data.result.actions === undefined, fromText.body.data.result);

  const fromImg = await post('/api/ai/chat', {
    task: 'recipe-from-image',
    prompt: '这是我要收录的一道菜',
    imageUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  });
  ok('拍照认菜调用成功', fromImg.body.data.ok === true, fromImg.body.data);
  eq('菜名解析出来了', fromImg.body.data.result.name, '清蒸鲈鱼');
  eq('耗时是数字', typeof fromImg.body.data.result.duration, 'number');

  await stop(ai);
  await new Promise((r) => mock.close(r));

  console.log('\n[14·2] 做法自带调料');
  const mz = await boot('methodSeason');
  const md = await post('/api/dishes', {
    name: '红烧肉',
    category: '家常菜',
    servings: '3 人份',
    seasonings: [{ name: '五花肉', amount: '600g' }],
    methods: [
      {
        name: '红烧',
        seasonings: [{ name: '冰糖', amount: '20g' }, { name: '八角', amount: '2 个' }],
        steps: ['冷水下肉焯水', '炒糖色后下肉', '加开水没过，小火 50 分钟'],
      },
      { name: '清蒸', steps: ['肉切片铺盘', '上汽蒸 40 分钟'] },
    ],
  });
  const mzId = md.body.data.id;
  eq('菜品级调料留着', JSON.stringify(md.body.data.seasonings), JSON.stringify([{ name: '五花肉', amount: '600g' }]));
  eq('做法能带自己的调料', md.body.data.methods[0].seasonings.length, 2);
  eq('做法调料名字对', md.body.data.methods[0].seasonings[0].name, '冰糖');
  eq('没配调料的做法是空数组', JSON.stringify(md.body.data.methods[1].seasonings), '[]');

  // 存盘再读，字段不能被服务端规范化吃掉
  await new Promise((r) => setTimeout(r, 400)); // 等防抖落盘
  const mzBack = (await get('/api/state')).body.data.dishes.find((x) => x.id === mzId);
  eq('重新读出来做法调料还在', mzBack.methods[0].seasonings.length, 2);

  // 老数据（没有 methods[].seasonings）不能被弄坏
  const oldStyle = await post('/api/dishes', {
    name: '老格式菜',
    category: '家常菜',
    seasonings: [{ name: '盐', amount: '适量' }],
    methods: [{ name: '唯一做法', steps: ['炒一下'] }],
  });
  eq('老格式自动补空数组', JSON.stringify(oldStyle.body.data.methods[0].seasonings), '[]');
  eq('老格式的步骤没丢', oldStyle.body.data.methods[0].steps[0], '炒一下');
  // 没有调料名的空行不能进 JSON
  const withBlank = await put('/api/dishes/' + mzId, {
    methods: [
      { name: '红烧', seasonings: [{ name: '  ', amount: 'x' }, { name: '老抽', amount: '2 勺' }], steps: ['焯水'] },
    ],
  });
  eq('空调料名被丢掉', JSON.stringify(withBlank.body.data.methods[0].seasonings), JSON.stringify([{ name: '老抽', amount: '2 勺' }]));
  await stop(mz);

  console.log('\n[15] 版本信息');
  const verBoot = await boot('ver');
  const v = (await get('/api/version')).body.data;
  ok('版本号有值', /^\d+\.\d+\.\d+$/.test(v.version), v.version);
  ok('更新记录不是空数组', Array.isArray(v.releases) && v.releases.length > 0, v.releases && v.releases.length);
  ok('第一条更新记录就是当前版本', v.releases[0].version === v.version, {
    current: v.version,
    first: v.releases[0].version,
  });
  ok('每条更新记录都有标题和日期', v.releases.every((r) => r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.date)), v.releases.map((r) => r.version));
  ok('每条更新记录都列了具体改了什么', v.releases.every((r) => Array.isArray(r.items) && r.items.length), v.releases.map((r) => r.items && r.items.length));
  // 版本页不该要口令：网页上任何人都该能看到自己跑的是哪一版
  const noPinVer = (await get('/api/version')).status;
  eq('没口令也能看版本', noPinVer, 200);
  await stop(verBoot);

  console.log('\n[16] 批量删除库存');
  const bulk = await boot('bulk');
  const pf1 = (await post('/api/pantry', { name: '土豆', category: '蔬菜', quantity: 2, unit: '个' })).body.data;
  const pf2 = (await post('/api/pantry', { name: '五花肉', category: '肉类', quantity: 1, unit: '斤' })).body.data;
  const pf3 = (await post('/api/pantry', { name: '鸡蛋', category: '蛋类', quantity: 10, unit: '个' })).body.data;
  eq('先记了 3 样', (await get('/api/state')).body.data.pantry.length, 3);

  const rm2 = await del(`/api/pantry?ids=${pf1.id},${pf2.id}`);
  eq('批量删返回 200', rm2.status, 200);
  eq('删掉了 2 样', rm2.body.data.removed, 2);
  const afterIds = (await get('/api/state')).body.data.pantry.map((p) => p.id);
  eq('没勾的那样还在', JSON.stringify(afterIds), JSON.stringify([pf3.id]));

  const rmAgain = await del(`/api/pantry?ids=${pf1.id}`);
  eq('重复删不报错，只是删不到东西', rmAgain.body.data.removed, 0);
  const rmNone = await del('/api/pantry?ids=');
  eq('没勾任何东西时明确报错', rmNone.status, 400);

  // 老的按 scope 清理不能被 ids 分支顶掉
  await post('/api/pantry', { name: '牛奶', category: '奶制品', quantity: 1, unit: '盒', expireAt: dayOffset(-2) });
  await post('/api/pantry', { name: '酸奶', category: '奶制品', quantity: 1, unit: '盒', expireAt: dayOffset(2) });
  const scopePurge = await del('/api/pantry?scope=expired');
  eq('按过期清理仍然可用', scopePurge.body.data.removed, 1);
  // 不带任何参数曾经等于「删掉所有填了保质期的」——这种默认值太危险
  const noParam = await del('/api/pantry');
  eq('不说明删什么就拒绝执行', noParam.status, 400);
  const badScope = await del('/api/pantry?scope=all');
  eq('不认识的清理范围被拒', badScope.status, 400);
  eq('上面的拒绝没有误删任何东西', (await get('/api/state')).body.data.pantry.length, 2);
  await stop(bulk);

  console.log('\n[17] 点餐一键开做');
  const bulkOrder = await boot('bulkOrder');
  const bd1 = (await post('/api/dishes', { name: '测试菜一', category: '家常菜' })).body.data;
  const bd2 = (await post('/api/dishes', { name: '测试菜二', category: '家常菜' })).body.data;
  const bo1 = (await post('/api/orders', { dishId: bd1.id, dishName: bd1.name, requester: '我', people: 2 })).body.data;
  const bo2 = (await post('/api/orders', { dishId: bd2.id, dishName: bd2.name, requester: '我', people: 3 })).body.data;
  eq('两条点餐都是待做', (await get('/api/state')).body.data.orders.every((o) => o.status === 'pending'), true);

  const started = await req('PATCH', '/api/orders', { ids: [bo1.id, bo2.id], status: 'cooking' });
  eq('一键开做返回 200', started.status, 200);
  eq('两条都改了', started.body.data.changed, 2);
  const afterStart = (await get('/api/state')).body.data.orders.map((o) => o.status);
  eq('状态全变成制作中', JSON.stringify(afterStart.sort()), JSON.stringify(['cooking', 'cooking']));

  const badStatus = await req('PATCH', '/api/orders', { ids: [bo1.id], status: '瞎写' });
  eq('不认的状态被拒', badStatus.status, 400);
  const noIds = await req('PATCH', '/api/orders', { status: 'cooking' });
  eq('没选任何一条时明确报错', noIds.status, 400);
  await stop(bulkOrder);

  console.log('\n[18] 备份：zip 带照片 + 自动快照');
  const bk = await boot('backup');
  const bkDir = path.join(TMP, 'backup');
  const bkUploads = path.join(bkDir, 'uploads');

  // 造一张真照片挂到菜上，才能验证「备份把照片带走了」而不是只测了 JSON
  const TINY_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const upPhoto = await post('/api/upload', { dataUrl: 'data:image/png;base64,' + TINY_PNG });
  eq('照片上传成功', upPhoto.status, 200);
  const photoUrl = upPhoto.body.data.url;
  const photoFile = path.join(bkUploads, path.basename(photoUrl));
  ok('照片真落到 uploads/ 下了', fs.existsSync(photoFile), photoUrl);

  const photoDish = await post('/api/dishes', {
    name: '带照片的菜',
    category: '家常菜',
    images: [photoUrl],
  });
  eq('菜谱挂上了照片', JSON.stringify(photoDish.body.data.images), JSON.stringify([photoUrl]));

  // ---- 导出是 zip ----
  const exported = await reqRaw('GET', '/api/export');
  eq('导出返回 200', exported.status, 200);
  ok(
    '导出的是 zip（PK 头）',
    exported.buf.length > 4 && exported.buf[0] === 0x50 && exported.buf[1] === 0x4b,
    exported.buf.slice(0, 4)
  );
  ok(
    '文件名带 .zip',
    /filename="menu-backup-\d{4}-\d{2}-\d{2}\.zip"/.test(exported.res.headers.get('Content-Disposition') || ''),
    exported.res.headers.get('Content-Disposition')
  );

  // ---- 自动快照 ----
  const list0 = await get('/api/backups');
  eq('备份列表能读', list0.status, 200);
  ok('启动时自动打了一份', list0.body.data.list.length >= 1, list0.body.data.list);
  ok('保留份数是 7', list0.body.data.keep, 7);
  ok('备份名格式对', /^backup-\d{8}-\d{6}\.zip$/.test(list0.body.data.list[0].name), list0.body.data.list[0].name);

  // 启动快照是在建这道菜之前打的，得现在手动打一份才包含它
  const manual = await post('/api/backups');
  eq('手动打一份返回 200', manual.status, 200);
  const snapName = manual.body.data.name;
  ok('手动这份进了列表', (await get('/api/backups')).body.data.list.some((x) => x.name === snapName), snapName);

  // ---- 破坏现场：改名 + 把照片删了 ----
  await put('/api/dishes/' + photoDish.body.data.id, { name: '改坏了的菜' });
  fs.unlinkSync(photoFile);
  ok('现场已破坏：照片不在了', !fs.existsSync(photoFile));

  // ---- 恢复 ----
  const restored = await reqRaw(
    'POST',
    `/api/backups/${encodeURIComponent(snapName)}/restore`
  );
  eq('恢复返回 200', restored.status, 200);
  const bkState = (await get('/api/state')).body.data;
  eq(
    '菜谱恢复回快照时的样子',
    bkState.dishes.find((d) => d.id === photoDish.body.data.id).name,
    '带照片的菜'
  );
  ok('照片也一起回来了', fs.existsSync(photoFile));
  ok('恢复前自动留了一份现场', !!restored.body.data.safety, restored.body.data);

  // ---- 上传 zip 恢复（前端走的是这条路）----
  const reExported = await reqRaw('GET', '/api/export');
  fs.unlinkSync(photoFile);
  const imported = await reqRaw('POST', '/api/import', reExported.buf);
  eq('上传 zip 恢复返回 200', imported.status, 200);
  ok('zip 恢复把照片写回来了', imported.body.data.written === 1, imported.body.data);
  ok('文件真的在', fs.existsSync(photoFile));

  // ---- 老的纯 JSON 备份还得能收 ----
  const legacyBackup = {
    __app: 'family-menu',
    dishes: [{ id: 'd_legacy1', name: '老备份的菜', category: '家常菜', images: [] }],
    households: [{ id: 'h_legacy', name: '老家庭', emoji: '🏠', members: [] }],
  };
  const legRes = await reqRaw('POST', '/api/import', Buffer.from(JSON.stringify(legacyBackup), 'utf8'));
  eq('老的纯 JSON 备份还能恢复', legRes.status, 200);
  eq('老备份的菜进来了', (await get('/api/state')).body.data.dishes[0].name, '老备份的菜');

  // ---- 不是备份的东西要说清楚 ----
  const junk = await reqRaw('POST', '/api/import', Buffer.from('这不是备份', 'utf8'));
  eq('乱传的文件被拒', junk.status, 400);
  const notZip = await reqRaw('GET', '/api/backups/%2e%2e%2f%2e%2e%2fserver.js');
  eq('备份名不认 ../ 这种', notZip.status, 400);
  const noSuch = await reqRaw('GET', '/api/backups/backup-19700101-000000.zip');
  eq('不存在的备份报 404', noSuch.status, 404);

  // ---- 备份里存着口令，列表也要认证 ----
  const pinRes = await put('/api/settings', { adminPin: '2468' });
  eq('设了口令', pinRes.status, 200);
  const auth = (await post('/api/auth', { pin: '2468' })).body.data.token;
  const locked = await get('/api/backups');
  eq('没解锁读不到备份列表', locked.status, 401);
  const lockedExport = await get('/api/export');
  eq('没解锁导不出备份', lockedExport.status, 401);
  const unlocked = await get('/api/backups', auth);
  eq('解锁后能读', unlocked.status, 200);
  await stop(bk);

  /* ---------- 批量删除 ---------- */
  console.log('\n[19] 批量删除：点餐 + 计划');
  const bdDel = await boot('batchdel');

  // ---- 点餐 ----
  const dBatch = (await post('/api/dishes', { name: '批量测试菜', category: '家常菜' })).body.data;
  const oA = (await post('/api/orders', { dishId: dBatch.id, dishName: dBatch.name, requester: '我' })).body.data;
  const oB = (await post('/api/orders', { dishId: dBatch.id, dishName: dBatch.name, requester: '我' })).body.data;
  const oC = (await post('/api/orders', { dishId: dBatch.id, dishName: dBatch.name, requester: '我' })).body.data;
  eq('先记了 3 条点餐', (await get('/api/state')).body.data.orders.length, 3);

  const delOrders = await del(`/api/orders?ids=${oA.id},${oB.id}`);
  eq('批量删点餐返回 200', delOrders.status, 200);
  eq('删掉了 2 条', delOrders.body.data.removed, 2);
  eq('没勾的那条还在', (await get('/api/state')).body.data.orders.map((o) => o.id).join(), oC.id);

  // 不给 ids 必须报错，不能偷偷当成「全删」
  eq('不带 ids 明确报错', (await del('/api/orders')).status, 400);
  eq('ids 为空明确报错', (await del('/api/orders?ids=')).status, 400);
  ok('报错说的是「要删哪几条」', /要删哪几条/.test((await del('/api/orders')).body.error || ''), '要有话');
  eq('不存在的 id 不报错，只是删不到', (await del('/api/orders?ids=o_没有,o_也没有')).body.data.removed, 0);
  eq('重复删同一批也不报错', (await del(`/api/orders?ids=${oA.id},${oB.id}`)).body.data.removed, 0);

  // 批量分支不能把 /api/orders/done 这种单段路由吃掉
  await req('PATCH', `/api/orders/${oC.id}`, { status: 'done' });
  eq('按家庭清空已完成仍认得', (await del('/api/orders/done')).status, 200);
  eq('已完成那条真被清掉了', (await get('/api/state')).body.data.orders.length, 0);

  // ---- 本周计划 ----
  const bMonday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const iA = (await post('/api/plans/items', { weekOf: bMonday, name: '批量拿掉一' })).body.data.item;
  const iB = (await post('/api/plans/items', { weekOf: bMonday, name: '批量拿掉二' })).body.data.item;
  const iC = (await post('/api/plans/items', { weekOf: bMonday, name: '留着别动' })).body.data.item;
  eq('本周排了 3 道', (await get(`/api/plans?weekOf=${bMonday}`)).body.data.items.length, 3);

  const delPlan = await del(`/api/plans/items?ids=${iA.id},${iB.id}`);
  eq('批量拿掉计划返回 200', delPlan.status, 200);
  eq('拿掉了 2 道', delPlan.body.data.removed, 2);
  eq(
    '没勾的那道还在',
    (await get(`/api/plans?weekOf=${bMonday}`)).body.data.items.map((i) => i.id).join(),
    iC.id
  );

  eq('计划不带 ids 明确报错', (await del('/api/plans/items')).status, 400);
  eq('计划 ids 为空明确报错', (await del('/api/plans/items?ids=')).status, 400);
  ok(
    '计划报错说的是「要拿掉哪几道」',
    /要拿掉哪几道/.test((await del('/api/plans/items')).body.error || ''),
    '要有话'
  );
  eq('不存在的计划项不报错', (await del('/api/plans/items?ids=p_没有')).body.data.removed, 0);

  // 批量分支不能吃掉「按 id 拿掉一道」的老路由
  eq('单条拿掉仍认得', (await del(`/api/plans/items/${iC.id}`)).status, 200);
  eq('删完本周空了', (await get(`/api/plans?weekOf=${bMonday}`)).body.data.items.length, 0);
  eq('拿掉不存在的那条报 404', (await del('/api/plans/items/p_没有')).status, 404);
  await stop(bdDel);

  /* ---------- 留言板 + 菜品互动 ---------- */
  console.log('\n[20] 留言板与菜品互动');
  const board = await boot('board');
  const bDish = (await post('/api/dishes', { name: '留言测试菜', category: '家常菜' })).body.data;
  const bOther = (await post('/api/dishes', { name: '另一道菜', category: '主食' })).body.data;
  const bHouse = (await post('/api/households', { name: '302 室' })).body.data;

  // ---- 留言板 ----
  eq('初始没有留言', (await get('/api/state')).body.data.notes.notes.length, 0);
  const n1 = (await post('/api/notes', { author: '我', text: '今晚我做饭', sticker: '🍳' })).body.data;
  ok('留言建起来了', !!n1.id && n1.kind === 'board', n1);
  eq('贴纸记下来了', n1.sticker, '🍳');
  eq('空留言被拒', (await post('/api/notes', { author: '我', text: '   ' })).status, 400);
  eq('不认识的贴纸丢掉', (await post('/api/notes', { author: '我', text: 'x', sticker: '💩' })).body.data.sticker, '');

  const n2 = (await post('/api/notes', { author: '妈', text: '我去买菜' })).body.data;
  // 前面那条「贴纸不认」的用例也真建了条留言，所以是 3 条
  eq('三条留言', (await get('/api/state')).body.data.notes.notes.length, 3);

  // 家庭之间互不串
  const nOther = (await post('/api/notes', { householdId: bHouse.id, author: '舅', text: '这边也有留言' })).body.data;
  eq('留言记到指定家庭', nOther.householdId, bHouse.id);
  const byHouse = (await get('/api/state')).body.data.notes.notes.filter((n) => n.householdId === bHouse.id);
  eq('另一个家庭的留言单独算', byHouse.length, 1);
  eq('幽灵家庭拉回默认', (await post('/api/notes', { householdId: '幽灵', text: 'x' })).body.data.householdId,
    (await get('/api/state')).body.data.households[0].id);

  // ---- 表情 ----
  const r1 = await post(`/api/notes/${n1.id}/react`, { emoji: '👍', who: '我' });
  eq('表情点上了', r1.body.data.on, true);
  eq('表情记了谁', JSON.stringify(r1.body.data.reactions['👍']), JSON.stringify(['我']));
  const r2 = await post(`/api/notes/${n1.id}/react`, { emoji: '👍', who: '妈' });
  eq('两个人都点了', r2.body.data.reactions['👍'].length, 2);
  const r3 = await post(`/api/notes/${n1.id}/react`, { emoji: '👍', who: '我' });
  eq('再点一次是取消', r3.body.data.on, false);
  eq('取消后只剩妈那一个', JSON.stringify(r3.body.data.reactions['👍']), JSON.stringify(['妈']));
  await post(`/api/notes/${n2.id}/react`, { emoji: '🔥', who: '我' });
  await post(`/api/notes/${n2.id}/react`, { emoji: '🔥', who: '我' });
  eq('取消到没人就不留空数组',
    (await get('/api/state')).body.data.notes.notes.find((n) => n.id === n2.id).reactions['🔥'], undefined);
  eq('不认识的表情被拒', (await post(`/api/notes/${n1.id}/react`, { emoji: '💩', who: '我' })).status, 400);
  eq('没人名不给点', (await post(`/api/notes/${n1.id}/react`, { emoji: '👍', who: '' })).status, 400);
  eq('给不存在的留言点表情 404', (await post('/api/notes/n_没有/react', { emoji: '👍', who: '我' })).status, 404);

  // ---- 认领 ----
  const c1 = await post(`/api/notes/${n1.id}/claim`, { by: '妈' });
  eq('妈认领了', c1.body.data.claim.by, '妈');
  const c2 = await post(`/api/notes/${n1.id}/claim`, { by: '我' });
  eq('别人不能抢认领', c2.status, 409);
  eq('还是妈认领着', (await get('/api/state')).body.data.notes.notes.find((n) => n.id === n1.id).claim.by, '妈');
  eq('本人再点是取消', (await post(`/api/notes/${n1.id}/claim`, { by: '妈' })).body.data.claim, null);
  eq('取消了就能被别人认领', (await post(`/api/notes/${n1.id}/claim`, { by: '我' })).body.data.claim.by, '我');

  // ---- 楼中楼 ----
  const rp1 = (await post(`/api/notes/${n1.id}/replies`, { author: '妈', text: '好啊' })).body.data;
  ok('回复建起来了', !!rp1.id, rp1);
  await post(`/api/notes/${n1.id}/replies`, { author: '我', text: '六点开饭' });
  eq('两条回复', (await get('/api/state')).body.data.notes.notes.find((n) => n.id === n1.id).replies.length, 2);
  eq('空回复被拒', (await post(`/api/notes/${n1.id}/replies`, { author: '我', text: '' })).status, 400);
  eq('删掉一条回复', (await del(`/api/notes/${n1.id}/replies/${rp1.id}`)).body.data.removed, 1);
  eq('删完剩一条', (await get('/api/state')).body.data.notes.notes.find((n) => n.id === n1.id).replies.length, 1);
  eq('删不存在的回复 404', (await del(`/api/notes/${n1.id}/replies/r_没有`)).status, 404);

  // ---- 菜品留言 ----
  const dn = (await post('/api/notes', { kind: 'dish', dishId: bDish.id, author: '妈', text: '少放辣' })).body.data;
  eq('菜品留言挂上菜了', dn.kind + '/' + dn.dishId, 'dish/' + bDish.id);
  // 板上的留言：n1、贴纸那条、n2、302 室那条、幽灵家庭那条
  eq('菜品留言不进留言板', (await get('/api/state')).body.data.notes.notes.filter((n) => n.kind === 'board').length, 5);
  eq('菜品留言不给菜就明确报错',
    (await post('/api/notes', { kind: 'dish', author: '我', text: '孤儿' })).status, 400);
  eq('给不存在的菜留言被拒',
    (await post('/api/notes', { kind: 'dish', dishId: 'd_没有', author: '我', text: 'x' })).status, 400);

  // ---- 菜品投票 ----
  const v1 = await post('/api/dish-votes', { dishId: bDish.id, who: '我', role: 'want' });
  eq('想吃点上了', JSON.stringify(v1.body.data.want), JSON.stringify(['我']));
  await post('/api/dish-votes', { dishId: bDish.id, who: '妈', role: 'want' });
  eq('两个人想吃', v1.status, 200);
  const vCook = await post('/api/dish-votes', { dishId: bDish.id, who: '妈', role: 'cook' });
  eq('妈认领下厨', vCook.body.data.cook[0], '妈');
  eq('别人抢下厨被拒', (await post('/api/dish-votes', { dishId: bDish.id, who: '我', role: 'cook' })).status, 409);
  eq('认领人没被顶掉',
    (await get('/api/state')).body.data.notes.votes[bDish.id].cook[0], '妈');
  eq('本人再点是取消认领',
    (await post('/api/dish-votes', { dishId: bDish.id, who: '妈', role: 'cook' })).body.data.cook.length, 0);
  eq('想吃可以取消',
    (await post('/api/dish-votes', { dishId: bDish.id, who: '我', role: 'want' })).body.data.want.join(), '妈');
  eq('给不存在的菜投票 404', (await post('/api/dish-votes', { dishId: 'd_没有', who: '我', role: 'want' })).status, 404);
  eq('投票必须有名', (await post('/api/dish-votes', { dishId: bDish.id, who: '', role: 'want' })).status, 400);

  // ---- 级联 ----
  await del(`/api/dishes/${bDish.id}`);
  let stB = (await get('/api/state')).body.data;
  eq('菜删了，挂在它下面的留言降级但内容留着',
    stB.notes.notes.find((n) => n.id === dn.id).kind, 'board');
  ok('留言正文没被抹掉', !!stB.notes.notes.find((n) => n.id === dn.id));
  ok('投票被清掉', !Object.keys(stB.notes.votes).includes(bDish.id), stB.notes.votes);
  await post('/api/dish-votes', { dishId: bOther.id, who: '我', role: 'want' });
  await del(`/api/households/${bHouse.id}`);
  stB = (await get('/api/state')).body.data;
  eq('删家庭带走它的留言', stB.notes.notes.filter((n) => n.householdId === bHouse.id).length, 0);
  eq('别的家庭的留言还在', stB.notes.notes.filter((n) => n.kind === 'board').length >= 4, true);

  // ---- 批量删留言 ----
  const alive = stB.notes.notes.map((n) => n.id);
  const delAll = await del(`/api/notes?ids=${alive.join(',')}`);
  eq('批量删留言 200', delAll.status, 200);
  eq('一次全删完', delAll.body.data.removed, alive.length);
  eq('留言板空了', (await get('/api/state')).body.data.notes.notes.length, 0);
  eq('批量删不带 ids 报错', (await del('/api/notes')).status, 400);
  eq('报错说的是「要删哪几条留言」', /要删哪几条留言/.test((await del('/api/notes')).body.error || ''), true);
  eq('ids 为空报错', (await del('/api/notes?ids=')).status, 400);
  eq('删不存在的留言不报错', (await del('/api/notes?ids=n_没有')).body.data.removed, 0);
  await stop(board);

  /* ---------- 老数据没有 notes.json ---------- */
  console.log('\n[20·2] 老数据升级');
  const legacyBoard = await boot('legacyBoard', (dataDir) => {
    // 只放老版本的 dishes.json，故意不放 notes.json
    fs.writeFileSync(
      path.join(dataDir, 'dishes.json'),
      JSON.stringify([{ id: 'd_老菜', name: '老菜', category: '家常菜', images: [] }], null, 2),
      'utf8'
    );
  });
  st = (await get('/api/state')).body.data;
  ok('没 notes.json 也能起，留言是空的', st.notes && Array.isArray(st.notes.notes), st.notes);
  eq('老数据留言数 0', st.notes.notes.length, 0);
  eq('老数据投票是空对象', JSON.stringify(st.notes.votes), '{}');
  ok('notes.json 已被自动补出来', fs.existsSync(path.join(TMP, 'legacyBoard', 'data', 'notes.json')));
  await stop(legacyBoard);

  /* ---------- 备份把留言一起带走 ---------- */
  console.log('\n[20·3] 备份带上留言');
  const bkNote = await boot('bkNote');
  const bkDish = (await post('/api/dishes', { name: '备份测试菜', category: '家常菜' })).body.data;
  await post('/api/notes', { author: '我', text: '这条要进备份' });
  await post('/api/dish-votes', { dishId: bkDish.id, who: '我', role: 'want' });
  const bkSnap = (await post('/api/backups')).body.data.name;
  await post('/api/notes', { author: '我', text: '备份之后才写的' });
  const restoredNote = await reqRaw(
    'POST',
    `/api/backups/${encodeURIComponent(bkSnap)}/restore`
  );
  eq('恢复 200', restoredNote.status, 200);
  const bkAfter = (await get('/api/state')).body.data;
  eq('备份之后的留言被回退了', bkAfter.notes.notes.length, 1);
  eq('备份里的留言内容还在', bkAfter.notes.notes[0].text, '这条要进备份');
  eq('备份里的投票也回来了', JSON.stringify(bkAfter.notes.votes), JSON.stringify({ [bkDish.id]: { want: ['我'], cook: [] } }));
  await stop(bkNote);

  /* ---------- 菜单分家：共享菜 + 本家私菜 ---------- */
  console.log('\n[21] 菜单分家');
  const sc = await boot('scope');
  const s0 = (await get('/api/state')).body.data;
  const A = s0.households[0].id; // 我家
  const sharedCat = s0.categories[0].name; // 家常菜

  // ---- 老种子本来就是共享的 ----
  eq('种子分类全是共享', s0.categories.every((c) => c.householdId === null), true);
  eq('种子菜全是共享', s0.dishes.every((d) => d.householdId === null), true);

  const hB = (await post('/api/households', { name: 'B 家', emoji: '🏡' })).body.data;
  ok('第二个家庭建起来了', !!hB.id, hB);

  // ---- 归属的默认值和改法 ----
  const sDish = (await post('/api/dishes', { name: '共享菜', category: sharedCat })).body.data;
  eq('新菜默认共享', sDish.householdId, null);
  const pDish = (await post('/api/dishes', { name: '我家秘制', category: sharedCat, householdId: A })).body.data;
  eq('私菜记下归属', pDish.householdId, A);

  // 编辑器保存时会带上整份菜谱，但不会碰 householdId —— 不能被偷偷改成私菜
  const p2 = await put(`/api/dishes/${pDish.id}`, { ...pDish, description: '改了个介绍' });
  eq('没带 householdId 不会偷改归属', p2.body.data.householdId, A);
  const s2 = await put(`/api/dishes/${sDish.id}`, { ...sDish, description: '改了个介绍' });
  eq('共享菜也不会被偷偷私有化', s2.body.data.householdId, null);

  eq('显式传 null 把私菜变回共享',
    (await put(`/api/dishes/${pDish.id}`, { ...pDish, householdId: null })).body.data.householdId, null);
  eq("传 'shared' 也算共享",
    (await put(`/api/dishes/${pDish.id}`, { ...pDish, householdId: A, isFavorite: true })).body.data.householdId, A);
  eq('认不出的家庭 id 当共享（别把菜弄丢）',
    (await put(`/api/dishes/${pDish.id}`, { ...pDish, householdId: 'h_根本没有' })).body.data.householdId, null);

  // ---- 分类也分家 ----
  const catA = (await post('/api/categories', { name: '私房菜', householdId: A })).body.data;
  const catB = await post('/api/categories', { name: '私房菜', householdId: hB.id });
  eq('同名的分类不让建第二次（名字全局唯一）', catB.status, 400);
  ok('报错提醒了可能是别的家庭的分类', /别的家庭|共享/.test(catB.body.error || ''), catB.body);
  eq('私有分类记下归属', catA.householdId, A);
  eq('改个名字不会把私分类悄悄改成共享的',
    (await put(`/api/categories/${catA.id}`, { name: '私房菜' })).body.data.householdId, A);
  const scratch = (await post('/api/categories', { name: '夜宵', householdId: hB.id })).body.data;
  eq('分类也能改成共享',
    (await put(`/api/categories/${scratch.id}`, { name: '夜宵', householdId: null })).body.data.householdId, null);
  await del(`/api/categories/${scratch.id}`);

  // ---- 菜与分类的组合 ----
  const catBX = (await post('/api/categories', { name: 'B家专区', householdId: hB.id })).body.data;
  eq('B 家的私有分类建起来了', catBX.householdId, hB.id);
  eq('私菜 + 共享分类 放得进去',
    (await post('/api/dishes', { name: '组合1', category: sharedCat, householdId: A })).status, 200);
  eq('私菜 + 自家私有分类 放得进去',
    (await post('/api/dishes', { name: '组合2', category: '私房菜', householdId: A })).status, 200);
  const badShared = await post('/api/dishes', { name: '组合3', category: '私房菜' });
  eq('共享菜 + 私有分类 被拒', badShared.status, 400);
  ok('报错点明了是哪个分类', /私房菜/.test(badShared.body.error || ''), badShared.body);
  ok('报错说了怎么改', /仅本家|共享分类/.test(badShared.body.error || ''), badShared.body);
  const badOther = await post('/api/dishes', { name: '组合4', category: catBX.name, householdId: A });
  eq('私菜 + 别人家私有分类 被拒', badOther.status, 400);
  eq('被拒的组合没存进去',
    (await get('/api/state')).body.data.dishes.filter((d) => d.name === '组合3').length, 0);
  // PUT 上同样要拦：不能先存成共享菜再偷偷改成私有分类
  const sharedFlip = await put(`/api/dishes/${sDish.id}`, { ...sDish, category: '私房菜' });
  eq('改分类时同样拦共享菜进私有分类', sharedFlip.status, 400);

  // ---- 复制继承归属 ----
  // 前面那条「认不出的 id 当共享」把 pDish 改成共享了，先把它变回私菜再测复制
  await put(`/api/dishes/${pDish.id}`, { ...pDish, householdId: A });
  eq('复制私菜还是本家的',
    (await post(`/api/dishes/${pDish.id}/duplicate`, {})).body.data.householdId, A);
  eq('复制共享菜还是共享的',
    (await post(`/api/dishes/${sDish.id}/duplicate`, {})).body.data.householdId, null);

  // ---- 删分类只动同归属的菜 ----
  // 场景一：删 A 家的私有分类
  const privInA = (await post('/api/dishes', { name: 'A家私菜甲', category: '私房菜', householdId: A })).body.data;
  const privInB = (await post('/api/dishes', { name: 'B家私菜甲', category: sharedCat, householdId: hB.id })).body.data;
  await del(`/api/categories/${catA.id}`);
  let stS = (await get('/api/state')).body.data;
  eq('删私有分类后本家的私菜挪到「其他」', stS.dishes.find((d) => d.id === privInA.id).category, '其他');
  eq('别家的私菜一点没动', stS.dishes.find((d) => d.id === privInB.id).category, sharedCat);
  eq('私有分类真的没了', stS.categories.find((c) => c.id === catA.id), undefined);

  // 场景二：删共享分类
  const sharedCatId = stS.categories.find((c) => c.name === sharedCat).id;
  const sharedInCat = (await post('/api/dishes', { name: '共享菜甲', category: sharedCat })).body.data;
  const privateInShared = (await post('/api/dishes', { name: '私菜乙', category: sharedCat, householdId: A })).body.data;
  await del(`/api/categories/${sharedCatId}`);
  stS = (await get('/api/state')).body.data;
  eq('删共享分类后共享菜挪到「其他」', stS.dishes.find((d) => d.id === sharedInCat.id).category, '其他');
  eq('删共享分类不会拽走别家的私菜', stS.dishes.find((d) => d.id === privateInShared.id).category, sharedCat);
  await stop(sc);

  /* ---------- 删家庭带走它的私菜 ---------- */
  console.log('\n[21·2] 删家庭带走私菜');
  const sc2 = await boot('scope2');
  const t0 = (await get('/api/state')).body.data;
  const tA = t0.households[0].id;
  const tB = (await post('/api/households', { name: 'B 家', emoji: '🏡' })).body.data;
  const tCat = (await post('/api/categories', { name: '我家专区', householdId: tA })).body.data;
  const tSharedCat = t0.categories[0].name;
  const tPriv = (await post('/api/dishes', { name: '我家私菜', category: tCat.name, householdId: tA })).body.data;
  const tShared = (await post('/api/dishes', { name: '大家的菜', category: tSharedCat })).body.data;
  const tBPriv = (await post('/api/dishes', { name: 'B家私菜', category: tSharedCat, householdId: tB.id })).body.data;
  // B 家曾经排过一道当时还共享的菜，后来 A 家把它改成了私菜 —— 删 A 家时这个引用不能留成悬空
  const tOrder = (await post('/api/orders', { householdId: tB.id, dishId: tPriv.id, dishName: tPriv.name })).body.data;
  const tNote = (await post('/api/notes', { kind: 'dish', dishId: tPriv.id, householdId: tB.id, author: '我', text: '好吃' })).body.data;
  const tBNote = (await post('/api/notes', { author: '我', text: 'B 家的留言' , householdId: tB.id })).body.data;
  await post('/api/dish-votes', { dishId: tShared.id, who: '我', role: 'want' });

  const goneHouse = await del(`/api/households/${tA}`);
  eq('删家庭 200', goneHouse.status, 200);
  eq('回报删了几道私菜', goneHouse.body.data.removedDishes, 1);
  eq('回报删了几个私有分类', goneHouse.body.data.removedCategories, 1);
  const st2 = (await get('/api/state')).body.data;
  eq('私菜被带走了', st2.dishes.find((d) => d.id === tPriv.id), undefined);
  eq('私有分类被带走了', st2.categories.find((c) => c.id === tCat.id), undefined);
  eq('共享菜留着', !!st2.dishes.find((d) => d.id === tShared.id), true);
  eq('共享分类留着', !!st2.categories.find((c) => c.name === tSharedCat), true);
  eq('别家的私菜没被牵连', !!st2.dishes.find((d) => d.id === tBPriv.id), true);
  eq('别人家菜上的留言留着', !!st2.notes.notes.find((n) => n.id === tNote.id), true);
  eq('悬空的点餐引用被清掉',
    (await get('/api/state')).body.data.orders.find((o) => o.id === tOrder.id).dishId, null);
  eq('菜还在，投票就留着', !!st2.notes.votes[tShared.id], true);
  await stop(sc2);

  /* ---------- 老数据的菜和分类都升级成共享 ---------- */
  console.log('\n[21·3] 老数据升级成共享菜');
  const legacyScope = await boot('legacyScope', (dataDir) => {
    // 1.8 之前的 dishes.json / categories.json：根本没有 householdId 这个字段
    fs.writeFileSync(
      path.join(dataDir, 'dishes.json'),
      JSON.stringify(
        [
          { id: 'd_1', name: '老菜甲', category: '家常菜', images: [] },
          { id: 'd_2', name: '老菜乙', category: '主食', images: [], methods: [] },
        ],
        null,
        2
      ),
      'utf8'
    );
    fs.writeFileSync(
      path.join(dataDir, 'categories.json'),
      JSON.stringify([{ id: 'c_1', name: '家常菜', order: 1 }], null, 2),
      'utf8'
    );
  });
  st = (await get('/api/state')).body.data;
  eq('老菜全部补成共享', st.dishes.map((d) => d.householdId), [null, null]);
  eq('老分类也补成共享', st.categories.map((c) => c.householdId), [null]);
  eq('老菜一道没少', st.dishes.length, 2);
  ok('dishes.json 已回写成带 householdId',
    /"householdId": null/.test(fs.readFileSync(path.join(TMP, 'legacyScope', 'data', 'dishes.json'), 'utf8')));
  await stop(legacyScope);

  /* ---------- 家里人 vs 管理员：谁能改什么 ---------- */
  console.log('\n[22] 非管理员只能改自己家的菜');
  const permInst = await boot('permInst');
  const p0 = (await get('/api/state')).body.data;
  const hhA = p0.households[0].id;
  const ppCat = p0.categories[0].name;

  // 还没设口令：谁都算管理员，装上就能用
  eq('没设口令时加公共菜没人拦',
    (await post('/api/dishes', { name: '公共菜', category: ppCat })).status, 200);

  // 设上口令，走管理员流程
  await put('/api/settings', { adminPin: '8888' });
  eq('设了口令后没 token 加不了公共菜',
    (await post('/api/dishes', { name: '偷偷加的', category: ppCat })).status, 401);
  eq('口令错拿不到 token', (await post('/api/auth', { pin: '0000' })).status, 401);
  const tokX = (await post('/api/auth', { pin: '8888' })).body.data.token;
  eq('口令对就换到 token', (tokX || '').length > 10, true);

  const hhB = (await post('/api/households', { name: 'B 家' }, tokX)).body.data.id;
  const ppDish = (await post('/api/dishes', {
    name: '公共菜', category: ppCat, duration: 20,
    seasonings: [{ name: '五花肉', amount: '600g' }],
    methods: [{ name: '红烧', steps: ['焯水', '炒糖色', '小火 50 分钟'], seasonings: [] }],
  }, tokX)).body.data;
  eq('管理员建出来的菜是共享的', ppDish.householdId, null);

  // 家里人这边：先认领身份（设 PIN 换设备令牌），再谈写自家私菜。
  // 没有身份的人什么都写不了 —— 这正是「只能改自己写的」能成立的前提。
  const meA = p0.households[0].members[0];
  ok('这个家有人可认领', !!meA, p0.households[0]);
  const claimA = await claim(hhA, meA.id, '1234');
  eq('第一次认领是设密码', claimA.status, 200);
  eq('设完就拿到设备令牌', (claimA.token || '').length > 10, true);
  const devA = claimA.token;

  const pvCat = (await post('/api/my-categories?householdId=' + hhA, { name: '我家专区' }, undefined, devA)).body.data;
  eq('家里人能建自家私有分类', pvCat.householdId, hhA);
  const mwDish = (await post('/api/my-dishes?householdId=' + hhA, { name: '我家红烧肉', category: ppCat }, undefined, devA)).body.data;
  eq('家里人能加自家私菜', mwDish.householdId, hhA);
  eq('这道菜记下了是谁加的', mwDish.authorName, meA.name);
  const mwDish2B = (await post('/api/my-dishes?householdId=' + hhA, { name: '我家腌菜', category: pvCat.name }, undefined, devA)).body.data;
  eq('私菜能放进自家私有分类', mwDish2B.householdId, hhA);
  eq('body 里写别人家 id 也不管用',
    (await post('/api/my-dishes?householdId=' + hhA, { name: '想混进别人家', category: ppCat, householdId: hhB }, undefined, devA)).body.data.householdId,
    hhA);
  eq('不说改哪一家会被挡住', (await post('/api/my-dishes', {})).status, 400);
  eq('不存在的家庭会被挡住', (await post('/api/my-dishes?householdId=h_没有', { name: 'x' })).status, 400);
  eq('没认领身份的人连自己家的私菜都加不了',
    (await post('/api/my-dishes?householdId=' + hhA, { name: '匿名加的', category: ppCat })).status, 403);

  // 公共菜谱：非管理员改不动
  const editPub = await put('/api/my-dishes/' + ppDish.id + '?householdId=' + hhA, { name: '公共菜被改了' }, undefined, devA);
  eq('非管理员改不了公共菜谱', editPub.status, 403);
  ok('报错告诉人家可以「收进我家」', /收进我家/.test(editPub.body.error || ''), editPub.body);
  eq('非管理员删不了公共菜谱', (await del('/api/my-dishes/' + ppDish.id + '?householdId=' + hhA, undefined, devA)).status, 403);
  const batch = await del('/api/my-dishes?householdId=' + hhA + '&ids=' + mwDish.id + ',' + ppDish.id, undefined, devA);
  eq('批量删时公共菜被跳过', batch.body.data.removed, 1);
  eq('批量删如实回报跳过了几条', batch.body.data.kept, 1);
  eq('公共菜真的还在', !!(await get('/api/state')).body.data.dishes.find((d) => d.id === ppDish.id), true);
  const ppCatId = (await get('/api/state')).body.data.categories[0].id;
  eq('非管理员改不了公共分类',
    (await put('/api/my-categories/' + ppCatId + '?householdId=' + hhA, { name: '改名字' }, undefined, devA)).status, 403);
  eq('非管理员删不了公共分类',
    (await del('/api/my-categories/' + ppCatId + '?householdId=' + hhA, undefined, devA)).status, 403);

  // 别人家的私菜：碰不到。用超管身份造出来 —— 他能给任何一家建菜，
  // 正好当越权测试的靶子
  const bCatX = (await post('/api/my-categories?householdId=' + hhB, { name: 'B 家专区' }, tokX)).body.data;
  const bDishX = (await post('/api/my-dishes?householdId=' + hhB, { name: 'B 家私菜', category: bCatX.name }, tokX)).body.data;
  ok('超管能给别家建私菜（当靶子用）', !!bDishX && bDishX.householdId === hhB, bDishX);
  eq('碰不到别人家的私菜',
    (await put('/api/my-dishes/' + bDishX.id + '?householdId=' + hhA, { name: '偷改' }, undefined, devA)).status, 403);
  eq('B 家私菜没被改',
    (await get('/api/state', tokX)).body.data.dishes.find((d) => d.id === bDishX.id).name, 'B 家私菜');

  // 收进我家：公共菜谱上普通人唯一的正当途径
  const adopted = await post('/api/my-dishes/' + ppDish.id + '/adopt?householdId=' + hhA, {}, undefined, devA);
  eq('收进我家成功', adopted.status, 200);
  eq('抄出来的是自家私菜', adopted.body.data.householdId, hhA);
  eq('菜名原样保留', adopted.body.data.name, '公共菜');
  ok('抄出来是新的一条', adopted.body.data.id !== ppDish.id, adopted.body.data.id);
  eq('做法也带过来了', (adopted.body.data.methods || []).length > 0, true);
  eq('公共那份纹丝未动',
    (await get('/api/state')).body.data.dishes.find((d) => d.id === ppDish.id).householdId, null);
  eq('收进来的菜可以随便改',
    (await put('/api/my-dishes/' + adopted.body.data.id + '?householdId=' + hhA, { name: '我家的红烧肉' }, undefined, devA)).status, 200);
  eq('换个身份就改不动它了',
    (await put('/api/my-dishes/' + adopted.body.data.id + '?householdId=' + hhA, { name: '冒充改' })).status, 403);

  // 管理员：什么都能动
  eq('解锁后能加公共菜',
    (await post('/api/dishes', { name: '管理员加的公共菜', category: ppCat }, tokX)).status, 200);
  eq('解锁后能改公共菜', (await put('/api/dishes/' + ppDish.id, { name: '管理员改的公共菜' }, tokX)).status, 200);
  eq('管理员也能碰别人家的私菜',
    (await put('/api/dishes/' + bDishX.id, { name: '管理员改的 B 家菜' }, tokX)).status, 200);

  // 自家私有分类：只挪自家的菜
  eq('公共菜进不了私有分类（管理员也一样）',
    (await post('/api/dishes', { name: '公共菜乙', category: pvCat.name }, tokX)).status, 400);
  eq('非管理员的菜也进不了别人家私有分类',
    (await post('/api/my-dishes?householdId=' + hhA, { name: 'X', category: bCatX.name }, undefined, devA)).status, 400);
  await del('/api/my-categories/' + pvCat.id + '?householdId=' + hhA, undefined, devA);
  const after = (await get('/api/state')).body.data;
  eq('删自家私有分类，本家的私菜挪到「其他」',
    after.dishes.find((d) => d.id === mwDish2B.id).category, '其他');
  eq('公共菜一点没动', after.dishes.find((d) => d.id === ppDish.id).category, ppCat);

  // ---- 普通用户状态范围与做饭状态 ----
  const joinReq = await post('/api/join-requests', {
    name: '申请人',
    householdId: hhB,
    note: '测试申请',
  });
  eq('加入申请普通用户可以提交', joinReq.status, 200);
  const scoped = (await get(`/api/state?householdId=${encodeURIComponent(hhA)}&memberName=申请人`)).body.data;
  ok('普通用户状态带 access', scoped.access && Array.isArray(scoped.access.requests), scoped.access);
  eq('普通用户看不到别家私菜', scoped.dishes.some((d) => d.id === bDishX.id), false);
  eq('普通用户看不到别家点餐', scoped.orders.some((o) => o.householdId === hhB), false);
  eq('普通用户能看到自己的申请', scoped.access.requests.some((r) => r.id === joinReq.body.data.id), true);
  const full = (await get('/api/state', tokX)).body.data;
  eq('管理员状态能看到别家私菜', full.dishes.some((d) => d.id === bDishX.id), true);
  const cookingOrder = (await post('/api/orders', {
    householdId: hhA,
    dishName: '管理员状态测试菜',
    requester: '申请人',
  })).body.data;
  eq('普通用户仍能提交点餐', cookingOrder && cookingOrder.id ? 200 : 500, 200);
  eq('普通用户不能开做',
    (await req('PATCH', `/api/orders/${cookingOrder.id}`, { status: 'cooking' })).status, 401);
  eq('普通用户不能删除点餐', (await del(`/api/orders/${cookingOrder.id}`)).status, 401);
  eq('管理员能开做',
    (await req('PATCH', `/api/orders/${cookingOrder.id}`, { status: 'cooking' }, tokX)).status, 200);
  eq('管理员能删除点餐', (await del(`/api/orders/${cookingOrder.id}`, tokX)).status, 200);

  await stop(permInst);

  /* ---------- 申请加入家庭 ---------- */
  console.log('\n[23] 申请加入家庭');
  const joinInst = await boot('joinInst');
  const j0 = (await get('/api/state')).body.data;
  const jHome = j0.households[0].id;
  const jCat = j0.categories[0].name;
  eq('没申请这回事之前是空的', (j0.access && j0.access.requests) || [], []);

  const jTok0 = (await post('/api/auth', { pin: '' })).body.data;
  eq('没口令时人人都是管理员', jTok0.hasPin, false);
  const jB = (await post('/api/households', { name: '奶奶家' })).body.data;

  // 提交申请：谁都能做（人总得有个申请入口）
  const req1 = await post('/api/join-requests', { name: '姑姑', householdId: jB.id, note: '我来做饭' });
  eq('申请提交成功', req1.status, 200);
  eq('申请记下申请人了', req1.body.data.name, '姑姑');
  eq('申请记下目标家庭', req1.body.data.householdId, jB.id);
  eq('新申请是待处理', req1.body.data.status, 'pending');
  eq('不写名字会被拒', (await post('/api/join-requests', { householdId: jB.id })).status, 400);
  eq('申请不存在的家庭会被拒',
    (await post('/api/join-requests', { name: 'x', householdId: 'h_没有' })).status, 404);
  eq('已经是成员的不用再申请',
    (await post('/api/join-requests', { name: (j0.households[0].members[0] || {}).name || '我', householdId: jHome })).status, 409);

  // 重复申请只留一条，不刷屏
  await post('/api/join-requests', { name: '姑姑', householdId: jB.id, note: '再问一次' });
  eq('同一个人同一家只留一条申请',
    (await get('/api/state')).body.data.access.requests.filter((r) => r.name === '姑姑').length, 1);

  // 设上口令：批准/拒绝就必须是管理员的活了
  await put('/api/settings', { adminPin: '4321' });
  const jTok = (await post('/api/auth', { pin: '4321' })).body.data.token;
  eq('没 token 批不了', (await put('/api/join-requests/' + req1.body.data.id, { status: 'ok' })).status, 401);
  eq('没 token 删不了', (await del('/api/join-requests/' + req1.body.data.id)).status, 401);

  const jBefore = (await get('/api/state')).body.data.households.find((h) => h.id === jB.id);
  eq('批之前还不是成员', jBefore.members.some((m) => m.name === '姑姑'), false);

  const jOkRes = await put('/api/join-requests/' + req1.body.data.id, { status: 'ok' }, jTok);
  eq('批准成功', jOkRes.status, 200);
  eq('状态变成已批准', jOkRes.body.data.status, 'ok');
  const jAfterx = (await get('/api/state')).body.data.households.find((h) => h.id === jB.id);
  eq('批准 = 真的把人加进这个家', jAfterx.members.some((m) => m.name === '姑姑'), true);
  ok('成员有名字也有头像', !!jAfterx.members.find((m) => m.name === '姑姑').emoji, jAfterx.members);

  // 拒绝
  const req2r = await post('/api/join-requests', { name: '不熟的人', householdId: jB.id });
  eq('设了口令后普通人照样能申请', req2r.status, 200);
  const req2 = req2r;
  await put('/api/join-requests/' + req2.body.data.id, { status: 'no' }, jTok);
  eq('拒绝了也不会加进去',
    (await get('/api/state')).body.data.households.find((h) => h.id === jB.id).members.some((m) => m.name === '不熟的人'),
    false);
  // 设了口令后，非管理员只看得到自己那条 —— 前端靠 memberName 认人
  const ownReqs = (await get('/api/state?memberName=' + encodeURIComponent('不熟的人')))
    .body.data.access.requests;
  const rejReq = ownReqs.find((r) => r.id === req2.body.data.id);
  ok('申请人看得到自己被拒的结果', !!rejReq, { sent: req2.body, own: ownReqs });
  eq('拒绝的申请还留着（看得到结果）', rejReq && rejReq.status, 'no');
  eq('别人的申请看不见', ownReqs.some((r) => r.name === '姑姑'), false);
  const allReqs = (await get('/api/state', jTok)).body.data.access.requests;
  ok('管理员看得到全部申请', !!allReqs.find((r) => r.id === req2.body.data.id), allReqs);

  // 改家庭会加进去，别把人加错地方
  const req3 = await post('/api/join-requests', { name: '姑父', householdId: jHome });
  await put('/api/join-requests/' + req3.body.data.id, { status: 'ok' }, jTok);
  eq('批进了对的那个家',
    (await get('/api/state')).body.data.households.find((h) => h.id === jHome).members.some((m) => m.name === '姑父'),
    true);

  // 备份带上申请
  await post('/api/join-requests', { name: '要进备份的', householdId: jB.id });
  const jSnap = (await post('/api/backups', {}, jTok)).body.data.name;
  await post('/api/join-requests', { name: '备份之后才来的', householdId: jB.id });
  // 备份里存着明文口令，所以备份这套端点一律要认证（不是只有下载）
  eq('没 token 不能存备份', (await post('/api/backups', {})).status, 401);
  const jRestore = await reqRaw('POST', '/api/backups/' + encodeURIComponent(jSnap) + '/restore', undefined, jTok);
  eq('恢复成功', jRestore.status, 200);
  const jAfter = (await get('/api/state', jTok)).body.data;
  eq('备份之后的申请被回退了', jAfter.access.requests.some((r) => r.name === '备份之后才来的'), false);
  eq('备份里的申请还在', jAfter.access.requests.some((r) => r.name === '要进备份的'), true);
  eq('已批准的申请恢复后仍是已批准',
    jAfter.access.requests.find((r) => r.name === '姑姑').status, 'ok');

  await stop(joinInst);

  /* ---------- 三层身份：超管 / 家庭管理员 / 成员 ---------- */
  console.log('\n[24] 三层身份与「记住我」');
  const triInst = await boot('triInst');
  const tr0 = (await get('/api/state')).body.data;
  const tHome = tr0.households[0].id;
  const trCat = tr0.categories[0].name;
  const tMe = tr0.households[0].members[0];

  /* --- 迁移：老数据补上角色和「还没设密码」 --- */
  eq('老成员自动升成管理员', tMe.role, 'owner');
  eq('老成员还没设密码', tMe.hasPin, false);
  ok('密码绝不下发到前端', tMe.pin === undefined, tMe);
  eq('老家庭一律算正式', tr0.households[0].status, 'approved');

  /* --- 认领身份：第一次是设密码，之后是验密码 --- */
  eq('没密码不给换令牌', (await post('/api/claim', { householdId: tHome, memberId: tMe.id, pin: '' })).status, 400);
  eq('认领不存在的成员会被挡', (await post('/api/claim', { householdId: tHome, memberId: 'm_没有', pin: '1234' })).status, 404);
  const tClaim = await claim(tHome, tMe.id, '1234');
  eq('第一次认领成功', tClaim.status, 200);
  ok('换到设备令牌', (tClaim.token || '').length > 10, tClaim.token);
  eq('换回来的成员信息里有 hasPin', tClaim.body.data.member.hasPin, true);
  ok('换回来的成员信息里没有密码明文', tClaim.body.data.member.pin === undefined, tClaim.body.data.member);
  const dev = tClaim.token;
  eq('密码不对换不到令牌', (await post('/api/claim', { householdId: tHome, memberId: tMe.id, pin: '9999' })).status, 401);
  eq('密码对就换得到', (await claim(tHome, tMe.id, '1234')).status, 200);

  /* --- 设了全局口令之后，设备令牌依然认得人 --- */
  await put('/api/settings', { adminPin: '5555' });
  const tSuper = (await post('/api/auth', { pin: '5555' })).body.data.token;
  const tDish = (await post('/api/my-dishes?householdId=' + tHome, { name: '我加的菜', category: trCat }, undefined, dev)).body.data;
  eq('带设备令牌就能加自家私菜', tDish.householdId, tHome);
  eq('菜记下了作者', tDish.authorName, tMe.name);
  eq('没令牌就连自家私菜都加不了',
    (await post('/api/my-dishes?householdId=' + tHome, { name: '匿名加的', category: trCat })).status, 403);

  /* --- 「只能改自己写的」 --- */
  const tOther = await post('/api/join-requests', { name: '另一个人', householdId: tHome });
  const tHouseAfter = (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === tHome);
  eq('另一个成员还没进来', tHouseAfter.members.length, 1);
  await put('/api/join-requests/' + tOther.body.data.id, { status: 'ok' }, tSuper);
  const tM2 = (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === tHome).members[1];
  eq('批进来的是普通成员', tM2.role, 'member');
  const dev2 = (await claim(tHome, tM2.id, '5678')).token;
  eq('新人认领得到自己的令牌', (dev2 || '').length > 10, true);

  /* --- 本家内部的「只能改自己写的」 ---
   *
   * 顺序很要紧：这家的家庭口令是在**下面**才设的。在设口令之前，
   * owner 就是本家管理员，管理员什么都能改 —— 那时候测「改不动别人的」
   * 测的不是成员规则，是管理员规则。所以这条必须放到口令之后测。
   */
  const tDish2 = (await post('/api/my-dishes?householdId=' + tHome, { name: '他加的菜', category: trCat }, undefined, dev2)).body.data;
  eq('第二个人也能加自家私菜', tDish2.householdId, tHome);
  eq('自己写的当然改得动',
    (await put('/api/my-dishes/' + tDish.id + '?householdId=' + tHome, { name: '改我自己的' }, undefined, dev)).status, 200);
  eq('没设家庭口令时 owner 能改任何人的（他就是管理员）',
    (await put('/api/my-dishes/' + tDish2.id + '?householdId=' + tHome, { name: 'owner 改的' }, undefined, dev)).status, 200);
  eq('管理员谁都能改',
    (await put('/api/my-dishes/' + tDish2.id + '?householdId=' + tHome, { name: '超管改的' }, tSuper)).status, 200);

  /* --- 家庭口令：这个家自己的管理员 --- */
  eq('没口令时 owner 天然是管理员',
    (await post('/api/dishes', { name: 'owner 加的公共菜', category: trCat }, undefined, dev)).status, 200);
  eq('普通成员加不了公共菜',
    (await post('/api/dishes', { name: '成员想加公共菜', category: trCat }, undefined, dev2)).status, 401);

  const tPin = await put('/api/households/' + tHome, { pin: '7788' }, tSuper);
  eq('设上家庭口令', tPin.status, 200);
  eq('家庭口令不下发到前端', tPin.body.data.pin === undefined, true);
  ok('只告诉前端「有没有口令」', tPin.body.data.hasPin === true, tPin.body.data);
  eq('没输家庭口令，owner 也降级了',
    (await post('/api/dishes', { name: 'owner 又想加公共菜', category: trCat }, undefined, dev)).status, 401);

  // 上了锁之后，才是「只有管理员或者自己写的」那条规则在起作用
  eq('同属一家也改不动别人的',
    (await put('/api/my-dishes/' + tDish2.id + '?householdId=' + tHome, { name: '成员偷改' }, undefined, dev)).status, 403);
  eq('普通成员也改不动别人的',
    (await put('/api/my-dishes/' + tDish.id + '?householdId=' + tHome, { name: '成员偷改' }, undefined, dev2)).status, 403);
  eq('普通成员改自己写的照样行',
    (await put('/api/my-dishes/' + tDish2.id + '?householdId=' + tHome, { name: '改我自己的' }, undefined, dev2)).status, 200);

  eq('输错家庭口令也不行', (await post('/api/households/' + tHome + '/auth', { pin: '0000' })).status, 401);
  const tHouse = await houseAuth(tHome, '7788');
  ok('输对换到家庭会话', (tHouse.token || '').length > 10, tHouse.body);
  const HH = tHouse.token;
  eq('家庭管理员能改共享菜',
    (await post('/api/dishes', { name: '家庭管理员加的', category: trCat }, undefined, undefined, HH)).status, 200);
  eq('家庭管理员能改别人的私菜',
    (await put('/api/my-dishes/' + tDish.id + '?householdId=' + tHome, { name: '家管改的' }, undefined, undefined, HH)).status, 200);
  eq('家庭会话改不了系统设置',
    (await put('/api/settings', { shopName: '改名了' }, undefined, undefined, HH)).status, 401);
  eq('家庭会话碰不到别的家的家庭口令',
    (await put('/api/households/h_别的', { name: 'x' }, undefined, undefined, HH)).status, 404);
  // 关键回归：家庭会话只能从 X-House-Token 读。塞进超管那条头不该被当成管理员，
  // 否则有人拿到 house token 就能混进系统设置的检查里。
  eq('家庭会话不能借 X-Auth-Token 冒充',
    (await post('/api/dishes', { name: '走错头的', category: trCat }, HH)).status, 401);

  /* --- 新建的家庭：账户创建后立即可用，不需要平台审批 --- */
  const tNew = (await post('/api/households', { name: '新开的家' }, tSuper)).body.data;
  eq('账户创建的家庭立即可用', tNew.status, 'approved');
  eq('新建的家庭没口令', tNew.hasPin, false);
  eq('家庭管理员不能改平台审核状态',
    (await put('/api/households/' + tNew.id, { status: 'normal' }, undefined, undefined, HH)).status, 403);
  eq('超级管理员可以改家庭状态',
    (await put('/api/households/' + tNew.id, { status: 'approved' }, tSuper)).body.data.status, 'approved');

  /* --- 申请加入：审批权在这个家的管理员，不在全局管理员以外 --- */
  const tJoin = await post('/api/join-requests', { name: '想进来的人', householdId: tHome });
  eq('申请提交成功', tJoin.status, 200);
  eq('没身份的人批不了',
    (await put('/api/join-requests/' + tJoin.body.data.id, { status: 'ok' }, undefined, dev2)).status, 401);
  eq('家庭管理员能批',
    (await put('/api/join-requests/' + tJoin.body.data.id, { status: 'ok' }, undefined, undefined, HH)).status, 200);
  const tJoined = (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === tHome);
  ok('批了真的加进成员', tJoined.members.some((m) => m.name === '想进来的人'), tJoined.members);
  eq('新人是普通成员', tJoined.members.find((m) => m.name === '想进来的人').role, 'member');

  /* --- 令牌失效：改密码 / 换口令 --- */
  const tPin2 = await put('/api/households/' + tHome, { pin: '9911' }, tSuper);
  eq('换家庭口令成功', tPin2.status, 200);
  eq('旧的家庭会话立刻作废',
    (await post('/api/dishes', { name: '用旧会话', category: trCat }, undefined, undefined, HH)).status, 401);
  eq('用新口令能换到新会话',
    (await post('/api/households/' + tHome + '/auth', { pin: '9911' })).status, 200);

  /* --- 「记住我」不能替危险动作背书 ---
   *
   * 设备令牌证明的是「这台设备以前是你」，不是「此刻可以替这个家做主」。
   * 改成员、重置密码、改家庭口令、删家庭、批申请 —— 这几样必须配一张
   * 刚刚用密码换来的凭证。
   *
   * 测这条要用一个**没设家庭口令**的家：只有这种家的 owner 才能靠设备令牌
   * 拿到管理员权限（装了就能用的老规矩），也才有机会撞上 canDoSensitive
   * 这道门。已经在上面测过的「设了口令的家」走不到这一步 —— 那儿
   * 连统一守卫都过不去，测到的不是同一件事。
   */
  const tFresh = (await post('/api/households', { name: '没口令的家' }, tSuper)).body.data;
  const tFreshPin = await put('/api/households/' + tHome + '/member-pin', { memberId: tM2.id, pin: '4321' }, tSuper);
  eq('给普通成员设了密码', tFreshPin.status, 200);
  const devFresh = (await claim(tHome, tM2.id, '4321')).token;
  ok('拿到新令牌', (devFresh || '').length > 10, devFresh);
  void tFresh;

  // 成员一旦设了密码，「owner 没设密码 → 放行」那条豁免就不成立了。
  // owner 自己也设一个，逼它落到必须验密码的那一档。
  const tMembers0 = (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === tHome).members;
  const tOwner0 = tMembers0.find((m) => m.role === 'owner');
  eq('owner 设密码成功',
    (await put('/api/households/' + tHome + '/member-pin', { memberId: tOwner0.id, pin: '2468' }, tSuper)).status, 200);
  // 先把家庭口令撤掉，让 owner 重新拿回「没设口令的 owner = 管理员」的身份
  eq('撤掉家庭口令', (await put('/api/households/' + tHome, { clearPin: true }, tSuper)).status, 200);
  const devOwner = (await claim(tHome, tOwner0.id, '2468')).token;

  // 先确认前提成立：owner 靠设备令牌确实能改共享菜（统一守卫放行）
  eq('没口令时 owner 靠设备令牌就能加共享菜',
    (await post('/api/dishes', { name: '危险动作体检', category: trCat }, undefined, devOwner)).status, 200);

  // 现在危险动作就该被挡住了 —— 能管菜单，但动不了「谁是谁」
  eq('改名字这种日常维护不用拦',
    (await put('/api/households/' + tHome, { name: '我家（改名了）' }, undefined, devOwner)).status, 200);
  eq('光靠设备令牌改不了成员名单',
    (await put('/api/households/' + tHome,
      { members: tMembers0.map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, role: m.role })) },
      undefined, devOwner)).status, 403);
  eq('光靠设备令牌改不了家庭口令',
    (await put('/api/households/' + tHome, { pin: '0000' }, undefined, devOwner)).status, 403);
  eq('光靠设备令牌不能升成正式家庭',
    (await put('/api/households/' + tHome, { status: 'approved' }, undefined, devOwner)).status, 403);

  const tJoin2 = await post('/api/join-requests', { name: '新来的那个人', householdId: tHome });
  eq('申请提交成功', tJoin2.status, 200, tJoin2.body);
  eq('光靠设备令牌批不了申请',
    (await put('/api/join-requests/' + tJoin2.body.data.id, { status: 'ok' }, undefined, devOwner)).status, 403);

  /* --- 5 分钟凭证：验一次密码就够，够用但不能转手 --- */
  eq('没验过密码就要不到凭证', (await post('/api/verify-pin', { householdId: tHome, memberId: tOwner0.id, pin: '0000' })).status, 401);
  const tVer = await post('/api/verify-pin', { householdId: tHome, memberId: tOwner0.id, pin: '2468' });
  eq('验对密码换到凭证', tVer.status, 200);
  const VT = tVer.body.data.verifiedToken;
  ok('凭证是非空串', typeof VT === 'string' && VT.length > 10, VT);

  // 带凭证改成员：只改一个，别把别人悄悄抹掉
  const listNow = () => get('/api/state', tSuper).then((r) =>
    r.body.data.households.find((h) => h.id === tHome).members
      .map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, role: m.role }))
  );
  eq('带上凭证就改得了',
    (await put('/api/households/' + tHome,
      { members: (await listNow()).map((m) => (m.id === tOwner0.id ? { ...m, name: '正式改名' } : m)) },
      undefined, devOwner, undefined, VT)).status, 200);
  eq('改的确实是那一个成员',
    (await get('/api/state', tSuper)).body.data.households
      .find((h) => h.id === tHome).members.find((m) => m.id === tOwner0.id).name, '正式改名');
  eq('别人一个没少', (await get('/api/state', tSuper)).body.data.households
    .find((h) => h.id === tHome).members.length, tMembers0.length);

  // 凭证只对验的那个家有效，不能拿去动别家
  eq('凭证只能用于验的那个家',
    (await put('/api/households/' + tNew.id, { note: '越权' }, undefined, devOwner, undefined, VT)).status, 403);
  eq('凭证混进 X-Auth-Token 不算数',
    (await put('/api/households/' + tHome, { members: await listNow() }, VT)).status, 403);
  eq('凭证混进 X-House-Token 不算数',
    (await put('/api/households/' + tHome, { members: await listNow() }, undefined, devOwner, VT)).status, 403);

  /* --- 只改名字图标这种日常维护，不该被拦 --- */
  eq('改名字图标不用二次验证',
    (await put('/api/households/' + tHome, { name: '我家（改名了）' }, undefined, devOwner)).status, 200);

  /* --- 家庭管理员碰不到别家 --- */
  const HH2 = (await houseAuth(tHome, '')).token;
  ok('没口令时也能换到这个家的会话', (HH2 || '').length > 10, HH2.body);
  eq('A 家管理员改不了 B 家的名字',
    (await put('/api/households/' + tNew.id, { note: '越权' }, undefined, undefined, HH2)).status, 403);

  /* --- 成员被删了，他的设备令牌一并作废 --- */
  await put('/api/join-requests/' + tJoin2.body.data.id, { status: 'ok' }, undefined, devOwner, undefined, VT);
  const tNewM = (await get('/api/state', tSuper)).body.data.households
    .find((h) => h.id === tHome).members.find((m) => m.name === '想进来的人');
  const devNewM = (await claim(tHome, tNewM.id, '5678')).token;
  eq('新人令牌能加自家私菜',
    (await post('/api/my-dishes?householdId=' + tHome, { name: '新人的菜', category: trCat }, undefined, devNewM)).status, 200);
  await put('/api/households/' + tHome,
    { members: (await listNow()).filter((m) => m.id !== tNewM.id) },
    undefined, devOwner, undefined, VT);
  eq('新人确实从名单里没了', (await get('/api/state', tSuper)).body.data.households
    .find((h) => h.id === tHome).members.some((m) => m.id === tNewM.id), false);
  eq('被删成员的令牌立刻失效（连自己家私菜都加不了）',
    (await post('/api/my-dishes?householdId=' + tHome, { name: '还想加', category: trCat }, undefined, devNewM)).status, 403);

  /* ---------- 文本登录 ID + 多个家庭管理员 ---------- */
  console.log('\n[25] 文本登录 ID 与多个家庭管理员');
  const t25 = (await post('/api/households', {
    name: '多管理员测试家',
    members: [
      { name: '大管家', role: 'owner', loginId: '厨房大管家' },
      { name: '小管家', role: 'member', loginId: '二号管家' },
    ],
  }, tSuper)).body.data;
  const t25Before = (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === t25.id);
  const t25A = t25Before.members.find((m) => m.name === '大管家');
  const t25B = t25Before.members.find((m) => m.name === '小管家');
  eq('家庭成员保留汉字登录 ID', t25A.loginId, '厨房大管家');
  eq('第二个成员保留字母可扩展的 ID', t25B.loginId, '二号管家');

  const t25ASet = await put('/api/households/' + t25.id + '/member-password', {
    memberId: t25A.id,
    loginId: '厨房大管家',
    password: '炒菜大师',
  }, tSuper);
  eq('设置汉字登录 ID 和非数字密码', t25ASet.status, 200);
  eq('成员密码响应不回传明文', t25ASet.body.data.password, undefined);
  eq('成员密码响应有 hasPassword', t25ASet.body.data.hasPassword, true);

  const t25BSet = await put('/api/households/' + t25.id + '/member-password', {
    memberId: t25B.id,
    loginId: '二号管家',
    password: 'Cook汉字A',
  }, tSuper);
  eq('第二个管理员也能设置文本密码', t25BSet.status, 200);
  const t25BadPassword = await put('/api/households/' + t25.id + '/member-password', {
    memberId: t25B.id,
    loginId: '不该保存的 ID',
    password: '短',
  }, tSuper);
  eq('非法密码被拒', t25BadPassword.status, 400);
  eq('非法密码不会半途改掉登录 ID',
    (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === t25.id)
      .members.find((m) => m.id === t25B.id).loginId,
    '二号管家');

  const t25Promote = await put('/api/households/' + t25.id, {
    members: [
      { id: t25A.id, name: '大管家', emoji: t25A.emoji, role: 'owner', loginId: '厨房大管家' },
      { id: t25B.id, name: '小管家', emoji: t25B.emoji, role: 'owner', loginId: '二号管家' },
    ],
  }, tSuper);
  eq('同一家庭可以有两个管理员', t25Promote.status, 200);
  const t25AfterPromote = (await get('/api/state', tSuper)).body.data.households.find((h) => h.id === t25.id);
  eq('第二个成员角色变成管理员', t25AfterPromote.members.find((m) => m.id === t25B.id).role, 'owner');

  const t25DevA = await claimByLoginId(t25.id, '厨房大管家', '炒菜大师');
  eq('汉字登录 ID + 汉字密码可以认领', t25DevA.status, 200);
  ok('第一个管理员拿到设备令牌', (t25DevA.token || '').length > 10, t25DevA.token);
  const t25DevB = await claimByLoginId(t25.id, '二号管家', 'Cook汉字A');
  eq('第二个管理员也能独立认领', t25DevB.status, 200);
  ok('第二个管理员拿到设备令牌', (t25DevB.token || '').length > 10, t25DevB.token);
  eq('错误文本密码被拒', (await claimByLoginId(t25.id, '二号管家', '不是密码')).status, 401);

  eq('第一个管理员能管理共享菜单',
    (await post('/api/dishes', { name: '大管家加菜', category: trCat }, undefined, t25DevA.token)).status, 200);
  eq('第二个管理员也能管理共享菜单',
    (await post('/api/dishes', { name: '小管家加菜', category: trCat }, undefined, t25DevB.token)).status, 200);

  const t25NoOwners = t25AfterPromote.members.map((m) => ({
    id: m.id, name: m.name, emoji: m.emoji, role: 'member', loginId: m.loginId,
  }));
  eq('不能撤掉最后一名管理员',
    (await put('/api/households/' + t25.id, { members: t25NoOwners }, tSuper)).status, 400);

  await stop(triInst);

  /* ---------- 全局账户跨家庭与 5 户上限 ---------- */
  console.log('\n[26] 全局账户跨家庭与家庭上限');
  const accountInst = await boot('account-flow');
  const accA = await registerAccount('跨家庭用户');
  eq('账户流程注册成功', accA.status, 200);
  const created = [];
  for (let i = 1; i <= 5; i++) {
    const r = await req('POST', '/api/households', { name: `账户家${i}` }, undefined, undefined, undefined, undefined, accA.token);
    eq(`账户创建第 ${i} 个家庭`, r.status, 200);
    created.push(r.body.data);
  }
  eq('第六个家庭被 5 户上限拒绝',
    (await req('POST', '/api/households', { name: '账户家6' }, undefined, undefined, undefined, undefined, accA.token)).status,
    409);
  const privateDish = await req('POST', `/api/my-dishes?householdId=${encodeURIComponent(created[0].id)}`, {
    name: '账户私菜', category: '家常菜',
  }, undefined, undefined, undefined, undefined, accA.token);
  eq('账户管理员可以新增本家私菜', privateDish.status, 200);
  const accB = await registerAccount('申请加入用户');
  const bBefore = await req('GET', `/api/state?householdId=${encodeURIComponent(created[0].id)}`, undefined, undefined, undefined, undefined, undefined, accB.token);
  eq('未加入账号看不到目标家庭私菜', bBefore.status, 200);
  ok('未加入账号状态不含目标私菜', !(bBefore.body.data.dishes || []).some((d) => d.name === '账户私菜'));
  const join = await req('POST', '/api/join-requests', { householdId: created[0].id, name: '申请加入用户' }, undefined, undefined, undefined, undefined, accB.token);
  eq('账户申请加入家庭成功', join.status, 200);
  const approved = await req('PUT', `/api/join-requests/${join.body.data.id}`, { status: 'ok' }, undefined, undefined, undefined, undefined, accA.token);
  eq('家庭管理员批准账户申请', approved.status, 200);
  const bMe = await req('GET', '/api/account/me', undefined, undefined, undefined, undefined, undefined, accB.token);
  ok('批准后账户关系可见', (bMe.body.data.households || []).some((h) => h.id === created[0].id));
  await stop(accountInst);

  /* ---------- 收尾 ---------- */
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });

  console.log(`\n${'─'.repeat(46)}`);
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('\n失败明细：');
    for (const f of failures) console.log('  · ' + f);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\n自检崩了：', err);
  try {
    fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
