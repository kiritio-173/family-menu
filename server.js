'use strict';

/**
 * 家庭菜单服务 —— 本地部署版
 * 零第三方依赖：Node 原生 http + JSON 文件存储
 * 启动：node server.js   （Windows 可双击 start.bat）
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 16 * 1024 * 1024; // 16MB，够放压缩后的 base64 图片
// 恢复备份走的是 zip 原样上传，里面装着 uploads/ 的照片，体积比单条请求大得多。
// 上限从 128MB 降到 64MB：恢复时这份 zip 会先整体收进内存、再解出一份照片，
// 128MB 的包意味着峰值 256MB 起。2G 的小机器上宁可早点报错让人分批处理，
// 也不要悄悄把机器撑爆。照片特别多的话可以 MEM_IMPORT_MB=128 放宽。
const MAX_IMPORT = Number(process.env.MEM_IMPORT_MB || 64) * 1024 * 1024;
// 自动备份保留几份
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP) || 7;
// node server.js --open  启动后自动打开浏览器
const AUTO_OPEN = process.argv.includes('--open') || process.env.AUTO_OPEN === '1';

/* ------------------------------------------------------------------ *
 * 版本与更新内容
 *
 * 网页上「这是第几版、这一版加了什么」直接读这里。
 * 写在代码里而不是另开一个文件，是为了保证打包时不会漏 —— 少一个文件，
 * 网页上就会出现一个空白的更新日志，比没有还糟。
 * ------------------------------------------------------------------ */

const APP_VERSION = '1.10.1';

