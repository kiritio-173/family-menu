'use strict';

/**
 * 打包脚本：把家庭菜单打成可以直接拷到别的电脑上运行的便携版
 *
 *   node build-package.js            把当前菜单数据一起打进去（推荐）
 *   node build-package.js --empty    只带示例种子数据，适合做干净模板
 *
 * 产出：
 *   package/家庭菜单-便携版/          解压即用，自带 Node 运行时
 *   package/家庭菜单-便携版.zip       方便传输
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'package');
const APP = path.join(OUT, '家庭菜单-便携版');
const RUNTIME_DIR = path.join(APP, 'runtime');
const NODE_EXE = path.join(RUNTIME_DIR, 'node.exe');

const CRLF = '\r\n';
const bat = (lines) => lines.join(CRLF) + CRLF;
const nl = (lines) => lines.join('\n') + '\n';

function log(...a) {
  console.log(...a);
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (err) {
    // 杀软扫描 node.exe、或用户正开着便携版窗口时，目录会删不掉
    if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
    const aside = p + '.old-' + Date.now();
    try {
      fs.renameSync(p, aside);
      fs.rmSync(aside, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (_) {
      // 退而求其次：保留目录，后面就地覆盖文件
      log('  [--] 旧目录删不掉（可能正被占用），改为就地覆盖');
    }
  }
}

/** 就地覆盖写入：目标目录已存在且删不掉时使用 */
function writeOver(src, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(src, destFile);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/* ------------------------------------------------------------------ *
 * 1. 收集 Node 运行时
 * ------------------------------------------------------------------ */

function collectNodeRuntime() {
  if (fs.existsSync(NODE_EXE)) {
    log(`  [OK] 运行时已存在，跳过`);
    return fs.statSync(NODE_EXE).size;
  }
  const candidates = [
    path.join(path.dirname(process.execPath), 'node.exe'),
    process.execPath,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && path.basename(c).toLowerCase() === 'node.exe') {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
      fs.copyFileSync(c, NODE_EXE);
      const size = fs.statSync(NODE_EXE).size;
      log(`  [OK] 已内置 Node 运行时：${c}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return size;
    }
  }
  log('  [--] 没找到可复制的 node.exe，将只依赖目标电脑已装 Node');
  return 0;
}

/* ------------------------------------------------------------------ *
 * 2. 生成脚本文件
 * ------------------------------------------------------------------ */

const LAUNCH_BAT = () =>
  bat([
    '@echo off',
    'chcp 65001 >nul',
    'title 家庭菜单',
    'cd /d "%~dp0"',
    '',
    'set "NODEEXE=%~dp0runtime\\node.exe"',
    'if exist "%NODEEXE%" goto :run',
    '',
    'rem 没带运行时的话，找系统里装好的 node',
    'where node >nul 2>nul',
    'if not errorlevel 1 (',
    '  set "NODEEXE=node"',
    '  goto :run',
    ')',
    '',
    'echo.',
    'echo   [!] 这台电脑上没有找到 Node.js 运行环境',
    'echo.',
    'echo   两种办法，任选一种：',
    'echo     1. 重新解压完整的压缩包（里面自带运行环境）',
    'echo     2. 到 https://nodejs.org/zh-cn 下载安装 LTS 版本后重试',
    'echo.',
    'start "" "https://nodejs.org/zh-cn/download"',
    'echo   已为你打开下载页面，装完再双击本文件即可。',
    'echo.',
    'pause',
    'exit /b 1',
    '',
    ':run',
    'echo.',
    'echo   正在启动家庭菜单，浏览器会自动打开...',
    'echo   用完直接关掉这个窗口就行。',
    'echo.',
    '"%NODEEXE%" server.js --open',
    'echo.',
    'echo   服务已停止。按任意键关闭窗口。',
    'pause >nul',
  ]);

const INSTALL_BAT = () =>
  bat([
    '@echo off',
    'chcp 65001 >nul',
    'title 安装家庭菜单',
    'cd /d "%~dp0"',
    '',
    'if not exist "%~dp0runtime\\node.exe" (',
    '  echo.',
    '  echo   [!] 缺少自带运行环境，请重新解压完整的压缩包。',
    '  echo.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'set "TARGET=%LOCALAPPDATA%\\家庭菜单"',
    'echo.',
    'echo   将安装到：%TARGET%',
    'echo   （在 C 盘的用户目录下，不需要管理员权限）',
    'echo.',
    'choice /c YN /n /m "现在安装? [Y=是 N=否] "',
    'if errorlevel 2 exit /b 0',
    '',
    'if exist "%TARGET%" rmdir /s /q "%TARGET%"',
    'mkdir "%TARGET%" >nul 2>&1',
    'xcopy "%~dp0server.js" "%TARGET%\\" /Y >nul',
    'xcopy "%~dp0package.json" "%TARGET%\\" /Y >nul',
    'xcopy "%~dp0public" "%TARGET%\\public\\" /E /I /Y >nul',
    'xcopy "%~dp0runtime" "%TARGET%\\runtime\\" /E /I /Y >nul',
    'xcopy "%~dp0启动家庭菜单.bat" "%TARGET%\\" /Y >nul',
    'xcopy "%~dp0安装到电脑.bat" "%TARGET%\\" /Y >nul',
    'xcopy "%~dp0创建快捷方式.ps1" "%TARGET%\\" /Y >nul',
    'xcopy "%~dp0使用说明.txt" "%TARGET%\\" /Y >nul',
    'xcopy "%~dp0data" "%TARGET%\\data\\" /E /I /Y >nul',
    'xcopy "%~dp0uploads" "%TARGET%\\uploads\\" /E /I /Y >nul',
    '',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0创建快捷方式.ps1" -Target "%TARGET%"',
    'if errorlevel 1 echo   [..] 快捷方式创建失败，不影响使用，可直接双击安装目录里的 bat',
    '',
    'echo.',
    'echo   [OK] 安装完成。',
    'echo.',
    'choice /c YN /n /m "要设置开机自动启动吗? [Y=是 N=否] "',
    'if errorlevel 2 goto :launch',
    'set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\启动"',
    'if not exist "%STARTUP%" mkdir "%STARTUP%"',
    'copy /y "%TARGET%\\启动家庭菜单.bat" "%STARTUP%\\家庭菜单.bat" >nul',
    'echo   [OK] 已设置开机自启。',
    '',
    ':launch',
    'echo.',
    'echo   正在启动...',
    'start "" "%TARGET%\\启动家庭菜单.bat"',
    'timeout /t 3 >nul',
    'exit /b 0',
  ]);

/** 生成快捷方式：单独放 ps1，避开批处理里 PowerShell 的引号地狱 */
const SHORTCUT_PS1 = () =>
  '\uFEFF' +
  nl([
    'param([Parameter(Mandatory=$true)][string]$Target)',
    '$ErrorActionPreference = "Stop"',
    '$ws = New-Object -ComObject WScript.Shell',
    '$exe = Join-Path $Target "启动家庭菜单.bat"',
    '',
    'function New-MenuShortcut([string]$Path) {',
    '  $s = $ws.CreateShortcut($Path)',
    '  $s.TargetPath = $exe',
    '  $s.WorkingDirectory = $Target',
    '  $icon = Join-Path $Target "runtime\\node.exe"',
    '  if (Test-Path $icon) { $s.IconLocation = "$icon,0" }',
    '  $s.Description = "家庭菜单 · 家庭点餐入口"',
    '  $s.Save()',
    '  Write-Host "  [OK] $Path"',
    '}',
    '',
    'Write-Host "  创建快捷方式..."',
    'New-MenuShortcut ((Join-Path ([Environment]::GetFolderPath("Desktop")) "家庭菜单.lnk"))',
    '$programs = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs"',
    'New-MenuShortcut (Join-Path $programs "家庭菜单.lnk")',
  ]);

const README_TXT = (nodeVer, hasRuntime, runtimeSizeMB) =>
  nl([
    '家庭菜单 · 便携版',
    '==================',
    '',
    hasRuntime
      ? `本包已内置 Node.js 运行环境（v${nodeVer}，约 ${runtimeSizeMB} MB），`
      : `本包需要目标电脑已安装 Node.js（v${nodeVer} 或更高）。`,
    '解压后双击「启动家庭菜单.bat」即可，不需要安装任何东西。',
    '',
    '',
    '【怎么开始用】',
    '',
    '1. 把整个文件夹解压出来（不要在压缩包里直接双击运行）。',
    '2. 双击「启动家庭菜单.bat」，浏览器会自动打开菜单。',
    '3. 窗口里会显示一个「手机访问」地址，比如 http://192.168.1.3:8787',
    '   家里人拿手机连同一个 WiFi，浏览器输入这个地址就能点餐。',
    '4. 用完直接关掉那个黑色窗口就行，下次双击重新启动。',
    '',
    '',
    '【多个家庭用在一起】',
    '',
    '菜谱是所有家庭共享的，只要录一次。点餐和库存各记各的，互不干扰。',
    '',
    '- 顶部那个「🏠 名字」的按钮就是切换家庭，点它可以选或者新建。',
    '- 名字可以写房号（301）、门牌（西苑 2 栋 501），也可以写称呼（外婆家）。',
    '- 每个家庭的成员单独维护：在「管理」页里，先切到那个家庭再改成员。',
    '- 每台设备记住自己选的是哪个家庭，一家人可以各自用各自的。',
    '',
    '',
    '【菜谱和图片存在哪】',
    '',
    '就在这个文件夹里：',
    '  data/      菜品、分类、家庭、点餐记录、库存（纯文本 JSON，随便查看和修改）',
    '  uploads/   图片文件',
    '',
    '所以整个文件夹拷到 U 盘或别的电脑，菜单就一起带走了。',
    '',
    '',
    '【建议】',
    '',
    '- 在浏览器里按 Ctrl+D（手机上选「添加到主屏幕」），下次一点就开。',
    '- 录菜之前，先在「管理」页点「导出备份」存一份，以后换电脑能恢复。',
    '- 想让家里人只能点餐、不能改菜谱：管理页 → 家庭设置 → 设置管理口令。',
    '- 想开机自动运行：见文件夹里的「安装到电脑.bat」。',
    '',
    '',
    '【遇到问题】',
    '',
    'Q: 双击后窗口一闪而过 / 提示端口被占用？',
    'A: 端口被占用时会自动往后找（8787→8788…），看窗口里显示的实际地址。',
    '',
    'Q: 手机打不开那个地址？',
    'A: 确认手机和电脑连的是同一个 WiFi；Windows 防火墙弹窗要选「允许访问」。',
    '   路由器开了「AP 隔离 / 访客网络」的话，同网设备互相看不见，需要在路由器里关掉。',
    '',
    'Q: 想换端口？',
    'A: 打开命令提示符，运行：set PORT=9000 && 启动家庭菜单.bat',
    '',
    'Q: 忘了管理口令？',
    'A: 用记事本打开 data\\settings.json，把 adminPin 改成 "" 再重启。',
    '',
    '',
    '祝开饭愉快。',
  ]);

const PACKAGE_README = (runtimeSizeMB, zipSizeMB, dataNote) =>
  nl([
    '家庭菜单 · 打包产物说明',
    '======================',
    '',
    '本目录由 build-package.js 自动生成。',
    '',
    '',
    '【家庭菜单-便携版.zip】  ' + (zipSizeMB ? `约 ${zipSizeMB} MB` : ''),
    '',
    '  ← 推荐用这个。传到另一台电脑（微信 / U 盘都行），',
    '    先解压，再双击里面的「启动家庭菜单.bat」就能用。',
    '',
    '',
    '【家庭菜单-便携版/】',
    '',
    '  上面那个 ZIP 解压后的内容，也可以直接拷贝整个文件夹过去。',
    `  已内置 Node.js 运行时（约 ${runtimeSizeMB} MB），目标电脑不需要装任何东西。`,
    '',
    '  里面的文件：',
    '    启动家庭菜单.bat   ← 双击这个',
    '    安装到电脑.bat     ← 想装到固定位置、建桌面快捷方式、开机自启就跑这个',
    '    使用说明.txt       给家里人的说明书',
    '    runtime/           自带的 Node 运行时',
    '    data/ uploads/     菜单数据和菜品照片',
    '',
    '',
    '【这次打进去的数据】',
    '',
    dataNote,
    '',
    '',
    '【自己重新打包】',
    '',
    '  node build-package.js            把当前菜单数据和照片一起打包（默认）',
    '  node build-package.js --empty    只带空白模板，做干净示例用',
    '',
    '',
    '【支持的系统】',
    '',
    '  Windows 10 / 11，64 位（x86-64）。',
    '  内置的 node.exe 只支持 64 位 x86 处理器；',
    '  如果是 ARM 版 Windows 或 32 位系统，装一下官方 Node.js LTS 即可，',
    '  启动脚本会自动改用系统里装好的 Node。',
  ]);

/* ------------------------------------------------------------------ *
 * 3. 主流程
 * ------------------------------------------------------------------ */

function main() {
  const includeData = !process.argv.includes('--empty');
  log('\n打包家庭菜单 →', OUT, '\n');

  log('[1/5] 准备目录');
  rmrf(APP);
  rmrf(path.join(OUT, '家庭菜单-便携版.zip'));
  fs.mkdirSync(APP, { recursive: true });

  log('[2/5] 复制程序文件');
  writeOver(path.join(ROOT, 'server.js'), path.join(APP, 'server.js'));
  writeOver(path.join(ROOT, 'package.json'), path.join(APP, 'package.json'));
  copyDir(path.join(ROOT, 'public'), path.join(APP, 'public'));

  fs.mkdirSync(path.join(APP, 'uploads'), { recursive: true });
  const uploadSrc = path.join(ROOT, 'uploads');
  const upCount = fs.existsSync(uploadSrc) ? fs.readdirSync(uploadSrc).length : 0;

  // 先清空包内 data 目录：就地覆盖时（上一份便携版还在运行，目录删不掉）
  // 上一次残留的文件不会自动消失，不显式清掉的话，
  // 后面打 --empty 会把上一份的私人菜谱一起打进要公开发布的包里。
  rmrf(path.join(APP, 'data'));

  if (includeData) {
    // 当前菜单数据 + 菜品照片一起带走
    copyDir(path.join(ROOT, 'data'), path.join(APP, 'data'));
    if (upCount) copyDir(uploadSrc, path.join(APP, 'uploads'));
    const dishes = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data', 'dishes.json'), 'utf8')
    );
    log(
      `  [OK] server.js / package.json / public/ / 当前菜单 ${dishes.length} 道菜 / 图片 ${upCount} 张`
    );
  } else {
    // 干净模板：只保留分类骨架，首次启动由 server.js 生成示例菜
    fs.mkdirSync(path.join(APP, 'data'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'data', 'categories.json'),
      path.join(APP, 'data', 'categories.json')
    );
    log('  [OK] server.js / package.json / public/ / 空菜单（--empty）');
  }
  // 点餐记录和库存是运行时状态，不随包分发：到新电脑上重新开始更清爽
  rmrf(path.join(APP, 'data', 'orders.json'));
  rmrf(path.join(APP, 'data', 'pantry.json'));

  // ---- 密钥与口令绝不随包分发 ----------------------------------------
  // 便携包是要发给别人、甚至挂到 GitHub Release 上的。
  // ai.json 里有你的 MiniMax API Key，settings.json 里有管理口令：
  // 两者都是「只属于这台电脑」的东西，跟着包走等于白送。
  // （data/ 整个目录是被原样拷过去的，光排除 orders/pantry 不够。）
  rmrf(path.join(APP, 'data', 'ai.json'));
  try {
    const sp = path.join(APP, 'data', 'settings.json');
    const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
    if (st.adminPin) {
      st.adminPin = ''; // 店名、欢迎语留着，口令抹掉
      fs.writeFileSync(sp, JSON.stringify(st, null, 2) + '\n', 'utf8');
    }
  } catch (_) {
    /* 没有 settings.json 也无所谓，服务端首次启动会自己生成 */
  }

  log('[3/5] 内置 Node.js 运行时');
  const runtimeSize = collectNodeRuntime();

  log('[4/5] 生成启动脚本与说明');
  fs.writeFileSync(path.join(APP, '启动家庭菜单.bat'), LAUNCH_BAT(), 'utf8');
  fs.writeFileSync(path.join(APP, '安装到电脑.bat'), INSTALL_BAT(), 'utf8');
  fs.writeFileSync(path.join(APP, '创建快捷方式.ps1'), SHORTCUT_PS1(), 'utf8');
  const runtimeMB = runtimeSize ? (runtimeSize / 1024 / 1024).toFixed(0) : '0';
  fs.writeFileSync(
    path.join(APP, '使用说明.txt'),
    README_TXT(process.versions.node, runtimeSize > 0, runtimeMB),
    'utf8'
  );
  log('  [OK] 启动家庭菜单.bat / 安装到电脑.bat / 使用说明.txt');

  log('[5/5] 压缩 ZIP');
  const zip = path.join(OUT, '家庭菜单-便携版.zip');
  let zipMB = 0;
  const makeZip = () => {
    // 优先 7z；没有就用 Windows 自带的 bsdtar（tar -a 会按扩展名选 zip 格式）
    if (spawnSync('7z', ['i'], { shell: true }).status === 0) {
      execFileSync('7z', ['a', '-tzip', '-mx=7', zip, '家庭菜单-便携版'], {
        cwd: OUT,
        stdio: 'ignore',
        shell: true,
      });
      return '7z';
    }
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(tar)) {
      execFileSync(tar, ['-a', '-c', '-f', zip, '家庭菜单-便携版'], {
        cwd: OUT,
        stdio: 'ignore',
      });
      return 'tar';
    }
    return null;
  };

  const via = makeZip();
  if (via) {
    zipMB = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
    log(`  [OK] ${path.basename(zip)}  ${zipMB} MB  (via ${via})`);
  } else {
    log('  [--] 没找到 7z 或 tar，跳过 ZIP（目录本身可直接使用）');
  }

  let dishesSummary = '';
  let houseSummary = '';
  if (includeData) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'dishes.json'), 'utf8'));
      dishesSummary = `共 ${d.length} 道菜：${d.map((x) => x.name).join('、')}`;
    } catch (_) {
      dishesSummary = '菜单数据已包含';
    }
    try {
      const h = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'households.json'), 'utf8'));
      houseSummary =
        h.length > 1
          ? `连 ${h.length} 个家庭（${h.map((x) => x.name).join('、')}）也一起带上，每个家庭的成员都记着。`
          : '家庭列表也带上了，可以在「管理」页随时加第二个家庭。';
    } catch (_) {
      houseSummary = '';
    }
  }

  const dataNote = includeData
    ? nl(
        [
          `  ${dishesSummary}。`,
          houseSummary ? `  ${houseSummary}` : '',
          `  菜品照片 ${upCount} 张也一并带上。`,
          '  点餐记录和库存没有打包（那是各家庭自己的东西，到新电脑重新开始更清爽）。',
        ].filter(Boolean)
      ).trim()
    : '  空白模板。目标电脑第一次启动会自动生成 4 道示例菜（番茄炒蛋等）。';
  write(path.join(OUT, '说明.txt'), PACKAGE_README(runtimeMB, zipMB, dataNote));
  log('\n完成。产物在 package/ 目录。');
}

if (require.main === module) {
  main();
}

module.exports = { main, OUT, APP };