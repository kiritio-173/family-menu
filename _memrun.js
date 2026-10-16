'use strict';
/**
 * 端到端内存实测：起一份真的服务实例，往 uploads/ 里塞一堆照片，
 * 然后走真的备份/导出接口，看进程 RSS 峰值。
 *
 * 这比 _memtest.js 更可信：_memtest 量的是 zip 打包函数本身，
 * 这里量的是「HTTP 请求 → 读照片 → 打包 → 写盘」整条链路。
 *
 *   node _memrun.js [照片数] [单张MB] [--old]
 *
 * --old 会临时把 zipWriteTo 换回全内存的老写法，用来对比。
 * 不带参数跑新写法。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const TMP = path.join(os.tmpdir(), 'family-menu-memrun-' + Date.now());
const PORT = 8907;
const PHOTOS = Number(process.argv[2] || 60);
const EACH_MB = Number(process.argv[3] || 2);
const USE_OLD = process.argv.includes('--old');
const mb = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rssMB(pid) {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WS`],
    { encoding: 'utf8' }
  );
  const bytes = parseInt(String(r.stdout).trim(), 10);
  // WS 返回的是字节
  return Number.isFinite(bytes) ? Math.round(bytes / 1024 / 1024) : 0;
}

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, size: buf.length, body: buf.toString('utf8').slice(0, 400) });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** 下载到文件而不是攒在内存里 —— 客户端也得守法 */
function download(p, dest) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('导出 HTTP ' + res.statusCode));
      }
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
      });
      res.on('end', () => resolve(n));
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
  fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'uploads'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(TMP, 'server.js'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
  copyDir(path.join(ROOT, 'public'), path.join(TMP, 'public'));

  if (USE_OLD) {
    // 把 zipWriteTo 换回老写法：全读进内存 + Buffer.concat
    const p = path.join(TMP, 'server.js');
    let src = fs.readFileSync(p, 'utf8');
    const i = src.indexOf('function zipWriteTo(entries, write) {');
    const j = src.indexOf('\n/**\n * 一次性打包成 Buffer');
    if (i < 0 || j < 0) throw new Error('没找到 zipWriteTo，换不了');
    src =
      src.slice(0, i) +
      `function zipWriteTo(entries, write) {
  const { time, date } = dosStamp(new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.read();
    const crc = crc32(raw);
    const deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10); cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, cdBuf, eocd]);
  write(all);
  return all.length;
}
` +
      src.slice(j);
    fs.writeFileSync(p, src, 'utf8');
  }

  console.log(`造 ${PHOTOS} 张 × ${EACH_MB}MB = ${(PHOTOS * EACH_MB).toFixed(0)}MB 假照片…`);
  const size = EACH_MB * 1024 * 1024;
  for (let i = 0; i < PHOTOS; i++) {
    const buf = Buffer.allocUnsafe(size);
    for (let k = 0; k < size; k += 4) buf.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, k);
    fs.writeFileSync(path.join(TMP, 'uploads', `img_${i}.jpg`), buf);
  }

  const child = spawn(process.execPath, ['--max-old-space-size=384', 'server.js'], {
    cwd: TMP,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    await sleep(150);
    try {
      await api('GET', '/api/version');
      up = true;
    } catch (_) {
      /* 还没起来 */
    }
  }
  if (!up) {
    child.kill();
    console.error(log.join(''));
    throw new Error('实例没起来');
  }

  await sleep(400);
  const base = rssMB(child.pid);
  let peak = base;
  const poll = setInterval(() => {
    const n = rssMB(child.pid);
    if (n > peak) peak = n;
  }, 60);

  const t0 = Date.now();
  const bk = await api('POST', '/api/backups');
  const t1 = Date.now();
  await sleep(200);
  const peakBackup = peak;
  clearInterval(poll);

  // 导出：这条路由以前是把整个 zip 塞进一个 Buffer 再 res.end()，
  // 现在是先落临时文件再流式发。量的是它自己涨了多少。
  let peakExport = 0;
  const poll2 = setInterval(() => {
    const n = rssMB(child.pid);
    if (n > peakExport) peakExport = n;
  }, 60);
  const t2 = Date.now();
  const exported = await download('/api/export', null).catch((e) => '失败:' + e.message);
  const t3 = Date.now();
  await sleep(200);
  clearInterval(poll2);

  const after = rssMB(child.pid);
  const zipDir = path.join(TMP, 'backups');
  const zipFiles = fs.existsSync(zipDir) ? fs.readdirSync(zipDir).sort() : [];
  const zipSize = zipFiles.length ? fs.statSync(path.join(zipDir, zipFiles[zipFiles.length - 1])).size : 0;

  child.kill();
  await sleep(300);
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });

  console.log(`\n模式：${USE_OLD ? 'old 全内存拼 zip' : 'new 逐条写磁盘'}`);
  console.log(`空闲 RSS       ${base}MB`);
  console.log(`备份接口       ${bk.status}，耗时 ${t1 - t0}ms`);
  console.log(`备份期间峰值   ${peakBackup}MB   （比空闲多 ${peakBackup - base}MB）`);
  console.log(`导出接口       ${typeof exported === 'string' ? exported : exported + ' 字节'}，耗时 ${t3 - t2}ms`);
  console.log(`导出期间峰值   ${peakExport}MB   （比空闲多 ${peakExport - base}MB）`);
  console.log(`备份产物       ${mb(zipSize)}（${zipFiles.length} 份）`);
  console.log(`结束 RSS       ${after}MB`);
  const lines = log.join('').split('\n').filter((l) => l.includes('[backup]'));
  for (const l of lines) console.log(`服务端自报     ${l.trim()}`);
})();