// 新的排在前面；date 只写发布年月日，不用精确到时分
const RELEASES = [
  {
    version: '1.10.1',
    date: '2026-10-16',
    title: '修两个界面和自检的问题',
    items: [
      '修正家里人页面「👇 收进我家」按钮文字被挤成竖排、撑高整行的问题',
      '自检补上「非管理员只看得到自己那条申请、管理员看得到全部」和「备份这套端点一律要口令」的校验',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-10-16',
    title: '管理员与普通用户工作区',
    items: [
      '普通用户进入「我的菜单」工作区，只能维护当前家庭的私有菜谱和分类',
      '普通用户可以点餐、库存、计划和留言，但只能查看做饭状态；开做、完成和删除点餐由管理员处理',
      '管理员解锁后维护共享菜单、家庭、成员、设置、备份和 AI',
      '普通用户状态接口按当前家庭过滤，并补齐加入申请状态',
      '共享菜上「👇 收进我家」：抄一份成本家私菜，公共那份一个字节都不动',
      '批准加入申请 = 真的把人加进这个家庭的成员列表，不只是改个状态',
      '当前家庭和当前成员选择会保存在本机浏览器中',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-10-16',
    title: '菜单分家 · AI 降权 · 内存优化',
    items: [
      '菜品和分类都能分家：共享的（🌏）归管理员，本家私菜（🔒）本家自己维护',
      '分类名全局唯一；共享菜进不了私有分类，删分类只挪同归属的菜',
      '删掉一个家庭会带走它的私菜和私有分类，并清掉悬空引用',
      '拆掉全局 AI 对话助手。AI 只剩拍照、粘贴文字、整理规范、厨房助手，全部只填表单不入库',
      '新增「📋 粘贴文字，AI 帮我写」：把抄来的菜谱文字拆成结构化的调料和步骤',
      '备份和导出改成流式打包：120MB 照片下峰值内存 305MB → 73MB，耗时和产物字节数不变',
      '导入上限 128MB → 64MB，启动加 --max-old-space-size=384，启动时打印内存占用',
      '权限模型：/api/my-dishes 免口令但只能写本家私菜，归属由服务端按查询参数钉死',
      '加入申请：提交免口令、批准和拒绝要口令、同一人同一家只留一条',
      '新增 npm run publish：自检、打包便携版、提交并推送 GitHub',
      '便携版输出固定更新到 package/家庭菜单-便携版/，同时生成 ZIP',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-10-15',
    title: '留言板 + 菜品互动区',
    items: [
      '底部多了第 6 个页签「💬 留言」：一家人在这儿说话 ——「今晚我做饭」「冰箱里还有排骨」「谁去买菜」',
      '写的时候先点一下自己是谁（头像那一排），还能挑个贴纸 🍳🛒🌶️⚠️，一眼扫过去就知道是谁说的',
      '每条留言都能 👍❤️😂😋🙏🔥，按一下就算回应了，不打字也行；再按一下取消',
      '能「🙋 我来」认领：「今晚我做饭」「我去买菜」——认领了别人一眼就看到，也不会两个人都说「我来做」',
      '能回复，一条留言底下能接一串话，接话不用另开一条',
      '菜单页每张菜卡片底下多一排：**🍽 想吃 / 👩‍🍳 我来做 / 💬**，点「想吃」的人是谁、谁认领了下厨，一眼就清楚',
      '每道菜也能单独留言：「这道糖放少一点」「上次太咸了」——点 💬 打开就是这道菜的专属留言',
      '留言板也支持批量删：点「☑ 批量操作」勾上几条一起删',
      '页签上的数字是「今天」家里说了几句，不是总数 —— 总数只会越滚越大，越滚越没意义',
      '留言按家庭分开，A 家的话不会串到 B 家去；和家庭成员一样，不用管理口令就能写',
      '删掉一道菜不会抹掉别人在它下面说的话：留言内容留着，退回留言板继续看得到',
      '备份（zip）里也带上留言和投票，恢复回来是原样',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-10-15',
    title: '能多选的地方都能多选了',
    items: [
      '菜品管理：勾上几道菜就能批量改分类、加去标签、标拿手菜、删除，不用一道一道点',
      '点餐单：勾上几条就能批量开做、批量完成、批量删除，按钮跟着当前页签变（待做给「开做」，制作中给「完成」）',
      '本周计划：勾上几道批量拿掉；「加一道菜」改成能多选，一次把几道排进这一周',
      '点餐弹层也改成多选：勾几道就一次下几道，不用点一次提交一次',
      '买菜清单：每行那个 ✓ 就是勾选，勾上就冒出工具条 —— 全勾、复制勾中的、🧊 全部入库；入完库自动把勾清掉',
      '库存：原来只能批量删除，现在还能批量改保质期（+3 天 / +1 周 / +1 月…或直接指定日期）和批量改分类',
      '所有批量删除都必须真的勾了东西才动手，不会「没勾就当成全选」',
      '全选只针对你眼前这一批 —— 筛了「临期」再全选，删掉的就是你看到的那几样，不会顺手删掉别的',
      '删除确认框只念前三个名字，不会甩给你一个吓人的大数字',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-10-15',
    title: 'AI 助手改成底部悬浮窗，而且真的能动手',
    items: [
      'AI 入口从顶栏搬到底部：收起时是一条小胶囊，点开是贴着底面的对话面板，单手拿手机也戳得到',
      '它现在不只是聊天：「把红烧排骨记到菜单」「刚买了三斤排骨」「这道排进本周计划」——说完就给你一张操作卡',
      '操作卡上写着它准备改什么（菜名、用量、几步、哪个做法），你点「确认」才真的存进去，点「算了」就当没说过',
      '能操作四样：加菜品（调料和步骤按常见做法自动填好）、下点餐单、排本周计划、记库存',
      '菜单里已有的菜会一起告诉它，它不会再一本正经地重复添加已有的那道',
      '模型偶尔没把回复包成 JSON 也不会整句没回应，原话照样显示，只是这轮没有可点确认的操作',
      '收起时 pill 上会冒个红点，方便你忙完别的再回来看它答了什么',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-15',
    title: '全局对话助手 + 一菜多做法各带调料 + 备份区瘦身',
    items: [
      '顶栏多了个 💬，在哪个页面都能打开直接问 AI：它知道你正在看哪一页、哪个家庭、手上这道菜、谁点了什么、哪些食材快过期了',
      '菜品调料拆成两层：菜品上的「通用调料」是每种做法都要用的，每个做法里还能只给自己加几味不一样的（比如微辣版多一勺小米辣）',
      '买菜清单会把各做法的调料一起汇总，并写清是哪道菜的哪个做法要用',
      '管理页数据区不再堆一列快照：改成「⬇ 导出备份 / ⬆ 恢复备份」两个按钮，恢复就是选一个文件回来',
      '自动快照还在（每天凌晨 3 点 + 每次启动，保留最近 7 份），只是收成了一行字加两个小按钮',
      '老的菜谱不用改：以前没有的做法级调料会自动补成空，你记的东西一样不少',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-15',
    title: '备餐流程时间轴 + 批量操作 + 版本页',
    items: [
      '厨房助手升级成完整备餐时间轴：从开始洗菜到最后一道上桌，每步带预计耗时，能并行的标「可离开」，要守着的标「要守灶」',
      '库存支持批量删除：进多选模式，勾选或全选后一次清掉',
      '点餐页新增「一键开做」：待做的菜一次全部转成制作中',
      '管理页新增版本信息，点开能看到每个版本都改了什么',
      '点餐单上的菜名现在可以直接点开菜谱（自定义菜除外）',
      '导出备份改成 zip，照片一起带走；每天凌晨自动存一份快照，坏了可一键回退',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-15',
    title: 'AI 厨房助手',
    items: [
      '拍张照 AI 认菜谱：传一张成品图，自动填菜名、分类、调料用量、步骤',
      '菜谱规范化：把随手记的乱菜谱理顺，「够两个人吃的」会变成「2 人份」',
      '厨房助手：把今晚几道菜排成并行下厨的顺序',
      'AI 全程走服务端，API Key 不进网页、不进备份、不进 GitHub',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-14',
    title: '本周计划',
    items: [
      '新增「本周计划」页：把想做的菜先排上，一周一次买齐',
      '计划菜自动汇总成采购清单，标了「家里有」的不用买',
      '可以翻到下一周提前备菜，计划按家庭各记各的',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-14',
    title: '管理口令',
    items: [
      '可选的管理口令，口令只存在服务端，前端拿不到明文',
      '改菜谱、导备份要口令；点餐、库存、本周计划不受影响',
      '编辑菜品时误关弹层不再丢内容，自动存草稿',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-13',
    title: '第一版',
    items: [
      '菜谱管理、点餐、买菜清单、库存、多家庭、局域网扫码点餐',
      '零第三方依赖：不用 npm install、不用数据库',
    ],
  },
];

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

const uid = (p = '') =>
  p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

const nowISO = () => new Date().toISOString();

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function safeText(v, max = 500) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function safeList(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60);
}

/* ------------------------------------------------------------------ *
 * AI（可选增强）
 *
 * 这一块是纯增量的：没配 Key、没网、服务挂了，都不影响点餐/计划/库存/买菜清单
 * 任何原有功能。Node 22 自带全局 fetch，所以不用引任何 npm 包，零依赖保住了。
 *
 * Key 只从 data/ai.json 读，永远不进 /api/state、不进导出备份、不下发前端。
 * ------------------------------------------------------------------ */

const AI_FILE = path.join(DATA_DIR, 'ai.json');

/** 环境变量优先，其次 data/ai.json —— 方便不想把 Key 放文件里的用法 */
function loadAIConfig() {
  const fromEnv = {
    enabled: process.env.MINIMAX_API_KEY ? true : null,
    baseUrl: process.env.MINIMAX_BASE_URL || null,
    model: process.env.MINIMAX_MODEL || null,
    apiKey: process.env.MINIMAX_API_KEY || null,
    timeoutMs: process.env.MINIMAX_TIMEOUT ? Number(process.env.MINIMAX_TIMEOUT) : null,
  };
  let fromFile = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(AI_FILE, 'utf8'));
  } catch (_) {
    /* 没有这个文件就是没配 AI，正常情况 */
  }
  const cfg = { ...fromFile, ...Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v != null)) };
  return {
    enabled: cfg.enabled !== false,
    baseUrl: String(cfg.baseUrl || 'https://api.minimax.io/v1').replace(/\/+$/, ''),
    model: String(cfg.model || 'MiniMax-M3'),
    apiKey: String(cfg.apiKey || ''),
    timeoutMs: Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 45000,
    maxCompletionTokens: Number(cfg.maxCompletionTokens) > 0 ? Number(cfg.maxCompletionTokens) : 8000,
  };
}

/** 给前端看的状态：绝不含 key 本身 */
function aiStatus() {
  const c = loadAIConfig();
  return {
    enabled: c.enabled && !!c.apiKey,
    model: c.model,
    hasKey: !!c.apiKey,
    timeoutMs: c.timeoutMs,
  };
}

/**
 * 剥掉 <think>…</think>。
 * MiniMax-M3 开启思考时，回答和思考过程会挤在 content 同一个字段里，
 * 不剥的话后面 JSON.parse 必崩。
 */
function stripThink(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/i, '')
    .trim();
}

/** 从可能夹杂散文/代码围栏的回复里抠出 JSON 对象 */
function extractJSON(text) {
  const s = stripThink(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * 调一次 MiniMax。永远不抛异常，只返回 { ok, data, error }，
 * 调用方拿不到结果时走降级，不该让整个功能崩掉。
 */
async function callAI(messages, opts = {}) {
  const c = loadAIConfig();
  if (!c.enabled || !c.apiKey) {
    return { ok: false, error: '还没配置 AI，去 data/ai.json 填上 API Key' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || c.timeoutMs);
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model || c.model,
        messages,
        max_completion_tokens: opts.maxTokens || c.maxCompletionTokens,
        temperature: opts.temperature == null ? 0.6 : opts.temperature,
        // 默认关掉思考：实测同一道调度题，开思考 20.3s/1628 tokens，
        // 关掉只要 5.0s/430 tokens，而 JSON 质量一样 —— 做饭时等 20 秒不可接受。
        // 需要仔细看图的任务可以单独开回来。
        // 只有 adaptive / disabled 两种取值，没有 enabled。
        ...(opts.think
          ? { thinking: { type: 'adaptive' }, reasoning_split: true }
          : { thinking: { type: 'disabled' }, reasoning_split: true }),
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let msg = `AI 返回 ${res.status}`;
      try {
        const j = JSON.parse(raw);
        msg = (j.error && j.error.message) || (j.base_resp && j.base_resp.status_msg) || msg;
      } catch (_) {
        /* 保持默认信息 */
      }
      if (res.status === 401 || res.status === 403) msg = 'API Key 不对或已失效，去 data/ai.json 换一个新的';
      if (res.status === 429) msg = 'AI 额度用完了，等会儿再试';
      return { ok: false, error: msg };
    }
    const j = JSON.parse(raw);
    const content = j.choices && j.choices[0] && j.choices[0].message
      ? j.choices[0].message.content
      : '';
    const text = stripThink(content);
    if (!text) return { ok: false, error: 'AI 没返回内容' };
    return {
      ok: true,
      text,
      json: opts.wantJSON ? extractJSON(text) : null,
      usage: j.usage || null,
      model: j.model || c.model,
    };
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      return { ok: false, error: 'AI 超时了，可能网络不通或模型在想太久' };
    }
    return { ok: false, error: `连不上 AI：${(err && err.message) || '未知错误'}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * 数据存储（原子写入 + 防抖落盘）
 * ------------------------------------------------------------------ */

const FILES = {
  categories: 'categories.json',
  dishes: 'dishes.json',
  orders: 'orders.json',
  settings: 'settings.json',
  households: 'households.json',
  pantry: 'pantry.json',
  plans: 'plans.json',
  // 留言板 + 菜品互动（想吃 / 我来做）。合成一个文件：这两样都是
  // 「家里人随手写的短内容」，拆成两个文件只会让备份/恢复多一条分支。
  notes: 'notes.json',
  // 「申请加入家庭」的待办。单独一个文件是因为它跟菜单数据完全两套生命周期：
  // 菜谱是长期内容，申请是几天内就该处理掉的一次性记录。
  access: 'access.json',
};

const state = {};
let saveTimer = null;

function seedDishes() {
  return [
    {
      id: 'd_seed_tomato_egg',
      name: '番茄炒蛋',
      category: '家常菜',
      description: '国民下饭菜，酸甜开胃，10 分钟上桌。',
      images: [],
      servings: '2 人份',
      duration: 10,
      difficulty: '简单',
      tags: ['下饭', '快手'],
      seasonings: [
        { name: '番茄', amount: '2 个' },
        { name: '鸡蛋', amount: '3 个' },
        { name: '白糖', amount: '1 小勺' },
        { name: '盐', amount: '适量' },
        { name: '葱花', amount: '1 根' },
      ],
      methods: [
        {
          name: '家常做法',
          steps: [
            '番茄顶部划十字，开水烫 30 秒去皮，切成滚刀块。',
            '鸡蛋打散，加一小勺清水，热油下锅炒至半凝固盛出。',
            '锅内留底油，下番茄中火炒出汁水，加白糖和盐。',
            '倒回鸡蛋，翻拌均匀让蛋吸满汤汁，撒葱花出锅。',
          ],
        },
      ],
      notes: '番茄一定要炒出红汤再回蛋，不然味道寡淡。',
      isFavorite: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
    {
      id: 'd_seed_kungpao',
      name: '宫保鸡丁',
      category: '家常菜',
      description: '荔枝口，酸甜微辣，鸡丁嫩滑、花生酥脆。',
      images: [],
      servings: '3 人份',
      duration: 30,
      difficulty: '中等',
      tags: ['下饭', '宴客'],
      seasonings: [
        { name: '鸡腿肉', amount: '400g' },
        { name: '油酥花生米', amount: '80g' },
        { name: '干辣椒', amount: '10 个' },
        { name: '花椒', amount: '1 小勺' },
        { name: '生抽', amount: '2 勺' },
        { name: '香醋', amount: '2 勺' },
        { name: '白糖', amount: '1.5 勺' },
        { name: '淀粉', amount: '1 小勺' },
      ],
      methods: [
        {
          name: '正宗川味',
          steps: [
            '鸡腿肉切 1.5cm 丁，加生抽、淀粉抓匀腌 15 分钟。',
            '调碗汁：生抽 2 勺、香醋 2 勺、糖 1.5 勺、水 3 勺、淀粉少许。',
            '热油下干辣椒花椒小火炒香，转大火下鸡丁快速滑炒至变色。',
            '倒入碗汁大火收稠，最后放花生米翻两下立刻出锅。',
          ],
        },
      ],
      notes: '花生米一定最后放，久炒会回软失去酥脆。',
      isFavorite: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
    {
      id: 'd_seed_pumpkin',
      name: '小米南瓜粥',
      category: '主食',
      description: '暖胃养人的早餐粥，煮一锅够全家吃。',
      images: [],
      servings: '3 碗',
      duration: 40,
      difficulty: '简单',
      tags: ['早餐', '养胃'],
      seasonings: [
        { name: '小米', amount: '80g' },
        { name: '南瓜', amount: '200g' },
        { name: '清水', amount: '1.2L' },
      ],
      methods: [
        {
          name: '电饭锅版',
          steps: [
            '小米淘洗两遍，南瓜去皮切小块。',
            '全部放入电饭锅，按下煮粥键。',
            '煮到南瓜化开、小米出油即可，可按口味加少许糖。',
          ],
        },
      ],
      notes: '',
      isFavorite: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
    {
      id: 'd_seed_smashed_cucumber',
      name: '拍黄瓜',
      category: '凉菜',
      description: '3 分钟上桌的爽口小菜，越拍越入味。',
      images: [],
      servings: '2 人份',
      duration: 5,
      difficulty: '简单',
      tags: ['快手', '解腻'],
      seasonings: [
        { name: '黄瓜', amount: '2 根' },
        { name: '蒜', amount: '3 瓣' },
        { name: '香醋', amount: '1 勺' },
        { name: '生抽', amount: '1 勺' },
        { name: '香油', amount: '几滴' },
      ],
      methods: [
        {
          name: '快手版',
          steps: [
            '黄瓜洗净用刀面拍裂，切成小段。',
            '蒜切末，与醋、生抽、香油、糖调成料汁。',
            '料汁倒进黄瓜拌匀，腌 5 分钟更脆。',
          ],
        },
      ],
      notes: '',
      isFavorite: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    },
  ];
}

function defaultState() {
  return {
    categories: [
      { id: 'c_home', name: '家常菜', order: 1 },
      { id: 'c_staple', name: '主食', order: 2 },
      { id: 'c_soup', name: '汤羹', order: 3 },
      { id: 'c_cold', name: '凉菜', order: 4 },
      { id: 'c_breakfast', name: '早餐', order: 5 },
      { id: 'c_snack', name: '小吃甜点', order: 6 },
      { id: 'c_drink', name: '饮品', order: 7 },
    ],
    dishes: seedDishes(),
    orders: [],
    households: [
      {
        id: 'h_home',
        name: '我家',
        emoji: '🏠',
        note: '',
        members: [{ id: 'm_self', name: '我', emoji: '🙋' }],
        createdAt: nowISO(),
        updatedAt: nowISO(),
      },
    ],
    pantry: [],
    plans: [],
    // 留言板留言 + 每道菜的「想吃 / 我来做」投票
    notes: { notes: [], votes: {} },
    // 申请加入别的家庭。普通用户不能直接把自己塞进别人家，得管理员点头。
    access: { requests: [] },
    settings: {
      shopName: '家庭菜单',
      adminPin: '',
      currentHouseholdId: 'h_home',
      shoppingChecked: [],
      welcome: '把常做的菜录进来，家人随时扫码点餐。',
    },
  };
}

const MEMBER_EMOJI = ['🙋', '👩', '👨', '👧', '👦', '🧒', '👵', '👴', '🐱', '🐶'];

const HOUSEHOLD_EMOJI = ['🏠', '🏡', '🏘️', '🏢', '🚪', '🛏️', '🍀', '🌷', '⭐', '🌙'];

/** 库存分类：肉蛋奶菜饮料……覆盖家里会囤的东西 */
const PANTRY_CATEGORIES = [
  { name: '肉类', emoji: '🥩' },
  { name: '蛋类', emoji: '🥚' },
  { name: '奶制品', emoji: '🥛' },
  { name: '蔬菜', emoji: '🥬' },
  { name: '水果', emoji: '🍎' },
  { name: '主食粮油', emoji: '🍚' },
  { name: '豆制品', emoji: '🫘' },
  { name: '水产海鲜', emoji: '🐟' },
  { name: '冷冻食品', emoji: '🧊' },
  { name: '饮料', emoji: '🥤' },
  { name: '调味干货', emoji: '🧂' },
  { name: '零食', emoji: '🍪' },
  { name: '其他', emoji: '📦' },
];

/**
 * 家庭成员统一成 {id, name, emoji}
 * 兼容早期存成 ["妈妈","爸爸"] 的字符串数组，老数据不用手动改
 */
function normMembers(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const m of input.slice(0, 30)) {
    const name = safeText(typeof m === 'object' && m ? m.name : m, 12).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const emoji =
      typeof m === 'object' && m && typeof m.emoji === 'string' && m.emoji.trim()
        ? safeText(m.emoji.trim(), 4)
        : MEMBER_EMOJI[out.length % MEMBER_EMOJI.length];
    out.push({
      id: typeof m === 'object' && m && typeof m.id === 'string' && m.id ? m.id : uid('m_'),
      name,
      emoji,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 预置食材库：录入库存时点一下就有名字、分类、单位、参考保质期
 * [名称, 分类, 单位, 保质期天数]
 * ------------------------------------------------------------------ */

const FOOD_PRESETS = [
  // 肉类
  ['猪里脊', '肉类', 'g', 3], ['五花肉', '肉类', 'g', 3], ['猪排骨', '肉类', 'g', 3],
  ['猪蹄', '肉类', 'g', 3], ['牛肉', '肉类', 'g', 3], ['牛腩', '肉类', 'g', 3],
  ['肥牛卷', '肉类', 'g', 90], ['羊肉', '肉类', 'g', 3], ['羊排', '肉类', 'g', 3],
  ['鸡胸肉', '肉类', 'g', 3], ['鸡腿', '肉类', 'g', 3], ['鸡翅', '肉类', 'g', 3],
  ['鸭肉', '肉类', 'g', 3], ['腊肉', '肉类', '块', 180], ['香肠', '肉类', '根', 30],
  ['火腿肠', '肉类', '根', 30], ['午餐肉', '肉类', '罐', 365],
  // 蛋类
  ['鸡蛋', '蛋类', '个', 20], ['鸭蛋', '蛋类', '个', 20], ['鹌鹑蛋', '蛋类', '个', 15],
  ['咸鸭蛋', '蛋类', '个', 60], ['皮蛋', '蛋类', '个', 90],
  // 奶制品
  ['纯牛奶', '奶制品', '盒', 30], ['酸奶', '奶制品', '盒', 21], ['奶酪', '奶制品', '片', 30],
  ['黄油', '奶制品', '块', 60], ['淡奶油', '奶制品', '盒', 30], ['奶粉', '奶制品', '罐', 540],
  // 蔬菜
  ['番茄', '蔬菜', '个', 7], ['黄瓜', '蔬菜', '根', 7], ['土豆', '蔬菜', '个', 30],
  ['洋葱', '蔬菜', '个', 30], ['胡萝卜', '蔬菜', '根', 21], ['大白菜', '蔬菜', '颗', 10],
  ['青菜', '蔬菜', '棵', 3], ['小油菜', '蔬菜', '把', 3], ['生菜', '蔬菜', '颗', 5],
  ['菠菜', '蔬菜', '把', 3], ['西兰花', '蔬菜', '颗', 7], ['芹菜', '蔬菜', '把', 7],
  ['茄子', '蔬菜', '个', 7], ['青椒', '蔬菜', '个', 10], ['小米椒', '蔬菜', 'g', 10],
  ['大蒜', '蔬菜', '头', 60], ['生姜', '蔬菜', '块', 30], ['香菇', '蔬菜', 'g', 5],
  ['金针菇', '蔬菜', '包', 7], ['木耳', '蔬菜', '包', 180], ['豆角', '蔬菜', 'g', 5],
  ['四季豆', '蔬菜', 'g', 5], ['冬瓜', '蔬菜', 'g', 7], ['南瓜', '蔬菜', 'g', 14],
  ['莲藕', '蔬菜', 'g', 7], ['山药', '蔬菜', 'g', 14], ['白萝卜', '蔬菜', '根', 14],
  ['玉米', '蔬菜', '根', 7], ['苦瓜', '蔬菜', '个', 7], ['西葫芦', '蔬菜', '个', 7],
  ['韭菜', '蔬菜', '把', 3], ['娃娃菜', '蔬菜', '颗', 7], ['紫甘蓝', '蔬菜', '颗', 10],
  // 水果
  ['苹果', '水果', '个', 14], ['香蕉', '水果', '根', 5], ['橙子', '水果', '个', 14],
  ['葡萄', '水果', 'g', 7], ['西瓜', '水果', 'g', 7], ['草莓', '水果', 'g', 3],
  ['蓝莓', '水果', 'g', 5], ['柠檬', '水果', '个', 14], ['梨', '水果', '个', 14],
  ['芒果', '水果', '个', 5], ['桃子', '水果', '个', 5], ['火龙果', '水果', '个', 7],
  ['猕猴桃', '水果', '个', 10], ['圣女果', '水果', 'g', 7],
  // 主食粮油
  ['大米', '主食粮油', 'g', 180], ['面粉', '主食粮油', 'g', 180], ['挂面', '主食粮油', 'g', 180],
  ['小米', '主食粮油', 'g', 180], ['糯米', '主食粮油', 'g', 180], ['燕麦片', '主食粮油', 'g', 180],
  ['馒头', '主食粮油', '个', 3], ['包子', '主食粮油', '个', 3], ['饺子', '主食粮油', '包', 90],
  ['面包', '主食粮油', '个', 5], ['吐司', '主食粮油', '个', 5], ['方便面', '主食粮油', '包', 120],
  ['米粉', '主食粮油', '包', 180], ['粉丝', '主食粮油', '包', 180], ['食用油', '主食粮油', '瓶', 300],
  // 豆制品
  ['豆腐', '豆制品', '块', 3], ['豆干', '豆制品', '块', 5], ['腐竹', '豆制品', '包', 180],
  ['豆浆', '豆制品', '杯', 2], ['黄豆', '豆制品', 'g', 180],
  // 水产海鲜
  ['草鱼', '水产海鲜', '条', 2], ['鲈鱼', '水产海鲜', '条', 2], ['鲫鱼', '水产海鲜', '条', 2],
  ['带鱼', '水产海鲜', 'g', 180], ['基围虾', '水产海鲜', 'g', 1], ['螃蟹', '水产海鲜', '只', 2],
  ['蛤蜊', '水产海鲜', 'g', 2], ['鱿鱼', '水产海鲜', 'g', 2], ['三文鱼', '水产海鲜', 'g', 3],
  // 冷冻食品
  ['速冻水饺', '冷冻食品', '包', 90], ['速冻汤圆', '冷冻食品', '包', 90],
  ['冷冻虾仁', '冷冻食品', 'g', 90], ['冰淇淋', '冷冻食品', '盒', 180],
  ['冷冻披萨', '冷冻食品', '张', 180], ['冷冻玉米', '冷冻食品', '根', 90],
  // 饮料
  ['矿泉水', '饮料', '瓶', 180], ['可乐', '饮料', '罐', 180], ['果汁', '饮料', '盒', 180],
  ['苏打水', '饮料', '瓶', 180], ['绿茶', '饮料', '瓶', 180], ['柠檬茶', '饮料', '瓶', 180],
  ['咖啡豆', '饮料', 'g', 180], ['速溶咖啡', '饮料', '盒', 180],
  // 调味干货
  ['食盐', '调味干货', '袋', 540], ['白砂糖', '调味干货', '袋', 365], ['生抽', '调味干货', '瓶', 540],
  ['老抽', '调味干货', '瓶', 540], ['香醋', '调味干货', '瓶', 540], ['蚝油', '调味干货', '瓶', 365],
  ['料酒', '调味干货', '瓶', 365], ['豆瓣酱', '调味干货', '瓶', 365], ['辣椒酱', '调味干货', '瓶', 365],
  ['番茄酱', '调味干货', '瓶', 365], ['沙拉酱', '调味干货', '瓶', 365], ['蜂蜜', '调味干货', '罐', 540],
  ['淀粉', '调味干货', '袋', 365], ['鸡精', '调味干货', '袋', 540], ['咖喱块', '调味干货', '盒', 365],
  ['花椒', '调味干货', '包', 180], ['干辣椒', '调味干货', 'g', 180], ['八角', '调味干货', '包', 180],
  ['孜然粒', '调味干货', '包', 180], ['辣椒面', '调味干货', '包', 180],
  // 零食
  ['薯片', '零食', '袋', 180], ['巧克力', '零食', '块', 365], ['饼干', '零食', '袋', 180],
  ['瓜子', '零食', '包', 180], ['花生', '零食', '包', 180], ['混合坚果', '零食', '罐', 180],
  ['糖果', '零食', '袋', 180],
  // 其他
  ['保鲜膜', '其他', '卷', 0], ['厨房纸', '其他', '卷', 0], ['洗洁精', '其他', '瓶', 1080],
];

/** 日期只认 YYYY-MM-DD，其它一律当作「没填」 */
function normDate(v) {
  const s = safeText(v, 10).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/**
 * 家庭统一成 {id, name, emoji, note, members[]}
 * 名字可以是房号（301）、门牌（西苑 2 栋 501），也可以是随便起的称呼
 */
function normHousehold(input, prev) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 20).trim();
  if (!name) return null;
  return {
    id: base.id || (typeof input.id === 'string' && input.id ? input.id : uid('h_')),
    name,
    emoji: safeText(input.emoji ?? base.emoji, 4) || '🏠',
    note: safeText(input.note ?? base.note, 100),
    members: normMembers(input.members ?? base.members) || [],
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/** 库存条目：{id, householdId, name, category, quantity, unit, expireAt, note} */
function normPantryItem(input, prev, keepInputId) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 24).trim();
  if (!name) return null;

  const rawQty = Number(input.quantity ?? base.quantity ?? 1);
  const qty = Number.isFinite(rawQty)
    ? Math.min(99999, Math.max(0, Math.round(rawQty * 1000) / 1000))
    : 0;

  const cat = safeText(input.category ?? base.category, 12).trim();
  const known = PANTRY_CATEGORIES.some((c) => c.name === cat);

  return {
    id:
      base.id ||
      (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('f_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    name,
    category: known ? cat : '其他',
    quantity: qty,
    unit: safeText(input.unit ?? base.unit, 8).trim() || '份',
    expireAt: normDate(input.expireAt ?? base.expireAt),
    note: safeText(input.note ?? base.note, 100),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: keepInputId && input.updatedAt ? safeText(input.updatedAt, 40) : nowISO(),
  };
}

/** 今天往前推 n 天，返回 YYYY-MM-DD */
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + Number(n || 0));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 一律按「周一开始」归周，传周一传今天都会落到同一周 */
function mondayOf(dateStr) {
  const s = normDate(dateStr) || todayStr();
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const date = new Date(y, m - 1, d);
  // getDay() 里周日是 0，换成周一为 0
  const back = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - back);
  const p = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 本周计划里的一道菜 */
function normPlanItem(input, prev, keepInputId) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 40).trim();
  if (!name) return null;
  return {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('pi_')),
    dishId: safeText(input.dishId ?? base.dishId, 40) || null,
    name,
    servings: safeText(input.servings ?? base.servings, 30),
    note: safeText(input.note ?? base.note, 100),
    addedAt: base.addedAt || input.addedAt || nowISO(),
  };
}

/** 一个家庭一周的计划：{id, householdId, weekOf, items[]} */
function normPlan(input, prev) {
  const base = prev || {};
  const weekOf = mondayOf(input.weekOf ?? base.weekOf);
  const items = (Array.isArray(input.items) ? input.items : base.items || [])
    .map((it) => normPlanItem(it, undefined, true))
    .filter(Boolean);
  // 同一周同一道菜只留一条
  const seen = new Set();
  return {
    id: base.id || (typeof input.id === 'string' && input.id ? input.id : uid('pl_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    weekOf,
    items: items.filter((it) => (seen.has(it.name) ? false : (seen.add(it.name), true))),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/** 找出某家庭某周的计划，没有就现建一条空的 */
function findPlan(householdId, weekOf, create) {
  const hid = resolveHouseholdId(householdId);
  const wk = mondayOf(weekOf);
  let plan = state.plans.find((p) => p.householdId === hid && p.weekOf === wk);
  if (!plan && create) {
    plan = { id: uid('pl_'), householdId: hid, weekOf: wk, items: [], createdAt: nowISO(), updatedAt: nowISO() };
    state.plans.push(plan);
  }
  return plan || null;
}

function loadState() {
  const base = defaultState();
  const fromDisk = new Set(); // 哪些数据文件是真的存在的，用来判断是不是首次升级
  for (const key of Object.keys(FILES)) {
    const file = path.join(DATA_DIR, FILES[key]);
    let parsed = null;
    try {
      if (fs.existsSync(file)) {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (err) {
      console.error(`[warn] ${FILES[key]} 解析失败，已使用默认值：${err.message}`);
      const backup = file + '.corrupt-' + Date.now();
      try {
        fs.renameSync(file, backup);
        console.error(`[warn] 原文件已备份到 ${backup}`);
      } catch (_) {
        /* ignore */
      }
    }
    if (parsed === null || parsed === undefined) {
      state[key] = base[key];
    } else {
      fromDisk.add(key);
      if (Array.isArray(base[key])) {
        state[key] = Array.isArray(parsed) ? parsed : base[key];
      } else {
        state[key] =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { ...base[key], ...parsed }
            : base[key];
      }
    }
  }
  // 分类去重修正（菜品按分类名归属）
  state.categories = state.categories.filter((c) => c && c.name);
  state.dishes = state.dishes.filter((d) => d && d.name);
  // 菜和分类分家是从 1.9 才有的。老数据没有 householdId 字段，
  // 一律补成 null（= 共享）：升级之后你原来录的菜还是人人可见，
  // 只是从今往后新加的菜可以只给自己家看。
  state.categories.forEach((c) => {
    if (c.householdId === undefined) c.householdId = null;
    else if (c.householdId) c.householdId = resolveHouseholdId(c.householdId);
  });
  state.dishes.forEach((d) => {
    if (d.householdId === undefined) d.householdId = null;
    else if (d.householdId) d.householdId = resolveHouseholdId(d.householdId);
  });
  // 按 id 去重：重复 id 会让删除/更新只命中一条
  const seenD = new Set();
  state.dishes = state.dishes.filter((d) => (seenD.has(d.id) ? false : (seenD.add(d.id), true)));
  const seenO = new Set();
  state.orders = state.orders.filter((o) => (seenO.has(o.id) ? false : (seenO.add(o.id), true)));
  // 加入申请的归属兜底：指向已经不存在的家庭的申请直接清掉，免得管理员看到一堆点不亮的待办
  const hhNow = new Set(state.households.map((h) => h.id));
  state.access.requests = (state.access.requests || []).filter(
    (r) => r && r.name && hhNow.has(r.householdId)
  );

  /* ---- 家庭 / 库存：从旧版本平滑升级 ---- */

  // 旧版本没有 households，settings.members 里存着家庭成员，搬进第一个家庭
  const legacyMembers = normMembers(state.settings.members) || [];

  state.households = (Array.isArray(state.households) ? state.households : [])
    .map((h) => (h && typeof h === 'object' ? normHousehold(h, undefined) : null))
    .filter(Boolean);

  const seenH = new Set();
  state.households = state.households.filter((h) =>
    seenH.has(h.id) ? false : (seenH.add(h.id), true)
  );
  if (!state.households.length) {
    state.households = [normHousehold({ name: '我家', emoji: '🏠', members: legacyMembers })];
  } else if (legacyMembers.length && !fromDisk.has('households')) {
    // households.json 是这次升级才有的，说明用户跑的是老版本：
    // settings.members 里的老成员认领给第一个家庭（不要被示例成员占位）
    state.households[0].members = legacyMembers;
  } else if (legacyMembers.length && !state.households.some((h) => h.members.length)) {
    state.households[0].members = legacyMembers;
  }
  delete state.settings.members; // 成员改由各家庭自己持有

  const hhIds = new Set(state.households.map((h) => h.id));
  const fallbackH = state.households[0].id;

  // 历史点餐 / 库存没有 householdId 的，都归到第一个家庭
  state.orders.forEach((o) => {
    if (!hhIds.has(o.householdId)) o.householdId = fallbackH;
  });

  const seenF = new Set();
  state.pantry = (Array.isArray(state.pantry) ? state.pantry : [])
    .map((p) => (p && typeof p === 'object' ? normPantryItem(p, undefined, true) : null))
    .filter(Boolean)
    .filter((p) => (seenF.has(p.id) ? false : (seenF.add(p.id), true)));
  state.pantry.forEach((p) => {
    if (!hhIds.has(p.householdId)) p.householdId = fallbackH;
  });

  // 本周计划：同样拉回有效家庭，周一归一
  const seenPl = new Set();
  state.plans = (Array.isArray(state.plans) ? state.plans : [])
    .map((pl) => (pl && typeof pl === 'object' ? normPlan(pl, undefined) : null))
    .filter(Boolean)
    .filter((pl) => (seenPl.has(pl.id) ? false : (seenPl.add(pl.id), true)));
  state.plans.forEach((pl) => {
    if (!hhIds.has(pl.householdId)) pl.householdId = fallbackH;
  });

  // 留言板：老版本没这个文件，走默认空板；坏数据按 normBoard 兜回来
  state.notes = normBoard(state.notes);
  const seenN = new Set();
  state.notes.notes = state.notes.notes.filter((n) =>
    seenN.has(n.id) ? false : (seenN.add(n.id), true)
  );
  state.notes.notes.forEach((n) => {
    if (!hhIds.has(n.householdId)) n.householdId = fallbackH;
  });
  // 留言挂的菜要是没了，整条退回成普通留言，别留一条谁也找不到的孤儿
  const dishIds = new Set(state.dishes.map((d) => d.id));
  state.notes.notes.forEach((n) => {
    if (n.kind === 'dish' && !dishIds.has(n.dishId)) {
      n.kind = 'board';
      n.dishId = null;
    }
  });
  // 投票挂在已删掉的菜上，纯垃圾，直接扔
  Object.keys(state.notes.votes).forEach((id) => {
    if (!dishIds.has(id)) delete state.notes.votes[id];
  });

  if (!hhIds.has(state.settings.currentHouseholdId)) {
    state.settings.currentHouseholdId = fallbackH;
  }
}

function persist(key) {
  const file = path.join(DATA_DIR, FILES[key]);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state[key], null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function scheduleSave(key) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      for (const k of Object.keys(FILES)) persist(k);
    } catch (err) {
      console.error('[error] 保存失败：', err.message);
    }
  }, 150);
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  for (const k of Object.keys(FILES)) persist(k);
}

/* ------------------------------------------------------------------ *
 * ZIP 读写 —— 自己手写的，零依赖
 *
 * 为什么不用现成的库：这个项目承诺「不需要 npm install」。而备份必须
 * 能带上 uploads/ 里的照片，照片在磁盘上是独立文件，JSON 装不下
 * （base64 撑爆 16MB 请求上限）。所以自己写一个够用的 ZIP：
 * 写：store 或 deflate（压不小就不压，省 CPU）
 * 读：从尾部找 EOCD，顺着中央目录逐个解
 *
 * 只支持标准 ZIP 的最常见形态，不做 ZIP64（4GB 以上）、不加密、不解压
 * 带密码的包 —— 家庭菜单的备份用不上那些。
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP 用的是 MS-DOS 时间（秒只有 2 秒精度，1980 年起） */
function dosStamp(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/**
 * 把 entries 写成 zip，逐条喂给 write(buf)。
 *
 * entries: [{ name, read() }] —— read() 每次调用返回一份**新的** Buffer。
 *   刻意不收「已经读好的 data」：几十张手机照片全读进来再拼一整个 zip，
 *   峰值就是照片总量的两倍。2G 的小机器上，一张 5MB 的照片多存几十张，
 *   每天凌晨那一次自动备份就足以把进程顶到几百 MB、被系统 OOM Killer 干掉。
 *   这里一次只留一个条目，写完就松手，峰值降到「单张照片 + 它的压缩结果」。
 *
 * write(buf) 得是同步的（res.write 或 fs.writeSync）。
 * 返回值是 zip 的总字节数，调用方拿它填 Content-Length。
 */
function zipWriteTo(entries, write) {
  const { time, date } = dosStamp(new Date());
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    let raw = e.read();
    const crc = crc32(raw);
    // 压不小就原样存：省掉一次 inflate/deflate，家庭菜单的 JSON 本来就压不动
    const deflated = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // 标志位：文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra 长度
    write(local);
    write(nameBuf);
    write(payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    cd.writeUInt16LE(20, 4); // 生成版本
    cd.writeUInt16LE(20, 6); // 解压所需版本
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // 起始磁盘号
    cd.writeUInt16LE(0, 36); // 内部属性
    cd.writeUInt32LE(0, 38); // 外部属性
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(centrals);
  if (cdBuf.length + offset > 0xffffffff) throw new Error('内容太大，超过 ZIP 上限');

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度
  write(cdBuf);
  write(eocd);

  return offset + cdBuf.length + eocd.length;
}

/**
 * 一次性打包成 Buffer（自检里的小样本用得上）。
 * 数据量大的路径一律别用它 —— 那正是把内存顶爆的那条路。
 */
function zipMake(files) {
  const parts = [];
  const size = zipWriteTo(
    files.map((f) => ({
      name: f.name,
      read: () => (Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8')),
    })),
    (b) => parts.push(b)
  );
  return Buffer.concat(parts, size);
}

/**
 * 读 zip，返回 Map<文件名, Buffer>。
 * 刻意不做「目录穿越」防护在函数里 —— 调用方拿到名字后必须自己
 * path.basename 消毒，否则一个 ../ 的条目就能把文件写到 uploads/ 外面。
 */
function zipRead(buf, maxTotalBytes) {
  // 从尾部往前找 EOCD 签名（注释最长 65535，所以往后多扫一段）
  let eocd = -1;
  const from = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('这不是有效的备份文件（不是 zip）');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('备份文件目录损坏');
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // 本地文件头的 extra 长度可能和中央目录记录的不一样，必须去本地头重读，
    // 直接拿中央目录的偏移算会差那么几个字节，图片就解不出来了
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error('备份文件内容损坏');
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    if (start + compSize > buf.length) throw new Error('备份文件内容不完整');

    total += rawSize;
    if (maxTotalBytes && total > maxTotalBytes) {
      throw new Error('备份文件解压后太大，已拒绝（可能是损坏文件）');
    }

    const payload = buf.slice(start, start + compSize);
    if (method === 8) out.set(name, zlib.inflateRawSync(payload));
    else if (method === 0) out.set(name, Buffer.from(payload));
    else throw new Error(`备份文件里有不支持的压缩方式（method=${method}）`);

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** 看看这坨字节是不是 zip（PK\x03\x04） */
function looksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/* ------------------------------------------------------------------ *
 * 备份 / 恢复
 *
 * 备份是一个 zip：backup.json（7 类数据）+ uploads/（照片）。
 * 之前导出只给 JSON，照片全丢 —— 菜谱在、图没了，恢复完才发现，
 * 等于备份了个寂寞。
 * ------------------------------------------------------------------ */

function backupPayload() {
  return {
    __app: 'family-menu',
    exportedAt: nowISO(),
    categories: state.categories,
    dishes: state.dishes,
    orders: state.orders,
    settings: state.settings,
    households: state.households,
    pantry: state.pantry,
    plans: state.plans,
    notes: state.notes,
    access: state.access,
  };
}

/**
 * 把一份备份灌进当前状态。返回恢复进去的条数。
 * 上传恢复和备份恢复共用这一段，免得两条路修一个漏一个。
 */
function applyBackup(src) {
  state.categories = Array.isArray(src.categories) ? src.categories : state.categories;
  state.dishes = src.dishes.map((d) => normDish(d, undefined, true)).filter(Boolean);
  if (Array.isArray(src.orders)) {
    state.orders = src.orders.map((o) => normOrder(o, undefined, true));
  }
  // 家庭要先恢复，否则点餐/库存的 householdId 会指向不存在的家庭
  if (Array.isArray(src.households)) {
    const seen = new Set();
    state.households = src.households
      .map((h) => normHousehold(h, undefined))
      .filter(Boolean)
      .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
    if (!state.households.length) state.households = defaultState().households;
  }
  if (Array.isArray(src.pantry)) {
    const seen = new Set();
    state.pantry = src.pantry
      .map((p) => normPantryItem(p, undefined, true))
      .filter(Boolean)
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }
  if (Array.isArray(src.plans)) {
    const seen = new Set();
    state.plans = src.plans
      .map((pl) => normPlan(pl, undefined))
      .filter(Boolean)
      .filter((pl) => (seen.has(pl.id) ? false : (seen.add(pl.id), true)));
  }
  // 家庭要先恢复，留言的 householdId 才有地方挂 —— 上一段已经恢复了
  if (src.notes && typeof src.notes === 'object') {
    state.notes = normBoard(src.notes);
  }
  // 加入申请同理：家庭已经回来了，才能判断申请指向的家庭还在不在
  if (src.access && typeof src.access === 'object' && Array.isArray(src.access.requests)) {
    const ids = new Set(state.households.map((h) => h.id));
    state.access = {
      requests: src.access.requests
        .filter((r) => r && r.id && r.name && ids.has(r.householdId))
        .slice(0, 50)
        .map((r) => ({
          id: safeText(r.id, 40),
          name: safeText(r.name, 20),
          householdId: safeText(r.householdId, 40),
          note: safeText(r.note, 100),
          at: safeText(r.at, 30) || nowISO(),
          status: r.status === 'ok' ? 'ok' : r.status === 'no' ? 'no' : 'pending',
        })),
    };
  }
  if (src.settings && typeof src.settings === 'object') {
    // hasPin 是给前端的派生标记，不是真配置，别让它进磁盘
    const { hasPin: _ignored, ...incoming } = src.settings;
    const prevPin = state.settings.adminPin;
    state.settings = { ...defaultState().settings, ...incoming };
    // 备份可能把口令换了或取消了，旧会话全部作废
    if (state.settings.adminPin !== prevPin) sessions.clear();
  }
  // 兜底：任何指向已删除家庭的记录拉回第一个家庭
  const hhIds = new Set(state.households.map((h) => h.id));
  if (!hhIds.has(state.settings.currentHouseholdId)) {
    state.settings.currentHouseholdId = state.households[0].id;
  }
  state.orders.forEach((o) => {
    if (!hhIds.has(o.householdId)) o.householdId = state.households[0].id;
  });
  state.pantry.forEach((p) => {
    if (!hhIds.has(p.householdId)) p.householdId = state.households[0].id;
  });
  state.plans.forEach((pl) => {
    if (!hhIds.has(pl.householdId)) pl.householdId = state.households[0].id;
  });
  state.notes.notes.forEach((n) => {
    if (!hhIds.has(n.householdId)) n.householdId = state.households[0].id;
  });

  saveNow();
  return {
    dishes: state.dishes.length,
    households: state.households.length,
    pantry: state.pantry.length,
    plans: state.plans.length,
    notes: state.notes.notes.length,
  };
}
const PHOTO_RE = /\.(jpg|jpeg|png|gif|webp|avif)$/i;

/**
 * 当前状态 + uploads/ 里的照片，列成待打包的条目。
 *
 * 照片只记**路径**，不读内容 —— 读的动作推迟到 zipWriteTo 真正写到那一条的时候。
 * 这样不管 uploads/ 里攒了多少张照片，打包时的内存上限都是「一张照片」，
 * 而不是「所有照片加起来」。见 zipWriteTo 的注释。
 */
function backupEntries() {
  const json = JSON.stringify(backupPayload(), null, 2);
  const entries = [{ name: 'backup.json', read: () => Buffer.from(json, 'utf8') }];
  let photos = 0;
  try {
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      if (!name || name.startsWith('.') || !PHOTO_RE.test(name)) continue;
      const full = path.join(UPLOAD_DIR, name);
      if (!fs.statSync(full).isFile()) continue;
      entries.push({ name: 'uploads/' + name, read: () => fs.readFileSync(full) });
      photos++;
    }
  } catch (_) {
    /* uploads/ 还没建，照片 0 张，不影响导出 */
  }
  return { entries, photos };
}

/**
 * 把 zip 里的照片写回 uploads/。
 * 条目名一律 path.basename —— 备份文件可能来自别人，一个
 * 「uploads/../../.bashrc」不能顺着写到 uploads/ 外面去。
 */
function restoreUploads(zipFiles) {
  let written = 0;
  let skipped = 0;
  for (const [name, data] of zipFiles) {
    if (!name.startsWith('uploads/')) continue;
    const base = path.basename(name);
    if (!base || base.startsWith('.') || !PHOTO_RE.test(base)) {
      skipped++;
      continue;
    }
    fs.writeFileSync(path.join(UPLOAD_DIR, base), data);
    written++;
  }
  return { written, skipped };
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

function listBackups() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^backup-\d{8}-\d{6}\.zip$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1)); // 新的排前面
  } catch (_) {
    return [];
  }
}

/** 备份名是外部来的，拼路径前必须认死格式，否则 ../ 就能读任意文件 */
function safeBackupName(name) {
  if (typeof name !== 'string' || !/^backup-\d{8}-\d{6}\.zip$/.test(name)) return null;
  return name;
}

function pruneBackups() {
  const all = listBackups();
  let n = 0;
  for (const old of all.slice(BACKUP_KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, old.name));
      n++;
    } catch (_) {
      /* ignore */
    }
  }
  return n;
}

function makeBackup(reason) {
  saveNow(); // 先把内存里的落盘，快照才是准的
  ensureBackupDir();
  const { entries, photos } = backupEntries();
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name =
    `backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`;
  const full = path.join(BACKUP_DIR, name);
  // 边压边写，不在内存里攒整个 zip
  const fd = fs.openSync(full, 'w');
  let size;
  try {
    size = zipWriteTo(entries, (b) => fs.writeSync(fd, b, 0, b.length));
  } finally {
    fs.closeSync(fd);
  }
  const pruned = pruneBackups();
  console.log(
    `[backup] ${name}  ${(size / 1024).toFixed(0)}KB  照片 ${photos} 张` +
      // 打 RSS 而不是堆用量：照片是 Buffer，压根不在 JS 堆里，
      // 只看 heapUsed 会得出「备份不吃内存」的错误结论。
      `  内存 RSS ${Math.round(process.memoryUsage().rss / 1048576)}MB` +
      (reason ? `  (${reason})` : '') +
      (pruned ? `  清理旧备份 ${pruned} 份` : '')
  );
  return { name, size, photos };
}

let autoBackupTimer = null;

function scheduleAutoBackup() {
  // 启动先来一份：万一这之前的数据已经是坏的，至少留个现场
  try {
    makeBackup('启动');
  } catch (err) {
    console.error('[backup] 启动快照失败：', err.message);
  }
  // 每天凌晨 3 点打一份（家里没人改数据的时间）
  const msUntilNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };
  const run = () => {
    autoBackupTimer = setTimeout(
      () => {
        try {
          makeBackup('每日');
        } catch (err) {
          console.error('[backup] 定时快照失败：', err.message);
        }
        run();
      },
      msUntilNext()
    );
    if (autoBackupTimer.unref) autoBackupTimer.unref();
  };
  run();
}

/* ------------------------------------------------------------------ *
 * 菜品规范化
 * ------------------------------------------------------------------ */

function normDish(input, prev, keepInputId) {
  const base = prev || {};
  const rawName = safeText(input.name, 40).trim();
  // 新建必须给名字（导入历史数据除外），避免空名菜谱混进菜单
  if (!rawName && prev === undefined && !keepInputId) return null;

  const d = {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('d_')),
    name: rawName || base.name || '未命名菜品',
    category: safeText(input.category ?? base.category, 24).trim() || '家常菜',
    // 共享菜（householdId 为 null）= 全体家庭都能看到；
    // 填了家庭 id = 只有那一家能看到。老数据没这个字段 → 当共享菜，
    // 升级过来你原来那 6 道菜还跟以前一样人人可见。
    householdId: normScope(input, base),
    description: safeText(input.description, 300),
    images: safeList(input.images ?? base.images)
      .map((s) => safeText(s, 300))
      .filter((s) => /^\/uploads\//.test(s))
      .slice(0, 9),
    servings: safeText(input.servings ?? base.servings, 30),
    duration: Number(input.duration ?? base.duration) || 0,
    difficulty: safeText(input.difficulty ?? base.difficulty, 12) || '简单',
    tags: (Array.isArray(input.tags)
      ? input.tags
      : safeText(input.tags, 120).split(/[,，\s]+/)
    )
      .map((t) => safeText(t, 12).trim())
      .filter(Boolean)
      .slice(0, 8),
    seasonings: safeList(input.seasonings)
      .map((s) => ({
        name: safeText(s && s.name, 30).trim(),
        amount: safeText(s && s.amount, 30).trim(),
      }))
      .filter((s) => s.name)
      .slice(0, 40),
    methods: safeList(input.methods)
      .map((m) => ({
        name: safeText(m && m.name, 24).trim() || '做法',
        // 每个做法可以带自己的调料。
        // 一道菜常有几种做法甚至几种口味（红烧/清蒸、甜口/辣口），
        // 用到的调料本来就不一样，全挂在菜品级就分不出谁是谁的。
        // 菜品级的 seasonings 现在的语义是「通用调料」，两种都不冲突。
        // 老数据没有这个字段，解析出来就是空数组 —— 不用迁移，菜谱不会少东西。
        seasonings: safeList(m && m.seasonings)
          .map((s) => ({
            name: safeText(s && s.name, 30).trim(),
            amount: safeText(s && s.amount, 30).trim(),
          }))
          .filter((s) => s.name)
          .slice(0, 40),
        steps: (Array.isArray(m && m.steps)
          ? m.steps
          : safeText(m && m.steps, 3000).split('\n')
        )
          .map((s) => safeText(s, 400).trim())
          .filter(Boolean)
          .slice(0, 40),
      }))
      .filter((m) => m.steps.length)
      .slice(0, 8),
    notes: safeText(input.notes, 1000),
    isFavorite: input.isFavorite === undefined ? !!base.isFavorite : !!input.isFavorite,
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
  return d;
}

/**
 * 菜品 / 分类的归属：null = 共享（全体家庭可见），字符串 = 只有那一家可见。
 *
 * 显式传 null / '' / 'shared' 才算「共享」；没传这个字段时沿用原来的归属，
 * 这样编辑器不碰它就不会把一道共享菜偷偷改成私有的。
 */
function normScope(input, base) {
  const raw = input.householdId;
  if (raw === undefined) return base.householdId === undefined ? null : base.householdId;
  if (raw === null || raw === '' || raw === 'shared') return null;
  const id = safeText(raw, 40);
  if (!id || !state.households.some((h) => h.id === id)) return null; // 认不出的当共享，别把人家的菜弄丢
  return id;
}

/**
 * 一道菜能不能放进它那个分类。
 *
 * 分了家之后菜和分类各有归属，只有「菜的范围 ⊇ 分类的范围」才说得通：
 *   共享菜 + 共享分类        ✅ 大家都能看到
 *   私菜   + 共享分类        ✅ 只有本家看得到，不影响别人
 *   私菜   + 自家私有分类    ✅ 自家范围内自洽
 *   共享菜 + 任意私有分类    ❌ 别人家看得见这道菜，却看不到它属于哪个分类，等于凭空多出一道菜
 *   私菜   + 别人家私有分类  ❌ 存了谁都看不到
 * 最后两种直接拒掉，免得用户以为菜存进去了，回头在菜单里找不到或者对不上号。
 */
function categoryProblem(dish) {
  const cat = state.categories.find((c) => c.name === dish.category);
  if (!cat) return null; // 分类不存在（比如老数据引用的分类被删了）不拦，兼容旧行为
  if (!cat.householdId || cat.householdId === dish.householdId) return null;
  const owner = (state.households.find((h) => h.id === cat.householdId) || {}).name || '别的家庭';
  return `「${cat.name}」是「${owner}」的私有分类，只有同样仅本家可见的菜才能放进去。换一个共享分类，或者把这道菜也设成仅本家。`;
}

/** 只认已存在的家庭 id，认不出就落到当前/默认家庭，避免数据悬空 */
function resolveHouseholdId(v) {
  const id = safeText(v, 40);
  if (id && state.households.some((h) => h.id === id)) return id;
  const cur = state.settings && state.settings.currentHouseholdId;
  if (cur && state.households.some((h) => h.id === cur)) return cur;
  return (state.households[0] && state.households[0].id) || '';
}

function normOrder(input, prev, keepInputId) {
  const base = prev || {};
  return {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('o_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    dishId: input.dishId ? safeText(input.dishId, 40) : null,
    dishName: safeText(input.dishName, 40).trim() || base.dishName || '随便吃点',
    requester: safeText(input.requester, 20).trim() || '匿名',
    people: Math.max(1, Math.min(20, Number(input.people) || base.people || 2)),
    note: safeText(input.note, 200),
    status: ['pending', 'cooking', 'done', 'cancelled'].includes(input.status)
      ? input.status
      : base.status || 'pending',
    date: safeText(input.date, 20) || base.date || todayStr(),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/* ------------------------------------------------------------------ *
 * 留言板 / 菜品互动
 *
 * 一条留言同时是三件事的载体：正文、别人的表情回应、楼中楼回复。
 * 「我来认领」也挂在留言上（今晚我做饭 / 我去买菜），一条留言只能有
 * 一个人认领 —— 两个人都说「我来做」不如没认领。
 * ------------------------------------------------------------------ */

// 能用的表情就这几个：够表达意思，又不至于把留言板变成表情包展销
const REACT_EMOJI = ['👍', '❤️', '😂', '😋', '🙏', '🔥'];
const STICKER_EMOJI = ['🍳', '🛒', '🌶️', '🍚', '🎉', '⚠️', '💤', '🧊'];
const MAX_REACTIONS = 6; // 一条留言最多几种不同的表情，够表态也够看得清
const MAX_REPLIES = 30;

function normReactions(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const emoji of REACT_EMOJI) {
    const list = input[emoji];
    if (!Array.isArray(list) || !list.length) continue;
    // 同一个人点两次只算一次；名字去重后限量，防止有人狂刷
    const who = [...new Set(list.map((w) => safeText(w, 20).trim()).filter(Boolean))].slice(0, 20);
    if (who.length) out[emoji] = who;
  }
  return out;
}

function normReplies(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const text = safeText(r.text, 300).trim();
      if (!text) return null;
      let id = safeText(r.id, 40);
      if (!id || seen.has(id)) id = uid('r_');
      seen.add(id);
      return {
        id,
        author: safeText(r.author, 20).trim() || '匿名',
        text,
        createdAt: safeText(r.createdAt, 30) || nowISO(),
      };
    })
    .filter(Boolean)
    .slice(-MAX_REPLIES); // 只留最近的，多的丢掉
}

function normNote(input, prev, keepInputId) {
  const base = prev || {};
  const kind = input.kind === 'dish' ? 'dish' : 'board';
  const text = safeText(input.text, 500).trim();
  // 菜品留言必须挂着菜
  const dishId = kind === 'dish' ? safeText(input.dishId ?? base.dishId, 40) || null : null;

  let claim = base.claim && base.claim.by
    ? { by: safeText(base.claim.by, 20).trim() || base.claim.by, at: base.claim.at || base.createdAt || nowISO() }
    : null;
  if (input.claim !== undefined) {
    const by = safeText(input.claim && typeof input.claim === 'object' ? input.claim.by : input.claim, 20).trim();
    // 传空字符串 = 取消认领
    claim = by ? { by, at: nowISO() } : null;
  }

  const sticker = safeText(input.sticker, 8);
  return {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('n_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    kind,
    dishId,
    author: safeText(input.author, 20).trim() || base.author || '匿名',
    text: text || base.text || '',
    sticker: STICKER_EMOJI.includes(sticker) ? sticker : '',
    reactions: input.reactions !== undefined ? normReactions(input.reactions) : normReactions(base.reactions),
    claim,
    replies: input.replies !== undefined ? normReplies(input.replies) : normReplies(base.replies),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/** 把 ?ids=a,b,c 解析成去重后的 Set，顺手把长度超限的挡掉 */
function parseIds(raw) {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(',')
      .map((s) => safeText(s, 40))
      .filter(Boolean)
  );
}

/** 菜品投票：{ 'd_xxx': { want: ['我','妈'], cook: ['爸'] } } */
function normVotes(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [dishId, v] of Object.entries(input)) {
    if (!dishId || !v || typeof v !== 'object') continue;
    const pick = (arr) =>
      [...new Set((Array.isArray(arr) ? arr : []).map((w) => safeText(w, 20).trim()).filter(Boolean))].slice(0, 20);
    const want = pick(v.want);
    const cook = pick(v.cook);
    if (want.length || cook.length) out[dishId] = { want, cook };
  }
  return out;
}

/** 老数据 / 坏数据兜底：notes 永远是 { notes: [], votes: {} } 这个形状 */
function normBoard(input) {
  return {
    notes: (Array.isArray(input && input.notes) ? input.notes : [])
      .map((n) => (n && typeof n === 'object' ? normNote(n, undefined, true) : null))
      .filter(Boolean)
      .filter((n) => n.text),
    votes: normVotes(input && input.votes),
  };
}

/* ------------------------------------------------------------------ *
 * HTTP 基础
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, code, message) {
  sendJSON(res, code, { ok: false, error: message });
}

/* ------------------------------------------------------------------ *
 * 管理口令
 *
 * 口令是拦「乱改菜谱」的，不是拦网络攻击者的 —— 威胁模型是同一个
 * 局域网里手欠的家里人。所以没必要上完整的账号体系，一个口令换一枚
 * 会话 token 就够：口令不落前端，token 走请求头，服务端自己判定。
 *
 * 没设口令时一律放行，保持「装了就能用」的默认状态。
 * ------------------------------------------------------------------ */

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 小时
const sessions = new Map(); // token -> 过期时间戳

function pruneSessions() {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp <= now) sessions.delete(t);
}

function issueSession() {
  if (sessions.size > 200) pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

/** 没设口令 → 放行；设了 → 必须带有效 token */
function isAuthed(req) {
  const pin = state.settings.adminPin;
  if (!pin) return true;
  const token = req.headers['x-auth-token'];
  if (!token || typeof token !== 'string') return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_TTL); // 滑动续期
  return true;
}

/**
 * 需要管理权限的写操作。
 * 点餐、库存、本周计划**不在列** —— 那是家里人每天都要用的，
 * 口令不该挡着他们正常吃饭。
 */
const ADMIN_WRITES = new Set(['households', 'dishes', 'categories', 'settings', 'import', 'upload']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（上限 16MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

/** 和 readBody 一样，但收原始字节（恢复备份传的是 zip 本体，不是 JSON） */
function readBodyRaw(req, limit) {
  const max = limit || MAX_BODY;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error(`请求体过大（上限 ${Math.round(max / 1024 / 1024)}MB）`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, filePath, cacheable) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

async function handleAPI(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = seg.slice(1);
  const method = req.method;

  // ---- 登录换会话 token ----
  if (method === 'POST' && route.length === 1 && route[0] === 'auth') {
    const body = await readBody(req);
    const pin = state.settings.adminPin || '';
    const given = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!pin) return sendJSON(res, 200, { ok: true, data: { token: '', hasPin: false } });
    if (given !== pin) return sendError(res, 401, '口令不对');
    return sendJSON(res, 200, { ok: true, data: { token: issueSession(), hasPin: true } });
  }

  // ---- 统一守卫 ----
  // 管理类的写操作要有有效会话；导出/导入因为文件里含口令明文，同样要认证。
  // AI 调用要花钱，也不能让别人白用。
  // 点餐、库存、本周计划不在保护范围内 —— 那是家里人每天都要用的。
  // 统一守卫。备份一律要认证，GET 也要 —— 备份里存着管理口令明文，
  // 「只能下载不能看列表」等于没保护。
  const needsAuth =
    route[0] === 'export' ||
    route[0] === 'backups' ||
    route[0] === 'ai' ||
    // 普通用户可以提交点餐，但不能改做饭状态、删除点餐或清空已完成记录。
    (route[0] === 'orders' && method !== 'GET' && !(method === 'POST' && !route[1])) ||
    // 加入申请：提交谁都能做（人总得有个申请入口），批准/拒绝是管理员的活
    (route[0] === 'join-requests' && method !== 'GET' && !!route[1]) ||
    (method !== 'GET' && method !== 'HEAD' && ADMIN_WRITES.has(route[0]));
  if (needsAuth && !isAuthed(req)) {
    return sendError(res, 401, '需要管理口令，请先在「管理」页解锁');
  }

  // ---- AI ----
  // 只暴露「能不能用」和「用的哪个模型」，永远不下发 Key
  if (method === 'GET' && route.length === 1 && route[0] === 'ai') {
    return sendJSON(res, 200, { ok: true, data: aiStatus() });
  }

  // 通用对话入口。task 只用来挑提示词模板，不接受前端传任意模型/baseUrl，
  // 免得有人拿这个接口当任意 API 的跳板。
  if (method === 'POST' && route.length === 2 && route[0] === 'ai' && route[1] === 'chat') {
    const body = await readBody(req);
    const task = safeText(body && body.task, 30);
    const prompt = safeText(body && body.prompt, 12000);
    const imageUrl = safeText(body && body.imageUrl, 8 * 1024 * 1024);
    if (!prompt) return sendError(res, 400, '内容不能为空');

    const AI_TASKS = {
      // 从一张照片生成菜谱草稿。这是 AI 现在唯一的「看东西」入口：
      // 它只认菜，不知道这个家里已经有哪些菜，也不会替用户做决定。
      'recipe-from-image': {
        system:
          '你是中餐菜谱助手。用户会给你一道菜的照片（成品图或食材图）。' +
          '请只输出 JSON，不要任何解释、不要 markdown 代码块。格式：' +
          '{"name":"菜名","category":"分类","description":"一句话介绍",' +
          '"servings":"份量","duration":分钟数,"difficulty":"简单|中等|有点难",' +
          '"tags":["标签"],"seasonings":[{"name":"食材","amount":"用量"}],' +
          '"methods":[{"name":"做法名","seasonings":[{"name","amount"}],"steps":["一步一句"]}],' +
          '"notes":"备注"}。' +
          '要求：分类从家常菜/主食/汤羹/凉菜/早餐/小吃甜点/饮品/其他里挑一个；' +
          '调料用量写「2 个」「400g」「1 小勺」这种能直接买菜的形式；步骤 4-8 步。' +
          'seasonings 是所有做法都要用的通用调料；只有当这道菜有多种做法时，' +
          '才把某几个做法独有的调料放进那个做法的 seasonings 里，通用调料不要重复放。' +
          '看不清的字段就留空字符串或空数组，不要编造。',
        wantJSON: true,
        think: true, // 看图要仔细判断，给它开思考
      },
      // 从一段纯文字（纸质菜单、外卖页面、群里转发的做法）生成菜谱草稿。
      // 同样只填表单，存不存由人按。
      'recipe-from-text': {
        system:
          '你是中餐菜谱助手。用户会给你一段文字，可能来自纸质菜单、外卖页面、' +
          '或者群里转发的一段做法。请把它整理成一道菜的菜谱，只输出 JSON，' +
          '不要任何解释、不要 markdown 代码块。格式：' +
          '{"name":"菜名","category":"分类","description":"一句话介绍",' +
          '"servings":"份量","duration":分钟数,"difficulty":"简单|中等|有点难",' +
          '"tags":["标签"],"seasonings":[{"name":"食材","amount":"用量"}],' +
          '"methods":[{"name":"做法名","seasonings":[{"name","amount"}],"steps":["一步一句"]}],' +
          '"notes":"备注"}。' +
          '要求：分类从家常菜/主食/汤羹/凉菜/早餐/小吃甜点/饮品/其他里挑一个；' +
          '调料用量写「2 个」「400g」「1 小勺」这种能直接买菜的形式；步骤 4-8 步。' +
          'seasonings 是所有做法都要用的通用调料；只有当这道菜有多种做法时，' +
          '才把某几个做法独有的调料放进那个做法的 seasonings 里，通用调料不要重复放。' +
          '原文里只有菜名没写做法时，按常见做法把 seasonings 和 methods 补完整，' +
          '并在 notes 里写一句「用量和步骤是按常见做法补的」。' +
          '原文没有的信息就留空字符串或空数组，不要编造。',
        wantJSON: true,
      },
      'recipe-normalize': {
        system:
          '你是菜谱整理助手。请把用户给的这道菜整理成规范格式，只输出 JSON，' +
          '不要解释、不要 markdown 代码块。格式：' +
          '{"name","category","description","servings","duration":分钟数,' +
          '"difficulty","tags":[],"seasonings":[{"name","amount"}],' +
          '"methods":[{"name","seasonings":[{"name","amount"}],"steps":[]}],"notes"}。' +
          '做法：统一份量写法（如「2-3 人份」「3 碗」）、把用量写规范、' +
          '步骤一行一步、补上原文里明显缺的字段。不要凭空增加原文没有的食材。' +
          '一道菜有多种做法时，把各做法独有的调料放进那个做法的 seasonings，' +
          '通用的留在菜品级；只有一个做法时调料一律放菜品级，那个做法的 seasonings 留空数组。',
        wantJSON: true,
      },
      'cook-plan': {
        system:
          '你是厨房调度助手。用户会给今天要一起做的几道菜。' +
          '请给出并行下厨的顺序：备菜可以并行，热灶必须串行，等待（腌/炖）时去做别的。' +
          '只输出 JSON，不要解释。格式：' +
          '{"prep":["备菜事项"],"sequence":[{"step":1,"what":"做什么","dish":"哪道菜","why":"为什么这么做"}],' +
          '"tips":["提醒"]}。',
        wantJSON: true,
      },
      // 厨房助手现在用的是这个：把 cook-plan 的「顺序」升级成带时间轴的整条流程
      'prep-timeline': {
        system:
          '你是厨房调度助手。用户会给今天要一起做的几道菜，请排出一条从「开始洗菜」' +
          '到最后一道菜上桌的完整流程。只输出 JSON，不要解释、不要 markdown 代码块。格式：' +
          '{"totalMinutes":总耗时分钟数,' +
          '"stages":[{"step":1,"startMinute":从第几分钟开始,"minutes":这一步要几分钟,' +
          '"what":"具体做什么（动词开头，一句话）","dish":"属于哪道菜，没有就空字符串",' +
          '"parallel":true或false,"why":"为什么这一步排在这里"}],' +
          '"tips":["提醒"]}。' +
          '要求：' +
          '1) startMinute 必须和前面所有步骤的时长对得上——第一步 startMinute=0，' +
          '之后每一步的 startMinute = 上一步 startMinute + 上一步 minutes；' +
          '2) parallel=true 表示这一步可以和别的菜同时做（洗菜、切配、腌肉、蒸饭），' +
          'parallel=false 表示必须守着灶台或必须等上一步做完（下锅、翻炒、收汁、装盘）；' +
          '3) minutes 写实际耗时，洗菜切菜 3-8 分钟，下锅翻炒 2-5 分钟，' +
          '炖煮 15-40 分钟，不要一律填 5；' +
          '4) 步骤 5-12 条，从备菜一直写到全部上桌；' +
          '5) why 用一句话说明为什么这么排，不要空话。',
        wantJSON: true,
      },
    };

    const t = AI_TASKS[task];
    if (!t) return sendError(res, 400, '不认识这个 AI 任务');

    const userContent = imageUrl
      ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }]
      : prompt;
    // 不接受前端直接传消息数组 —— 那等于把这个接口变成任意角色扮演的跳板。
    // AI 现在是单轮的「拍照/文字 → 菜谱草稿」，没有多轮对话可言。
    const messages = [{ role: 'system', content: t.system }, { role: 'user', content: userContent }];
    const r = await callAI(messages, { wantJSON: t.wantJSON, think: !!t.think });
    if (!r.ok) return sendJSON(res, 200, { ok: true, data: { ok: false, error: r.error } });
    if (t.wantJSON && !r.json) {
      return sendJSON(res, 200, {
        ok: true,
        data: { ok: false, error: 'AI 的回复看不懂（不是合法 JSON），可以再试一次' },
      });
    }
    return sendJSON(res, 200, {
      ok: true,
      data: { ok: true, result: t.wantJSON ? r.json : r.text, usage: r.usage, model: r.model },
    });
  }

  // GET /api/version —— 版本号和更新内容。
  // 不用认证：这里没有任何用户数据，网页上任何人都该能看到自己跑的是哪一版。
  if (method === 'GET' && route.length === 1 && route[0] === 'version') {
    return sendJSON(res, 200, {
      ok: true,
      data: { version: APP_VERSION, releases: RELEASES },
    });
  }

  // GET /api/state —— 全量状态（家庭规模数据很小，一次取完最省事）
  if (method === 'GET' && route.length === 1 && route[0] === 'state') {
    // 口令绝不能跟着 state 一起发出去：否则局域网里任何人按 F12
    // 就能在返回的 JSON 里读到明文，管理口令形同虚设。
    const { adminPin, ...pubSettings } = state.settings;
    const requestedHouseholdId = safeText(url.searchParams.get('householdId'), 40);
    const requestedHousehold = state.households.find((h) => h.id === requestedHouseholdId);
    const visibleHouseholdId = requestedHousehold
      ? requestedHousehold.id
      : state.households[0]
      ? state.households[0].id
      : '';
    // 没设口令时仍是兼容旧版本的开放模式；设了口令后，只有有效会话能看全量状态。
    const fullState = !adminPin || isAuthed(req);
    const visibleDishes = fullState
      ? state.dishes
      : state.dishes.filter((d) => !d.householdId || d.householdId === visibleHouseholdId);
    const visibleDishIds = new Set(visibleDishes.map((d) => d.id));
    const visibleCategories = fullState
      ? state.categories
      : state.categories.filter((c) => !c.householdId || c.householdId === visibleHouseholdId);
    const visibleNotes = fullState
      ? state.notes.notes
      : state.notes.notes.filter((n) => n.householdId === visibleHouseholdId);
    const visibleVotes = fullState
      ? state.notes.votes
      : Object.fromEntries(
          Object.entries(state.notes.votes).filter(([dishId]) => visibleDishIds.has(dishId))
        );
    const visibleAccess = fullState
      ? state.access.requests
      : state.access.requests.filter(
          (r) => r.name === safeText(url.searchParams.get('memberName'), 20).trim()
        );
    return sendJSON(res, 200, {
      ok: true,
      data: {
        categories: visibleCategories,
        dishes: visibleDishes,
        orders: fullState
          ? state.orders
          : state.orders.filter((o) => o.householdId === visibleHouseholdId),
        settings: { ...pubSettings, hasPin: !!adminPin },
        households: state.households,
        pantry: fullState
          ? state.pantry
          : state.pantry.filter((p) => p.householdId === visibleHouseholdId),
        plans: fullState
          ? state.plans
          : state.plans.filter((p) => p.householdId === visibleHouseholdId),
        notes: { notes: visibleNotes, votes: visibleVotes },
        access: { requests: visibleAccess },
      },
    });
  }

  // GET /api/ingredient-presets —— 常见食材预设（录库存时选一下就有分类和保质期）
  if (method === 'GET' && route.length === 1 && route[0] === 'ingredient-presets') {
    return sendJSON(res, 200, {
      ok: true,
      data: {
        categories: PANTRY_CATEGORIES,
        presets: FOOD_PRESETS.map((p) => ({
          name: p[0],
          category: p[1],
          unit: p[2],
          shelfLife: p[3],
          expireAt: p[3] > 0 ? daysFromNow(p[3]) : '',
        })),
      },
    });
  }

  // ---- 加入申请 ----
  // 提交申请谁都能做（人总得有个申请入口）；批准/拒绝是管理员的活，要口令。
  if (route[0] === 'join-requests') {
    const id = route[1];
    const body = method !== 'GET' ? await readBody(req) : {};

    if (method === 'GET') {
      const fullAccess = !state.settings.adminPin || isAuthed(req);
      const memberName = safeText(url.searchParams.get('memberName'), 20).trim();
      const requests = fullAccess
        ? state.access.requests
        : state.access.requests.filter((r) => r.name === memberName);
      return sendJSON(res, 200, { ok: true, data: requests });
    }

    if (method === 'POST' && !id) {
      const name = safeText(body.name, 20).trim();
      const householdId = safeText(body.householdId, 40);
      if (!name) return sendError(res, 400, '写上你是谁，管理员才知道批给谁');
      const house = state.households.find((h) => h.id === householdId);
      if (!house) return sendError(res, 404, '这个家庭不存在');
      if (house.members.some((m) => m.name === name)) {
        return sendError(res, 409, `「${name}」已经是${house.name}的成员了`);
      }
      // 同一家的同名申请只留最新的一条，免得刷出一长串等价的待办
      const dup = state.access.requests.find((r) => r.name === name && r.householdId === householdId);
      if (dup) {
        dup.at = nowISO();
        dup.note = safeText(body.note, 100).trim();
        return sendJSON(res, 200, { ok: true, data: dup, updated: true });
      }
      const req = {
        id: uid('j_'),
        name,
        householdId,
        note: safeText(body.note, 100).trim(),
        at: nowISO(),
        status: 'pending',
      };
      state.access.requests.unshift(req);
      // 别无限堆：已处理的只留最近 20 条，待处理的全留
      const done = state.access.requests.filter((r) => r.status !== 'pending');
      if (done.length > 20) {
        const drop = new Set(done.slice(20).map((r) => r.id));
        state.access.requests = state.access.requests.filter((r) => !drop.has(r.id));
      }
      scheduleSave('access');
      return sendJSON(res, 200, { ok: true, data: req });
    }

    if (method === 'PUT' && id) {
      const req = state.access.requests.find((r) => r.id === id);
      if (!req) return sendError(res, 404, '申请不存在');
      const status = body.status === 'ok' ? 'ok' : 'no';
      req.status = status;
      req.at = nowISO();
      // 批准 = 真的把人加进这个家庭。光改状态不生效的话，
      // 被批准的人在成员列表里还是找不到自己，等于没批
      if (status === 'ok') {
        const house = state.households.find((h) => h.id === req.householdId);
        if (house && !house.members.some((m) => m.name === req.name)) {
          house.members.push({
            id: uid('m_'),
            name: req.name,
            emoji: MEMBER_EMOJI[house.members.length % MEMBER_EMOJI.length],
          });
          scheduleSave('households');
        }
      }
      scheduleSave('access');
      return sendJSON(res, 200, { ok: true, data: req });
    }

    if (method === 'DELETE' && id) {
      const before = state.access.requests.length;
      state.access.requests = state.access.requests.filter((r) => r.id !== id);
      scheduleSave('access');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.access.requests.length } });
    }
    return sendError(res, 405, '不支持的请求');
  }

  // ------------------------------------------------------------------
  // 自家菜单：给**没有管理员口令**的家里人用。
  //
  // 分工是这样的：
  //   共享菜（householdId 为空）是管理员的地盘 —— 谁想改公共菜谱，先过口令。
  //   本家私菜是家里人自己的 —— 不用口令，想加就加，想改就改，想删就删。
  //
  // 所以这组端点必须在上面的守卫**之前**处理（'my-dishes' / 'my-categories'
  // 不在 ADMIN_WRITES 里），并且每一条都把 householdId 钉死在查询参数上：
  // 客户端说什么不算数，只有它确实存在、且目标东西本来就属于这个家，才算数。
  // ------------------------------------------------------------------

  if (route[0] === 'my-dishes' || route[0] === 'my-categories') {
    const mine = route[0] === 'my-dishes';
    const id = route[1];
    const hhId = url.searchParams.get('householdId');
    const house = hhId && state.households.find((h) => h.id === hhId);
    if (!house) return sendError(res, 400, '没说要改哪一家，先切换家庭');

    /** 只认「本来就属于这一家」的东西 */
    const owns = (o) => o.householdId === hhId;

    if (mine) {
      // 收进我家：把一道共享菜复制一份成自家私菜。
      // 这是普通人碰公共菜谱的唯一正当途径 —— 不改它，只是抄一份自己改。
      if (method === 'POST' && route[2] === 'adopt' && id) {
        const src = state.dishes.find((d) => d.id === id);
        if (!src) return sendError(res, 404, '菜品不存在');
        const copy = normDish({ ...src, id: '', householdId: hhId });
        copy.name = src.name;
        copy.isFavorite = false;
        copy.createdAt = nowISO();
        const bad = categoryProblem(copy);
        if (bad) return sendError(res, 400, bad);
        state.dishes.unshift(copy);
        scheduleSave('dishes');
        return sendJSON(res, 200, { ok: true, data: copy });
      }

      if (method === 'POST' && !id) {
        const dish = normDish({ ...(await readBody(req)), householdId: hhId });
        if (!dish || !dish.name) return sendError(res, 400, '菜名不能为空');
        const bad = categoryProblem(dish);
        if (bad) return sendError(res, 400, bad);
        state.dishes.unshift(dish);
        scheduleSave('dishes');
        return sendJSON(res, 200, { ok: true, data: dish });
      }
      if (method === 'PUT' && id) {
        const idx = state.dishes.findIndex((d) => d.id === id);
        if (idx < 0) return sendError(res, 404, '菜品不存在');
        if (!owns(state.dishes[idx])) {
          return sendError(res, 403, '这是公共菜谱（或别人家的菜），改不了。要改可以「收进我家」自己抄一份。');
        }
        const dish = normDish({ ...(await readBody(req)), householdId: hhId }, state.dishes[idx]);
        const bad = categoryProblem(dish);
        if (bad) return sendError(res, 400, bad);
        state.dishes[idx] = dish;
        scheduleSave('dishes');
        return sendJSON(res, 200, { ok: true, data: dish });
      }
      if (method === 'DELETE') {
        // 一律用 Set：数组没有 .size，下面那句 !ids.size 会永远成立
        const ids = id
          ? new Set([id])
          : new Set(
              String(url.searchParams.get('ids') || '')
                .split(',')
                .map((s) => safeText(s, 40))
                .filter(Boolean)
            );
        if (!ids.size) return sendError(res, 400, '要删哪几条？');
        // 删单条时直接说不行；批量时只跳过 —— 批量里混了公共菜是常事，
        // 逐条报错会让人以为整批都没删掉
        if (id) {
          const one = state.dishes.find((d) => d.id === id);
          if (!one) return sendError(res, 404, '菜品不存在');
          if (!owns(one)) {
            return sendError(res, 403, '这是公共菜谱（或别人家的菜），删不了。想改成自己的版本，用「收进我家」抄一份。');
          }
        }
        // 只删真正属于这一家的。混进来的共享菜一条都不动 ——
        // 非管理员不该有「顺手把公共菜删了」这种可能。
        const kill = state.dishes.filter((d) => ids.has(d.id) && owns(d));
        const shared = ids.size - kill.length;
        state.dishes = state.dishes.filter((d) => !(ids.has(d.id) && owns(d)));
        for (const gone of kill) {
          state.orders = state.orders.filter((o) => !(o.dishId === gone.id && o.status !== 'done'));
          state.plans.forEach((p) => {
            p.items = p.items.filter((it) => it.dishId !== gone.id);
          });
          state.notes.notes.forEach((n) => {
            if (n.kind === 'dish' && n.dishId === gone.id) {
              n.kind = 'board';
              n.dishId = null;
            }
          });
          delete state.notes.votes[gone.id];
        }
        scheduleSave('dishes');
        scheduleSave('orders');
        scheduleSave('plans');
        scheduleSave('notes');
        return sendJSON(res, 200, {
          ok: true,
          data: { removed: kill.length, kept: shared, first: kill[0] || null },
        });
      }
      return sendError(res, 405, '不支持的请求');
    }

    // ---- 自家私有分类 ----
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const name = safeText(body.name, 24).trim();
      if (!name) return sendError(res, 400, '分类名不能为空');
      if (state.categories.some((c) => c.name === name)) {
        return sendError(res, 400, '已经有同名的分类了（也可能属于别的家庭）。换个名字吧。');
      }
      const cat = { id: uid('c_'), name, householdId: hhId, order: state.categories.length + 1 };
      state.categories.push(cat);
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'PUT' && id) {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return sendError(res, 404, '分类不存在');
      if (!owns(cat)) return sendError(res, 403, '这是公共分类（或别人家的分类），改不了。');
      const body = await readBody(req);
      const name = safeText(body.name, 24).trim() || cat.name;
      if (state.categories.some((c) => c.id !== id && c.name === name)) {
        return sendError(res, 400, '已经有同名的分类了，换个名字吧。');
      }
      cat.name = name;
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'DELETE' && id) {
      const idx = state.categories.findIndex((c) => c.id === id);
      if (idx < 0) return sendError(res, 404, '分类不存在');
      if (!owns(state.categories[idx])) return sendError(res, 403, '这是公共分类（或别人家的分类），删不了。');
      const [gone] = state.categories.splice(idx, 1);
      // 只挪本家的菜：公共菜动不得，别人家的私菜也跟这里没关系
      state.dishes.forEach((d) => {
        if (d.category === gone.name && owns(d)) d.category = '其他';
      });
      scheduleSave('categories');
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
    return sendError(res, 405, '不支持的请求');
  }

  // ---- 家庭 ----
  if (route[0] === 'households') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const h = normHousehold({
        ...body,
        emoji: safeText(body.emoji, 4) || HOUSEHOLD_EMOJI[state.households.length % HOUSEHOLD_EMOJI.length],
      });
      if (!h) return sendError(res, 400, '家庭名称不能为空');
      state.households.push(h);
      scheduleSave('households');
      return sendJSON(res, 200, { ok: true, data: h });
    }
    if (method === 'PUT' && id) {
      const idx = state.households.findIndex((h) => h.id === id);
      if (idx < 0) return sendError(res, 404, '家庭不存在');
      const next = normHousehold(await readBody(req), state.households[idx]);
      if (!next) return sendError(res, 400, '家庭名称不能为空');
      state.households[idx] = next;
      scheduleSave('households');
      return sendJSON(res, 200, { ok: true, data: next });
    }
    if (method === 'DELETE' && id) {
      if (state.households.length <= 1) {
        return sendError(res, 400, '至少要保留一个家庭');
      }
      const idx = state.households.findIndex((h) => h.id === id);
      if (idx < 0) return sendError(res, 404, '家庭不存在');
      const [gone] = state.households.splice(idx, 1);
      // 家庭没了，它名下的点餐和库存也一并清掉，免得数据无处安放
      const removedOrders = state.orders.filter((o) => o.householdId === id).length;
      const removedPantry = state.pantry.filter((p) => p.householdId === id).length;
      const removedNotes = state.notes.notes.filter((n) => n.householdId === id).length;
      state.orders = state.orders.filter((o) => o.householdId !== id);
      state.pantry = state.pantry.filter((p) => p.householdId !== id);
      state.plans = state.plans.filter((p) => p.householdId !== id);
      state.notes.notes = state.notes.notes.filter((n) => n.householdId !== id);
      // 这个家的私菜和私有分类跟着走；共享的留给别的家继续用
      const removedDishes = state.dishes.filter((d) => d.householdId === id).length;
      const removedCats = state.categories.filter((c) => c.householdId === id).length;
      state.dishes = state.dishes.filter((d) => d.householdId !== id);
      state.categories = state.categories.filter((c) => c.householdId !== id);
      // 删掉的私菜还挂着点餐 / 计划 / 留言的引用，一并清掉，别留悬空 id
      state.orders.forEach((o) => {
        if (o.dishId && !state.dishes.some((d) => d.id === o.dishId)) o.dishId = null;
      });
      state.plans.forEach((pl) => {
        pl.items = pl.items.filter((it) => !it.dishId || state.dishes.some((d) => d.id === it.dishId));
      });
      state.notes.notes.forEach((n) => {
        if (n.kind === 'dish' && n.dishId && !state.dishes.some((d) => d.id === n.dishId)) {
          n.kind = 'board';
          n.dishId = null;
        }
      });
      Object.keys(state.notes.votes).forEach((dishId) => {
        if (!state.dishes.some((d) => d.id === dishId)) delete state.notes.votes[dishId];
      });
      if (state.settings.currentHouseholdId === id) {
        state.settings.currentHouseholdId = state.households[0].id;
      }
      scheduleSave('households');
      scheduleSave('orders');
      scheduleSave('pantry');
      scheduleSave('plans');
      scheduleSave('notes');
      scheduleSave('dishes');
      scheduleSave('categories');
      scheduleSave('settings');
      return sendJSON(res, 200, {
        ok: true,
        data: {
          ...gone,
          removedOrders,
          removedPantry,
          removedNotes,
          removedDishes,
          removedCategories: removedCats,
        },
      });
    }
  }

  // ---- 本周计划 ----
  if (route[0] === 'plans') {
    const id = route[1];

    // 加一道菜进某家庭某周的计划
    if (method === 'POST' && route[1] === 'items') {
      const body = await readBody(req);
      const dish = body.dishId ? state.dishes.find((d) => d.id === body.dishId) : null;
      const item = normPlanItem({
        ...body,
        name: body.name || (dish && dish.name),
        servings: body.servings || (dish && dish.servings),
      });
      if (!item) return sendError(res, 400, '要加哪道菜？写个菜名吧');
      const plan = findPlan(body.householdId, body.weekOf, true);
      // 同一道菜别重复加
      if (plan.items.some((it) => it.name === item.name)) {
        return sendError(res, 400, `「${item.name}」已经在本周计划里了`);
      }
      plan.items.push(item);
      plan.updatedAt = nowISO();
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { plan, item } });
    }

    // 从计划里一次拿掉几道菜（计划页多选模式）
    // 必须排在「按 id 删一道」前面，否则 /api/plans/items?ids= 会被当成删 id 为 ids 的项。
    if (method === 'DELETE' && route[1] === 'items' && !route[2]) {
      const raw = url.searchParams.get('ids');
      if (!raw) return sendError(res, 400, '要拿掉哪几道？');
      const ids = new Set(
        raw.split(',').map((s) => safeText(s, 40)).filter(Boolean)
      );
      if (!ids.size) return sendError(res, 400, '没有选中任何一道');
      let removed = 0;
      for (const plan of state.plans) {
        const keep = plan.items.filter((it) => !ids.has(it.id));
        if (keep.length !== plan.items.length) {
          removed += plan.items.length - keep.length;
          plan.items = keep;
          plan.updatedAt = nowISO();
        }
      }
      if (removed) scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { removed } });
    }

    // 从计划里拿掉一道菜
    if (method === 'DELETE' && route[1] === 'items' && route[2]) {
      const target = route[2];
      let hit = null;
      for (const plan of state.plans) {
        const i = plan.items.findIndex((it) => it.id === target);
        if (i >= 0) {
          hit = plan.items.splice(i, 1)[0];
          plan.updatedAt = nowISO();
          break;
        }
      }
      if (!hit) return sendError(res, 404, '计划里没有这道菜');
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: hit });
    }

    // 查某家庭某周的计划（不传参数就是当前家庭本周）
    if (method === 'GET' && !id) {
      const hid = resolveHouseholdId(url.searchParams.get('householdId'));
      const wk = mondayOf(url.searchParams.get('weekOf'));
      return sendJSON(res, 200, { ok: true, data: findPlan(hid, wk, false) });
    }

    // 清空某家庭某周
    if (method === 'DELETE' && !id) {
      const hid = resolveHouseholdId(url.searchParams.get('householdId'));
      const wk = mondayOf(url.searchParams.get('weekOf'));
      const plan = findPlan(hid, wk, false);
      if (!plan) return sendJSON(res, 200, { ok: true, data: { removed: 0 } });
      const removed = plan.items.length;
      plan.items = [];
      plan.updatedAt = nowISO();
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { removed } });
    }
  }

  // ---- 库存 ----
  if (route[0] === 'pantry') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const item = normPantryItem(await readBody(req));
      if (!item) return sendError(res, 400, '食材名不能为空');
      state.pantry.unshift(item);
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: item });
    }
    if (method === 'PUT' && id) {
      const idx = state.pantry.findIndex((p) => p.id === id);
      if (idx < 0) return sendError(res, 404, '库存条目不存在');
      const item = normPantryItem(await readBody(req), state.pantry[idx]);
      if (!item) return sendError(res, 400, '食材名不能为空');
      state.pantry[idx] = item;
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: item });
    }
    if (method === 'DELETE' && id) {
      const idx = state.pantry.findIndex((p) => p.id === id);
      if (idx < 0) return sendError(res, 404, '库存条目不存在');
      const [gone] = state.pantry.splice(idx, 1);
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
    if (method === 'DELETE' && !id) {
      // 两种批量删法，靠参数区分：
      //   ?ids=a,b,c            删勾选的那几样（库存多选模式）
      //   ?householdId=&scope=   删过期 / 临期（保质期清理）
      // 两种都必须明确给参数：宁可报错，也不能「不传参数就当全选」。
      const idsRaw = url.searchParams.get('ids');
      if (idsRaw !== null) {
        const ids = parseIds(idsRaw);
        if (!ids.size) return sendError(res, 400, '没有选中任何一样');
        const before = state.pantry.length;
        // 一次过滤删完，而不是循环 splice：省掉「边删边比对」的坑
        state.pantry = state.pantry.filter((p) => !ids.has(p.id));
        scheduleSave('pantry');
        return sendJSON(res, 200, {
          ok: true,
          data: { removed: before - state.pantry.length },
        });
      }
      const hid = safeText(url.searchParams.get('householdId'), 40);
      const scope = safeText(url.searchParams.get('scope'), 12);
      // 少了 scope 就直接拒：以前这里是 return false（=删），
      // 意味着误调一次接口就能把全家的保质期食材清空
      if (scope !== 'expired' && scope !== 'soon') {
        return sendError(res, 400, '得说清楚清理哪一类：expired 或 soon');
      }
      const today = todayStr();
      const soon = daysFromNow(3);
      const keep = (p) => {
        if (hid && p.householdId !== hid) return true;
        if (!p.expireAt) return true;
        if (scope === 'expired') return p.expireAt >= today;
        return p.expireAt < today || p.expireAt > soon; // soon
      };
      const before = state.pantry.length;
      state.pantry = state.pantry.filter(keep);
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.pantry.length } });
    }
  }

  // ---- 留言板 + 菜品互动 ----
  // 这些接口**不要管理口令**：留言、点个想吃，是家里人随手就做的事，
  // 跟点餐/库存/计划一个待遇。口令只挡改菜谱和导出。
  if (route[0] === 'notes') {
    const board = state.notes;
    const findNote = (nid) => board.notes.find((n) => n.id === nid);

    if (method === 'POST' && route.length === 1) {
      const note = normNote(await readBody(req));
      if (!note.text) return sendError(res, 400, '写点什么再发吧');
      if (note.kind === 'dish' && !state.dishes.some((d) => d.id === note.dishId)) {
        return sendError(res, 400, '这道菜不在菜单里了');
      }
      board.notes.unshift(note);
      scheduleSave('notes');
      return sendJSON(res, 200, { ok: true, data: note });
    }

    // 批量删留言（留言板多选模式）—— 必须显式给 ids
    if (method === 'DELETE' && !route[1]) {
      const ids = parseIds(url.searchParams.get('ids'));
      if (!ids.size) return sendError(res, 400, '要删哪几条留言？');
      const before = board.notes.length;
      board.notes = board.notes.filter((n) => !ids.has(n.id));
      scheduleSave('notes');
      return sendJSON(res, 200, { ok: true, data: { removed: before - board.notes.length } });
    }

    if (route[1]) {
      const note = findNote(route[1]);
      if (!note) return sendError(res, 404, '留言不存在');

      if (method === 'PUT' && route.length === 2) {
        const next = normNote({ ...note, ...(await readBody(req)) }, note);
        if (!next.text) return sendError(res, 400, '留言不能改成空的');
        Object.assign(note, next);
        scheduleSave('notes');
        return sendJSON(res, 200, { ok: true, data: note });
      }

      if (method === 'DELETE' && route.length === 2) {
        board.notes = board.notes.filter((n) => n.id !== note.id);
        scheduleSave('notes');
        return sendJSON(res, 200, { ok: true, data: note });
      }

      // 表情回应：同一个人对同一个表情只能出现一次，再点一次就是取消
      if (method === 'POST' && route[2] === 'react') {
        const body = await readBody(req);
        const emoji = safeText(body.emoji, 8);
        const who = safeText(body.who, 20).trim();
        if (!REACT_EMOJI.includes(emoji)) return sendError(res, 400, '这个表情不在可选范围里');
        if (!who) return sendError(res, 400, '得先告诉我是谁');
        const list = (note.reactions[emoji] || []).filter((w) => w !== who);
        const had = (note.reactions[emoji] || []).includes(who);
        if (had) {
          if (list.length) note.reactions[emoji] = list;
          else delete note.reactions[emoji];
        } else {
          if (Object.keys(note.reactions).length >= MAX_REACTIONS) {
            return sendError(res, 400, '这条留言的表情用满了，先取消一个再点');
          }
          note.reactions[emoji] = [...(note.reactions[emoji] || []), who].slice(0, 20);
        }
        note.updatedAt = nowISO();
        scheduleSave('notes');
        return sendJSON(res, 200, { ok: true, data: { reactions: note.reactions, on: !had } });
      }

      // 「我来」认领：一条留言只能有一个人认领，再点自己那个 = 取消
      if (method === 'POST' && route[2] === 'claim') {
        const body = await readBody(req);
        const by = safeText(body.by, 20).trim();
        if (!by) return sendError(res, 400, '得先告诉我是谁');
        if (note.claim && note.claim.by !== by) {
          return sendError(res, 409, `「${note.claim.by}」已经认领了这条`);
        }
        note.claim = note.claim ? null : { by, at: nowISO() };
        note.updatedAt = nowISO();
        scheduleSave('notes');
        return sendJSON(res, 200, { ok: true, data: { claim: note.claim } });
      }

      if (method === 'POST' && route[2] === 'replies') {
        const body = await readBody(req);
        const text = safeText(body.text, 300).trim();
        if (!text) return sendError(res, 400, '回复不能是空的');
        const reply = {
          id: uid('r_'),
          author: safeText(body.author, 20).trim() || '匿名',
          text,
          createdAt: nowISO(),
        };
        note.replies = [...note.replies, reply].slice(-MAX_REPLIES);
        note.updatedAt = nowISO();
        scheduleSave('notes');
        return sendJSON(res, 200, { ok: true, data: reply });
      }

      if (method === 'DELETE' && route[2] === 'replies' && route[3]) {
        const before = note.replies.length;
        note.replies = note.replies.filter((r) => r.id !== route[3]);
        if (note.replies.length === before) return sendError(res, 404, '回复不存在');
        note.updatedAt = nowISO();
        scheduleSave('notes');
        return sendJSON(res, 200, { ok: true, data: { removed: before - note.replies.length } });
      }
    }
  }

  // ---- 菜品互动投票 ----
  // 单独一个端点，不挂在 /api/dishes 下面：dishes 在 ADMIN_WRITES 里
  // 会要管理口令，而「我想吃这道」必须是家里任何人都能随手点的。
  if (route[0] === 'dish-votes' && method === 'POST') {
    const body = await readBody(req);
    const dishId = safeText(body.dishId, 40);
    const who = safeText(body.who, 20).trim();
    const role = body.role === 'cook' ? 'cook' : 'want';
    if (!state.dishes.some((d) => d.id === dishId)) return sendError(res, 404, '菜品不存在');
    if (!who) return sendError(res, 400, '得先告诉我是谁');
    const cur = state.notes.votes[dishId] || { want: [], cook: [] };
    const list = cur[role] || [];
    const had = list.includes(who);
    // 「我来做」一道菜只认一个人：别人来认领直接拒，不能默默顶掉上一个
    if (role === 'cook' && list.length && !had) {
      return sendError(res, 409, `${list[0]} 已经认领了「${state.dishes.find((d) => d.id === dishId).name}」`);
    }
    state.notes.votes[dishId] = {
      ...cur,
      [role]: had ? list.filter((w) => w !== who) : [...list, who].slice(0, 20),
    };
    if (!state.notes.votes[dishId].want.length && !state.notes.votes[dishId].cook.length) {
      delete state.notes.votes[dishId];
    }
    scheduleSave('notes');
    return sendJSON(res, 200, { ok: true, data: state.notes.votes[dishId] || { want: [], cook: [] } });
  }

  // ---- 菜品 ----
  if (route[0] === 'dishes') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const dish = normDish(await readBody(req));
      if (!dish) return sendError(res, 400, '菜名不能为空');
      const bad = categoryProblem(dish);
      if (bad) return sendError(res, 400, bad);
      state.dishes.unshift(dish);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: dish });
    }
    if (method === 'PUT' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      const dish = normDish(await readBody(req), state.dishes[idx]);
      const bad = categoryProblem(dish);
      if (bad) return sendError(res, 400, bad);
      state.dishes[idx] = dish;
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: dish });
    }
    if (method === 'POST' && route[2] === 'duplicate' && id) {
      const src = state.dishes.find((d) => d.id === id);
      if (!src) return sendError(res, 404, '菜品不存在');
      // 副本跟原菜一个归属：复制我家私菜不该把它变成全体共享
      const copy = normDish({ ...src, id: '', name: src.name + '（副本）' });
      copy.isFavorite = false;
      state.dishes.unshift(copy);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: copy });
    }
    if (method === 'DELETE' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      const [gone] = state.dishes.splice(idx, 1);
      // 同时清掉该菜品相关的未完成点餐
      state.orders = state.orders.filter(
        (o) => !(o.dishId === id && o.status !== 'done')
      );
      // 本周计划里引用的这道菜也去掉，免得采购买到已删的菜
      state.plans.forEach((p) => {
        p.items = p.items.filter((it) => it.dishId !== id);
      });
      // 这道菜下面的留言降级成普通留言（内容留着，不因为删个菜就抹掉别人的话），
      // 投票没人认领了，直接扔
      state.notes.notes.forEach((n) => {
        if (n.kind === 'dish' && n.dishId === id) {
          n.kind = 'board';
          n.dishId = null;
        }
      });
      delete state.notes.votes[id];
      scheduleSave('dishes');
      scheduleSave('orders');
      scheduleSave('plans');
      scheduleSave('notes');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
  }

  // ---- 分类 ----
  // 分类也是分家的：null = 共享分类，全体家庭都能用；填了家庭 id = 只有那一家用。
  // 名字全局唯一 —— 菜品是按名字挂到分类上的，撞名会让一道菜挂到谁身上说不清。
  if (route[0] === 'categories') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const name = safeText(body.name, 24).trim();
      if (!name) return sendError(res, 400, '分类名不能为空');
      const owner = normScope(body, {});
      if (state.categories.some((c) => c.name === name)) {
        return sendError(
          res,
          400,
          '已经有同名的分类了（也可能属于别的家庭）。换个名字，或者把那个分类改成共享的。'
        );
      }
      const cat = {
        id: uid('c_'),
        name,
        householdId: owner,
        order: state.categories.length + 1,
      };
      state.categories.push(cat);
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'PUT' && id) {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return sendError(res, 404, '分类不存在');
      const body = await readBody(req);
      const nextName = safeText(body.name, 24).trim() || cat.name;
      // 没传 householdId 就沿用原来的归属，别因为改个名字把私分类改成共享的
      const nextOwner =
        body.householdId === undefined ? cat.householdId || null : normScope(body, cat);
      // 分类名全局唯一。菜品是按名字挂到分类上的，同名的两个分类会让一道菜
      // 挂到谁身上变得说不清，所以宁可报错让人换个名字。
      if (state.categories.some((c) => c.id !== id && c.name === nextName)) {
        return sendError(
          res,
          400,
          '已经有同名的分类了（也可能属于别的家庭）。换个名字，或者把那个分类改成共享的。'
        );
      }
      cat.name = nextName;
      cat.householdId = nextOwner;
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'DELETE' && id) {
      const idx = state.categories.findIndex((c) => c.id === id);
      if (idx < 0) return sendError(res, 404, '分类不存在');
      const [gone] = state.categories.splice(idx, 1);
      // 该分类下菜品改为「其他」，不丢数据。
      // 只动归属相同的菜：删共享分类别去拽别家私菜，删私有分类也别碰别人同名的那份
      // （A 家和 B 家完全可以各有一个私有的「夜宵」，各装各的菜）
      state.dishes.forEach((d) => {
        if (d.category !== gone.name) return;
        if ((d.householdId || null) !== (gone.householdId || null)) return;
        d.category = '其他';
      });
      scheduleSave('categories');
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
    }

  // ---- 点餐 ----
  if (route[0] === 'orders') {
    const id = route[1];
    if (method === 'POST' && !id) {
      const order = normOrder(await readBody(req));
      state.orders.unshift(order);
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: order });
    }
    // 批量改状态：点餐页「一键开做」用。PATCH /api/orders 不带 id。
    // 一次改完，不是循环单改 —— 十几条点餐时前者明显更快。
    if (method === 'PATCH' && !id) {
      const body = await readBody(req);
      const status = ['pending', 'cooking', 'done', 'cancelled'].includes(body.status)
        ? body.status
        : null;
      if (!status) return sendError(res, 400, '状态不对');
      const ids = Array.isArray(body.ids) ? body.ids.map((s) => safeText(s, 40)).filter(Boolean) : [];
      if (!ids.length) return sendError(res, 400, '没有选中任何一条');
      const set = new Set(ids);
      let n = 0;
      const now = nowISO();
      state.orders.forEach((o) => {
        if (!set.has(o.id)) return;
        o.status = status;
        o.updatedAt = now;
        n++;
      });
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: { changed: n, status } });
    }
    if (method === 'PATCH' && id) {
      const order = state.orders.find((o) => o.id === id);
      if (!order) return sendError(res, 404, '点餐不存在');
      const body = await readBody(req);
      // 逐字段更新：只改请求里明确带上的字段，避免清空备注等未提交的内容
      if (['pending', 'cooking', 'done', 'cancelled'].includes(body.status)) {
        order.status = body.status;
      }
      if (body.dishName !== undefined) {
        order.dishName = safeText(body.dishName, 40).trim() || order.dishName;
      }
      if (body.requester !== undefined) {
        order.requester = safeText(body.requester, 20).trim() || order.requester;
      }
      if (body.people !== undefined) {
        order.people = Math.max(1, Math.min(20, Number(body.people) || order.people));
      }
      if (body.note !== undefined) order.note = safeText(body.note, 200);
      if (body.date !== undefined) order.date = safeText(body.date, 20) || order.date;
      if (body.dishId !== undefined) order.dishId = body.dishId ? safeText(body.dishId, 40) : null;
      order.updatedAt = nowISO();
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: order });
    }
    // 注意要排在「按 id 删点餐」前面，否则 /api/orders/done 会被当成删 id 为 done 的点餐
    if (method === 'DELETE' && route[1] === 'done') {
      const hid = safeText(url.searchParams.get('householdId'), 40);
      const before = state.orders.length;
      state.orders = state.orders.filter(
        (o) => o.status !== 'done' || (hid && o.householdId !== hid)
      );
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.orders.length } });
    }
    // 一次删掉勾选的那几条点餐（点餐页多选模式）。
    // 和库存一样：必须明确给 ids，不能「不传参数就当全选」。
    if (method === 'DELETE' && !id) {
      const raw = url.searchParams.get('ids');
      if (!raw) return sendError(res, 400, '要删哪几条？');
      const ids = new Set(
        raw.split(',').map((s) => safeText(s, 40)).filter(Boolean)
      );
      if (!ids.size) return sendError(res, 400, '没有选中任何一条');
      const before = state.orders.length;
      state.orders = state.orders.filter((o) => !ids.has(o.id));
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.orders.length } });
    }
    if (method === 'DELETE' && id) {
      const idx = state.orders.findIndex((o) => o.id === id);
      if (idx < 0) return sendError(res, 404, '点餐不存在');
      const [gone] = state.orders.splice(idx, 1);
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: gone });
    }
  }

  // ---- 图片上传（前端已压缩的 dataURL）----
  if (method === 'POST' && route[0] === 'upload') {
    const body = await readBody(req);
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
      safeText(body.dataUrl, 32 * 1024 * 1024)
    );
    if (!m) return sendError(res, 400, '图片格式不支持（需 png/jpg/webp/gif 的 dataURL）');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return sendError(res, 400, '图片过大');
    const name = uid('img_') + '.' + ext;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    return sendJSON(res, 200, { ok: true, data: { url: '/uploads/' + name } });
  }

  // ---- 设置 ----
  if (method === 'PUT' && route[0] === 'settings') {
    const body = await readBody(req);
    const s = state.settings;
    if (typeof body.shopName === 'string') s.shopName = safeText(body.shopName, 30).trim() || '家庭菜单';
    if (typeof body.welcome === 'string') s.welcome = safeText(body.welcome, 120);
    // 口令三态：不传 = 不动；传空串 = 取消；传非空 = 改新值。
    // 前端拿不到旧口令明文了，所以「清除」必须靠显式标记，不能靠留空猜。
    if (body.clearAdminPin === true) {
      s.adminPin = '';
      sessions.clear(); // 口令没了，所有会话作废
    } else if (typeof body.adminPin === 'string' && body.adminPin.trim()) {
      const next = safeText(body.adminPin, 12).trim();
      if (next !== s.adminPin) sessions.clear(); // 换口令了，旧会话全部失效
      s.adminPin = next;
    }
    if (typeof body.currentHouseholdId === 'string') {
      const id = safeText(body.currentHouseholdId, 40);
      // 只认存在的家庭，防止前端写进脏 id
      if (state.households.some((h) => h.id === id)) s.currentHouseholdId = id;
    }
    if (Array.isArray(body.shoppingChecked)) {
      s.shoppingChecked = body.shoppingChecked
        .map((m) => safeText(m, 40).trim())
        .filter(Boolean)
        .slice(0, 400);
    }
    scheduleSave('settings');
    // 响应里同样不能带口令明文
    const { adminPin, ...safeSettings } = s;
    return sendJSON(res, 200, {
      ok: true,
      data: { ...safeSettings, hasPin: !!adminPin },
    });
  }

  // ---- 备份列表 / 立即打一份 / 下载 / 恢复 ----
  if (route[0] === 'backups') {
    const name = route[1];

    if (method === 'GET' && !name) {
      return sendJSON(res, 200, { ok: true, data: { keep: BACKUP_KEEP, list: listBackups() } });
    }
    if (method === 'GET' && name) {
      const safe = safeBackupName(path.basename(decodeURIComponent(name)));
      if (!safe) return sendError(res, 400, '备份文件名不对');
      const file = path.join(ensureBackupDir(), safe);
      if (!fs.existsSync(file)) return sendError(res, 404, '没有这份备份');
      const buf = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safe}"`,
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }
    if (method === 'POST' && !name) {
      const r = makeBackup('手动');
      return sendJSON(res, 200, {
        ok: true,
        data: { ...r, list: listBackups() },
      });
    }
    if (method === 'POST' && route[2] === 'restore') {
      const safe = safeBackupName(path.basename(decodeURIComponent(name)));
      if (!safe) return sendError(res, 400, '备份文件名不对');
      const file = path.join(ensureBackupDir(), safe);
      if (!fs.existsSync(file)) return sendError(res, 404, '没有这份备份');

      // 顺序很重要：先把要恢复的那份整个读进内存。
      // 反过来先打「恢复前」快照的话，那一下会触发保留份数的清理 ——
      // 手上正好只有 7 份、要恢复的是最老那份的话，它会被自己刚存的快照挤掉。
      let zipFiles;
      try {
        zipFiles = zipRead(fs.readFileSync(file), MAX_IMPORT);
      } catch (err) {
        return sendError(res, 400, '备份文件读不出来：' + err.message);
      }
      const jsonBuf = zipFiles.get('backup.json');
      if (!jsonBuf) return sendError(res, 400, '这份备份里没有 backup.json，可能不是本程序的备份');
      let src;
      try {
        src = JSON.parse(jsonBuf.toString('utf8'));
      } catch (_) {
        return sendError(res, 400, '备份文件格式不正确');
      }

      // 恢复会覆盖现在的数据：先给现状留一份，免得用户后悔了没得退
      let safety = null;
      try {
        safety = makeBackup('恢复前').name;
      } catch (err) {
        console.error('[backup] 恢复前快照失败：', err.message);
      }

      let photos;
      try {
        photos = restoreUploads(zipFiles);
      } catch (err) {
        return sendError(res, 500, '照片写回失败：' + err.message);
      }
      const r = applyBackup(src);
      return sendJSON(res, 200, { ok: true, data: { ...r, ...photos, safety } });
    }
    return sendError(res, 405, '不支持的请求');
  }

  // ---- 导出（zip，含照片）----
  if (method === 'GET' && route[0] === 'export') {
    const { entries } = backupEntries();
    const filename = `menu-backup-${todayStr()}.zip`;
    // 先落到临时文件，再流式发出去。
    // 直接往 socket 上边打包边灌看着更省事，但客户端一慢，res.write 的积压
    // 就会把照片重新堆回内存 —— 换个地方 OOM 而已。
    const tmp = path.join(os.tmpdir(), `menu-export-${Date.now()}-${process.pid}.zip`);
    try {
      const fd = fs.openSync(tmp, 'w');
      let size;
      try {
        size = zipWriteTo(entries, (b) => fs.writeSync(fd, b, 0, b.length));
      } finally {
        fs.closeSync(fd);
      }
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': size,
      });
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(tmp);
        stream.on('error', reject);
        res.on('close', resolve);
        stream.pipe(res);
      });
    } catch (err) {
      if (!res.headersSent) sendError(res, 500, '导出失败：' + err.message);
      else res.destroy();
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {
        /* 临时文件删不掉就算了，下次重启自然清 */
      }
    }
    return;
  }

  if (method === 'POST' && route[0] === 'import') {
    // 两种都收：新版 zip（含照片），以及旧版导出的纯 JSON
    const raw = await readBodyRaw(req, MAX_IMPORT);
    let src;
    let photos = { written: 0, skipped: 0 };

    if (looksLikeZip(raw)) {
      let zipFiles;
      try {
        zipFiles = zipRead(raw, MAX_IMPORT);
      } catch (err) {
        return sendError(res, 400, '备份文件读不出来：' + err.message);
      }
      const jsonBuf = zipFiles.get('backup.json');
      if (!jsonBuf) return sendError(res, 400, '这个 zip 里没有 backup.json，可能不是本程序的备份');
      try {
        src = JSON.parse(jsonBuf.toString('utf8'));
      } catch (_) {
        return sendError(res, 400, '备份文件格式不正确');
      }
      try {
        photos = restoreUploads(zipFiles);
      } catch (err) {
        return sendError(res, 500, '照片写回失败：' + err.message);
      }
    } else {
      try {
        src = JSON.parse(raw.toString('utf8'));
      } catch (_) {
        return sendError(res, 400, '既不是备份 zip，也不是 JSON');
      }
      if (src && src.data) src = src.data;
    }

    if (!src || !Array.isArray(src.dishes)) return sendError(res, 400, '备份文件格式不正确');
    const r = applyBackup(src);
    return sendJSON(res, 200, { ok: true, data: { ...r, ...photos } });
  }

  // ---- 汇总统计（首页小卡片用）----
  if (method === 'GET' && route[0] === 'summary') {
    const today = todayStr();
    const soon = daysFromNow(3);
    const pending = state.orders.filter((o) => o.status === 'pending' || o.status === 'cooking');
    const mine = state.pantry.filter((p) => p.householdId === state.settings.currentHouseholdId);
    return sendJSON(res, 200, {
      ok: true,
      data: {
        dishCount: state.dishes.length,
        pendingCount: pending.length,
        categoryCount: state.categories.length,
        householdCount: state.households.length,
        pantryCount: mine.length,
        expiredCount: mine.filter((p) => p.expireAt && p.expireAt < today).length,
        soonCount: mine.filter((p) => p.expireAt && p.expireAt >= today && p.expireAt <= soon).length,
      },
    });
  }

  return sendError(res, 404, '接口不存在：' + req.method + ' ' + url.pathname);
}

/* ------------------------------------------------------------------ *
 * 路由分发
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleAPI(req, res, url);
    }

    // 上传的图片
    if (url.pathname.startsWith('/uploads/')) {
      const rel = path.basename(decodeURIComponent(url.pathname));
      return await serveStatic(req, res, path.join(UPLOAD_DIR, rel), true);
    }

    // 静态资源
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    rel = path.normalize(rel).replace(/^(\.\.[\\/])+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('403');
    }
    await serveStatic(req, res, file, false);
  } catch (err) {
    console.error('[error]', req.method, url.pathname, err);
    if (!res.headersSent) sendError(res, 500, err.message || '服务器内部错误');
    else res.end();
  }
});

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 内存护栏
 *
 * 这个服务是给一台家用小机器跑的：2 核 2G 很常见。
 * 64 位 Node 的 old space 上限默认跟机器内存一样大，V8 会以为自己有整个
 * 内存可用，于是一路涨 —— 等它涨到把宿主机吃满，Linux 的 OOM Killer 会
 * 直接把进程杀掉，连一行报错都来不及写，看起来就像「服务自己停了」。
 *
 * 真正省内存的是别处（备份打包已经改成一次只压一个文件了，见 zipWriteTo）；
 * 这里只做两件事：
 *   1) 启动时把「实际堆上限」打出来，让人一眼知道自己裸奔还是有限制的；
 *   2) 小内存机器上没加参数就启动时，响亮地提醒一句该怎么加。
 *
 * 想自己定：node --max-old-space-size=256 server.js
 * （package.json 的 npm start 已经带了默认值）
 * ------------------------------------------------------------------ */

function memoryReport() {
  const v8 = require('v8');
  const heapLimitMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
  const mem = process.memoryUsage();
  const totalMB = Math.round(os.totalmem() / 1048576);
  return {
    heapLimitMB,
    totalMB,
    rssMB: Math.round(mem.rss / 1048576),
    heapMB: Math.round(mem.heapUsed / 1048576),
  };
}

/** 小内存机器裸奔时提醒；已经有限制就闭嘴 */
function warnIfMemoryUnbounded(m) {
  const smallBox = m.totalMB > 0 && m.totalMB <= 3072; // 3G 及以下算「小机器」
  const unbounded = m.heapLimitMB > m.totalMB * 0.75;
  if (!smallBox || !unbounded) return;
  console.warn(
    [
      '',
      `  ⚠️ 这台机器只有 ${m.totalMB}MB 内存，但 Node 的堆上限是 ${m.heapLimitMB}MB。`,
      '     万一内存涨上去，Linux 会直接杀掉这个进程（OOM Killer），日志来不及写。',
      '     建议这样起：',
      '       node --max-old-space-size=384 server.js',
      '     或者直接 npm start（package.json 里已经带上了）。',
      '',
    ].join('\n')
  );
}

function banner(port) {
  const line = '─'.repeat(46);
  const m = memoryReport();
  console.log('');
  console.log(`  ${state.settings.shopName || '家庭菜单'} 正在运行`);
  console.log(`  ${line}`);
  console.log(`  本机访问：   http://localhost:${port}`);
  for (const ip of lanAddresses()) {
    console.log(`  手机访问：   http://${ip}:${port}   ← 家人连同一个 WiFi 打开这个`);
  }
  console.log(`  ${line}`);
  console.log(
    `  菜品 ${state.dishes.length} 道 · 分类 ${state.categories.length} 个 · 家庭 ${state.households.length} 个`
  );
  console.log(`  数据目录 ${DATA_DIR}`);
  console.log(`  自动备份 ${BACKUP_DIR}（每天凌晨 3 点，保留最近 ${BACKUP_KEEP} 份）`);
  console.log(
    `  内存 堆上限 ${m.heapLimitMB}MB · 现在用 ${m.rssMB}MB（物理 ${m.totalMB}MB）`
  );
  console.log(`  按 Ctrl+C 停止服务`);
  console.log('');
  warnIfMemoryUnbounded(m);
}

/** 启动后自动打开浏览器（打包版用，省得家人自己敲地址） */
function openBrowser(port) {
  const url = `http://localhost:${port}`;
  try {
    let cmd, args;
    if (process.platform === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '', url]];
    else if (process.platform === 'darwin') [cmd, args] = ['open', [url]];
    else [cmd, args] = ['xdg-open', [url]];
    require('child_process')
      .spawn(cmd, args, { detached: true, stdio: 'ignore' })
      .unref();
  } catch (err) {
    console.error('[warn] 无法自动打开浏览器：' + err.message);
  }
}

function init() {
  for (const dir of [DATA_DIR, UPLOAD_DIR, PUBLIC_DIR, BACKUP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  loadState();
  saveNow();
  scheduleAutoBackup();
}

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${sig}，正在保存数据…`);
  try {
    saveNow();
    console.log('数据已保存，服务已停止。');
  } catch (err) {
    console.error('保存失败：', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[fatal]', err);
  try {
    saveNow();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});

init();

/** 端口被占用时自动往后找，避免打包到别人电脑上起不来 */
function startServer(port, triesLeft) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && triesLeft > 1) {
      console.warn(`  端口 ${port} 已被占用，自动改用 ${port + 1}…`);
      setTimeout(() => startServer(port + 1, triesLeft - 1), 250);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`\n端口 ${port} 到 ${port + triesLeft} 都被占用了。`);
      console.error('可以用环境变量指定别的端口：set PORT=9000 && node server.js\n');
    } else {
      console.error('[fatal]', err);
    }
    process.exit(1);
  };

  const onListening = () => {
    server.removeListener('error', onError);
    server.on('error', (e) => console.error('[warn] 服务异常：', e.message));
    banner(port);
    if (AUTO_OPEN) openBrowser(port);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}

startServer(PORT, 12);
