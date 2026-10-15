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

async function req(method, p, body, token) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  if (token) opt.headers['X-Auth-Token'] = token;
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

const get = (p, t) => req('GET', p, undefined, t);
const post = (p, b, t) => req('POST', p, b === undefined ? {} : b, t);
const put = (p, b, t) => req('PUT', p, b, t);
const del = (p, t) => req('DELETE', p, undefined, t);

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
  return child;
}

/* ================================================================ */

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
  fs.mkdirSync(TMP, { recursive: true });

  let child = await boot('main');

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
  const backup = await (await fetch(BASE + '/api/export')).text();
  const parsed = JSON.parse(backup);
  ok('备份含 households', Array.isArray(parsed.households), typeof parsed.households);
  ok('备份含 pantry', Array.isArray(parsed.pantry), typeof parsed.pantry);
  ok('备份含 plans', Array.isArray(parsed.plans), typeof parsed.plans);

  const hh = (await post('/api/households', { name: '临时户' })).body.data;
  await post('/api/pantry', { householdId: hh.id, name: '临时菜', category: '蔬菜', quantity: 3, unit: '把' });
  eq('导入前多了一户', (await get('/api/state')).body.data.households.length, 2);

  await post('/api/import', JSON.parse(backup));
  st = (await get('/api/state')).body.data;
  eq('导入后家庭数恢复', st.households.length, before.households.length);
  eq('导入后库存恢复', st.pantry.length, before.pantry.length);
  eq('导入后库存内容一致', st.pantry.map((p) => [p.name, p.quantity]), before.pantry.map((p) => [p.name, p.quantity]));
  eq('导入后计划恢复', st.plans.length, before.plans.length);

  // 备份里带了已删除的家庭 id 时，点餐要拉回有效家庭，不能悬空
  const orphan = JSON.parse(backup);
  orphan.orders = [{ id: 'o_orphan', dishName: '测试菜', householdId: 'h_不存在', people: 2, status: 'pending', date: '2024-01-01', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  await post('/api/import', orphan);
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

  // state 里也绝不能有明文
  const stLocked = (await get('/api/state')).body.data;
  ok('state 不下发口令明文', !('adminPin' in stLocked.settings), Object.keys(stLocked.settings));
  eq('state 只告诉前端有没有锁', stLocked.settings.hasPin, true);
  ok('整个 state 里搜不到口令值', JSON.stringify(stLocked).indexOf('2468') === -1, '泄漏');

  // 没 token 的写操作要被拒
  eq('没 token 改菜谱 401', (await post('/api/dishes', { name: '偷偷加的', category: '其他' })).status, 401);
  eq('没 token 删家庭 401', (await del(`/api/households/${h301.id}`)).status, 401);
  eq('没 token 改设置 401', (await put('/api/settings', { shopName: '被改了' })).status, 401);
  eq('没 token 导出 401', (await get('/api/export')).status, 401);
  eq('没 token 导入 401', (await post('/api/import', { dishes: [] })).status, 401);
  const afterFail = (await get('/api/state')).body.data;
  eq('被拒的操作没真的生效', afterFail.settings.shopName, stLocked.settings.shopName);
  eq('被拒的加菜没进菜单', afterFail.dishes.length, stLocked.dishes.length);
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

  await stop(ai);
  await new Promise((r) => mock.close(r));

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
