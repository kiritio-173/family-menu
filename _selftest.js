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

/**
 * 发原始字节并把响应也按字节拿回来。
 * 备份是 zip 本体，既不能 JSON.stringify 也不能按 text 读（读一次就没了）。
 */
async function reqRaw(method, p, buf, token) {
  const opt = { method, headers: {} };
  if (buf !== undefined) {
    opt.headers['Content-Type'] = 'application/octet-stream';
    opt.body = buf;
  }
  if (token) opt.headers['X-Auth-Token'] = token;
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
      // 对话助手：现在要的是 {reply, actions}，而且 actions 必须是能落库的结构
      if (body.includes('【当前页面】')) {
        if (body.includes('【用户问】把红烧肉加到菜单')) {
          return rs.end(JSON.stringify({
            model: 'MiniMax-M3',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content:
                    '```json\n{"reply":"给你记上这道红烧肉。",' +
                    '"actions":[{"type":"add_dish","data":{' +
                    '"name":"红烧肉","category":"家常菜","description":"肥而不腻，配饭一绝",' +
                    '"servings":"3 人份","duration":90,"difficulty":"中等","tags":["下饭"],' +
                    '"seasonings":[{"name":"五花肉","amount":"600g"},{"name":"冰糖","amount":"20g"}],' +
                    '"methods":[{"name":"红烧","steps":["焯水","炒糖色","小火 50 分钟"],' +
                    '"seasonings":[{"name":"八角","amount":"2 个"}]}]}}]}\n```',
                },
              },
            ],
            usage: { total_tokens: 88 },
          }));
        }
        if (body.includes('【用户问】宫保鸡丁减盐怎么做')) {
          return rs.end(JSON.stringify({
            model: 'MiniMax-M3',
            choices: [
              {
                message: {
                  role: 'assistant',
                  // 故意不给 JSON：验证降级路径不会把这一轮整句话吞掉
                  content: '1. 少放半勺盐就行。\n2. 出锅前尝一下咸淡。',
                },
              },
            ],
            usage: { total_tokens: 40 },
          }));
        }
        return rs.end(JSON.stringify({
          model: 'MiniMax-M3',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"reply":"今晚做个宫保鸡丁吧，菜单里有这道。","actions":[]}',
              },
            },
          ],
          usage: { total_tokens: 30 },
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

  // 对话助手：回 {reply, actions}，actions 要能直接拿去落库
  const chat = await post('/api/ai/chat', {
    task: 'assistant-chat',
    prompt: '【当前页面】点餐单\n【用户问】今晚吃什么',
    history: [
      { role: 'user', text: '晚上做什么好' },
      { role: 'assistant', text: '做个宫保鸡丁吧' },
    ],
  });
  ok('对话助手调用成功', chat.body.data.ok === true, chat.body.data);
  ok('有 reply 字段', typeof chat.body.data.result.reply === 'string', chat.body.data.result);
  ok('纯问答不带动作', Array.isArray(chat.body.data.result.actions) && chat.body.data.result.actions.length === 0, chat.body.data.result);

  const act = await post('/api/ai/chat', {
    task: 'assistant-chat',
    prompt: '【当前页面】菜单\n【用户问】把红烧肉加到菜单',
  });
  ok('动手请求调用成功', act.body.data.ok === true, act.body.data);
  eq('回了一条可执行动作', act.body.data.result.actions.length, 1);
  eq('动作类型认得', act.body.data.result.actions[0].type, 'add_dish');
  eq('动作里带上了菜名', act.body.data.result.actions[0].data.name, '红烧肉');
  eq('动作里的耗时是数字', act.body.data.result.actions[0].data.duration, 90);
  eq(
    '动作里各层调料都在',
    act.body.data.result.actions[0].data.seasonings.length + '/' +
      act.body.data.result.actions[0].data.methods[0].seasonings.length,
    '2/1'
  );

  // 模型偶尔不包 JSON 时，不能让这一轮整句话没回应
  const fb = await post('/api/ai/chat', {
    task: 'assistant-chat',
    prompt: '【当前页面】点餐单\n【用户问】宫保鸡丁减盐怎么做',
  });
  ok('AI 没包好 JSON 也不报错', fb.body.data.ok === true, fb.body.data);
  ok('降级时原文当回复', String(fb.body.data.result.reply).indexOf('少放半勺盐') > 0, fb.body.data.result);
  ok('降级时没有动作', fb.body.data.result.actions.length === 0, fb.body.data.result);

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
