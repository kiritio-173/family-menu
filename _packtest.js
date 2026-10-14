'use strict';

/** 冷启动打包产物：解压 ZIP 到临时目录，用内置 runtime 跑起来，验证多家庭 + 库存链路 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = __dirname;
const ZIP = path.join(ROOT, 'package', '家庭菜单-便携版.zip');
const TMP = path.join(os.tmpdir(), 'fm-pack-' + Date.now());
const PORT = 8901;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [!!] ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n解压 ' + path.basename(ZIP) + ' …');
  fs.mkdirSync(TMP, { recursive: true });
  const r = spawnSync(
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
    ['-xf', ZIP, '-C', TMP],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) throw new Error('解压失败');

  const APP = path.join(TMP, '家庭菜单-便携版');
  const NODE = path.join(APP, 'runtime', 'node.exe');
  ok('包内有自带 runtime/node.exe', fs.existsSync(NODE));
  ok('没有分发 orders.json', !fs.existsSync(path.join(APP, 'data', 'orders.json')));
  ok('没有分发 pantry.json', !fs.existsSync(path.join(APP, 'data', 'pantry.json')));
  ok('分发了 households.json', fs.existsSync(path.join(APP, 'data', 'households.json')));
  ok('分发了 4 个启动文件',
    ['启动家庭菜单.bat', '安装到电脑.bat', '使用说明.txt', '创建快捷方式.ps1'].every((f) =>
      fs.existsSync(path.join(APP, f))
    )
  );

  console.log('\n用包内 runtime 冷启动 …');
  const child = spawn(NODE, ['server.js'], {
    cwd: APP,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const BASE = 'http://127.0.0.1:' + PORT;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(BASE + '/api/state')).ok; } catch (_) { await sleep(150); }
  }
  ok('服务起来了', up);
  if (!up) throw new Error('启动失败');

  const api = async (m, p, b) => {
    const o = { method: m, headers: {} };
    if (b !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); }
    const res = await fetch(BASE + p, o);
    return { status: res.status, body: JSON.parse(await res.text()) };
  };

  let st = (await api('GET', '/api/state')).body.data;
  ok('首页能拿到菜谱', st.dishes.length === 5, st.dishes.length);
  ok('默认带 1 个家庭', st.households.length === 1, st.households);
  ok('默认家庭成员还在', st.households[0].members[0].name === '我', st.households[0].members);
  ok('库存初始为空', st.pantry.length === 0);
  ok('页面文件都在', (await fetch(BASE + '/')).status === 200 && (await fetch(BASE + '/app.js')).status === 200);

  const pre = (await api('GET', '/api/ingredient-presets')).body.data;
  ok('食材预设在包里也可用', pre.presets.length === 148, pre.presets.length);

  console.log('\n跑一遍多家庭 + 库存 …');
  const h = (await api('POST', '/api/households', { name: '301' })).body.data;
  ok('加第二个家庭', !!h.id, h);
  await api('POST', '/api/orders', { dishName: '番茄炒蛋', householdId: h.id });
  await api('POST', '/api/pantry', { householdId: h.id, name: '鸡蛋', category: '蛋类', quantity: 10, unit: '个' });
  await api('POST', '/api/pantry', { householdId: h.id, name: '过期货', category: '蔬菜', expireAt: '2020-01-01' });
  st = (await api('GET', '/api/state')).body.data;
  ok('点餐按家庭分开', st.orders.filter((o) => o.householdId === h.id).length === 1);
  ok('库存按家庭分开', st.pantry.filter((p) => p.householdId === h.id).length === 2);
  ok('另一家没受影响', st.orders.filter((o) => o.householdId !== h.id).length === 0);
  const sum = (await api('GET', '/api/summary')).body.data;
  ok('汇总接口认当前家庭', typeof sum.expiredCount === 'number', sum);

  // 数据要真的落在解压目录里
  await sleep(400);
  const onDisk = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'households.json'), 'utf8'));
  ok('households.json 落盘', onDisk.length === 2, onDisk.length);
  const pantryOnDisk = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'pantry.json'), 'utf8'));
  ok('pantry.json 落盘', pantryOnDisk.length === 2, pantryOnDisk.length);

  child.kill();
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    try { process.kill(child.pid, 0); } catch (_) { break; }
  }
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });

  console.log('\n' + '─'.repeat(46));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('冷启动验证失败：', e.message);
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 }); } catch (_) {}
  process.exit(1);
});