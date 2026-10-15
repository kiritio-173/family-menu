'use strict';

/**
 * 发布当前家庭菜单更新：
 *   1. 语法检查和接口自检
 *   2. 生成 package/家庭菜单-便携版
 *   3. 只提交明确列出的应用文件
 *   4. 提交并推送当前分支到 origin
 *
 * 运行：npm run publish
 * 可用 PUBLISH_MESSAGE 覆盖默认提交说明。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PUBLISH_FILES = [
  'README.md',
  'build-package.js',
  'package.json',
  'publish-selftest.js',
  'publish-update.js',
  'server.js',
  'start.bat',
  '_packtest.js',
  '_selftest.js',
  'docs/superpowers/plans/2026-10-16-permissions-publish-plan.md',
  'docs/superpowers/specs/2026-10-16-permissions-publish-design.md',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
];

function normalize(root, p) {
  return path.resolve(root, p);
}

function readVersion(root) {
  const pkg = JSON.parse(fs.readFileSync(normalize(root, 'package.json'), 'utf8'));
  const server = fs.readFileSync(normalize(root, 'server.js'), 'utf8');
  const m = /const APP_VERSION = ['"]([^'"]+)['"]/.exec(server);
  if (!m) throw new Error('server.js 里找不到 APP_VERSION');
  if (pkg.version !== m[1]) {
    throw new Error(`版本号不一致：package.json=${pkg.version}，server.js=${m[1]}`);
  }
  return m[1];
}

function buildPublishPlan({ root = __dirname, message } = {}) {
  const files = PUBLISH_FILES
    .map((p) => normalize(root, p))
    .filter((p) => fs.existsSync(p));
  const version = readVersion(root);
  return {
    files,
    version,
    commitMessage: message || `chore: 发布家庭菜单 v${version}`,
  };
}

function run(command, args, root) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

function git(root, args, capture = false) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function relativeFiles(root, files) {
  return files.map((p) => path.relative(root, p).replace(/\\/g, '/'));
}

function publishDecision(staged) {
  return { commit: !!String(staged || '').trim(), push: true };
}

function main() {
  const root = __dirname;
  const plan = buildPublishPlan({ root, message: process.env.PUBLISH_MESSAGE });
  const rel = relativeFiles(root, plan.files);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], true).trim();
  if (!branch || branch === 'HEAD') throw new Error('当前处于 detached HEAD，不能自动发布');

  console.log(`\n发布家庭菜单 v${plan.version} → ${branch}`);
  console.log('[1/5] 语法检查');
  for (const file of ['server.js', 'public/app.js', '_selftest.js', '_packtest.js', 'build-package.js', 'publish-update.js']) {
    run(process.execPath, ['--check', normalize(root, file)], root);
  }

  console.log('[2/5] 接口自检');
  run(process.execPath, ['_selftest.js'], root);

  console.log('[3/5] 生成便携版');
  run(process.execPath, ['build-package.js'], root);
  const app = normalize(root, 'package/家庭菜单-便携版');
  if (!fs.existsSync(normalize(root, 'package/家庭菜单-便携版.zip')) || !fs.existsSync(path.join(app, 'server.js'))) {
    throw new Error('便携版产物不完整');
  }

  console.log('[4/5] 提交应用文件');
  git(root, ['add', '--', ...rel]);
  const staged = git(root, ['diff', '--cached', '--name-only'], true).trim();
  const decision = publishDecision(staged);
  if (!decision.commit) {
    console.log('没有新的应用文件改动，跳过提交，继续推送当前提交。');
  } else {
    git(root, ['commit', '-m', plan.commitMessage]);
  }

  console.log('[5/5] 推送 GitHub');
  git(root, ['push', 'origin', branch]);
  console.log(`\n发布完成：${plan.commitMessage}`);
  console.log(`便携版目录：${app}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`\n发布失败：${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { PUBLISH_FILES, buildPublishPlan, publishDecision, main };
