'use strict';
/**
 * 内存基准：量「打包备份」这条路的峰值内存。
 *
 * 背景：这台机器可能只有 2 核 2G。备份是唯一一个「数据有多大、内存就得跟着涨多少」
 * 的操作 —— 照片都躺在 uploads/ 里，几十张手机照片就能把峰值顶到几百 MB，
 * 碰上每天凌晨自动打的那一份，就更容易被系统的 OOM Killer 盯上。
 *
 * 用假照片（随机数据，deflate 压不动 = 最坏情况）量两种写法：
 *   old  全部读进内存，最后 Buffer.concat 成一整个 zip Buffer（老写法）
 *   new  一个条目一份 Buffer，边压边写进 fd，写完立刻释放（优化后的写法）
 *
 * 两种写法各起一个**独立子进程**跑 —— 同一进程里连着跑两遍，V8 不会把上一遍的
 * RSS 还给操作系统，量出来的差值没有意义。
 *
 *   node --expose-gc _memtest.js            两种都跑，输出对比
 *   node --expose-gc _memtest.js old        只跑老写法，打印绝对峰值
 *
 * 下面的 zip 实现是 server.js 那套的原样副本：改 server.js 时记得同步，
 * 否则这里量到的就不是线上真跑的那份了。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const PHOTOS = Number(process.env.MEMTEST_PHOTOS || 60);
const EACH_MB = Number(process.env.MEMTEST_EACH_MB || 2);
const TMP = path.join(os.tmpdir(), 'family-menu-memtest-' + process.pid);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';

/* ---------- 与 server.js 同源的 zip 实现 ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosStamp(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

function entryHeaders(nameBuf, method, time, date, crc, payloadLen, rawLen, offset) {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payloadLen, 18);
  local.writeUInt32LE(rawLen, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(time, 12);
  cd.writeUInt16LE(date, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(payloadLen, 20);
  cd.writeUInt32LE(rawLen, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);
  cd.writeUInt32LE(offset, 42);
  return { local, cd };
}

function eocdOf(count, cdLen, offset) {
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(count, 8);
  e.writeUInt16LE(count, 10);
  e.writeUInt32LE(cdLen, 12);
  e.writeUInt32LE(offset, 16);
  return e;
}

/** old：全内存 —— 每个条目算完 push 进数组，最后 Buffer.concat 成一整份 */
function zipMakeInMemory(files) {
  const { time, date } = dosStamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(raw);
    const deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : raw;
    const { local, cd } = entryHeaders(nameBuf, method, time, date, crc, payload.length, raw.length, offset);
    locals.push(local, nameBuf, payload);
    centrals.push(cd, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const cdBuf = Buffer.concat(centrals);
  return Buffer.concat([...locals, cdBuf, eocdOf(files.length, cdBuf.length, offset)]);
}

/** new：逐条写 —— 一次只留一个条目，写完立刻放手 */
function zipWriteStreamed(entries, write) {
  const { time, date } = dosStamp(new Date());
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    let raw = e.read();
    const crc = crc32(raw);
    let deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : raw;
    const { local, cd } = entryHeaders(nameBuf, method, time, date, crc, payload.length, raw.length, offset);
    write(local);
    write(nameBuf);
    write(payload);
    centrals.push(cd, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
    // 关键：不松手的话 raw / deflated 会一直挂在循环里，峰值照样翻倍
    deflated = null;
    raw = null;
  }
  const cdBuf = Buffer.concat(centrals);
  write(cdBuf);
  write(eocdOf(entries.length, cdBuf.length, offset));
  return offset + cdBuf.length + 22;
}

/* ---------- 基准 ---------- */

function makePhotos() {
  fs.mkdirSync(TMP, { recursive: true });
  const size = EACH_MB * 1024 * 1024;
  for (let i = 0; i < PHOTOS; i++) {
    const buf = Buffer.allocUnsafe(size);
    for (let k = 0; k < size; k += 4) buf.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, k);
    fs.writeFileSync(path.join(TMP, `img_${i}.jpg`), buf);
  }
}

function runOne(which) {
  makePhotos();
  const json = JSON.stringify({ dishes: [{ name: '孜然牛肉' }] }, null, 2);
  const names = fs.readdirSync(TMP);
  let peak = 0;
  let size = 0;
  const tick = () => {
    const rss = process.memoryUsage.rss();
    if (rss > peak) peak = rss;
  };
  const timer = setInterval(tick, 2);
  timer.unref();

  const base = process.memoryUsage.rss();
  if (which === 'old') {
    const files = [{ name: 'backup.json', data: json }];
    for (const n of names) files.push({ name: 'uploads/' + n, data: fs.readFileSync(path.join(TMP, n)) });
    size = zipMakeInMemory(files).length;
  } else {
    const fd = fs.openSync(TMP + '.zip', 'w');
    try {
      const write = (b) => fs.writeSync(fd, b, 0, b.length);
      const entries = [{ name: 'backup.json', read: () => Buffer.from(json, 'utf8') }].concat(
        names.map((n) => ({ name: 'uploads/' + n, read: () => fs.readFileSync(path.join(TMP, n)) }))
      );
      size = zipWriteStreamed(entries, write);
    } finally {
      fs.closeSync(fd);
    }
  }
  tick();
  clearInterval(timer);
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
  try {
    fs.unlinkSync(TMP + '.zip');
  } catch (_) {
    /* old 那条不产生文件 */
  }
  return JSON.stringify({ base, peak, size });
}

const which = process.argv[2];
if (which === 'old' || which === 'new') {
  process.stdout.write(runOne(which));
  process.exit(0);
}

// ---- 对比模式：两个独立子进程各跑一遍，比绝对峰值 ----
const { spawnSync } = require('child_process');
const run = (w) => {
  const r = spawnSync(process.execPath, ['--expose-gc', __filename, w], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(w, '跑挂了：', r.stderr);
    process.exit(1);
  }
  return JSON.parse(r.stdout);
};
const oldR = run('old');
const newR = run('new');
const payload = (PHOTOS * EACH_MB).toFixed(0);
console.log(`假照片 ${PHOTOS} 张 × ${EACH_MB}MB = ${payload}MB（随机数据，deflate 压不动 = 最坏情况）`);
console.log(`每个实现在独立子进程里跑，比的是绝对峰值 RSS\n`);
console.log(`空进程 RSS        ${mb(oldR.base)}`);
console.log(`old 全内存拼 zip  ${mb(oldR.peak)}   （产物 ${mb(oldR.size)}）`);
console.log(`new 逐条写磁盘    ${mb(newR.peak)}   （产物 ${mb(newR.size)}）`);
console.log(
  `\n峰值少用 ${mb(oldR.peak - newR.peak)}，降到原来的 ${((newR.peak / oldR.peak) * 100).toFixed(0)}%` +
    `   产物大小一致：${oldR.size === newR.size ? '是' : '否（' + oldR.size + ' vs ' + newR.size + '）'}`
);
