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

const APP_VERSION = '1.31.2';

// 新的排在前面；date 只写发布年月日，不用精确到时分
const RELEASES = [
  {
    version: '1.31.2',
    date: '2026-10-21',
    title: '调味干货有无管理与入库反馈',
    items: [
      '库存移入调味干货后自动切换为有/无记录，并同步家庭原料字典和关联库存',
      '计划把食用油等数量型食材标成用量不明时，入库后记录确认、从待购项移除并提示仍需人工核实',
      '调料入库后即时显示确认结果；新增或变更本周计划会清除过期确认并重新计算',
    ],
  },
  {
    version: '1.31.1',
    date: '2026-10-21',
    title: '计划库存按原料 ID 精确联动',
    items: [
      '计划入库与做菜扣库存优先使用家庭原料 ID，原料改名或使用别名时仍更新同一库存',
      '计划入库以原料 ID 防止同一原料别名绕过重复提交检查',
      '新增库存继承原料字典的有无/数量跟踪方式；确认常备调料时保留原料 ID',
    ],
  },
  {
    version: '1.31.0',
    date: '2026-10-21',
    title: '计划采购缺口重算与分栏操作',
    items: [
      '计划采购只显示库存未覆盖的食材；入库后按当前库存自动移出，新增菜品形成缺口时重新列出',
      '食材采购与调料确认分开保存折叠状态、选择和批量操作，避免跨栏目误选或误入库',
      '同周同一食材可按新增缺口再次补货；请求编号与前端操作锁共同防止重复入账',
      '库存覆盖需求时保留无需采购的汇总提示，旧的已买勾选不再标记计划采购完成',
    ],
  },
  {
    version: '1.30.0',
    date: '2026-10-21',
    title: '共享菜与私房菜双向复制',
    items: [
      '共享菜可直接收进我家，家庭管理员可把私房菜独立复制到共享菜单；源菜保留，两份互不联动',
      '菜谱编辑不再切换共享/私房归属；新菜和批量导入跟随当前菜单栏目',
      '重复添加会提示已存在；跨范围复制会匹配目标家庭原料，并将私有分类映射到共享分类',
    ],
  },
  {
    version: '1.29.0',
    date: '2026-10-21',
    title: '家庭共享原料字典与计划联动',
    items: [
      '菜单和库存共用家庭原料 ID 与分类子树，可从菜单新建原料/子分类，也可从库存登记原料',
      '计划与库存按原料 ID 对应；同分类的牛里脊、牛排仍是独立原料和库存',
      '旧菜谱与库存启动时自动补原料关联，跨家庭引用会被拒绝',
      'AI 原料建议可逐项编辑确认，保存后更新家庭字典和菜谱关联并重新计算计划，不改库存或采购状态',
    ],
  },
  {
    version: '1.28.0',
    date: '2026-10-21',
    title: '计划食材缺口与调料确认',
    items: [
      '盐、白糖等历史库存自动归入调味干货，采购页不再落在其他分类',
      '计划按普通食材整周用量和库存计算缺口，库存充足的食材自动标记完成',
      '调味干货只确认家中是否有，不汇总菜谱用量或比较不统一的单位；可手动确认或按实际购买量入库',
    ],
  },
  {
    version: '1.27.0',
    date: '2026-10-20',
    title: '采购入库弹层与食材同义匹配',
    items: [
      '采购入库改用应用内弹层，支持填写实际数量和单位，兼容内置浏览器',
      '白砂糖/白糖、食盐/食用盐/盐巴/盐等明确同义名称会匹配到同一库存',
      '同义食材在计划入库时沿用同一周去重规则，避免重复入库',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-10-20',
    title: '重复计划与完成扣库存',
    items: [
      '同一道菜可以在一周内安排多次，并可精确到具体日期',
      '计划采购按整周重复次数累计需求，显示使用次数和总用量',
      '家庭管理员完成计划菜时按菜谱用量实际扣减库存，重复点击不会重复扣减',
      '库存不足、适量或单位不一致时完成仍会给出明确提醒',
    ],
  },
  {
    version: '1.25.2',
    date: '2026-10-19',
    title: '库存最低保有量与采购缺口',
    items: [
      '库存条目可设置最低保有量，低于最低量时在库存页提示补货',
      '采购页按“菜谱需求量 + 最低保有量”计算目标库存，显示真实缺口',
      '无库存但用量可比较时显示建议补足数量；适量和单位不同仍要求人工确认',
    ],
  },
  {
    version: '1.25.1',
    date: '2026-10-19',
    title: '库存分类选择与葱姜蒜归类',
    items: [
      '库存编辑的分类改为弹层内完整可滚动的按钮列表，鼠标可以选择全部分类',
      '大葱、小葱、葱花、生姜、姜片、大蒜、蒜瓣等预置为调味干货',
      '历史库存中原先归为蔬菜的葱姜蒜会自动迁移到调味干货',
    ],
  },
  {
    version: '1.25.0',
    date: '2026-10-19',
    title: '计划购买量入库与常备调料',
    items: [
      '计划采购与常备调料分开显示，「调味干货」默认按常备调料处理',
      '菜谱编辑器可逐项切换自动判断、常备调料或需要采购',
      '入库前填写实际购买数量和单位，数量会累加到同家庭已有的同名同单位库存',
      '同一周计划的同一食材只允许入库一次，避免重复点击造成库存重复增加',
      '采购入库支持常见调料别名合并，例如生抽酱油与生抽',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-10-19',
    title: '采购与库存分类折叠',
    items: [
      '计划采购按食材分类折叠展示，分类标题支持全选和本组一键入库',
      '库存按分类折叠展示，多选模式可在分类标题只选择本组',
      '分类折叠状态按账户保存，切换家庭和账号不会串用',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-10-19',
    title: '库存余量与采购识别',
    items: [
      '采购清单按库存余量和菜谱需求量判断已有、库存不足或待购买',
      '库存不足时显示当前余量和还需补购的数量，单位不一致或适量用量提示确认',
      '库存数量为 0 时明确显示用完待补，库存页和采购页都可以继续调整余量',
    ],
  },
  {
    version: '1.22.0',
    date: '2026-10-18',
    title: '家庭中心与采购权限统一',
    items: [
      '采购清单改为当前家庭状态，普通成员勾选已买和入库不再需要管理口令',
      '家庭栏目增加家庭广场，可浏览公开共享菜并收进当前家庭',
      '菜谱编辑权按作者账户绑定，家庭管理员不再自动编辑别人的私房菜',
      '账户按用户恢复上次家庭、页面、筛选和管理折叠状态',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-10-17',
    title: '家庭解散与成员生命周期修复',
    items: [
      '家庭最后一名成员可以使用“解散家庭”，解散后账户保留且默认不选择家庭',
      '最后一名管理员仍需先指定其他管理员才能退出多人家庭',
      '解散家庭会清理待处理加入申请、设备令牌和旧家庭会话',
      '家庭成员关系不允许保存为“有成员但无管理员”的无效状态',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-10-17',
    title: '菜谱图片批量导入与分享',
    items: [
      '超级管理员可以一次选择多张菜谱图片，逐张识别后集中审核并批量保存',
      '识别结果支持在保存前修改菜名和分类，原始图片会作为菜谱图片保留',
      '管理员和普通成员都可以选择当前可见菜谱，批量生成 PNG 分享卡片',
      '导入和导出继续遵循当前家庭与权限范围，不会跨家庭读取私菜',
    ],
  },
  {
    version: '1.19.0',
    date: '2026-10-17',
    title: '无家庭浏览路径优化',
    items: [
      '没有选择家庭时保留底部导航，可直接浏览只读共享菜单和账户设置',
      '共享菜单提供创建家庭、申请加入和返回账户首页入口，避免浏览后迷路',
      '计划、点餐、留言和库存在无家庭状态下明确置灰，需先创建或加入家庭',
      '无家庭浏览时只展示共享菜，不会看到其他家庭的私房菜',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-10-17',
    title: '全局账户与家庭流程统一',
    items: [
      '登录 ID 和账户密码是唯一身份凭证，设备只保存登录会话，不再要求重复认领成员或设置家庭密码',
      '登录后默认停在账户首页，不自动选择第一户；无家庭时可浏览公开目录、共享菜单、申请加入或创建家庭',
      '家庭成员角色只作为家庭权限标签，管理员通过成员关系和申请审批产生；账户可随时退出家庭且不影响其他家庭',
      '同一账户姓名跨家庭统一显示，管理页不再提供成员登录密码和家庭口令设置',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-10-16',
    title: '共享菜单收进家庭与菜品供应状态',
    items: [
      '已加入家庭的账户可以把共享菜复制为当前家庭私菜，原共享菜保持不变；未加入家庭时按钮和接口均不可用',
      '菜单页与管理页显示统一的菜品供应状态，管理员可切换正常供应或暂停供应',
      '暂停供应菜不能新建点餐，随机来一道默认排除，已有订单和计划继续保留',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-10-16',
    title: '权限模型收敛与开放初始化修复',
    items: [
      '未设置全局管理口令时，账户可以直接进入开放超级管理员模式并初始化口令；设置后按账户绑定 12 小时授权',
      '家庭管理员只由成员关系中的 owner 决定，历史家庭口令不再授予权限，管理页移除家庭口令入口',
      '共享菜单对未加入家庭的账户保持只读；已加入家庭的账户可将共享菜收进当前家庭成为私菜',
      '普通成员管理工作区增加折叠结构，家庭设置和菜单数据按角色显示',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-10-16',
    title: '全局账户姓名与菜单投影统一',
    items: [
      '同一账户在所有家庭、申请、点餐和菜品作者位置使用统一的账户姓名，修改后全局同步',
      '家庭成员编辑和加入申请不再创建家庭专属姓名，申请人由当前账户自动识别',
      '菜单页、管理页、随机来一道和菜品详情共用同一份当前家庭菜单数据投影',
      '管理页菜品点击可直接打开与菜单页相同的详情，并在修改后立即同步',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-10-16',
    title: '管理页折叠搜索与随机筛选',
    items: [
      '管理页按家庭与成员、菜单与日常数据、系统与备份三组折叠，支持管理项模糊搜索',
      '家庭管理员可以编辑家庭名称、图标和备注，加入申请可以申请管理员身份并由管理员决定',
      '随机来一道支持可见范围、分类、标签、今天没做过和排除已点餐条件',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-10-16',
    title: '全局账户与多家庭工作区',
    items: [
      '新设备先登录或注册，全局登录 ID 支持汉字、字母和数字，初始密码为 123456 并显示风险提示',
      '一个账号最多加入 5 个有效家庭，家庭之间切换不需要重新认领身份',
      '创建家庭不需要平台管理员批准，创建者立即成为家庭管理员',
      '申请加入按账户建立成员关系，管理员批准后才计入家庭名额',
      '全局管理口令绑定当前账号和设备，超级管理员授权固定有效 12 小时',
      '菜单固定为第一栏，账户、家庭和平台配置集中到最后的设置栏',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-10-16',
    title: '多个家庭管理员与文本登录身份',
    items: [
      '一个家庭可以有多个家庭管理员，每个管理员独立登录和管理本家庭',
      '登录 ID 支持汉字、字母和数字，密码支持一般文本，不再限制为纯数字 PIN',
      '旧成员 PIN 自动迁移为个人密码，前端只显示是否设置，不回传密码明文',
      '身份不再靠自报：「你是谁」向导多一步密码，每个成员自己设一个，别人拿到设备也冒充不了',
      '「记住我」：输一次密码换一枚 30 天令牌，之后打开就是自己。令牌存在本机，绝不进备份',
      '超级管理员（全局口令）/ 家庭管理员（家庭口令）/ 普通成员（成员密码）三层权限',
      '菜品记下作者是谁：一家人里只有管理员和作者本人能改这一道',
      '危险动作不认「记住我」的令牌：改成员、重置密码、改家庭口令、删家庭、批申请，都要当场重新输一次密码',
      '每个家庭一个口令：这个家的管理员用它解锁，不影响别的家',
      '新建的家庭是「普通家庭」，要超级管理员点头才升级为「正式家庭」',
      '菜单页加「🌐 共享 / 🔒 我家私房」筛选：同名的只露共享那一版，你家的私房版收在私房那一屏',
      '成员可以重名（爸爸和儿子都叫「小明」）：身份认的是人不是名字',
      '家庭管理员只能改自己家 —— 以前 A 家的管理员能把 B 家的名字也改了',
    ],
  },
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

/** 用户可见的登录 ID：允许汉字、字母、数字和常用符号，不接受控制字符。 */
function normalizeLoginId(value, fallback = '') {
  const raw = safeText(value, 32).trim();
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned || safeText(fallback, 32).trim();
}

function uniqueLoginId(members, value, fallback = '') {
  const requested = normalizeLoginId(value, fallback) || '成员';
  const used = new Set((members || []).map((m) => m && m.loginId).filter(Boolean));
  let result = requested;
  let suffix = 2;
  while (used.has(result)) result = `${requested}-${suffix++}`;
  return result;
}

/** 成员密码允许一般文本；旧 pin 字段只作为迁移兼容来源。 */
function memberPassword(member) {
  if (!member) return '';
  if (typeof member.password === 'string') return member.password;
  return typeof member.pin === 'string' ? member.pin : '';
}

function passwordValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validMemberPassword(value) {
  return value.length >= 4 && value.length <= 64;
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
  ingredients: 'ingredients.json',
  pantryCategories: 'pantry-categories.json',
  plans: 'plans.json',
  // 当前家庭采购清单的“已买”状态。库存属于 pantry，采购状态单独保存，
  // 这样普通成员勾选清单不需要触碰全局 settings。
  shoppingStatus: 'shopping.json',
  // 留言板 + 菜品互动（想吃 / 我来做）。合成一个文件：这两样都是
  // 「家里人随手写的短内容」，拆成两个文件只会让备份/恢复多一条分支。
  notes: 'notes.json',
  // 「申请加入家庭」的待办。单独一个文件是因为它跟菜单数据完全两套生命周期：
  // 菜谱是长期内容，申请是几天内就该处理掉的一次性记录。
  access: 'access.json',
  // 全局账户身份。账户令牌只在内存中保存，密码摘要和用户资料落盘。
  users: 'users.json',
};

const state = {};
let saveTimer = null;

/* ------------------------------------------------------------------ *
 * 全局账户
 *
 * 家庭成员仍保留原来的 member.id，便于旧菜谱作者、留言和设备令牌平滑
 * 迁移；userId 是跨家庭不变的身份键。密码只保存 scrypt 摘要。
 * ------------------------------------------------------------------ */

const DEFAULT_ACCOUNT_PASSWORD = '123456';
const ACCOUNT_TTL = 30 * 24 * 60 * 60 * 1000;
const SUPER_GRANT_TTL_MS = Number(process.env.SUPER_GRANT_TTL_MS) > 0
  ? Number(process.env.SUPER_GRANT_TTL_MS)
  : 12 * 60 * 60 * 1000;
const accountSessions = new Map(); // token -> { userId, deviceId, exp }

function hashUserPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

function verifyUserPassword(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const m = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/i.exec(encoded);
  if (!m) return false;
  try {
    const got = crypto.scryptSync(String(password), m[1], 32);
    const want = Buffer.from(m[2], 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (_) {
    return false;
  }
}

function userById(userId) {
  return (state.users || []).find((u) => u && u.id === userId) || null;
}

function userByLoginId(loginId) {
  const id = normalizeLoginId(loginId, '');
  return (state.users || []).find((u) => u && u.loginId === id) || null;
}

function generatedLoginId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += alphabet[crypto.randomInt(alphabet.length)];
    const id = `用户-${suffix}`;
    if (!userByLoginId(id)) return id;
  }
  return uniqueLoginId(state.users || [], `用户-${Date.now().toString(36).slice(-6)}`);
}

function normalizeUser(input, prev) {
  const base = prev || {};
  const loginId = normalizeLoginId(input.loginId ?? base.loginId, '') || generatedLoginId();
  return {
    id: base.id || safeText(input.id, 80) || uid('u_'),
    loginId,
    displayName: safeText(input.displayName ?? base.displayName ?? loginId, 40).trim() || loginId,
    emoji: safeText(input.emoji ?? base.emoji, 4) || '🙋',
    passwordHash: safeText(input.passwordHash ?? base.passwordHash, 180),
    legacyDefaultPassword: !!(input.legacyDefaultPassword ?? base.legacyDefaultPassword),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, legacyDefaultPassword, ...safe } = user;
  return { ...safe, passwordRisk: !!legacyDefaultPassword };
}

function memberForUser(householdId, userId) {
  if (!householdId || !userId) return null;
  const h = state.households.find((x) => x.id === householdId);
  return h && (h.members || []).find((m) => m && m.userId === userId) || null;
}

function membershipsOf(userId) {
  if (!userId) return [];
  return state.households.filter((h) => (h.members || []).some((m) => m && m.userId === userId));
}

function accountHouseholds(userId) {
  return membershipsOf(userId).map((h) => {
    const me = memberForUser(h.id, userId);
    return { ...publicHousehold(h), role: me && me.role || 'member', memberId: me && me.id || '' };
  });
}

/**
 * 账户姓名是跨家庭的唯一来源。成员关系里的 name 只保留作旧数据兼容，
 * 任何对外显示都优先解析 userId 对应账户的 displayName。
 */
function memberDisplayName(member) {
  if (!member) return '';
  const user = member.userId && userById(member.userId);
  return safeText(user && user.displayName, 40).trim() || safeText(member.name, 40).trim();
}

function syncMemberDisplayName(userId, displayName) {
  if (!userId || !displayName) return false;
  let changed = false;
  for (const house of state.households || []) {
    for (const member of house.members || []) {
      if (member && member.userId === userId && member.name !== displayName) {
        member.name = displayName;
        house.updatedAt = nowISO();
        changed = true;
      }
    }
  }
  return changed;
}

function dishAuthorUserId(dish) {
  if (!dish) return '';
  if (dish.authorUserId && userById(dish.authorUserId)) return dish.authorUserId;
  if (!dish.authorId) return '';
  for (const house of state.households || []) {
    const member = (house.members || []).find((m) => m && m.id === dish.authorId);
    if (member && member.userId) return member.userId;
  }
  return '';
}

function dishDisplayAuthor(dish) {
  const userId = dishAuthorUserId(dish);
  const user = userId && userById(userId);
  return safeText(user && user.displayName, 40).trim() || safeText(dish && dish.authorName, 40).trim();
}

function publicDish(dish) {
  if (!dish) return null;
  return { ...dish, authorName: dishDisplayAuthor(dish) };
}

function publicJoinRequest(request) {
  if (!request) return null;
  const user = request.applicantUserId && userById(request.applicantUserId);
  return {
    ...request,
    name: safeText(user && user.displayName, 40).trim() || request.name || request.applicantDisplayNameSnapshot || '',
    ...(user ? { applicantLoginIdSnapshot: user.loginId, applicantDisplayNameSnapshot: user.displayName } : {}),
  };
}

function accountSessionOf(req) {
  const token = req.headers['x-account-token'];
  if (!token || typeof token !== 'string') return null;
  const s = accountSessions.get(token);
  if (!s || !userById(s.userId)) {
    if (s) accountSessions.delete(token);
    return null;
  }
  if (s.exp <= Date.now()) {
    accountSessions.delete(token);
    return null;
  }
  s.exp = Date.now() + ACCOUNT_TTL;
  return { token, scope: s };
}

function issueAccountToken(userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const deviceId = safeText(req.headers['x-device-id'], 120) || crypto.randomBytes(12).toString('hex');
  accountSessions.set(token, { kind: 'account', userId, deviceId, exp: Date.now() + ACCOUNT_TTL });
  return { token, deviceId };
}

function revokeAccountSessions(userId) {
  for (const [token, s] of accountSessions) if (s.userId === userId) accountSessions.delete(token);
  for (const [token, s] of sessions) {
    if (s && typeof s === 'object' && s.scope && s.scope.kind === 'super' && s.scope.userId === userId) sessions.delete(token);
  }
}

function accountUserId(req) {
  const a = accountSessionOf(req);
  return a ? a.scope.userId : '';
}

function currentMember(req, householdId) {
  const uidForRequest = accountUserId(req);
  if (uidForRequest) return memberForUser(householdId, uidForRequest);
  const d = deviceMember(req);
  if (!d) return null;
  const h = state.households.find((x) => x.id === householdId);
  return h && (h.members || []).find((m) => m.id === d.memberId) || null;
}

/** 账户模式下，日常数据也只能读写已经加入的家庭；旧设备令牌继续走兼容路径。 */
function accountCanAccessHousehold(req, householdId) {
  const account = accountSessionOf(req);
  if (!account || !householdId) return !account || !householdId;
  if (sessionOf(req)) return true; // 绑定账户的超级授权可跨家庭
  return !!memberForUser(householdId, account.scope.userId);
}

function requireAccountHousehold(req, res, householdId) {
  if (accountCanAccessHousehold(req, householdId)) return true;
  sendError(res, 403, '请先加入这个家庭，才能查看或修改它的家庭数据');
  return false;
}

function canAccessPantryDictionary(req, householdId) {
  const household = state.households.find((item) => item.id === householdId);
  if (!household) return false;
  const userId = accountUserId(req);
  const isAccountMember = !!(userId && memberForUser(householdId, userId));
  const device = deviceMember(req);
  const isDeviceMember = !!(device && device.householdId === householdId &&
    household.members.some((member) => member.id === device.memberId));
  const hasAuthenticatedSuperAdmin = isSuperAdmin(req) && (!!userId || !!sessionOf(req));
  return isAccountMember || isDeviceMember || hasAuthenticatedSuperAdmin;
}

function requirePantryDictionaryAccess(req, res, householdId) {
  if (canAccessPantryDictionary(req, householdId)) return true;
  if (!state.households.some((item) => item.id === householdId)) {
    sendError(res, 404, '家庭不存在');
    return false;
  }
  sendError(res, 403, '请使用已加入家庭的账号或设备访问原料字典');
  return false;
}

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
    users: [],
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
        // 系统自带的家，直接算正式：它是「装上就有」的，不是用户申请来的
        status: 'approved',
        pin: '',
        members: [{ id: 'm_self', name: '我', loginId: '我', emoji: '🙋', role: 'owner', password: '' }],
        createdAt: nowISO(),
        updatedAt: nowISO(),
      },
    ],
    pantry: [],
    ingredients: [],
    pantryCategories: [],
    plans: [],
    shoppingStatus: {},
    // 留言板留言 + 每道菜的「想吃 / 我来做」投票
    notes: { notes: [], votes: {} },
    // 申请加入别的家庭。普通用户不能直接把自己塞进别人家，得管理员点头。
    access: { requests: [] },
    settings: {
      shopName: '家庭菜单',
      adminPin: '',
      // 当前家庭是用户会话上下文，不是全局默认值；新账户登录后必须主动选择。
      currentHouseholdId: '',
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

function pantryRootCategories() {
  return PANTRY_CATEGORIES.map((category, index) => ({
    id: `pantry-root-${index + 1}`,
    householdId: null,
    parentId: null,
    name: category.name,
    builtin: true,
  }));
}

function normPantryCategory(input, base) {
  if (!input || typeof input !== 'object') return null;
  const name = safeText(input.name ?? (base && base.name), 40).trim();
  const householdId = safeText(input.householdId ?? (base && base.householdId), 40);
  if (!name || !householdId) return null;
  return {
    id: safeText((base && base.id) || input.id, 80) || uid('pc_'),
    householdId,
    parentId: safeText(input.parentId ?? (base && base.parentId), 80),
    name,
    createdAt: (base && base.createdAt) || safeText(input.createdAt, 40) || nowISO(),
    updatedAt: nowISO(),
  };
}

function normIngredient(input, base) {
  if (!input || typeof input !== 'object') return null;
  const name = safeText(input.name ?? (base && base.name), 80).trim();
  const householdId = safeText(input.householdId ?? (base && base.householdId), 40);
  if (!name || !householdId) return null;
  const sourceAliases = input.aliases ?? (base && base.aliases);
  const aliases = Array.isArray(sourceAliases)
    ? [...new Set(sourceAliases.map((alias) => safeText(alias, 80).trim()).filter((alias) => alias && alias !== name))].slice(0, 30)
    : [];
  const mode = input.defaultTrackingMode ?? (base && base.defaultTrackingMode);
  return {
    id: safeText((base && base.id) || input.id, 80) || uid('ing_'),
    householdId,
    name,
    aliases,
    categoryId: safeText(input.categoryId ?? (base && base.categoryId), 80),
    defaultTrackingMode: mode === 'presence' ? 'presence' : 'quantity',
    defaultUnit: safeText(input.defaultUnit ?? (base && base.defaultUnit), 20).trim(),
    createdAt: (base && base.createdAt) || safeText(input.createdAt, 40) || nowISO(),
    updatedAt: nowISO(),
  };
}

function pantryCategoryExists(householdId, categoryId) {
  return pantryRootCategories().some((category) => category.id === categoryId) ||
    state.pantryCategories.some((category) => category.householdId === householdId && category.id === categoryId);
}

function pantryCategoryLabel(householdId, categoryId) {
  const roots = pantryRootCategories();
  const root = roots.find((category) => category.id === categoryId);
  if (root) return root.name;
  const findCategory = (id) => state.pantryCategories.find((category) =>
    category.householdId === householdId && category.id === id) || roots.find((category) => category.id === id);
  const parts = [];
  let current = findCategory(categoryId);
  const visited = new Set();
  while (current) {
    if (visited.has(current.id)) return '';
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? findCategory(current.parentId) : null;
  }
  return parts.join(' > ');
}

function pantryCategoryIdByLabel(householdId, label) {
  const categories = pantryRootCategories().concat(
    state.pantryCategories.filter((category) => category.householdId === householdId)
  );
  const match = categories.find((category) => pantryCategoryLabel(householdId, category.id) === label);
  return match ? match.id : '';
}

function pantryCategoryNameExists(householdId, name, excludeId) {
  const key = safeText(name, 40).trim().toLocaleLowerCase();
  return pantryRootCategories().some((category) => category.name.toLocaleLowerCase() === key) ||
    state.pantryCategories.some((category) => category.id !== excludeId && category.householdId === householdId && category.name.toLocaleLowerCase() === key);
}

function ingredientCategoryId(householdId, name, pantryCategory) {
  const categoryName = safeText(pantryCategory, 40).trim() ||
    (FOOD_PRESETS.find((preset) => pantryIngredientKey(preset[0]) === pantryIngredientKey(name)) || [])[1] || '其他';
  const custom = state.pantryCategories.find((category) =>
    category.householdId === householdId && category.name === categoryName);
  if (custom) return custom.id;
  const rootIndex = PANTRY_CATEGORIES.findIndex((category) => category.name === categoryName);
  return `pantry-root-${rootIndex >= 0 ? rootIndex + 1 : PANTRY_CATEGORIES.length}`;
}

function findHouseholdIngredient(householdId, name) {
  const key = safeText(name, 80).trim().toLocaleLowerCase();
  if (!key) return null;
  return state.ingredients.find((ingredient) => ingredient.householdId === householdId &&
    (ingredient.name.toLocaleLowerCase() === key || ingredient.aliases.some((alias) => alias.toLocaleLowerCase() === key))) || null;
}

function ensureHouseholdIngredient(householdId, row, pantryCategory) {
  const name = safeText(row && row.name, 80).trim();
  if (!name || !householdId) return null;
  const existing = findHouseholdIngredient(householdId, name);
  if (existing) return existing;
  const stock = state.pantry.find((item) => item.householdId === householdId &&
    item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const purchaseType = row && row.purchaseType;
  const trackingMode = purchaseType === 'staple' ? 'presence' :
    purchaseType === 'purchase' ? 'quantity' : isKnownSeasoning(name) ? 'presence' : 'quantity';
  const ingredient = normIngredient({
    householdId,
    name,
    aliases: [],
    categoryId: ingredientCategoryId(householdId, name, pantryCategory || (stock && stock.category)),
    defaultTrackingMode: trackingMode,
    defaultUnit: trackingMode === 'quantity' && stock ? stock.unit : '',
  });
  if (!ingredient) return null;
  state.ingredients.push(ingredient);
  return ingredient;
}

function linkHouseholdIngredientReferences() {
  let dishesChanged = false;
  let pantryChanged = false;
  let ingredientsChanged = false;
  const previousIngredientCount = state.ingredients.length;
  const linkRows = (rows, householdId) => {
    if (!householdId || !Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (!row || !safeText(row.name, 80).trim()) return;
      const current = state.ingredients.find((ingredient) => ingredient.id === row.ingredientId && ingredient.householdId === householdId);
      if (current) return;
      const ingredient = ensureHouseholdIngredient(householdId, row);
      if (ingredient) {
        row.ingredientId = ingredient.id;
        dishesChanged = true;
      }
    });
  };

  state.dishes.forEach((dish) => {
    if (!dish || !dish.householdId) return;
    linkRows(dish.seasonings, dish.householdId);
    (Array.isArray(dish.methods) ? dish.methods : []).forEach((method) => linkRows(method && method.seasonings, dish.householdId));
  });
  state.pantry.forEach((item) => {
    if (!item || !item.householdId) return;
    const ingredient = state.ingredients.find((entry) => entry.id === item.ingredientId && entry.householdId === item.householdId) ||
      ensureHouseholdIngredient(item.householdId, item, item.category);
    if (ingredient && item.ingredientId !== ingredient.id) {
      item.ingredientId = ingredient.id;
      pantryChanged = true;
    }
    const categoryLabel = ingredient && pantryCategoryLabel(item.householdId, ingredient.categoryId);
    if (categoryLabel && item.category !== categoryLabel) {
      item.category = categoryLabel;
      pantryChanged = true;
    }
  });
  ingredientsChanged = state.ingredients.length !== previousIngredientCount;
  return { dishesChanged, pantryChanged, ingredientsChanged };
}

function dishIngredientReferenceProblem(dish, householdId) {
  const rows = [
    ...(Array.isArray(dish && dish.seasonings) ? dish.seasonings : []),
    ...((Array.isArray(dish && dish.methods) ? dish.methods : []).flatMap((method) => Array.isArray(method && method.seasonings) ? method.seasonings : [])),
  ];
  return rows.some((row) => row && row.ingredientId && !state.ingredients.some((ingredient) =>
    ingredient.id === row.ingredientId && ingredient.householdId === householdId))
    ? '原料必须属于当前菜谱家庭，请重新选择原料'
    : '';
}

function copyDishToScope(source, householdId, req) {
  const visibleCategory = state.categories.find((category) =>
    category.name === source.category &&
    (!category.householdId || category.householdId === householdId)
  );
  let category = visibleCategory ? source.category : source.category;
  if (!householdId && (!visibleCategory || visibleCategory.householdId)) {
    category = state.categories.find((item) => !item.householdId && item.name === '其他')?.name ||
      state.categories.find((item) => !item.householdId)?.name || '家常菜';
  }

  const mapRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => {
    const mapped = { ...row };
    delete mapped.ingredientId;
    if (householdId) {
      const ingredient = findHouseholdIngredient(householdId, mapped.name);
      if (ingredient) mapped.ingredientId = ingredient.id;
    }
    return mapped;
  });
  const copy = normDish({
    ...source,
    id: '',
    householdId: householdId || null,
    category,
    dishStatus: 'active',
    seasonings: mapRows(source.seasonings),
    methods: (Array.isArray(source.methods) ? source.methods : []).map((method) => ({
      ...method,
      seasonings: mapRows(method.seasonings),
    })),
  });
  if (!copy) return null;
  copy.copySourceDishId = source.id;
  const who = whoami(req, householdId);
  copy.authorId = who.kind === 'member' ? who.memberId : '';
  copy.authorUserId = who.userId || accountUserId(req) || '';
  copy.authorName = who.name || (who.userId && userById(who.userId)?.displayName) || '';
  return copy;
}

function pantryIngredientReferenceProblem(item) {
  if (!item || !item.ingredientId) return '';
  return state.ingredients.some((ingredient) => ingredient.id === item.ingredientId && ingredient.householdId === item.householdId)
    ? ''
    : '原料必须属于当前库存家庭，请重新选择原料';
}

function pantryCategoryWouldCycle(householdId, categoryId, parentId) {
  const seen = new Set();
  let currentId = parentId;
  while (currentId) {
    if (currentId === categoryId) return true;
    if (seen.has(currentId)) return true;
    seen.add(currentId);
    const current = state.pantryCategories.find((category) => category.householdId === householdId && category.id === currentId);
    if (!current) return false;
    currentId = current.parentId;
  }
  return false;
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
  ['香菇', '蔬菜', 'g', 5],
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
  ['大葱', '调味干货', '根', 7], ['小葱', '调味干货', '把', 3], ['葱', '调味干货', '根', 7], ['葱花', '调味干货', '把', 3],
  ['生姜', '调味干货', '块', 30], ['姜片', '调味干货', '块', 30], ['姜丝', '调味干货', '块', 30],
  ['大蒜', '调味干货', '头', 60], ['蒜瓣', '调味干货', '瓣', 30], ['蒜末', '调味干货', '瓣', 3],
  ['老抽', '调味干货', '瓶', 540], ['香醋', '调味干货', '瓶', 540], ['蚝油', '调味干货', '瓶', 365],
  ['料酒', '调味干货', '瓶', 365], ['豆瓣酱', '调味干货', '瓶', 365], ['辣椒酱', '调味干货', '瓶', 365],
  ['番茄酱', '调味干货', '瓶', 365], ['沙拉酱', '调味干货', '瓶', 365], ['蜂蜜', '调味干货', '罐', 540],
  ['淀粉', '调味干货', '袋', 365], ['鸡精', '调味干货', '袋', 540], ['咖喱块', '调味干货', '盒', 365],
  ['花椒', '调味干货', '包', 180], ['干辣椒', '调味干货', 'g', 180], ['八角', '调味干货', '包', 180],
  ['孜然粒', '调味干货', '包', 180], ['辣椒面', '调味干货', '包', 180],
  // 零食
  ['薯片', '零食', '袋', 180], ['巧克力', '零食', '块', 365], ['饼干', '零食', '袋', 180],
  ['瓜子', '零食', '包', 180], ['花生', '豆制品', '包', 180], ['花生米', '豆制品', 'g', 180], ['油酥花生米', '豆制品', 'g', 180],
  ['混合坚果', '零食', '罐', 180],
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
 * 家庭成员统一成 {id, name, loginId, emoji, role, password}
 * 兼容早期存成 ["妈妈","爸爸"] 的字符串数组，老数据不用手动改
 *
 * role 是写权限的分界：
 *   owner  —— 知道本家口令（或者本来就是这个家的创建者），能改本家所有人的菜
 *   member —— 只能改**自己添加**的那几条
 * 老成员一律升成 owner：他们本来就是自己家的管理员，硬降级只会让
 * 「我明明是户主却改不了」比迁移前更糟。
 *
 * password 是**这个人自己设**的认领密码，别人不知道，所以才是凭证。
 * 老成员没有 password（空）—— 意味着「还没设」，第一次认领时补上。
 * 明文存，跟全局 adminPin 一个规矩：备份里本来就有口令明文，
 * 给它加一层 hash 只是让源码多几行，挡不住能导出备份的人。
 *
 * 唯一键是 id 不是 name，所以爸爸和儿子可以都叫「小明」。
 * 老数据里重名的会在迁移时被并成一个人（见 loadState）。
 */
function normMembers(input, prevById, prevByName) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seenId = new Set();
  const seenLoginId = new Set();
  for (const m of input.slice(0, 30)) {
    const isObj = typeof m === 'object' && m;
    const name = safeText(isObj ? m.name : m, 12).trim();
    if (!name) continue;
    const id = isObj && typeof m.id === 'string' && m.id ? m.id : uid('m_');
    if (seenId.has(id)) continue;
    seenId.add(id);
    const old = (prevById && prevById.get(id)) || (prevByName && prevByName.get(name)) || null;
    const emoji =
      isObj && typeof m.emoji === 'string' && m.emoji.trim()
        ? safeText(m.emoji.trim(), 4)
        : old && old.emoji
        ? old.emoji
        : MEMBER_EMOJI[out.length % MEMBER_EMOJI.length];
    // 角色：显式给了就认；没给沿用老的；再没有默认 owner（见 normHousehold 的兜底）
    let role = isObj ? m.role : '';
    if (role !== 'owner' && role !== 'member') role = old && old.role === 'member' ? 'member' : 'owner';
    // 密码只有服务端认得的才留下，客户端传来的当作没设；旧 pin 自动迁移。
    const password = old ? memberPassword(old) : '';
    const requestedLoginId = normalizeLoginId(isObj ? m.loginId : '', old && old.loginId ? old.loginId : name);
    let loginId = requestedLoginId || id;
    let suffix = 2;
    while (seenLoginId.has(loginId)) loginId = `${requestedLoginId || id}-${suffix++}`;
    seenLoginId.add(loginId);
    const userId = isObj && typeof m.userId === 'string' && m.userId
      ? safeText(m.userId, 80)
      : old && typeof old.userId === 'string' ? old.userId : '';
    out.push({ id, name, loginId, emoji, role, password, ...(userId ? { userId } : {}) });
  }
  return out;
}

/**
 * 家庭统一成 {id, name, emoji, note, status, pin, members[]}
 * 名字可以是房号（301）、门牌（西苑 2 栋 501），也可以是随便起的称呼
 *
 * status: approved(正式) / normal(普通)
 *   新建的家庭一律 normal —— 能自己用，但不能拉人进共享菜单，
 *   要等超级管理员点头。防的是随手建一堆空家庭把共享菜单搅乱。
 * pin: 本家的管理口令，明文存（跟全局 adminPin 一个规矩，
 *   备份里本来就含明文口令，README 已写明）。
 */
function normHousehold(input, prev) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 20).trim();
  if (!name) return null;
  const prevById = new Map();
  const prevByName = new Map();
  for (const m of base.members || []) {
    if (m && m.id) prevById.set(m.id, m);
    if (m && m.name) prevByName.set(m.name, m);
  }
  const members = normMembers(input.members ?? base.members, prevById, prevByName) || [];
  // 新家庭没有 owner 时让第一个成员成为管理员；已有家庭的最后一个 owner
  // 由家庭更新 handler 拒绝撤销，不能在这里静默抢走管理员身份。
  if (members.length && !members.some((m) => m.role === 'owner') && !prev) members[0].role = 'owner';
  return {
    id: base.id || (typeof input.id === 'string' && input.id ? input.id : uid('h_')),
    name,
    emoji: safeText(input.emoji ?? base.emoji, 4) || '🏠',
    note: safeText(input.note ?? base.note, 100),
    status: (input.status ?? base.status) === 'approved' ? 'approved' : 'normal',
    pin: safeText(input.pin ?? base.pin, 12),
    members,
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: nowISO(),
  };
}

/** 库存条目：quantity 模式记余量；presence 模式只记有/无。 */
function normPantryItem(input, prev, keepInputId) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 24).trim();
  if (!name) return null;
  const householdId = resolveHouseholdId(input.householdId ?? base.householdId);
  const ingredientId = safeText(input.ingredientId ?? base.ingredientId, 80);
  const linkedIngredient = ingredientId
    ? state.ingredients.find((ingredient) => ingredient.id === ingredientId && ingredient.householdId === householdId)
    : null;

  const rawQty = Number(input.quantity ?? base.quantity ?? 1);
  const qty = Number.isFinite(rawQty)
    ? Math.min(99999, Math.max(0, Math.round(rawQty * 1000) / 1000))
    : 0;
  const rawMin = Number(input.minQuantity ?? base.minQuantity ?? 0);
  const minQuantity = Number.isFinite(rawMin)
    ? Math.min(99999, Math.max(0, Math.round(rawMin * 1000) / 1000))
    : 0;

  const cat = safeText(input.category ?? base.category, 80).trim();
  const known = PANTRY_CATEGORIES.some((c) => c.name === cat);
  const category = linkedIngredient
    ? pantryCategoryLabel(householdId, linkedIngredient.categoryId) || '其他'
    : isKnownSeasoning(name)
    ? '调味干货'
    : known ? cat : '其他';
  const requestedMode = input.trackingMode ?? base.trackingMode;
  const hasRequestedMode = requestedMode !== undefined && requestedMode !== null;
  const categoryChanged = input.category !== undefined && String(input.category).trim() !== String(base.category || '').trim();
  const seasoningCategory = category.split(' > ')[0] === '调味干货' &&
    ((!keepInputId && (!base.category || categoryChanged)) || (linkedIngredient && linkedIngredient.defaultTrackingMode === 'presence'));
  const trackingMode = seasoningCategory
    ? 'presence'
    : hasRequestedMode
    ? requestedMode === 'presence' ? 'presence' : 'quantity'
    : linkedIngredient
      ? linkedIngredient.defaultTrackingMode === 'presence' ? 'presence' : 'quantity'
      : isKnownSeasoning(name) ? 'presence' : 'quantity';
  const hasStock = typeof input.hasStock === 'boolean'
    ? input.hasStock
    : typeof base.hasStock === 'boolean'
    ? base.hasStock
    : qty > 0;

  return {
    id:
      base.id ||
      (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('f_')),
    householdId,
    ...(ingredientId ? { ingredientId } : {}),
    name,
    category,
    trackingMode,
    ...(trackingMode === 'presence' ? { hasStock, quantity: 0, minQuantity: 0, unit: '' } : {
      quantity: qty,
      minQuantity,
      unit: safeText(input.unit ?? base.unit, 8).trim() || '份',
    }),
    expireAt: normDate(input.expireAt ?? base.expireAt),
    note: safeText(input.note ?? base.note, 100),
    createdAt: base.createdAt || input.createdAt || nowISO(),
    updatedAt: keepInputId && input.updatedAt ? safeText(input.updatedAt, 40) : nowISO(),
  };
}

/** 采购合并用的食材键：处理空格、标点和常见同义写法。 */
function pantryIngredientKey(name) {
  let key = safeText(name, 24).toLowerCase()
    .replace(/[\s\u3000、，。；：:（）()【】\[\]\/\\·'"“”‘’\-_.]/g, '');
  const aliases = {
    生抽酱油: '生抽',
    酱油: '生抽',
    老抽酱油: '老抽',
    食盐: '盐',
    食用盐: '盐',
    精盐: '盐',
    盐巴: '盐',
    白砂糖: '糖',
    白糖: '糖',
    味精: '味精',
    鸡粉: '鸡精',
  };
  return aliases[key] || key;
}

const PRESENCE_SEASONINGS = new Set([
  '盐', '糖', '生抽', '老抽', '醋', '香醋', '米醋', '陈醋', '料酒', '黄酒',
  '蚝油', '豆瓣酱', '辣椒酱', '番茄酱', '沙拉酱', '蜂蜜', '鸡精', '味精',
  '花椒', '八角', '孜然粒', '干辣椒', '辣椒面', '咖喱块',
]);

function isKnownSeasoning(name) {
  return PRESENCE_SEASONINGS.has(pantryIngredientKey(name)) || isSeasoningAromatic(name);
}

/** 采购累加只在同家庭、同食材、同包装单位的库存条目上进行。 */
function pantryUnitKey(unit) {
  const key = safeText(unit, 8).trim().toLowerCase();
  return ({ 公克: 'g', 克: 'g', 千克: 'kg', 公斤: 'kg', 毫升: 'ml', 升: 'l' })[key] || key;
}

function isSeasoningAromatic(name) {
  return new Set([
    '葱', '大葱', '小葱', '葱花', '香葱', '青葱',
    '姜', '生姜', '姜片', '姜丝',
    '蒜', '大蒜', '蒜瓣', '蒜末',
  ]).has(safeText(name, 24).trim());
}

function addPantryQuantity(item) {
  const hit = state.pantry.find(
    (p) => p.householdId === item.householdId &&
      (p.trackingMode || 'quantity') === item.trackingMode &&
      (item.ingredientId
        ? p.ingredientId === item.ingredientId
        : !p.ingredientId && pantryIngredientKey(p.name) === pantryIngredientKey(item.name)) &&
      pantryUnitKey(p.unit) === pantryUnitKey(item.unit)
  );
  if (!hit) {
    state.pantry.unshift(item);
    return item;
  }
  if (item.trackingMode === 'presence') {
    hit.hasStock = hit.hasStock || item.hasStock;
    hit.updatedAt = nowISO();
    return hit;
  }
  hit.quantity = Math.min(99999, Math.round((Number(hit.quantity || 0) + Number(item.quantity || 0)) * 1000) / 1000);
  if (!hit.expireAt && item.expireAt) hit.expireAt = item.expireAt;
  if ((!hit.category || hit.category === '其他') && item.category && item.category !== '其他') hit.category = item.category;
  if (!hit.note && item.note) hit.note = item.note;
  hit.updatedAt = nowISO();
  return hit;
}

/** 菜谱用量解析：扣库存只处理明确的数字+单位，不把“适量”猜成一个单位。 */
function parseRecipeAmount(text) {
  const raw = safeText(text, 40).trim();
  const m = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+|[\u4e00-\u9fff]{1,4})/.exec(raw);
  if (!m || Number(m[1]) <= 0) return null;
  const aliases = {
    克: 'g', 公克: 'g', 千克: 'kg', 公斤: 'kg', 毫升: 'ml', 升: 'l', 毫克: 'mg',
    个: '个', 只: '只', 条: '条', 盒: '盒', 包: '包', 瓶: '瓶', 袋: '袋',
    勺: '勺', 小勺: '小勺', 大勺: '大勺', 片: '片', 瓣: '瓣', 根: '根', 把: '把',
    颗: '颗', 块: '块', 丝: '丝', 份: '份', 斤: '斤', 两: '两',
  };
  const unit = aliases[String(m[2]).trim().toLowerCase()] || String(m[2]).trim().toLowerCase();
  return { quantity: Math.round(Number(m[1]) * 1000) / 1000, unit };
}

function dishRecipeIngredients(dish) {
  if (!dish) return [];
  const rows = [];
  (dish.seasonings || []).forEach((s) => { if (s && s.name) rows.push(s); });
  (dish.methods || []).forEach((m) => (m.seasonings || []).forEach((s) => { if (s && s.name) rows.push(s); }));
  return rows;
}

/** 完成计划菜时实际扣库存；扣完的数量型库存行会删除，不足时仍返回缺货提醒。 */
function consumeDishPantry(householdId, dish) {
  const totals = new Map();
  const warnings = [];
  dishRecipeIngredients(dish).forEach((s) => {
    const ingredient = s.ingredientId
      ? state.ingredients.find((row) => row.id === s.ingredientId && row.householdId === householdId)
      : null;
    const matchesPantryIngredient = (row) => row.householdId === householdId &&
      (ingredient ? row.ingredientId === ingredient.id : pantryIngredientKey(row.name) === pantryIngredientKey(s.name));
    const presenceTracked = (ingredient && ingredient.defaultTrackingMode === 'presence') ||
      (!ingredient && isKnownSeasoning(s.name)) || state.pantry.some((row) =>
        matchesPantryIngredient(row) && row.trackingMode === 'presence');
    if (presenceTracked) {
      const stock = state.pantry.filter(matchesPantryIngredient);
      const present = stock.some((row) => row.hasStock === true ||
        ((row.trackingMode || 'quantity') !== 'presence' && Number(row.quantity) > 0));
      if (!present) warnings.push(`${s.name}：完成前请确认家中是否有`);
      return;
    }
    const amount = parseRecipeAmount(s.amount);
    if (!amount) {
      warnings.push(`${s.name}：用量为“适量”或无法识别，未自动扣除`);
      return;
    }
    const ingredientKey = ingredient ? `id:${ingredient.id}` : `name:${pantryIngredientKey(s.name)}`;
    const key = `${ingredientKey}|${pantryUnitKey(amount.unit)}`;
    const current = totals.get(key) || { name: ingredient ? ingredient.name : s.name, ingredientId: ingredient?.id || '', unit: amount.unit, quantity: 0 };
    current.quantity += amount.quantity;
    totals.set(key, current);
  });

  const consumed = [];
  for (const need of totals.values()) {
    const rows = state.pantry
      .filter((p) => p.householdId === householdId &&
        (need.ingredientId
          ? p.ingredientId === need.ingredientId
          : !p.ingredientId && pantryIngredientKey(p.name) === pantryIngredientKey(need.name)) &&
        pantryUnitKey(p.unit) === pantryUnitKey(need.unit))
      .sort((a, b) => String(a.expireAt || '9999-12-31').localeCompare(String(b.expireAt || '9999-12-31')));
    let remain = need.quantity;
    for (const row of rows) {
      if (remain <= 0) break;
      const before = Number(row.quantity) || 0;
      const used = Math.min(before, remain);
      const after = Math.round((before - used) * 1000) / 1000;
      row.updatedAt = nowISO();
      remain = Math.round((remain - used) * 1000) / 1000;
      if (used > 0) consumed.push({ name: row.name, quantity: used, unit: row.unit });
      if (after <= 0) state.pantry.splice(state.pantry.indexOf(row), 1);
      else row.quantity = after;
    }
    if (remain > 0) warnings.push(`${need.name}：库存还缺 ${remain}${need.unit}`);
  }
  return { consumed, warnings };
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

/** 本周计划里的一道菜；plannedFor 用于同一周重复安排同一道菜时按日期排序。 */
function normPlanItem(input, prev, keepInputId, defaultWeek) {
  const base = prev || {};
  const name = safeText(input.name ?? base.name, 40).trim();
  if (!name) return null;
  const week = mondayOf(defaultWeek || input.weekOf || base.weekOf);
  const requestedDate = normDate(input.plannedFor ?? base.plannedFor) || week;
  const plannedFor = mondayOf(requestedDate) === week ? requestedDate : week;
  return {
    id: base.id || (keepInputId && typeof input.id === 'string' && input.id ? input.id : uid('pi_')),
    dishId: safeText(input.dishId ?? base.dishId, 40) || null,
    name,
    servings: safeText(input.servings ?? base.servings, 30),
    note: safeText(input.note ?? base.note, 100),
    plannedFor,
    status: (input.status ?? base.status) === 'done' ? 'done' : 'planned',
    completedAt: (input.status ?? base.status) === 'done'
      ? (base.completedAt || input.completedAt || nowISO())
      : '',
    addedAt: base.addedAt || input.addedAt || nowISO(),
  };
}

/** 一个家庭一周的计划：{id, householdId, weekOf, items[]} */
function normPlan(input, prev) {
  const base = prev || {};
  const weekOf = mondayOf(input.weekOf ?? base.weekOf);
  const items = (Array.isArray(input.items) ? input.items : base.items || [])
    .map((it) => normPlanItem(it, undefined, true, weekOf))
    .filter(Boolean);
  return {
    id: base.id || (typeof input.id === 'string' && input.id ? input.id : uid('pl_')),
    householdId: resolveHouseholdId(input.householdId ?? base.householdId),
    weekOf,
    // 同一道菜允许在一周内安排多次，plannedFor 区分每次安排。
    items,
    received: input.received && typeof input.received === 'object'
      ? input.received
      : (base.received && typeof base.received === 'object' ? base.received : {}),
    receiveRequests: input.receiveRequests && typeof input.receiveRequests === 'object'
      ? input.receiveRequests
      : (base.receiveRequests && typeof base.receiveRequests === 'object' ? base.receiveRequests : {}),
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
    plan = { id: uid('pl_'), householdId: hid, weekOf: wk, items: [], received: {}, createdAt: nowISO(), updatedAt: nowISO() };
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
  // 采购状态按家庭隔离，旧版本没有这个文件时从空对象开始。
  state.shoppingStatus = state.shoppingStatus && typeof state.shoppingStatus === 'object'
    ? state.shoppingStatus
    : {};
  for (const [hid, bucket] of Object.entries(state.shoppingStatus)) {
    if (!bucket || typeof bucket !== 'object') {
      delete state.shoppingStatus[hid];
      continue;
    }
    const items = bucket.items && typeof bucket.items === 'object' ? bucket.items : {};
    bucket.items = Object.fromEntries(
      Object.entries(items)
        .map(([name, item]) => [safeText(name, 80).trim(), item])
        .filter(([name, item]) => name && item && item.state === 'completed')
        .map(([name, item]) => [name, { state: 'completed', updatedAt: safeText(item.updatedAt, 40) || nowISO() }])
    );
  }
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
    if (!['active', 'paused'].includes(d.dishStatus)) d.dishStatus = 'active';
  });
  // 按 id 去重：重复 id 会让删除/更新只命中一条
  const seenD = new Set();
  state.dishes = state.dishes.filter((d) => (seenD.has(d.id) ? false : (seenD.add(d.id), true)));
  const seenO = new Set();
  state.orders = state.orders.filter((o) => (seenO.has(o.id) ? false : (seenO.add(o.id), true)));
  // 加入申请的归属兜底：指向已经不存在的家庭的申请直接清掉，免得管理员看到一堆点不亮的待办
  const hhNow = new Set(state.households.map((h) => h.id));
  state.access.requests = (state.access.requests || [])
    .filter((r) => r && r.name && hhNow.has(r.householdId))
    .map((r) => ({
      ...r,
      requestedRole: r.requestedRole === 'owner' ? 'owner' : 'member',
      ...(r.approvedRole === 'owner' || r.approvedRole === 'member'
        ? { approvedRole: r.approvedRole }
        : {}),
    }));

  /* ---- 家庭 / 库存：从旧版本平滑升级 ---- */

  // 旧版本没有 households，settings.members 里存着家庭成员，搬进第一个家庭
  const legacyMembers = normMembers(state.settings.members) || [];

  /**
   * 家庭并成员迁移
   *
   * 老版本 households.json 里的成员是 {id, name, emoji}，没有 role / pin。
   * normHousehold 已经把它们补成 owner + 空 pin。
   *
   * status 的分界：磁盘上已经存在的家庭一律算**正式**。它们都在用了，
   * 没道理因为升级就变成「未审核」，那等于凭空收走人家的功能。
   * 从今往后**新建**的家庭才是普通家庭，要超级管理员点头才能升级 ——
   * 挡的是随手建一堆空家庭把共享菜单搅乱。
   *
   * 成员那边：老版本按名字去重存的，重名成员当时会被静默丢掉，所以文件里
   * 不会出现两个同名的。现在唯一键换成 id 了，保持原样别再合并 ——
   * 两个「小明」从此各走各的，靠各自的 PIN 认领。
   */
  const hadHouseholdsFile = fromDisk.has('households');
  state.households = (Array.isArray(state.households) ? state.households : [])
    .map((h) => {
      if (!h || typeof h !== 'object') return null;
      return normHousehold(h, hadHouseholdsFile && !h.status ? { status: 'approved' } : undefined);
    })
    .filter(Boolean);

  const seenH = new Set();
  state.households = state.households.filter((h) =>
    seenH.has(h.id) ? false : (seenH.add(h.id), true)
  );
  if (!state.households.length) {
    // 全新安装：系统自带的「我家」直接算正式。它是装上就有的，
    // 不是谁「申请」来的，没道理让人先去找超管认证一遍。
    state.households = [
      normHousehold({ name: '我家', emoji: '🏠', status: 'approved', members: legacyMembers }),
    ];
  } else if (legacyMembers.length && !fromDisk.has('households')) {
    // households.json 是这次升级才有的，说明用户跑的是老版本：
    // settings.members 里的老成员认领给第一个家庭（不要被示例成员占位）
    state.households[0].members = legacyMembers;
  } else if (legacyMembers.length && !state.households.some((h) => h.members.length)) {
    state.households[0].members = legacyMembers;
  }
  delete state.settings.members; // 成员改由各家庭自己持有

  // 全局账户迁移：旧成员继续保留自己的 member.id，新增 userId 作为跨家庭
  // 身份键。迁移按稳定 member.id 处理，不按显示名合并，重复启动幂等。
  state.users = Array.isArray(state.users) ? state.users : [];
  const userIds = new Set();
  const loginIds = new Set();
  state.users = state.users
    .filter((u) => u && typeof u === 'object')
    .map((u) => {
      const n = normalizeUser(u, u);
      if (userIds.has(n.id)) n.id = uid('u_');
      let requested = n.loginId || generatedLoginId();
      let suffix = 2;
      while (loginIds.has(requested)) requested = `${n.loginId}-${suffix++}`;
      n.loginId = requested;
      userIds.add(n.id);
      loginIds.add(n.loginId);
      return n;
    });
  const usersById = new Map(state.users.map((u) => [u.id, u]));
  let usersChanged = false;
  let housesChanged = false;
  for (const h of state.households) {
    for (const m of h.members || []) {
      let user = m.userId && usersById.get(m.userId);
      if (!user) {
        const password = memberPassword(m);
        let loginId = normalizeLoginId(m.loginId, m.name) || generatedLoginId();
        const baseLogin = loginId;
        let suffix = 2;
        while (loginIds.has(loginId)) loginId = `${baseLogin}-${suffix++}`;
        user = normalizeUser({
          id: uid('u_'),
          loginId,
          displayName: m.name,
          emoji: m.emoji,
          passwordHash: hashUserPassword(password || DEFAULT_ACCOUNT_PASSWORD),
          legacyDefaultPassword: !password,
        });
        state.users.push(user);
        usersById.set(user.id, user);
        userIds.add(user.id);
        loginIds.add(user.loginId);
        usersChanged = true;
      }
      if (m.userId !== user.id) {
        m.userId = user.id;
        housesChanged = true;
      }
      if (m.name !== user.displayName) {
        m.name = user.displayName;
        housesChanged = true;
      }
    }
  }
  if (usersChanged) scheduleSave('users');
  if (housesChanged) scheduleSave('households');

  const hhIds = new Set(state.households.map((h) => h.id));
  const fallbackH = state.households[0].id;

  const loadedPantryCategories = Array.isArray(state.pantryCategories) ? state.pantryCategories : [];
  state.pantryCategories = loadedPantryCategories
    .map((category) => normPantryCategory(category, category))
    .filter((category) => category && hhIds.has(category.householdId));
  const categoryIds = new Set(pantryRootCategories().map((category) => category.id));
  const seenCategoryIds = new Set(categoryIds);
  const seenCategoryNames = new Set();
  state.pantryCategories = state.pantryCategories.filter((category) => {
    const key = `${category.householdId}\0${category.name.toLocaleLowerCase()}`;
    const parentValid = categoryIds.has(category.parentId) || state.pantryCategories.some((parent) =>
      parent.id === category.parentId && parent.householdId === category.householdId);
    if (seenCategoryIds.has(category.id) || seenCategoryNames.has(key) || !parentValid || category.id === category.parentId) return false;
    seenCategoryIds.add(category.id);
    seenCategoryNames.add(key);
    categoryIds.add(category.id);
    return true;
  });
  if (JSON.stringify(loadedPantryCategories) !== JSON.stringify(state.pantryCategories)) scheduleSave('pantryCategories');

  const loadedIngredients = Array.isArray(state.ingredients) ? state.ingredients : [];
  state.ingredients = loadedIngredients
    .map((ingredient) => normIngredient(ingredient, ingredient))
    .filter((ingredient) => ingredient && hhIds.has(ingredient.householdId) && pantryCategoryExists(ingredient.householdId, ingredient.categoryId));
  const seenIngredientIds = new Set();
  const seenIngredientNames = new Set();
  state.ingredients = state.ingredients.filter((ingredient) => {
    const nameKey = `${ingredient.householdId}\0${ingredient.name.toLocaleLowerCase()}`;
    if (seenIngredientIds.has(ingredient.id) || seenIngredientNames.has(nameKey)) return false;
    seenIngredientIds.add(ingredient.id);
    seenIngredientNames.add(nameKey);
    return true;
  });
  if (JSON.stringify(loadedIngredients) !== JSON.stringify(state.ingredients)) scheduleSave('ingredients');

  // 历史点餐 / 库存没有 householdId 的，都归到第一个家庭
  state.orders.forEach((o) => {
    if (!hhIds.has(o.householdId)) o.householdId = fallbackH;
  });

  const seenF = new Set();
  const loadedPantry = Array.isArray(state.pantry) ? state.pantry : [];
  state.pantry = loadedPantry
    .map((p) => (p && typeof p === 'object' ? normPantryItem(p, undefined, true) : null))
    .filter(Boolean)
    .filter((item) => item.trackingMode === 'presence' || Number(item.quantity) > 0)
    .filter((p) => (seenF.has(p.id) ? false : (seenF.add(p.id), true)));
  let pantryChanged = JSON.stringify(loadedPantry) !== JSON.stringify(state.pantry);
  state.pantry.forEach((p) => {
    if (!hhIds.has(p.householdId)) p.householdId = fallbackH;
    // 老版本把葱姜蒜归到了蔬菜；迁移到调味干货后，计划页也会按常备调料提示。
    if (p.category === '蔬菜' && isSeasoningAromatic(p.name)) {
      p.category = '调味干货';
      pantryChanged = true;
    }
    // 早期从计划采购入库的盐、白糖没有对应预设分类，曾被保存为“其他”。
    if (['盐', '糖'].includes(pantryIngredientKey(p.name)) && p.category !== '调味干货') {
      p.category = '调味干货';
      pantryChanged = true;
    }
  });
  if (pantryChanged) scheduleSave('pantry');

  const ingredientLinks = linkHouseholdIngredientReferences();
  if (ingredientLinks.dishesChanged) scheduleSave('dishes');
  if (ingredientLinks.pantryChanged) scheduleSave('pantry');
  if (ingredientLinks.ingredientsChanged) scheduleSave('ingredients');

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

  if (!hhIds.has(state.settings.currentHouseholdId)) state.settings.currentHouseholdId = fallbackH;
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
  saveDevices();
}

/* ------------------------------------------------------------------ *
 * 设备令牌 —— 「登录一次，记住这台设备」
 *
 * 成员输一次 PIN，服务端发一枚不透明的随机串，前端存进 localStorage。
 * 之后这台设备每次请求都带着它，服务端据此知道「你是哪个成员」。
 * 同一台人的手机 / 平板 / 电脑各认领一次即可，都指向同一个成员。
 *
 * 为什么不塞进 state：state 会被备份带走，而设备令牌是**长期有效的冒名凭证**，
 * 导出备份的人拿到它就能一直冒充那个人。设备令牌只留在本机这台机器上。
 *
 * 30 天滑动续期：每次用都往后推。过期了重新输一次 PIN 就行。
 * 危险动作（改成员、改家庭口令、删家庭、升级家庭）**不认令牌，要重新输 PIN**。
 * ------------------------------------------------------------------ */

const DEVICE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天
const DEVICES_FILE = 'devices.json';
/** token -> { memberId, householdId, exp } */
let devices = new Map();
let devicesDirty = false;

function loadDevices() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, DEVICES_FILE), 'utf8'));
    const now = Date.now();
    devices = new Map(
      (Array.isArray(raw) ? raw : [])
        .filter((d) => d && typeof d.token === 'string' && typeof d.memberId === 'string' && d.exp > now)
        .map((d) => [d.token, { memberId: d.memberId, householdId: d.householdId || '', exp: d.exp }])
    );
  } catch (_) {
    devices = new Map(); // 文件不存在 = 从来没用过「记住我」，正常
  }
}

function saveDevices() {
  devicesDirty = false;
  try {
    const file = path.join(DATA_DIR, DEVICES_FILE);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...devices.entries()], null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[error] 设备令牌保存失败：', err.message);
  }
}

function markDevicesDirty() {
  devicesDirty = true;
  const t = setTimeout(saveDevices, 300);
  if (t.unref) t.unref();
}

function issueDeviceToken(memberId, householdId) {
  const token = crypto.randomBytes(24).toString('hex');
  devices.set(token, { memberId, householdId: householdId || '', exp: Date.now() + DEVICE_TTL });
  markDevicesDirty();
  return token;
}

/** 令牌换成员身份；顺便滑动续期 */
function deviceMember(req) {
  const token = req.headers['x-device-token'];
  if (!token || typeof token !== 'string') return null;
  const d = devices.get(token);
  if (!d) return null;
  if (Date.now() > d.exp) {
    devices.delete(token);
    markDevicesDirty();
    return null;
  }
  d.exp = Date.now() + DEVICE_TTL;
  markDevicesDirty();
  return { ...d, token };
}

function revokeDeviceTokens(memberId) {
  let n = 0;
  for (const [t, d] of devices) {
    if (d.memberId === memberId) {
      devices.delete(t);
      n++;
    }
  }
  if (n) markDevicesDirty();
  return n;
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
    ingredients: state.ingredients,
    pantryCategories: state.pantryCategories,
    plans: state.plans,
    shoppingStatus: state.shoppingStatus,
    notes: state.notes,
    access: state.access,
    users: state.users,
  };
}

/**
 * 把一份备份灌进当前状态。返回恢复进去的条数。
 * 上传恢复和备份恢复共用这一段，免得两条路修一个漏一个。
 */
function applyBackup(src) {
  if (Array.isArray(src.users)) {
    const seen = new Set();
    state.users = src.users
      .map((u) => (u && typeof u === 'object' ? normalizeUser(u, undefined) : null))
      .filter((u) => u && u.passwordHash && !seen.has(u.id) && (seen.add(u.id), true));
  }
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
  const backupHouseholdIds = new Set(state.households.map((household) => household.id));
  if (Array.isArray(src.pantryCategories)) {
    const seen = new Set();
    state.pantryCategories = src.pantryCategories
      .map((category) => (category && typeof category === 'object' ? normPantryCategory(category, undefined) : null))
      .filter((category) => category && backupHouseholdIds.has(category.householdId))
      .filter((category) => (seen.has(category.id) ? false : (seen.add(category.id), true)));
  }
  if (Array.isArray(src.ingredients)) {
    const seen = new Set();
    state.ingredients = src.ingredients
      .map((ingredient) => (ingredient && typeof ingredient === 'object' ? normIngredient(ingredient, undefined) : null))
      .filter((ingredient) => ingredient && backupHouseholdIds.has(ingredient.householdId))
      .filter((ingredient) => (seen.has(ingredient.id) ? false : (seen.add(ingredient.id), true)))
      .filter((ingredient) => pantryCategoryExists(ingredient.householdId, ingredient.categoryId));
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
  if (src.shoppingStatus && typeof src.shoppingStatus === 'object') {
    state.shoppingStatus = {};
    for (const [hid, bucket] of Object.entries(src.shoppingStatus)) {
      if (!bucket || typeof bucket !== 'object') continue;
      const items = bucket.items && typeof bucket.items === 'object' ? bucket.items : {};
      state.shoppingStatus[safeText(hid, 40)] = {
        items: Object.fromEntries(
          Object.entries(items)
            .map(([name, item]) => [safeText(name, 80).trim(), item])
            .filter(([name, item]) => name && item && item.state === 'completed')
            .map(([name, item]) => [name, { state: 'completed', updatedAt: safeText(item.updatedAt, 40) || nowISO() }])
        ),
      };
    }
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
          ...(r.applicantUserId ? { applicantUserId: safeText(r.applicantUserId, 80) } : {}),
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
  if (!hhIds.has(state.settings.currentHouseholdId)) state.settings.currentHouseholdId = '';
  state.orders.forEach((o) => {
    if (!hhIds.has(o.householdId)) o.householdId = state.households[0].id;
  });
  state.pantry.forEach((p) => {
    if (!hhIds.has(p.householdId)) p.householdId = state.households[0].id;
  });
  state.ingredients = state.ingredients.filter((ingredient) => hhIds.has(ingredient.householdId));
  state.pantryCategories = state.pantryCategories.filter((category) => hhIds.has(category.householdId));
  state.plans.forEach((pl) => {
    if (!hhIds.has(pl.householdId)) pl.householdId = state.households[0].id;
  });
  state.notes.notes.forEach((n) => {
    if (!hhIds.has(n.householdId)) n.householdId = state.households[0].id;
  });

  linkHouseholdIngredientReferences();

  saveNow();
  return {
    dishes: state.dishes.length,
    households: state.households.length,
    pantry: state.pantry.length,
    ingredients: state.ingredients.length,
    pantryCategories: state.pantryCategories.length,
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
    // 谁加的这道菜。普通成员只能改自己添加的那几条，管理员谁都能改。
    // 老数据没有这个字段 → 空字符串，等于「不知道谁加的」。
    // 那就让谁都能改：菜谱是家里的东西，为一条查不到出处的菜把主人锁在外面，
    // 代价（可能被人乱改）大于收益（防止改一条几乎不可能发生的事）。
    authorId: safeText(input.authorId ?? base.authorId, 40),
    authorUserId: safeText(input.authorUserId ?? base.authorUserId, 80),
    authorName: safeText(input.authorName ?? base.authorName, 20),
    copySourceDishId: safeText(keepInputId ? input.copySourceDishId : base.copySourceDishId, 40),
    // 菜品供应状态独立于点餐状态：暂停时仍可查看，但不能新建点餐。
    dishStatus: ['active', 'paused'].includes(input.dishStatus)
      ? input.dishStatus
      : ['active', 'paused'].includes(base.dishStatus)
      ? base.dishStatus
      : 'active',
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
      .map((s) => {
        const purchaseType = ['staple', 'purchase'].includes(s && s.purchaseType) ? s.purchaseType : '';
        return {
          name: safeText(s && s.name, 30).trim(),
          amount: safeText(s && s.amount, 30).trim(),
          ...(safeText(s && s.ingredientId, 80) ? { ingredientId: safeText(s.ingredientId, 80) } : {}),
          ...(purchaseType ? { purchaseType } : {}),
        };
      })
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
          .map((s) => {
            const purchaseType = ['staple', 'purchase'].includes(s && s.purchaseType) ? s.purchaseType : '';
            return {
              name: safeText(s && s.name, 30).trim(),
              amount: safeText(s && s.amount, 30).trim(),
              ...(safeText(s && s.ingredientId, 80) ? { ingredientId: safeText(s.ingredientId, 80) } : {}),
              ...(purchaseType ? { purchaseType } : {}),
            };
          })
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

/**
 * 会话：token -> { exp, scope }
 *
 * scope 决定这枚 token 能干什么，是三层身份的地基：
 *   { kind: 'super' }        超级管理员：全局口令换的，管所有家庭和系统设置
 *   { kind: 'house', id }    家庭管理员：本家口令换的，只管这一家
 *   { kind: 'anon' }         没解锁的匿名会话，只用日常功能
 *
 * 老版本发出去的 token 在 sessions 里存的是**数字**（就是过期时间），
 * 读的时候照旧当成 super —— 升级不该把所有人踢下线。
 */
const sessions = new Map();

function pruneSessions() {
  const now = Date.now();
  for (const [t, s] of sessions) {
    const exp = typeof s === 'number' ? s : s && s.exp;
    if (!exp || exp <= now) sessions.delete(t);
  }
}

function issueSession(scope) {
  if (sessions.size > 200) pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  const actualScope = scope || { kind: 'anon' };
  const fixedExp = actualScope.kind === 'super'
    ? Number(actualScope.fixedExp) || Date.now() + SUPER_GRANT_TTL_MS
    : 0;
  sessions.set(token, {
    exp: fixedExp || Date.now() + SESSION_TTL,
    ...(fixedExp ? { fixedExp } : {}),
    scope: actualScope,
  });
  return token;
}

function sessionOf(req) {
  const token = req.headers['x-auth-token'];
  if (!token || typeof token !== 'string') return null;
  const s = sessions.get(token);
  if (!s) return null;
  const exp = typeof s === 'number' ? s : s && (s.fixedExp || s.exp);
  if (!exp || Date.now() > exp) {
    sessions.delete(token);
    return null;
  }
  const scope = (typeof s === 'object' && s.scope) || { kind: 'super' };
  if (scope.kind === 'super') {
    const account = accountSessionOf(req);
    if (!account || scope.userId !== account.scope.userId || scope.accountToken !== account.token) {
      sessions.delete(token);
      return null;
    }
    // 超级授权是固定 12 小时，不滑动续期；并且绑定签发时的设备标识。
    if (scope.deviceId && scope.deviceId !== account.scope.deviceId) {
      sessions.delete(token);
      return null;
    }
    return { token, scope };
  }
  sessions.set(token, { exp: Date.now() + SESSION_TTL, scope }); // 家庭会话滑动续期
  return { token, scope };
}

/**
 * 这个请求「是谁」。
 *
 * 三条线索，谁强用谁：
 *   1. 超级管理员会话（全局口令换的）—— 什么都能干
 *   2. 设备令牌（成员 PIN 换的，30 天）—— 知道自己是哪个成员，能改自己写的
 *   3. 什么都没带 —— 匿名，只能用日常功能
 * 家庭口令换来的会话只提升到「家庭管理员」，不改变「我是谁」。
 */
function whoami(req, householdId) {
  if (isSuperAdmin(req)) return { kind: 'super', memberId: '', name: '' };
  const account = accountSessionOf(req);
  if (account) {
    const m = currentMember(req, householdId || state.settings.currentHouseholdId);
    if (m) return { kind: 'member', memberId: m.id, name: memberDisplayName(m), householdId: householdId || m.householdId || '' , userId: account.scope.userId };
    const first = membershipsOf(account.scope.userId)[0];
    const firstMember = first && memberForUser(first.id, account.scope.userId);
    return firstMember
      ? { kind: 'member', memberId: firstMember.id, name: memberDisplayName(firstMember), householdId: first.id, userId: account.scope.userId }
      : { kind: 'account', memberId: '', name: userById(account.scope.userId)?.displayName || '', userId: account.scope.userId };
  }
  const d = deviceMember(req);
  if (!d) return { kind: 'anon', memberId: '', name: '' };
  // 令牌可能已经被撤销（成员被删了、PIN 被重置）——认不得就当匿名
  for (const h of state.households) {
    const m = (h.members || []).find((x) => x.id === d.memberId);
    if (m) return { kind: 'member', memberId: m.id, name: memberDisplayName(m), householdId: h.id, userId: m.userId || '' };
  }
  return { kind: 'anon', memberId: '', name: '' };
}

/**
 * 超级管理员。没设全局口令时一律算 —— 保持「装了就能用」，
 * 设了口令才启用分工。
 */
function isSuperAdmin(req) {
  // 未设置全局口令时保持开放初始化模式：账户和旧设备都可以进入管理区，
  // 直到有人设置全局口令。设置后才需要当前账户持有 12 小时超级授权。
  if (!state.settings.adminPin) return true;
  const s = sessionOf(req);
  return !!s && s.scope.kind === 'super';
}

/** 家庭口令换来的会话。跟超管会话分开存，所以要单独读 X-House-Token */
function houseSessionOf(req) {
  const token = req.headers['x-house-token'];
  if (!token || typeof token !== 'string') return null;
  const s = sessions.get(token);
  if (!s) return null;
  const exp = typeof s === 'number' ? s : s && s.exp;
  if (!exp || Date.now() > exp) {
    sessions.delete(token);
    return null;
  }
  const scope = (typeof s === 'object' && s.scope) || { kind: 'super' };
  if (scope.kind !== 'house') return null;
  sessions.set(token, { exp: Date.now() + SESSION_TTL, scope }); // 滑动续期
  return { token, scope };
}

/* ------------------------------------------------------------------
 * 「刚验过密码」凭证 —— 只活 5 分钟，只对危险动作有效
 *
 * 为什么要有它：改成员、重置密码、改家庭口令、删家庭 —— 这几件事
 * 能改谁的身份，就等于能冒充谁。手上那把 30 天的设备令牌证明的是
 * 「这台设备以前是你」，不是「此刻可以替这个家做主」。
 * 所以危险动作必须配一张新鲜的、刚刚用密码换来的凭证。
 * ------------------------------------------------------------------ */

const VERIFIED_TTL = 5 * 60 * 1000; // 5 分钟

function issueVerified(householdId, memberId) {
  const token = crypto.randomBytes(18).toString('hex');
  sessions.set(token, {
    exp: Date.now() + VERIFIED_TTL,
    scope: { kind: 'verified', id: householdId, memberId },
  });
  return token;
}

function verifiedSessionOf(req) {
  const token = req.headers['x-verified-token'];
  if (!token || typeof token !== 'string') return null;
  const s = sessions.get(token);
  if (!s) return null;
  const exp = typeof s === 'number' ? s : s && s.exp;
  if (!exp || Date.now() > exp) {
    sessions.delete(token); // 过期的顺手清掉，别攒一堆死凭证
    return null;
  }
  const scope = (typeof s === 'object' && s.scope) || {};
  if (scope.kind !== 'verified') return null;
  return { token, scope }; // 刻意**不**续期 —— 5 分钟就是 5 分钟
}

const SENSITIVE_HINT =
  '这是危险操作，需要重新确认身份：用超级管理员口令登录，或输一次这个家的口令 / 你的成员密码。';

/**
 * 危险动作放行。
 *
 * 按「这个家里到底有没有秘密」分三种情况：
 *   1. 超管会话 —— 全局的，什么都能干
 *   2. 这家的口令会话 —— 刚输过这个家的口令
 *   3. 5 分钟内刚用成员密码验过
 *   4. 这一家谁都没设密码 —— 那本来就没有秘密可保护，按老规矩开着
 *      （等谁设了密码，这条路自动关上，不用谁记得来开）
 *
 * 光有设备令牌（30 天那把）永远过不了这一关。
 */
function canDoSensitive(req, householdId) {
  if (isSuperAdmin(req)) return true;
  const house = state.households.find((h) => h.id === householdId);
  if (!house) return false;
  const uidForRequest = accountUserId(req);
  const me = deviceMember(req);
  if (!me && !uidForRequest) return false;
  const member = uidForRequest
    ? (house.members || []).find((x) => x.userId === uidForRequest)
    : (house.members || []).find((x) => x.id === me.memberId);
  // 家庭口令和普通成员密码都不能提升家庭权限；只有 owner 关系可以执行
  // 成员、申请、家庭删除等敏感操作。旧 verified token 只作为兼容凭证，
  // 也必须绑定到 owner，不能让普通成员靠自己的密码越权。
  if (member && member.role === 'owner') return true;
  const vs = verifiedSessionOf(req);
  if (vs && vs.scope.id === householdId) {
    const verifiedMember = (house.members || []).find((m) => m.id === vs.scope.memberId);
    return !!(verifiedMember && verifiedMember.role === 'owner');
  }
  return false;
}

/**
 * 家庭管理员：这个家的 owner，或者超级管理员。
 *
 * 没设本家口令时，本家 owner 名单上的人天然就是管理员 —— 装了就能用的老传统。
 * 设了本家口令之后，光「在 owner 名单上」不够，还得输过那家的口令。
 */
function isHouseAdmin(req, householdId) {
  if (isSuperAdmin(req)) return true;
  const house = state.households.find((h) => h.id === householdId);
  if (!house) return false;
  const uidForRequest = accountUserId(req);
  if (uidForRequest) {
    const relation = memberForUser(householdId, uidForRequest);
    return !!(relation && relation.role === 'owner');
  }
  const me = deviceMember(req);
  const isOwner = me
    ? (house.members || []).some((m) => m.id === me.memberId && m.role === 'owner')
    : false;
  return isOwner;
}

/**
 * 这条能不能改这个对象 —— 三层权限里最常问的一句。
 *
 * 共享菜和私房菜都按作者授权；超级管理员可以处理历史数据。
 * 家庭管理员仍负责成员、家庭设置和做饭状态，不自动获得别人菜谱编辑权。
 */
function canWrite(req, obj) {
  if (!obj) return false;
  if (!obj.householdId) return canWriteShared(req, obj);
  // 旧安装在没有全局口令时可能存在没有作者字段的历史菜，
  // 允许本地开放模式继续维护；新账户/成员创建的菜都会写入作者 ID。
  if (!state.settings.adminPin && !obj.authorId && !obj.authorUserId) return true;
  const explicitSuper = sessionOf(req);
  if (explicitSuper && explicitSuper.scope && explicitSuper.scope.kind === 'super') return true;
  const uidForRequest = accountUserId(req);
  if (obj.authorUserId && uidForRequest) return obj.authorUserId === uidForRequest;
  const me = deviceMember(req);
  if (obj.authorId && me) return obj.authorId === me.memberId;
  return false;
}

/** 菜谱或分类的可见性：不再按「私房」锁死，一律可见，只分能不能改 */
function isMyMember(req, householdId) {
  const uidForRequest = accountUserId(req);
  if (uidForRequest) return !!memberForUser(householdId, uidForRequest);
  const me = deviceMember(req);
  if (!me) return false;
  const h = state.households.find((x) => x.id === householdId);
  return !!(h && (h.members || []).some((m) => m.id === me.memberId));
}

/**
 * 拒绝时的说法。笼统一句「没权限」只会让人以为是程序坏了 ——
 * 说清楚是哪一条、归谁、谁能改。
 */
function writeDenied(obj) {
  if (!obj.householdId) return '这道共享菜谱由作者维护。想改成自己的做法，请先「收进我家」复制一份。';
  const who = obj.authorName || '别人';
  return `这道菜是「${who}」加的，只有作者或超级管理员可以修改。\n想改成自己的做法，请先复制到我家。`;
}

/** 新增共享菜需要家庭管理员；已有共享菜只能由作者或超级管理员维护。 */
function canWriteShared(req, obj) {
  if (!obj && isSuperAdmin(req)) return true;
  if (obj) {
    // 未初始化全局口令时保持旧版开放安装体验；一旦设置口令，
    // 已有共享菜只允许作者或明确的超级授权修改。
    if (!state.settings.adminPin) return true;
    const explicitSuper = sessionOf(req);
    if (explicitSuper && explicitSuper.scope && explicitSuper.scope.kind === 'super') return true;
    const uidForRequest = accountUserId(req);
    if (obj.authorUserId && uidForRequest) return obj.authorUserId === uidForRequest;
    const me = deviceMember(req);
    return !!(obj.authorId && me && obj.authorId === me.memberId);
  }
  const uidForRequest = accountUserId(req);
  const me = deviceMember(req);
  if (!me && !uidForRequest) return false;
  for (const h of state.households) {
    if ((h.members || []).some((m) => (uidForRequest ? m.userId === uidForRequest : m.id === me.memberId) && m.role === 'owner')) return true;
  }
  return false;
}

/**
 * 是不是**至少一个**家庭的管理员（或者超管）。
 *
 * 这是统一守卫的粗筛：只回答「有没有资格碰管理区」，
 * 具体能不能动某一条菜、某一家，交给各 handler 里的 canWrite。
 */
function isAnyHouseAdmin(req) {
  if (isSuperAdmin(req)) return true;
  const uidForRequest = accountUserId(req);
  const me = deviceMember(req);
  if (!me && !uidForRequest) return false;
  // 设备令牌与账户令牌都以成员关系为准；旧数据可能没有 userId，
  // 因此设备路径必须按 memberId 比对。
  return state.households.some(
    (h) => (h.members || []).some((m) => (uidForRequest ? m.userId === uidForRequest : m.id === me.memberId) && m.role === 'owner')
  );
}

/** 成员往外发的时候抹掉 password/pin —— 那是凭证，永远不该出现在任何响应里 */
function publicMember(m) {
  if (!m) return null;
  const { pin, password, ...rest } = m;
  const hasPassword = !!(typeof password === 'string' ? password : pin);
  return { ...rest, name: memberDisplayName(m), hasPassword, hasPin: hasPassword };
}

function publicMembers(house) {
  return ((house && house.members) || []).map(publicMember);
}

/** 同样抹掉家庭口令 */
function publicHousehold(h) {
  if (!h) return null;
  const { pin, ...rest } = h;
  return { ...rest, hasPin: !!pin, members: publicMembers(h) };
}

function publicHouseholds() {
  return state.households.map(publicHousehold);
}

/** 没设口令 → 放行；设了 → 必须带有效 token（旧的单层判断，保留给备份/AI 这些全局功能） */
function isAuthed(req) {
  return isSuperAdmin(req);
}

/**
 * 需要管理员级的写操作（粗筛，真正的逐条判定在各 handler 里）。
 * 点餐提交、库存、本周计划、留言**不在列** —— 那是家里人每天都要用的，
 * 口令不该挡着他们正常吃饭。
 */
const ADMIN_WRITES = new Set(['households', 'dishes', 'categories', 'orders', 'join-requests']);

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

  // ---- 全局账户：新设备先登录/注册，账户身份跨家庭复用 ----
  if (route[0] === 'account') {
    if (method === 'POST' && route.length === 2 && route[1] === 'register') {
      const body = await readBody(req);
      const requested = normalizeLoginId(body.loginId, '');
      const loginId = requested || generatedLoginId();
      if (userByLoginId(loginId)) return sendError(res, 409, '这个登录 ID 已经被使用，请换一个');
      const password = body.password === undefined || body.password === '' ? DEFAULT_ACCOUNT_PASSWORD : String(body.password);
      if (password.length < 4 || password.length > 64) return sendError(res, 400, '密码要 4 到 64 个字符');
      const user = normalizeUser({
        id: uid('u_'),
        loginId,
        displayName: safeText(body.displayName, 40).trim() || loginId,
        emoji: safeText(body.emoji, 4) || '🙋',
        passwordHash: hashUserPassword(password),
        legacyDefaultPassword: password === DEFAULT_ACCOUNT_PASSWORD,
      });
      state.users.push(user);
      scheduleSave('users');
      const issued = issueAccountToken(user.id, req);
      return sendJSON(res, 200, {
        ok: true,
        data: { accountToken: issued.token, deviceId: issued.deviceId, user: publicUser(user), households: accountHouseholds(user.id) },
      });
    }

    if (method === 'POST' && route.length === 2 && route[1] === 'login') {
      const body = await readBody(req);
      const loginId = normalizeLoginId(body.loginId, '');
      const user = userByLoginId(loginId);
      const password = body.password === undefined || body.password === '' ? DEFAULT_ACCOUNT_PASSWORD : String(body.password);
      if (!user || !verifyUserPassword(password, user.passwordHash)) return sendError(res, 401, '登录 ID 或密码不对');
      const issued = issueAccountToken(user.id, req);
      return sendJSON(res, 200, {
        ok: true,
        data: { accountToken: issued.token, deviceId: issued.deviceId, user: publicUser(user), households: accountHouseholds(user.id) },
      });
    }

    if (method === 'GET' && route.length === 2 && route[1] === 'me') {
      const account = accountSessionOf(req);
      if (!account) return sendError(res, 401, '账户登录已过期，请重新登录');
      const user = userById(account.scope.userId);
      return sendJSON(res, 200, {
        ok: true,
        data: { accountToken: account.token, deviceId: account.scope.deviceId, user: publicUser(user), households: accountHouseholds(user.id) },
      });
    }

    if (method === 'PUT' && route.length === 2 && route[1] === 'profile') {
      const account = accountSessionOf(req);
      if (!account) return sendError(res, 401, '账户登录已过期，请重新登录');
      const body = await readBody(req);
      const user = userById(account.scope.userId);
      if (!user) return sendError(res, 401, '账户不存在，请重新登录');
      const nextLoginId = body.loginId === undefined
        ? user.loginId
        : normalizeLoginId(body.loginId, '');
      if (!nextLoginId) return sendError(res, 400, '登录 ID 不能为空');
      const duplicate = userByLoginId(nextLoginId);
      if (duplicate && duplicate.id !== user.id) return sendError(res, 409, '这个登录 ID 已经被使用，请换一个');
      const nextDisplayName = body.displayName === undefined
        ? user.displayName
        : safeText(body.displayName, 40).trim();
      if (!nextDisplayName) return sendError(res, 400, '账户姓名不能为空');
      user.loginId = nextLoginId;
      user.displayName = nextDisplayName;
      if (body.emoji !== undefined) user.emoji = safeText(body.emoji, 4) || user.emoji || '🙋';
      user.updatedAt = nowISO();
      if (syncMemberDisplayName(user.id, user.displayName)) scheduleSave('households');
      scheduleSave('users');
      return sendJSON(res, 200, {
        ok: true,
        data: { accountToken: account.token, deviceId: account.scope.deviceId, user: publicUser(user), households: accountHouseholds(user.id) },
      });
    }

    if (method === 'POST' && route.length === 2 && route[1] === 'logout') {
      const account = accountSessionOf(req);
      if (account) {
        accountSessions.delete(account.token);
        for (const [token, s] of sessions) {
          if (s && s.scope && s.scope.kind === 'super' && s.scope.accountToken === account.token) sessions.delete(token);
        }
      }
      return sendJSON(res, 200, { ok: true, data: { loggedOut: true } });
    }

    if (method === 'PUT' && route.length === 2 && route[1] === 'password') {
      const account = accountSessionOf(req);
      if (!account) return sendError(res, 401, '账户登录已过期，请重新登录');
      const body = await readBody(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 4 || password.length > 64) return sendError(res, 400, '密码要 4 到 64 个字符');
      const user = userById(account.scope.userId);
      user.passwordHash = hashUserPassword(password);
      user.legacyDefaultPassword = password === DEFAULT_ACCOUNT_PASSWORD;
      user.updatedAt = nowISO();
      revokeAccountSessions(user.id);
      const issued = issueAccountToken(user.id, req);
      scheduleSave('users');
      return sendJSON(res, 200, { ok: true, data: { accountToken: issued.token, deviceId: issued.deviceId, user: publicUser(user), households: accountHouseholds(user.id) } });
    }
    return sendError(res, 404, '账户接口不存在');
  }

  // ---- 登录换会话 token ----
  if (method === 'POST' && route.length === 1 && route[0] === 'auth') {
    const body = await readBody(req);
    const pin = state.settings.adminPin || '';
    const given = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!pin) return sendJSON(res, 200, { ok: true, data: { token: '', hasPin: false } });
    if (given !== pin) return sendError(res, 401, '口令不对');
    const account = accountSessionOf(req);
    if (!account) return sendError(res, 401, '输入全局管理口令前，请先登录账户');
    const fixedExp = Date.now() + SUPER_GRANT_TTL_MS;
    const token = issueSession({
      kind: 'super',
      userId: account.scope.userId,
      accountToken: account.token,
      deviceId: account.scope.deviceId,
      issuedAt: Date.now(),
      fixedExp,
    });
    return sendJSON(res, 200, { ok: true, data: { token, hasPin: true, expiresAt: fixedExp, fixedExp } });
  }

  /* ---- 身份认领 ----
   *
   * 这一组在统一守卫**之前**处理：它们是「怎么证明自己是谁」的地方，
   * 没法要求先证明身份。「成员第一次认领时自己设密码」是整套三层身份的地基，
   * 放在这儿才说得通。
   */
  if (route[0] === 'claim' && method === 'POST') {
    const body = await readBody(req);
    const houseId = safeText(body.householdId, 40);
    const memberId = safeText(body.memberId, 40);
    const requestedLoginId = normalizeLoginId(body.loginId, '');
    const givenPassword = passwordValue(body.password !== undefined ? body.password : body.pin);
    const house = state.households.find((h) => h.id === houseId);
    if (!house) return sendError(res, 404, '这个家庭不存在');
    const idx = memberId
      ? (house.members || []).findIndex((m) => m.id === memberId)
      : requestedLoginId
      ? (house.members || []).findIndex((m) => m.loginId === requestedLoginId)
      : -1;
    if (idx < 0) return sendError(res, 404, '这个家里没有这个成员');
    const m = house.members[idx];
    const currentPassword = memberPassword(m);

    // 已经有密码了 → 校验
    if (currentPassword) {
      if (givenPassword !== currentPassword) return sendError(res, 401, `「${m.name}」的密码不对`);
      return sendJSON(res, 200, {
        ok: true,
        data: {
          deviceToken: issueDeviceToken(m.id, house.id),
          member: publicMember(m),
          remember: body.remember !== false,
        },
      });
    }

    // 还没设过 → 第一次设。
    //
    // 这里分不出「本人」和「冒充的人」—— 第一次来设密码的和跑来顶替他密码的，
    // 在服务端看来是同一个请求。硬要分，就得要求管理员在场，那新成员
    // 第一次打开应用就得先找到管理员，反而更麻烦。
    //
    // 所以这里选择信任：成员名单本身就是管理员写下的，这一步等于
    // 「管理员认可你在这个家里」。真正的门槛在**加成员**那一步 ——
    // 那是管理员的活。想更严的场合，把 PIN 留给管理员当面交付。
    if (!validMemberPassword(givenPassword)) return sendError(res, 400, '密码设成 4~64 个字符');
    if (requestedLoginId) {
      const duplicate = (house.members || []).some((x, i) => i !== idx && x.loginId === requestedLoginId);
      if (duplicate) return sendError(res, 409, '这个登录 ID 已经在本家使用');
      house.members[idx].loginId = requestedLoginId;
    }
    house.members[idx].password = givenPassword;
    house.updatedAt = nowISO();
    scheduleSave('households');
    // 改了密码就把这台设备上旧的令牌全作废，免得「知道旧密码的人」还在用
    revokeDeviceTokens(m.id);
    return sendJSON(res, 200, {
      ok: true,
      data: {
        deviceToken: issueDeviceToken(m.id, house.id),
        member: publicMember(house.members[idx]),
        firstTime: true,
      },
    });
  }

  // 核对 PIN：危险动作（改成员、改家庭口令、删家庭）令牌不够，要重新输一次
  if (route[0] === 'verify-pin' && method === 'POST') {
    const body = await readBody(req);
    const house = state.households.find((h) => h.id === safeText(body.householdId, 40));
    const memberId = safeText(body.memberId, 40);
    const loginId = normalizeLoginId(body.loginId, '');
    const m = house && (house.members || []).find((x) => (memberId && x.id === memberId) || (!memberId && loginId && x.loginId === loginId));
    const currentPassword = memberPassword(m);
    if (!m || !currentPassword) return sendError(res, 400, '这个成员还没设密码');
    const given = passwordValue(body.password !== undefined ? body.password : body.pin);
    if (given !== currentPassword) return sendError(res, 401, '密码不对');
    // 顺手发一张 5 分钟的「刚验过」凭证：下一步那个危险动作凭它放行。
    // 不发给前端就没法把「验密码」和「执行」拆成两次请求，而拆开是有必要的 ——
    // 输错密码时该停的是密码这一步，不是让操作带着半截状态往下走。
    return sendJSON(res, 200, {
      ok: true,
      data: { ok: true, name: m.name, verifiedToken: issueVerified(house.id, m.id) },
    });
  }

  // 管理员给成员设 / 重置 / 清掉登录 ID 和密码。
  // 成员自己只能通过 /api/claim 设自己那个（那是身份认领的一部分），
  // 这里是管理员替人做 —— 所以要 canDoSensitive 那道额外的门槛。
  // member-pin 是旧客户端兼容别名，新的界面使用 member-password。
  if (
    method === 'PUT' &&
    route.length === 3 &&
    route[0] === 'households' &&
    (route[2] === 'member-pin' || route[2] === 'member-password')
  ) {
    const house = state.households.find((h) => h.id === route[1]);
    if (!house) return sendError(res, 404, '这个家庭不存在');
    if (!canDoSensitive(req, house.id)) return sendError(res, 403, SENSITIVE_HINT);
    const body = await readBody(req);
    const mi = (house.members || []).findIndex((x) => x.id === safeText(body.memberId, 40));
    if (mi < 0) return sendError(res, 404, '这个家里没有这个成员');
    const target = house.members[mi];
    let nextLoginId = target.loginId;
    if (typeof body.loginId === 'string') {
      const loginId = normalizeLoginId(body.loginId, '');
      if (!loginId) return sendError(res, 400, '登录 ID 不能为空');
      const duplicate = (house.members || []).some((x, i) => i !== mi && x.loginId === loginId);
      if (duplicate) return sendError(res, 409, '这个登录 ID 已经在本家使用');
      nextLoginId = loginId;
    }
    let nextPassword = target.password;
    let shouldRevokeTokens = false;
    if (body.clear === true || body.clearPassword === true) {
      nextPassword = '';
      shouldRevokeTokens = true; // 密码没了，那把 30 天的钥匙也得一起收
    } else {
      const password = passwordValue(body.password !== undefined ? body.password : body.pin);
      if (!validMemberPassword(password)) return sendError(res, 400, '密码设成 4~64 个字符');
      nextPassword = password;
      shouldRevokeTokens = true;
    }
    target.loginId = nextLoginId;
    target.password = nextPassword;
    if (shouldRevokeTokens) revokeDeviceTokens(target.id);
    house.updatedAt = nowISO();
    scheduleSave('households');
    return sendJSON(res, 200, { ok: true, data: publicMember(target) });
  }

  // 家庭口令换会话：知道这个家的口令 = 这个家的管理员
  if (method === 'POST' && route.length === 3 && route[0] === 'households' && route[2] === 'auth') {
    const house = state.households.find((h) => h.id === route[1]);
    if (!house) return sendError(res, 404, '这个家庭不存在');
    const body = await readBody(req);
    if (!house.pin) {
      return sendJSON(res, 200, { ok: true, data: { token: issueSession({ kind: 'house', id: house.id }), hasPin: false } });
    }
    const given = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (given !== house.pin) return sendError(res, 401, '这个家的口令不对');
    return sendJSON(res, 200, { ok: true, data: { token: issueSession({ kind: 'house', id: house.id }), hasPin: true } });
  }

  // 账户退出家庭：只删除当前账户在该家庭的成员关系，不删除全局账户或家庭数据。
  // 家庭最后一名 owner 不能直接退出；如果他也是最后一名成员，应走「解散家庭」。
  if (method === 'DELETE' && route.length === 4 && route[0] === 'households' && route[2] === 'members' && route[3] === 'me') {
    const account = accountSessionOf(req);
    if (!account) return sendError(res, 401, '退出家庭需要先登录账户');
    const householdId = route[1];
    const house = state.households.find((h) => h.id === householdId);
    if (!house) return sendError(res, 404, '这个家庭不存在');
    const idx = (house.members || []).findIndex((m) => m && m.userId === account.scope.userId);
    if (idx < 0) return sendError(res, 404, '你还不是这个家庭的成员');
    const member = house.members[idx];
    const memberCount = (house.members || []).filter(Boolean).length;
    if (memberCount <= 1) {
      return sendError(res, 409, '你是这个家庭最后一名成员，请使用「解散家庭」');
    }
    if (member.role === 'owner' && house.members.filter((m) => m && m.role === 'owner').length <= 1) {
      return sendError(res, 409, '你是最后一名家庭管理员，请先指定另一名管理员再退出');
    }
    house.members.splice(idx, 1);
    house.updatedAt = nowISO();
    state.access.requests = state.access.requests.filter(
      (r) => !(r.householdId === householdId && r.applicantUserId === account.scope.userId && r.status === 'pending')
    );
    scheduleSave('households');
    scheduleSave('access');
    return sendJSON(res, 200, { ok: true, data: { householdId, userId: account.scope.userId } });
  }

  // ---- 统一守卫 ----
  // 两级：全局功能（设置/备份/AI/导入导出）只认超级管理员；
  // 菜单和家庭相关的写操作，管理员级即可 —— 到底能不能碰这一条，
  // 由各 handler 里的 canWrite 按对象逐个判。
  // 点餐、库存、本周计划不在保护范围内 —— 那是家里人每天都要用的。
  const SUPER_ONLY = new Set(['settings', 'import', 'upload']);
  const needsSuper =
    route[0] === 'export' ||
    route[0] === 'backups' ||
    route[0] === 'ai' ||
    (method !== 'GET' && method !== 'HEAD' && SUPER_ONLY.has(route[0]));
  if (needsSuper && !isSuperAdmin(req)) {
    return sendError(res, 401, '需要管理口令，请先在「管理」页解锁');
  }
  const needsAdmin =
    (route[0] === 'households' && !(method === 'POST' && !route[1] && accountUserId(req)) && !(method === 'DELETE' && route[2] === 'members' && route[3] === 'me')) ||
    route[0] === 'dishes' ||
    route[0] === 'categories' ||
    // 点餐提交谁都能做（人总得能点菜），但改状态、删除是管理员的活
    (route[0] === 'orders' && method !== 'GET' && !(method === 'POST' && !route[1])) ||
    (route[0] === 'join-requests' && method !== 'GET' && !!route[1]);
  if (needsAdmin && !isAnyHouseAdmin(req)) {
    return sendError(res, 401, '这个操作要管理员，先解锁或让家里管理员输一次口令');
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
      'ingredient-classify': {
        system:
          '你是家庭食材分类助手。用户会给你若干食材名称及现有分类线索。' +
          '请只输出 JSON，不要 markdown 或解释。格式：' +
          '{"items":[{"inputName":"原名称","name":"标准名称","category":"分类",' +
          '"trackingMode":"presence|quantity","confidence":0.0,"reason":"简短理由"}]}。' +
          `category 只能从 ${PANTRY_CATEGORIES.map((c) => c.name).join('、')} 中选择。` +
          'presence 仅用于明确的常备调料，表示只需要记录家里有或没有；普通食材使用 quantity。' +
          '葱、姜、蒜展示分类统一建议为调味干货。' +
          '不要推断库存数量、单位、采购数量或计划状态。逐项对应输入，不要新增材料。',
        wantJSON: true,
      },
      'plan-analysis': {
        system:
          '你是家庭备菜计划解释助手。输入中已经包含程序计算的需求、库存和缺口。' +
          '只解释结果、指出需要人工确认的分类或单位，不要重新计算数量，不要修改库存或采购状态。' +
          '需要标准化或分类的原料放入 proposals，仅提出建议，不能输出数量、库存值、采购状态或完成状态。' +
          'proposals 每项必须对应输入中的材料，优先复用输入提供的 ingredientId 和 categoryId；' +
          '分类 ID 只能从输入给定的家庭分类树选择，不要自行编造 ID。' +
          '请只输出 JSON：{"summary":"简短总结","flags":[{"name":"材料名",' +
          '"reason":"需要注意的原因","suggestion":"可执行的人工建议"}],"proposals":' +
          '[{"inputName":"原录入名","ingredientId":"已有原料 ID 或空字符串","name":"标准名",' +
          '"aliases":["明确同义名"],"categoryId":"输入中有效的分类 ID","trackingMode":"presence|quantity",' +
          '"confidence":0.0,"reason":"建议理由"}]}。没有需要建议的原料时 proposals 返回空数组。',
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
    let result = t.wantJSON ? r.json : r.text;
    if (task === 'ingredient-classify') {
      const allowedCategories = new Set(PANTRY_CATEGORIES.map((c) => c.name));
      const source = r.json && Array.isArray(r.json.items) ? r.json.items : [];
      const items = source.slice(0, 100).filter((item) =>
        item && typeof item.inputName === 'string' && item.inputName.trim() &&
        typeof item.name === 'string' && item.name.trim() &&
        allowedCategories.has(item.category) &&
        ['presence', 'quantity'].includes(item.trackingMode) &&
        Number.isFinite(Number(item.confidence)) && Number(item.confidence) >= 0 && Number(item.confidence) <= 1
      ).map((item) => ({
        inputName: safeText(item.inputName, 40).trim(),
        name: safeText(item.name, 40).trim(),
        category: item.category,
        trackingMode: item.trackingMode,
        confidence: Number(item.confidence),
        reason: safeText(item.reason, 120).trim(),
      }));
      if (!items.length) {
        return sendJSON(res, 200, { ok: true, data: { ok: false, error: 'AI 没有返回可确认的食材分类' } });
      }
      result = { items };
    } else if (task === 'plan-analysis') {
      const summary = r.json && typeof r.json.summary === 'string' ? safeText(r.json.summary, 500).trim() : '';
      const flags = r.json && Array.isArray(r.json.flags) ? r.json.flags : null;
      const proposals = r.json && Array.isArray(r.json.proposals) ? r.json.proposals : null;
      if (!summary || !flags || !proposals) {
        return sendJSON(res, 200, { ok: true, data: { ok: false, error: 'AI 计划分析结果结构不完整' } });
      }
      result = {
        summary,
        flags: flags.slice(0, 30).filter((flag) => flag && typeof flag.name === 'string' && typeof flag.reason === 'string' && typeof flag.suggestion === 'string')
          .map((flag) => ({
            name: safeText(flag.name, 60).trim(),
            reason: safeText(flag.reason, 240).trim(),
            suggestion: safeText(flag.suggestion, 240).trim(),
          })),
        proposals: proposals.slice(0, 50).filter((proposal) =>
          proposal && typeof proposal.inputName === 'string' && typeof proposal.name === 'string' &&
          ['presence', 'quantity'].includes(proposal.trackingMode) &&
          Number.isFinite(Number(proposal.confidence)) && Number(proposal.confidence) >= 0 && Number(proposal.confidence) <= 1 &&
          typeof proposal.categoryId === 'string')
          .map((proposal) => ({
            inputName: safeText(proposal.inputName, 80).trim(),
            ingredientId: safeText(proposal.ingredientId, 80).trim(),
            name: safeText(proposal.name, 80).trim(),
            aliases: Array.isArray(proposal.aliases)
              ? [...new Set(proposal.aliases.map((alias) => safeText(alias, 80).trim()).filter(Boolean))].slice(0, 20)
              : [],
            categoryId: safeText(proposal.categoryId, 80).trim(),
            trackingMode: proposal.trackingMode,
            confidence: Number(proposal.confidence),
            reason: safeText(proposal.reason, 240).trim(),
          }))
          .filter((proposal) => proposal.inputName && proposal.name && proposal.categoryId),
      };
    }
    return sendJSON(res, 200, {
      ok: true,
      data: { ok: true, result, usage: r.usage, model: r.model },
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

  // Household-owned pantry dictionary. Built-in roots are generated in memory;
  // only custom child nodes and ingredients are written to their JSON files.
  if (route[0] === 'pantry-categories') {
    const id = route[1];
    const queryHouseholdId = safeText(url.searchParams.get('householdId'), 40);
    if (method === 'GET' && !id) {
      if (!queryHouseholdId) return sendError(res, 400, '缺少家庭 ID');
      if (!state.households.some((household) => household.id === queryHouseholdId)) return sendError(res, 404, '家庭不存在');
      if (!requirePantryDictionaryAccess(req, res, queryHouseholdId)) return;
      return sendJSON(res, 200, {
        ok: true,
        data: pantryRootCategories().concat(state.pantryCategories.filter((category) => category.householdId === queryHouseholdId)),
      });
    }
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const householdId = queryHouseholdId || safeText(body.householdId, 40);
      if (!householdId) return sendError(res, 400, '缺少家庭 ID');
      if (body.householdId && body.householdId !== householdId) return sendError(res, 400, '家庭 ID 不一致');
      if (!state.households.some((household) => household.id === householdId)) return sendError(res, 404, '家庭不存在');
      if (!requirePantryDictionaryAccess(req, res, householdId)) return;
      if (!isHouseAdmin(req, householdId)) return sendError(res, 403, '只有家庭管理员能维护分类');
      const category = normPantryCategory({ ...body, householdId });
      const parentId = category && category.parentId;
      if (!category || !parentId || !pantryCategoryExists(householdId, parentId)) return sendError(res, 400, '请选择本家庭有效的父分类');
      if (pantryCategoryNameExists(householdId, category.name)) {
        return sendError(res, 409, '这个家庭已经有同名分类');
      }
      state.pantryCategories.push(category);
      scheduleSave('pantryCategories');
      return sendJSON(res, 200, { ok: true, data: category });
    }
    if ((method === 'PUT' || method === 'DELETE') && id) {
      const index = state.pantryCategories.findIndex((category) => category.id === id);
      if (index < 0) return sendError(res, 404, '自定义分类不存在');
      const existing = state.pantryCategories[index];
      if (queryHouseholdId && queryHouseholdId !== existing.householdId) return sendError(res, 403, '不能操作其他家庭的分类');
      if (!requirePantryDictionaryAccess(req, res, existing.householdId)) return;
      if (!isHouseAdmin(req, existing.householdId)) return sendError(res, 403, '只有家庭管理员能维护分类');
      if (method === 'PUT') {
        const body = await readBody(req);
        if (body.householdId && body.householdId !== existing.householdId) return sendError(res, 400, '不能更改分类所属家庭');
        const category = normPantryCategory({ ...existing, ...body, householdId: existing.householdId }, existing);
        if (!category || !category.parentId || !pantryCategoryExists(existing.householdId, category.parentId)) return sendError(res, 400, '请选择本家庭有效的父分类');
        if (pantryCategoryWouldCycle(existing.householdId, id, category.parentId)) {
          return sendError(res, 400, '分类不能设置为自己的子分类');
        }
        if (pantryCategoryNameExists(existing.householdId, category.name, id)) {
          return sendError(res, 409, '这个家庭已经有同名分类');
        }
        state.pantryCategories[index] = category;
        scheduleSave('pantryCategories');
        return sendJSON(res, 200, { ok: true, data: category });
      }
      if (state.pantryCategories.some((category) => category.parentId === id && category.householdId === existing.householdId)) {
        return sendError(res, 409, '请先删除或移动这个分类下的子分类');
      }
      if (state.ingredients.some((ingredient) => ingredient.householdId === existing.householdId && ingredient.categoryId === id)) {
        return sendError(res, 409, '这个分类仍被原料使用，请先迁移原料');
      }
      state.pantryCategories.splice(index, 1);
      scheduleSave('pantryCategories');
      return sendJSON(res, 200, { ok: true, data: existing });
    }
  }

  if (route[0] === 'ingredients') {
    const id = route[1];
    const queryHouseholdId = safeText(url.searchParams.get('householdId'), 40);
    if (method === 'POST' && id === 'apply-proposals') {
      const body = await readBody(req);
      const householdId = safeText(body.householdId, 40);
      if (!householdId) return sendError(res, 400, '缺少家庭 ID');
      if (!state.households.some((household) => household.id === householdId)) return sendError(res, 404, '家庭不存在');
      if (!requirePantryDictionaryAccess(req, res, householdId)) return;
      if (!Array.isArray(body.proposals) || body.proposals.length < 1 || body.proposals.length > 50) {
        return sendError(res, 400, '请选择 1 到 50 条原料建议');
      }

      const prepared = [];
      const plannedByName = new Map();
      for (const raw of body.proposals) {
        const inputName = safeText(raw && raw.inputName, 80).trim();
        const name = safeText(raw && raw.name, 80).trim();
        const trackingMode = safeText(raw && raw.trackingMode, 20);
        const aliases = Array.isArray(raw && raw.aliases)
          ? [...new Set(raw.aliases.map((alias) => safeText(alias, 80).trim()).filter(Boolean))].slice(0, 20)
          : [];
        const categoryId = safeText(raw && raw.categoryId, 80);
        if (!inputName || !name) return sendError(res, 400, '原料建议缺少输入名或标准名');
        if (!['presence', 'quantity'].includes(trackingMode)) return sendError(res, 400, '原料建议的库存方式无效');
        if (!categoryId || !pantryCategoryExists(householdId, categoryId)) return sendError(res, 400, '原料分类不属于当前家庭');

        const requestedId = safeText(raw && raw.ingredientId, 80);
        let ingredient = requestedId
          ? state.ingredients.find((item) => item.id === requestedId && item.householdId === householdId)
          : null;
        if (requestedId && !ingredient) return sendError(res, 400, '原料 ID 不属于当前家庭');
        ingredient = ingredient || findHouseholdIngredient(householdId, name) ||
          findHouseholdIngredient(householdId, inputName) ||
          aliases.map((alias) => findHouseholdIngredient(householdId, alias)).find(Boolean) || null;

        const nameKey = name.toLocaleLowerCase();
        const pendingSameName = plannedByName.get(nameKey);
        if (pendingSameName && ingredient && pendingSameName.id !== ingredient.id) {
          return sendError(res, 409, `「${name}」对应多个原料，请分开确认`);
        }
        if (!ingredient && pendingSameName) ingredient = pendingSameName;
        if (!ingredient) {
          const collision = state.ingredients.find((item) => item.householdId === householdId && item.name.toLocaleLowerCase() === nameKey);
          if (collision) ingredient = collision;
        }
        const nameCollision = state.ingredients.find((item) => item.householdId === householdId &&
          item.id !== (ingredient && ingredient.id) && item.name.toLocaleLowerCase() === nameKey);
        if (nameCollision) return sendError(res, 409, `标准名「${name}」已属于另一个原料`);

        const nextAliases = [...new Set([
          ...((ingredient && ingredient.aliases) || []),
          inputName,
          ...aliases,
        ].map((alias) => safeText(alias, 80).trim()).filter((alias) => alias && alias.toLocaleLowerCase() !== nameKey))].slice(0, 30);
        const next = ingredient
          ? { ...ingredient, name, aliases: nextAliases, categoryId, defaultTrackingMode: trackingMode, updatedAt: nowISO() }
          : normIngredient({ householdId, name, aliases: nextAliases, categoryId, defaultTrackingMode: trackingMode, defaultUnit: '' });
        if (!next) return sendError(res, 400, '无法保存原料建议');
        plannedByName.set(nameKey, next);
        prepared.push({ inputName, aliases, ingredient: next });
      }

      const changedRows = [];
      const inputKeys = prepared.map((proposal) => new Set([
        proposal.inputName,
        ...proposal.aliases,
      ].map((name) => name.toLocaleLowerCase())));
      const targetByInput = new Map();
      for (let index = 0; index < prepared.length; index++) {
        for (const key of inputKeys[index]) {
          const previous = targetByInput.get(key);
          if (previous && previous !== prepared[index].ingredient.id) {
            return sendError(res, 409, `输入名「${key}」被映射到多个原料，请重新确认`);
          }
          targetByInput.set(key, prepared[index].ingredient.id);
        }
      }
      const matchedProposals = new Set();
      for (const dish of state.dishes) {
        if (!dish || dish.householdId !== householdId) continue;
        const rows = [
          ...(Array.isArray(dish.seasonings) ? dish.seasonings : []),
          ...((Array.isArray(dish.methods) ? dish.methods : []).flatMap((method) => Array.isArray(method && method.seasonings) ? method.seasonings : [])),
        ];
        for (const row of rows) {
          const key = safeText(row && row.name, 80).trim().toLocaleLowerCase();
          const index = prepared.findIndex((proposal, proposalIndex) => inputKeys[proposalIndex].has(key));
          if (index >= 0) {
            matchedProposals.add(index);
            changedRows.push({ row, ingredient: prepared[index].ingredient });
          }
        }
      }
      if (matchedProposals.size !== prepared.length) return sendError(res, 409, '部分建议已过期或没有对应菜谱材料，请重新分析后再应用');
      if (!changedRows.length) return sendError(res, 409, '建议已过期，没有找到仍存在的菜谱原料');

      const nextIngredients = [...state.ingredients];
      const updated = new Map();
      for (const proposal of prepared) updated.set(proposal.ingredient.id, proposal.ingredient);
      for (const [ingredientId, ingredient] of updated) {
        const index = nextIngredients.findIndex((item) => item.id === ingredientId);
        if (index < 0) nextIngredients.push(ingredient);
        else nextIngredients[index] = ingredient;
      }
      state.ingredients = nextIngredients;
      changedRows.forEach(({ row, ingredient }) => { row.ingredientId = ingredient.id; });
      state.pantry.forEach((item) => {
        const ingredient = updated.get(item.ingredientId);
        if (!ingredient || item.householdId !== householdId) return;
        item.name = ingredient.name;
        item.category = pantryCategoryLabel(householdId, ingredient.categoryId) || item.category;
      });
      scheduleSave('ingredients');
      scheduleSave('dishes');
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: { applied: updated.size, linkedRows: changedRows.length } });
    }
    if (method === 'GET' && !id) {
      if (!queryHouseholdId) return sendError(res, 400, '缺少家庭 ID');
      if (!state.households.some((household) => household.id === queryHouseholdId)) return sendError(res, 404, '家庭不存在');
      if (!requirePantryDictionaryAccess(req, res, queryHouseholdId)) return;
      return sendJSON(res, 200, { ok: true, data: state.ingredients.filter((ingredient) => ingredient.householdId === queryHouseholdId) });
    }
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const householdId = queryHouseholdId || safeText(body.householdId, 40);
      if (!householdId) return sendError(res, 400, '缺少家庭 ID');
      if (body.householdId && body.householdId !== householdId) return sendError(res, 400, '家庭 ID 不一致');
      if (!state.households.some((household) => household.id === householdId)) return sendError(res, 404, '家庭不存在');
      if (!requirePantryDictionaryAccess(req, res, householdId)) return;
      const ingredient = normIngredient({ ...body, householdId });
      if (!ingredient || !ingredient.categoryId || !pantryCategoryExists(householdId, ingredient.categoryId)) return sendError(res, 400, '请选择本家庭有效分类');
      if (state.ingredients.some((item) => item.householdId === householdId && item.name.toLocaleLowerCase() === ingredient.name.toLocaleLowerCase())) {
        return sendError(res, 409, '这个家庭已经有同名原料');
      }
      state.ingredients.push(ingredient);
      scheduleSave('ingredients');
      return sendJSON(res, 200, { ok: true, data: ingredient });
    }
    if ((method === 'PUT' || method === 'DELETE') && id) {
      const index = state.ingredients.findIndex((ingredient) => ingredient.id === id);
      if (index < 0) return sendError(res, 404, '原料不存在');
      const existing = state.ingredients[index];
      if (queryHouseholdId && queryHouseholdId !== existing.householdId) return sendError(res, 403, '不能操作其他家庭的原料');
      if (!requirePantryDictionaryAccess(req, res, existing.householdId)) return;
      if (method === 'PUT') {
        const body = await readBody(req);
        if (body.householdId && body.householdId !== existing.householdId) return sendError(res, 400, '不能更改原料所属家庭');
        const ingredient = normIngredient({ ...existing, ...body, householdId: existing.householdId }, existing);
        if (!ingredient || !ingredient.categoryId || !pantryCategoryExists(existing.householdId, ingredient.categoryId)) return sendError(res, 400, '请选择本家庭有效分类');
        const categoryLabel = pantryCategoryLabel(existing.householdId, ingredient.categoryId);
        if (categoryLabel.split(' > ')[0] === '调味干货') ingredient.defaultTrackingMode = 'presence';
        if (state.ingredients.some((item) => item.id !== id && item.householdId === existing.householdId && item.name.toLocaleLowerCase() === ingredient.name.toLocaleLowerCase())) {
          return sendError(res, 409, '这个家庭已经有同名原料');
        }
        state.ingredients[index] = ingredient;
        scheduleSave('ingredients');
        state.pantry.forEach((pantry) => {
          if (pantry.householdId !== existing.householdId || pantry.ingredientId !== id) return;
          pantry.name = ingredient.name;
          pantry.category = categoryLabel || pantry.category;
          if (ingredient.defaultTrackingMode === 'presence') {
            pantry.hasStock = pantry.hasStock === true || Number(pantry.quantity) > 0;
            pantry.trackingMode = 'presence';
            pantry.quantity = 0;
            pantry.minQuantity = 0;
            pantry.unit = '';
          }
          pantry.updatedAt = nowISO();
        });
        scheduleSave('pantry');
        return sendJSON(res, 200, { ok: true, data: ingredient });
      }
      const referencedByDish = state.dishes.some((dish) =>
        [...dish.seasonings, ...dish.methods.flatMap((method) => method.seasonings || [])]
          .some((seasoning) => seasoning.ingredientId === id)
      );
      const referencedByPantry = state.pantry.some((item) => item.ingredientId === id);
      if (referencedByDish || referencedByPantry) {
        return sendError(res, 409, '原料仍被菜谱或库存使用，请先重新分配引用');
      }
      state.ingredients.splice(index, 1);
      scheduleSave('ingredients');
      return sendJSON(res, 200, { ok: true, data: existing });
    }
  }

  // GET /api/state —— 全量状态（家庭规模数据很小，一次取完最省事）
  if (method === 'GET' && route.length === 1 && route[0] === 'state') {
    // 口令绝不能跟着 state 一起发出去：否则局域网里任何人按 F12
    // 就能在返回的 JSON 里读到明文，管理口令形同虚设。
    const { adminPin, ...pubSettings } = state.settings;
    const account = accountSessionOf(req);
    if (adminPin && req.headers['x-auth-token'] && !isSuperAdmin(req)) {
      return sendError(res, 401, '超级管理员授权已失效，请重新输入全局管理口令');
    }
    const accountHouses = account ? membershipsOf(account.scope.userId) : [];
    const superAccess = account ? (!adminPin || !!sessionOf(req)) : isAuthed(req);
    const requestedHouseholdId = safeText(url.searchParams.get('householdId'), 40);
    const requestedHousehold = state.households.find((h) => h.id === requestedHouseholdId);
    const isMemberOfRequested = !!(account && requestedHousehold && accountHouses.some((h) => h.id === requestedHousehold.id));
    const readOnlyExternal = !!(account && requestedHousehold && !isMemberOfRequested && !superAccess);
    const allowedRequested = !account || superAccess || isMemberOfRequested || readOnlyExternal;
    // 账户登录后默认没有当前家庭；只有显式传入已加入家庭（或公开家庭）才进入家庭上下文。
    // 超级管理员也可以保持无家庭上下文，此时只看全局共享菜单和平台数据。
    const visibleHouseholdId = allowedRequested && requestedHousehold ? requestedHousehold.id : '';
    const canReadHouseholdDictionary = !!visibleHouseholdId && !readOnlyExternal &&
      canAccessPantryDictionary(req, visibleHouseholdId);
    // 没设口令时是开放超级管理员模式；设了口令后，只有有效授权能看全量状态。
    const fullState = superAccess;
    const visibleDishes = fullState
      ? state.dishes
      : readOnlyExternal || !visibleHouseholdId
      ? state.dishes.filter((d) => !d.householdId)
      : state.dishes.filter((d) => !d.householdId || d.householdId === visibleHouseholdId);
    const publicVisibleDishes = visibleDishes.map(publicDish);
    const visibleDishIds = new Set(publicVisibleDishes.map((d) => d.id));
    const visibleCategories = fullState
      ? state.categories
      : readOnlyExternal || !visibleHouseholdId
      ? state.categories.filter((c) => !c.householdId)
      : state.categories.filter((c) => !c.householdId || c.householdId === visibleHouseholdId);
    const visibleNotes = fullState
      ? state.notes.notes
      : readOnlyExternal || !visibleHouseholdId
      ? []
      : state.notes.notes.filter((n) => n.householdId === visibleHouseholdId);
    const visibleVotes = fullState
      ? state.notes.votes
      : Object.fromEntries(
          Object.entries(state.notes.votes).filter(([dishId]) => visibleDishIds.has(dishId))
        );
    const visibleAccess = fullState
      ? state.access.requests
      : account
      ? state.access.requests.filter((r) => r.applicantUserId === account.scope.userId || r.name === safeText(url.searchParams.get('memberName'), 20).trim())
      : state.access.requests.filter((r) => r.name === safeText(url.searchParams.get('memberName'), 20).trim());
    const visibleShoppingStatus = visibleHouseholdId && !readOnlyExternal
      ? {
          householdId: visibleHouseholdId,
          items: (state.shoppingStatus[visibleHouseholdId] && state.shoppingStatus[visibleHouseholdId].items) || {},
        }
      : { householdId: '', items: {} };
    // 账户首页需要公开家庭目录；成员关系单独放在 account.households，不能把公开目录误当成“我的家庭”。
    const visibleHouseholds = publicHouseholds();
    const accountInfo = account
      ? { user: publicUser(userById(account.scope.userId)), households: accountHouseholds(account.scope.userId), deviceId: account.scope.deviceId }
      : null;
    return sendJSON(res, 200, {
      ok: true,
      data: {
        categories: visibleCategories,
        dishes: publicVisibleDishes,
        orders: fullState
          ? state.orders
          : readOnlyExternal || !visibleHouseholdId
          ? []
          : state.orders.filter((o) => o.householdId === visibleHouseholdId),
        // 当前家庭只属于客户端会话；服务端状态不再提供全局默认家庭。
        settings: { ...pubSettings, currentHouseholdId: '', hasPin: !!adminPin },
        // 家庭和成员的口令**永远不进这个响应** —— 这个接口局域网里谁都能调
        households: visibleHouseholds,
        pantry: fullState
          ? state.pantry
          : readOnlyExternal || !visibleHouseholdId
          ? []
          : state.pantry.filter((p) => p.householdId === visibleHouseholdId),
        ingredients: canReadHouseholdDictionary
          ? state.ingredients.filter((ingredient) => ingredient.householdId === visibleHouseholdId)
          : [],
        pantryCategories: canReadHouseholdDictionary
          ? state.pantryCategories.filter((category) => category.householdId === visibleHouseholdId)
          : [],
        plans: fullState
          ? state.plans
          : readOnlyExternal || !visibleHouseholdId
          ? []
          : state.plans.filter((p) => p.householdId === visibleHouseholdId),
        shoppingStatus: visibleShoppingStatus,
        notes: { notes: visibleNotes, votes: readOnlyExternal ? {} : visibleVotes },
        access: { requests: visibleAccess.map(publicJoinRequest) },
        ...(accountInfo ? { account: accountInfo, superExpiresAt: (() => { const s = sessionOf(req); return s && s.scope && s.scope.kind === 'super' ? s.scope.fixedExp : 0; })() } : {}),
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
  // 提交申请谁都能做（人总得有个申请入口）；
  // 批准/拒绝由**这个家的管理员**点头 —— 不是全局管理员，见下面 PUT。
  if (route[0] === 'join-requests') {
    const id = route[1];
    const body = method !== 'GET' ? await readBody(req) : {};

    if (method === 'GET') {
      // 管理员看全部（超管，或者至少管着一个家的 owner）；
      // 其余人只看得到自己那条，名字从 device token 推，不靠客户端报
      const fullAccess = isAnyHouseAdmin(req);
      const uidForRequest = accountUserId(req);
      const requests = fullAccess
        ? state.access.requests
        : uidForRequest
        ? state.access.requests.filter((r) => r.applicantUserId === uidForRequest || (!r.applicantUserId && r.name === whoami(req).name))
        : state.access.requests.filter((r) => r.name === whoami(req).name);
      return sendJSON(res, 200, { ok: true, data: requests.map(publicJoinRequest) });
    }

    if (method === 'POST' && !id) {
      const uidForRequest = accountUserId(req);
      const accountUser = uidForRequest && userById(uidForRequest);
      const name = accountUser
        ? safeText(accountUser.displayName, 40).trim()
        : safeText(body.name, 20).trim();
      const householdId = safeText(body.householdId, 40);
      if (!name) return sendError(res, 400, '写上你是谁，管理员才知道批给谁');
      const house = state.households.find((h) => h.id === householdId);
      if (!house) return sendError(res, 404, '这个家庭不存在');
      if (house.members.some((m) => (uidForRequest && m.userId === uidForRequest) || (!uidForRequest && m.name === name))) {
        return sendError(res, 409, `「${name}」已经是${house.name}的成员了`);
      }
      const requestedRole = body.requestedRole === 'owner' ? 'owner' : 'member';
      // 同一家的同名申请只留最新的一条，免得刷出一长串等价的待办
      const dup = state.access.requests.find((r) => r.householdId === householdId && (uidForRequest ? r.applicantUserId === uidForRequest : r.name === name));
      if (dup) {
        dup.at = nowISO();
        dup.note = safeText(body.note, 100).trim();
        dup.requestedRole = requestedRole;
        dup.name = name;
        if (accountUser) {
          dup.applicantLoginIdSnapshot = accountUser.loginId;
          dup.applicantDisplayNameSnapshot = accountUser.displayName;
        }
        delete dup.approvedRole;
        dup.status = 'pending';
        scheduleSave('access');
        return sendJSON(res, 200, { ok: true, data: publicJoinRequest(dup), updated: true });
      }
      const jrNew = {
        id: uid('j_'),
        name,
        householdId,
        ...(uidForRequest ? { applicantUserId: uidForRequest } : {}),
        ...(accountUser ? {
          applicantLoginIdSnapshot: accountUser.loginId,
          applicantDisplayNameSnapshot: accountUser.displayName,
        } : {}),
        note: safeText(body.note, 100).trim(),
        requestedRole,
        at: nowISO(),
        status: 'pending',
      };
      state.access.requests.unshift(jrNew);
      // 别无限堆：已处理的只留最近 20 条，待处理的全留
      const done = state.access.requests.filter((r) => r.status !== 'pending');
      if (done.length > 20) {
        const drop = new Set(done.slice(20).map((r) => r.id));
        state.access.requests = state.access.requests.filter((r) => !drop.has(r.id));
      }
      scheduleSave('access');
      return sendJSON(res, 200, { ok: true, data: publicJoinRequest(jrNew) });
    }

    if (method === 'PUT' && id) {
      // 局部变量叫 jr 不叫 req：req 是那个 HTTP 请求，
      // 一旦遮蔽，isHouseAdmin 拿到的就成了申请记录，判权全错。
      const jr = state.access.requests.find((r) => r.id === id);
      if (!jr) return sendError(res, 404, '申请不存在');
      // 批的是「谁进这个家」，所以由**这个家的管理员**点头，不是全局管理员。
      // 不然家庭管理员这个角色就只剩「改菜」一件事，形同虚设。
      if (!isHouseAdmin(req, jr.householdId)) {
        return sendError(res, 403, '这条申请要这个家的管理员批');
      }
      // 批准 = 往成员名单里塞一个人 = 改「谁是谁」。跟改成员一样是危险动作，
      // 得是刚刚用密码换来的授权，光靠「记住我」的令牌不行。
      if (!canDoSensitive(req, jr.householdId)) return sendError(res, 403, SENSITIVE_HINT);
      const status = body.status === 'ok' ? 'ok' : 'no';
      const approvedRole = body.role === 'owner' || body.role === 'member'
        ? body.role
        : jr.requestedRole === 'owner' ? 'owner' : 'member';
      jr.status = status;
      jr.at = nowISO();
      if (status === 'ok') jr.approvedRole = approvedRole;
      else delete jr.approvedRole;
      // 批准 = 真的把人加进这个家庭。光改状态不生效的话，
      // 被批准的人在成员列表里还是找不到自己，等于没批
      if (status === 'ok') {
        const house = state.households.find((h) => h.id === jr.householdId);
        const applicant = jr.applicantUserId && userById(jr.applicantUserId);
        if (applicant && membershipsOf(jr.applicantUserId).length >= 5) {
          jr.status = 'pending';
          return sendError(res, 409, '这个账号已经加入 5 个家庭，需先退出一个家庭');
        }
        if (house && !house.members.some((m) => (jr.applicantUserId && m.userId === jr.applicantUserId) || (!jr.applicantUserId && m.name === jr.name))) {
          house.members.push({
            id: uid('m_'),
            ...(jr.applicantUserId ? { userId: jr.applicantUserId } : {}),
            name: applicant ? memberDisplayName({ userId: applicant.id, name: applicant.displayName }) : jr.name,
            loginId: uniqueLoginId(house.members, applicant ? applicant.loginId : jr.name, jr.name),
            emoji: MEMBER_EMOJI[house.members.length % MEMBER_EMOJI.length],
            // 最终角色由目标家庭管理员在批准时决定；申请人只能表达意愿。
            role: approvedRole,
            password: '',
          });
          scheduleSave('households');
        }
      }
      scheduleSave('access');
      return sendJSON(res, 200, { ok: true, data: publicJoinRequest(jr) });
    }

    if (method === 'DELETE' && id) {
      const found = state.access.requests.find((r) => r.id === id);
      if (!found) return sendError(res, 404, '申请不存在');
      if (!isHouseAdmin(req, found.householdId)) {
        return sendError(res, 403, '这条申请要这个家的管理员处理');
      }
      if (!canDoSensitive(req, found.householdId)) return sendError(res, 403, SENSITIVE_HINT);
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
        if (src.householdId) return sendError(res, 403, '只能把共享菜单收进当前家庭');
        // 只能收进当前账户已加入的家庭；超级管理员可在已选择的家庭中代办。
        if (!isMyMember(req, hhId) && !isHouseAdmin(req, hhId)) {
          return sendError(res, 403, '请先加入这个家庭，再把共享菜收进我家');
        }
        if (state.dishes.some((dish) => dish.householdId === hhId && dish.copySourceDishId === src.id)) {
          return sendError(res, 409, '这道共享菜已经收进我家了');
        }
        const copy = copyDishToScope(src, hhId, req);
        if (!copy) return sendError(res, 400, '菜品无法复制');
        const bad = categoryProblem(copy);
        if (bad) return sendError(res, 400, bad);
        const ingredientProblem = dishIngredientReferenceProblem(copy, hhId);
        if (ingredientProblem) return sendError(res, 400, ingredientProblem);
        state.dishes.unshift(copy);
        scheduleSave('dishes');
        return sendJSON(res, 200, { ok: true, data: publicDish(copy) });
      }

      if (method === 'POST' && !id) {
        // 加菜必须先认领身份。「你添加的菜」这句话要有主语 ——
        // 没有身份的人加的菜，主人栏只能永远空着，权限也判不了。
        // 超管例外：他能替任何一家建菜（迁移、恢复、给别人家帮忙加一道）。
        if (!isMyMember(req, hhId) && !isHouseAdmin(req, hhId)) {
          return sendError(res, 403, '先说说你是谁，这道菜才好记下是谁加的');
        }
        const dish = normDish({ ...(await readBody(req)), householdId: hhId });
        if (!dish || !dish.name) return sendError(res, 400, '菜名不能为空');
        const ingredientProblem = dishIngredientReferenceProblem(dish, hhId);
        if (ingredientProblem) return sendError(res, 400, ingredientProblem);
        const who = whoami(req, hhId);
        dish.authorId = who.kind === 'member' ? who.memberId : '';
        dish.authorUserId = who.userId || '';
        dish.authorName = who.name || '';
        const bad = categoryProblem(dish);
        if (bad) return sendError(res, 400, bad);
        state.dishes.unshift(dish);
        scheduleSave('dishes');
        return sendJSON(res, 200, { ok: true, data: publicDish(dish) });
      }
      if (method === 'PUT' && id) {
        const idx = state.dishes.findIndex((d) => d.id === id);
        if (idx < 0) return sendError(res, 404, '菜品不存在');
        if (!owns(state.dishes[idx])) {
          return sendError(res, 403, '这是公共菜谱（或别人家的菜），改不了。要改可以「收进我家」自己抄一份。');
        }
        // 同属一家也不代表能改 —— 普通成员只能改自己添加的那些
        if (!canWrite(req, state.dishes[idx])) {
          return sendError(res, 403, writeDenied(state.dishes[idx]));
        }
        const dish = normDish({ ...(await readBody(req)), householdId: hhId }, state.dishes[idx]);
        const ingredientProblem = dishIngredientReferenceProblem(dish, hhId);
        if (ingredientProblem) return sendError(res, 400, ingredientProblem);
        dish.authorId = state.dishes[idx].authorId;
        dish.authorUserId = state.dishes[idx].authorUserId || dishAuthorUserId(state.dishes[idx]);
        dish.authorName = state.dishes[idx].authorName;
        const bad = categoryProblem(dish);
        if (bad) return sendError(res, 400, bad);
        state.dishes[idx] = dish;
        scheduleSave('dishes');
        return sendJSON(res, 200, { ok: true, data: publicDish(dish) });
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
          if (!canWrite(req, one)) return sendError(res, 403, writeDenied(one));
        }
        // 只删真正属于这一家、而且这个人改得动的。混进来的共享菜一条都不动 ——
        // 非管理员不该有「顺手把公共菜删了」这种可能。
        const kill = state.dishes.filter((d) => ids.has(d.id) && owns(d) && canWrite(req, d));
        // 按 kill 里的 id 删，不能按 owns 删 —— owns 会把「同属一家但不是你写的」
        // 那几条一起算进去，而它们在上面已经被 canWrite 滤掉了。
        const killedIds = new Set(kill.map((d) => d.id));
        state.dishes = state.dishes.filter((d) => !killedIds.has(d.id));
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
          data: { removed: kill.length, kept: ids.size - kill.length, first: kill[0] || null },
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
      if (!requireAccountHousehold(req, res, hhId)) return;
      const cat = { id: uid('c_'), name, householdId: hhId, order: state.categories.length + 1 };
      state.categories.push(cat);
      scheduleSave('categories');
      return sendJSON(res, 200, { ok: true, data: cat });
    }
    if (method === 'PUT' && id) {
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return sendError(res, 404, '分类不存在');
      if (cat.householdId && !requireAccountHousehold(req, res, cat.householdId)) return;
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
      const uidForRequest = accountUserId(req);
      if (uidForRequest && membershipsOf(uidForRequest).length >= 5) {
        return sendError(res, 409, '一个账号最多加入 5 个有效家庭，请先退出一个家庭');
      }
      const body = await readBody(req);
      const h = normHousehold({
        ...body,
        emoji: safeText(body.emoji, 4) || HOUSEHOLD_EMOJI[state.households.length % HOUSEHOLD_EMOJI.length],
      });
      if (!h) return sendError(res, 400, '家庭名称不能为空');
      // 新账户创建的家庭立即可用；保留旧设备创建的 normal 状态以兼容旧版审核流程。
      h.status = uidForRequest ? 'approved' : 'normal';
      state.households.push(h);
      // 谁建的，他就是这家的第一个管理员
      const me = deviceMember(req);
      if (uidForRequest || me) {
        const target = state.households[state.households.length - 1];
        const accountUser = uidForRequest && userById(uidForRequest);
        target.members.push({
          id: me ? me.memberId : uid('m_'),
          userId: uidForRequest || '',
          name: accountUser ? accountUser.displayName : me.name,
          loginId: uniqueLoginId(target.members, accountUser ? accountUser.loginId : me.name, me ? me.name : ''),
          emoji: MEMBER_EMOJI[0],
          role: 'owner',
          password: '',
        });
      }
      scheduleSave('households');
      return sendJSON(res, 200, { ok: true, data: publicHousehold(h) });
    }
    if (method === 'PUT' && id) {
      const idx = state.households.findIndex((h) => h.id === id);
      if (idx < 0) return sendError(res, 404, '家庭不存在');
      const body = await readBody(req);
      // 改名字、改图标、改备注也要对准「是这个家的管理员」：
      // 统一守卫只问「有没有资格碰管理区」，答不出「能不能改这一家」。
      // 不在这里补这道，A 家的管理员就能把 B 家的名字改成自己的。
      // 家庭权限只看成员关系中的 owner；历史家庭口令不再参与判权。
      if (!isSuperAdmin(req)) {
        const hs = houseSessionOf(req);
        const vs = verifiedSessionOf(req);
        const mine = (hs && hs.scope.id === id) || (vs && vs.scope.id === id) || isHouseAdmin(req, id);
        if (!mine) return sendError(res, 403, '只能改自己这个家');
      }
      // 只改名字、图标、备注这类无害字段的不用二次验证 —— 那是日常维护。
      // 动成员名单、家庭口令、家庭状态才是危险动作：那几样能改「谁是谁」。
      const touchesIdentity =
        body.members !== undefined ||
        typeof body.pin === 'string' ||
        body.clearPin === true ||
        typeof body.status === 'string';
      if (touchesIdentity && !canDoSensitive(req, id)) return sendError(res, 403, SENSITIVE_HINT);
      // 成员姓名属于全局账户资料。管理页沿用成员编辑表单时，把关联账户的
      // displayName 一并更新，避免同一账号在不同家庭出现两套姓名。
      let usersChangedByMemberEdit = false;
      if (Array.isArray(body.members)) {
        const previousMembers = state.households[idx].members || [];
        for (const raw of body.members) {
          if (!raw || typeof raw !== 'object') continue;
          const previous = previousMembers.find((m) => m && ((raw.id && m.id === raw.id) || (raw.userId && m.userId === raw.userId)));
          const userId = (raw.userId || (previous && previous.userId) || '');
          const user = userId && userById(userId);
          const nextName = safeText(raw.name, 40).trim();
          if (user && nextName && user.displayName !== nextName) {
            user.displayName = nextName;
            user.updatedAt = nowISO();
            syncMemberDisplayName(user.id, nextName);
            usersChangedByMemberEdit = true;
          }
        }
      }
      // 家庭口令已经废弃。旧客户端传来的 pin/clearPin 只会把历史字段清空，
      // 不会创建新的家庭权限来源。
      body.pin = '';
      // status 只有超级管理员能改
      if (typeof body.status === 'string') {
        if (!isSuperAdmin(req)) return sendError(res, 403, '只有超级管理员能把这个家庭升级为正式');
        body.status = body.status === 'approved' ? 'approved' : 'normal';
      }
      const next = normHousehold(body, state.households[idx]);
      if (!next) return sendError(res, 400, '家庭名称不能为空');
      const nextOwners = (next.members || []).filter((m) => m.role === 'owner');
      if ((next.members || []).length && nextOwners.length === 0) {
        return sendError(res, 400, '家庭至少要保留一名管理员');
      }
      // 成员被删了 → 那些设备令牌一并作废。
      // 就算不撤，whoami() 找不到这个成员也只会当匿名 —— 但留着等于让一把
      // 没人再认领的钥匙一直挂着，过期之前都是隐患。
      const keptIds = new Set((next.members || []).map((m) => m.id));
      for (const m of state.households[idx].members || []) {
        if (m && m.id && !keptIds.has(m.id)) revokeDeviceTokens(m.id);
      }
      // 旧家庭会话不再授予权限，历史 token 无需继续维护。
      state.households[idx] = next;
      if (usersChangedByMemberEdit) scheduleSave('users');
      scheduleSave('households');
      return sendJSON(res, 200, { ok: true, data: publicHousehold(next) });
    }
    if (method === 'DELETE' && id) {
      // 新账户允许解散自己的最后一个家庭，回到账户首页后默认没有家庭。
      // 没有关联账户的旧版设备数据仍保留至少一户的兼容保护。
      if (state.households.length <= 1 && !accountUserId(req)) {
        return sendError(res, 400, '至少要保留一个家庭');
      }
      const idx = state.households.findIndex((h) => h.id === id);
      if (idx < 0) return sendError(res, 404, '这个家庭不存在');
      // 删家庭 = 把一整家人的数据抹掉，没有比这更危险的了
      if (!canDoSensitive(req, id)) return sendError(res, 403, SENSITIVE_HINT);
      const [gone] = state.households.splice(idx, 1);
      // 家庭被解散后，成员设备令牌、待处理申请和旧家庭会话都必须失效，
      // 否则其他设备还会暂时带着一把指向已删除家庭的钥匙。
      for (const m of gone.members || []) {
        if (m && m.id) revokeDeviceTokens(m.id);
      }
      state.access.requests = state.access.requests.filter((r) => r.householdId !== id);
      for (const [token, session] of sessions) {
        const scope = session && session.scope;
        if (scope && scope.kind === 'house' && scope.id === id) sessions.delete(token);
      }
      // 家庭没了，它名下的点餐和库存也一并清掉，免得数据无处安放
      const removedOrders = state.orders.filter((o) => o.householdId === id).length;
      const removedPantry = state.pantry.filter((p) => p.householdId === id).length;
      const removedIngredients = state.ingredients.filter((ingredient) => ingredient.householdId === id).length;
      const removedPantryCategories = state.pantryCategories.filter((category) => category.householdId === id).length;
      const removedNotes = state.notes.notes.filter((n) => n.householdId === id).length;
      state.orders = state.orders.filter((o) => o.householdId !== id);
      state.pantry = state.pantry.filter((p) => p.householdId !== id);
      state.ingredients = state.ingredients.filter((ingredient) => ingredient.householdId !== id);
      state.pantryCategories = state.pantryCategories.filter((category) => category.householdId !== id);
      state.plans = state.plans.filter((p) => p.householdId !== id);
      delete state.shoppingStatus[id];
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
        state.settings.currentHouseholdId = '';
      }
      scheduleSave('households');
      scheduleSave('orders');
      scheduleSave('pantry');
      scheduleSave('ingredients');
      scheduleSave('pantryCategories');
      scheduleSave('plans');
      scheduleSave('shoppingStatus');
      scheduleSave('notes');
      scheduleSave('dishes');
      scheduleSave('categories');
      scheduleSave('settings');
      scheduleSave('access');
      return sendJSON(res, 200, {
        ok: true,
        data: {
          ...gone,
          removedOrders,
          removedPantry,
          removedIngredients,
          removedNotes,
          removedDishes,
          removedCategories: removedCats,
          removedPantryCategories,
        },
      });
    }
  }

  // ---- 本周计划 ----
  if (route[0] === 'plans') {
    const id = route[1];

    // 计划采购可以因新增缺口再次入库；请求编号保证同一次提交不会重复入账。
    if (method === 'POST' && route[1] === 'receive') {
      const body = await readBody(req);
      const hid = resolveHouseholdId(body.householdId);
      if (!requireAccountHousehold(req, res, hid)) return;
      const name = safeText(body.name, 24).trim();
      if (!name) return sendError(res, 400, '食材名不能为空');
      const rawQty = Number(body.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) return sendError(res, 400, '购买数量必须大于 0');
      const unit = safeText(body.unit, 8).trim() || '份';
      const wk = mondayOf(body.weekOf);
      const plan = findPlan(hid, wk, false);
      if (!plan) return sendError(res, 404, '这一周还没有计划');
      if (!plan.received || typeof plan.received !== 'object') plan.received = {};
      const requestedIngredientId = safeText(body.ingredientId, 80).trim();
      const linkedIngredient = requestedIngredientId
        ? state.ingredients.find((ingredient) => ingredient.id === requestedIngredientId && ingredient.householdId === hid)
        : null;
      if (requestedIngredientId && !linkedIngredient) return sendError(res, 400, '原料不属于当前家庭，请刷新后重试');
      const receivedKey = linkedIngredient ? `id:${linkedIngredient.id}` : `name:${pantryIngredientKey(name)}`;
      if (!plan.receiveRequests || typeof plan.receiveRequests !== 'object') plan.receiveRequests = {};
      const requestId = safeText(body.requestId, 120).trim();
      const requestKey = requestId || `legacy:${receivedKey}`;
      if (plan.receiveRequests[requestKey]) return sendError(res, 409, '这次入库请求已经处理，请刷新库存');
      const item = normPantryItem({
        householdId: hid,
        name,
        ...(linkedIngredient ? { ingredientId: linkedIngredient.id } : {}),
        category: body.category,
        trackingMode: body.trackingMode || linkedIngredient?.defaultTrackingMode,
        quantity: rawQty,
        unit,
        expireAt: body.expireAt,
        note: body.note || '从计划采购入库',
      });
      const stored = addPantryQuantity(item);
      plan.received[receivedKey] = nowISO();
      plan.receiveRequests[requestKey] = nowISO();
      plan.updatedAt = nowISO();
      scheduleSave('pantry');
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { item: stored, receivedKey } });
    }

    // 加一道菜进某家庭某周的计划
    if (method === 'POST' && route[1] === 'items') {
      const body = await readBody(req);
      if (!requireAccountHousehold(req, res, resolveHouseholdId(body.householdId))) return;
      const dish = body.dishId ? state.dishes.find((d) => d.id === body.dishId) : null;
      const item = normPlanItem({
        ...body,
        name: body.name || (dish && dish.name),
        servings: body.servings || (dish && dish.servings),
        weekOf: body.weekOf,
      }, undefined, false, body.weekOf);
      if (!item) return sendError(res, 400, '要加哪道菜？写个菜名吧');
      const plan = findPlan(body.householdId, body.weekOf, true);
      plan.items.push(item);
      plan.received = {};
      plan.updatedAt = nowISO();
      scheduleSave('plans');
      return sendJSON(res, 200, { ok: true, data: { plan, item } });
    }

    // 管理员完成计划菜并实际扣库存；每个计划项只允许完成一次。
    if (method === 'PATCH' && route[1] === 'items' && route[2]) {
      const target = route[2];
      let foundPlan = null;
      let item = null;
      for (const plan of state.plans) {
        if (!accountCanAccessHousehold(req, plan.householdId)) continue;
        const hit = plan.items.find((it) => it.id === target);
        if (hit) { foundPlan = plan; item = hit; break; }
      }
      if (!item || !foundPlan) return sendError(res, 404, '计划里没有这道菜');
      if (!isHouseAdmin(req, foundPlan.householdId)) return sendError(res, 403, '只有家庭管理员能完成计划并扣库存');
      const body = await readBody(req);
      if (body.status !== 'done') return sendError(res, 400, '计划状态只能标记为完成');
      if (item.status === 'done') return sendError(res, 409, '这道计划菜已经完成并扣过库存');

      const dish = item.dishId ? state.dishes.find((d) => d.id === item.dishId) : null;
      const result = dish
        ? consumeDishPantry(foundPlan.householdId, dish)
        : { consumed: [], warnings: ['这是临时菜，没有可读取的菜谱用量，未自动扣库存'] };
      item.status = 'done';
      item.completedAt = nowISO();
      foundPlan.received = {};
      foundPlan.updatedAt = nowISO();
      scheduleSave('plans');
      if (result.consumed.length) scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: { item, consumed: result.consumed, warnings: result.warnings } });
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
        if (!accountCanAccessHousehold(req, plan.householdId)) continue;
        const keep = plan.items.filter((it) => !ids.has(it.id));
        if (keep.length !== plan.items.length) {
          removed += plan.items.length - keep.length;
          plan.items = keep;
          plan.received = {};
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
        if (!accountCanAccessHousehold(req, plan.householdId)) continue;
        const i = plan.items.findIndex((it) => it.id === target);
        if (i >= 0) {
          hit = plan.items.splice(i, 1)[0];
          plan.received = {};
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
      if (!requireAccountHousehold(req, res, hid)) return;
      const wk = mondayOf(url.searchParams.get('weekOf'));
      return sendJSON(res, 200, { ok: true, data: findPlan(hid, wk, false) });
    }

    // 清空某家庭某周
    if (method === 'DELETE' && !id) {
      const hid = resolveHouseholdId(url.searchParams.get('householdId'));
      if (!requireAccountHousehold(req, res, hid)) return;
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
      const body = await readBody(req);
      const item = normPantryItem(body);
      if (!item) return sendError(res, 400, '食材名不能为空');
      if (item.trackingMode === 'quantity' && body.quantity !== undefined) {
        const quantity = Number(body.quantity);
        if (!Number.isFinite(quantity) || quantity < 0) return sendError(res, 400, '库存数量不能小于 0');
        if (quantity === 0) return sendError(res, 400, '数量为 0，无需新增库存条目');
      }
      if (!requireAccountHousehold(req, res, item.householdId)) return;
      const ingredientProblem = pantryIngredientReferenceProblem(item);
      if (ingredientProblem) return sendError(res, 400, ingredientProblem);
      if (body.addToExisting) addPantryQuantity(item);
      else state.pantry.unshift(item);
      scheduleSave('pantry');
      const stored = body.addToExisting
        ? state.pantry.find((p) => p.id === item.id ||
            (p.householdId === item.householdId && pantryIngredientKey(p.name) === pantryIngredientKey(item.name) && pantryUnitKey(p.unit) === pantryUnitKey(item.unit))) || item
        : item;
      return sendJSON(res, 200, { ok: true, data: stored });
    }
    if (method === 'PUT' && id) {
      const idx = state.pantry.findIndex((p) => p.id === id);
      if (idx < 0) return sendError(res, 404, '库存条目不存在');
      const body = await readBody(req);
      const existing = state.pantry[idx];
      if (!requireAccountHousehold(req, res, existing.householdId)) return;
      const linkedIngredient = existing.ingredientId
        ? state.ingredients.find((ingredient) => ingredient.id === existing.ingredientId && ingredient.householdId === existing.householdId)
        : null;
      const requestedCategory = safeText(body.category, 80).trim();
      if (linkedIngredient && requestedCategory && requestedCategory !== pantryCategoryLabel(existing.householdId, linkedIngredient.categoryId)) {
        const categoryId = pantryCategoryIdByLabel(existing.householdId, requestedCategory);
        if (categoryId) {
          linkedIngredient.categoryId = categoryId;
          const categoryRoot = pantryCategoryLabel(existing.householdId, categoryId).split(' > ')[0];
          if (categoryRoot === '调味干货') linkedIngredient.defaultTrackingMode = 'presence';
          linkedIngredient.updatedAt = nowISO();
          state.pantry.filter((pantry) => pantry.householdId === existing.householdId && pantry.ingredientId === linkedIngredient.id)
            .forEach((pantry) => {
              pantry.category = pantryCategoryLabel(existing.householdId, categoryId);
              if (linkedIngredient.defaultTrackingMode === 'presence') {
                pantry.hasStock = pantry.hasStock === true || Number(pantry.quantity) > 0;
                pantry.trackingMode = 'presence';
                pantry.quantity = 0;
                pantry.minQuantity = 0;
                pantry.unit = '';
              }
              pantry.updatedAt = nowISO();
            });
          scheduleSave('ingredients');
          scheduleSave('pantry');
        }
      }
      const item = normPantryItem(body, state.pantry[idx]);
      if (!item) return sendError(res, 400, '食材名不能为空');
      if (item.householdId !== existing.householdId) return sendError(res, 400, '不能更改库存所属家庭');
      const ingredientProblem = pantryIngredientReferenceProblem(item);
      if (ingredientProblem) return sendError(res, 400, ingredientProblem);
      if (item.trackingMode === 'quantity' && body.quantity !== undefined) {
        const quantity = Number(body.quantity);
        if (!Number.isFinite(quantity) || quantity < 0) return sendError(res, 400, '库存数量不能小于 0');
        if (quantity === 0) {
          const [deleted] = state.pantry.splice(idx, 1);
          scheduleSave('pantry');
          return sendJSON(res, 200, { ok: true, data: { deleted: true, id: deleted.id, item: deleted } });
        }
      }
      state.pantry[idx] = item;
      scheduleSave('pantry');
      return sendJSON(res, 200, { ok: true, data: item });
    }
    if (method === 'DELETE' && id) {
      const idx = state.pantry.findIndex((p) => p.id === id);
      if (idx < 0) return sendError(res, 404, '库存条目不存在');
      if (!requireAccountHousehold(req, res, state.pantry[idx].householdId)) return;
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
        state.pantry = state.pantry.filter((p) => !(ids.has(p.id) && accountCanAccessHousehold(req, p.householdId)));
        scheduleSave('pantry');
        return sendJSON(res, 200, {
          ok: true,
          data: { removed: before - state.pantry.length },
        });
      }
      const hid = safeText(url.searchParams.get('householdId'), 40);
      if (!requireAccountHousehold(req, res, hid || resolveHouseholdId(hid))) return;
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

  // ---- 当前家庭买菜状态 ----
  // 这是家庭日常数据，不属于全局 settings；普通成员可以标记已买，
  // 只有库存数量由 pantry 实时决定“已有”。
  if (route[0] === 'shopping-status') {
    const bucketFor = (hid, create) => {
      if (!state.shoppingStatus[hid] && create) state.shoppingStatus[hid] = { items: {} };
      if (state.shoppingStatus[hid] && (!state.shoppingStatus[hid].items || typeof state.shoppingStatus[hid].items !== 'object')) {
        state.shoppingStatus[hid].items = {};
      }
      return state.shoppingStatus[hid] || null;
    };
    const hid = safeText(url.searchParams.get('householdId'), 40);
    if (method === 'GET') {
      if (!hid) return sendError(res, 400, '缺少家庭 ID');
      if (!requireAccountHousehold(req, res, hid)) return;
      const bucket = bucketFor(hid, false) || { items: {} };
      return sendJSON(res, 200, { ok: true, data: { householdId: hid, items: bucket.items } });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const target = safeText(body.householdId || hid, 40);
      if (!target) return sendError(res, 400, '缺少家庭 ID');
      if (!requireAccountHousehold(req, res, target)) return;
      const bucket = bucketFor(target, true);
      const updates = Array.isArray(body.items)
        ? body.items
        : [{ name: body.name, state: body.state }];
      let changed = 0;
      for (const raw of updates) {
        const name = safeText(raw && raw.name, 80).trim();
        if (!name) continue;
        if (raw.state === 'completed') {
          bucket.items[name] = { state: 'completed', updatedAt: nowISO() };
        } else if (raw.state === 'needed' || raw.state === 'available' || raw.state === '' || raw.state == null) {
          delete bucket.items[name];
        } else {
          return sendError(res, 400, '采购状态只能是 needed 或 completed');
        }
        changed++;
      }
      scheduleSave('shoppingStatus');
      return sendJSON(res, 200, { ok: true, data: { householdId: target, items: bucket.items, changed } });
    }
    if (method === 'DELETE') {
      const target = hid;
      if (!target) return sendError(res, 400, '缺少家庭 ID');
      if (!requireAccountHousehold(req, res, target)) return;
      const bucket = bucketFor(target, false);
      if (!bucket) return sendJSON(res, 200, { ok: true, data: { householdId: target, removed: 0 } });
      const names = String(url.searchParams.get('names') || '').split(',').map((x) => safeText(x, 80).trim()).filter(Boolean);
      const removed = names.length
        ? names.reduce((n, name) => n + (delete bucket.items[name] ? 1 : 0), 0)
        : Object.keys(bucket.items).length;
      if (!names.length) delete state.shoppingStatus[target];
      scheduleSave('shoppingStatus');
      return sendJSON(res, 200, { ok: true, data: { householdId: target, removed } });
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
      if (!requireAccountHousehold(req, res, note.householdId)) return;
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
      board.notes = board.notes.filter((n) => !(ids.has(n.id) && accountCanAccessHousehold(req, n.householdId)));
      scheduleSave('notes');
      return sendJSON(res, 200, { ok: true, data: { removed: before - board.notes.length } });
    }

    if (route[1]) {
      const note = findNote(route[1]);
      if (!note) return sendError(res, 404, '留言不存在');
      if (!requireAccountHousehold(req, res, note.householdId)) return;

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
    const voteDish = state.dishes.find((d) => d.id === dishId);
    if (!voteDish) return sendError(res, 404, '菜品不存在');
    if (voteDish.householdId && !requireAccountHousehold(req, res, voteDish.householdId)) return;
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
  // 写权限交给 canWrite：共享菜要管理员，本家菜管理员随便改、
  // 普通成员只能改自己添加的那几条。
  if (route[0] === 'dishes') {
    const id = route[1];
    if (method === 'POST' && route[2] === 'copy-to-shared' && id) {
      const src = state.dishes.find((dish) => dish.id === id);
      if (!src) return sendError(res, 404, '菜品不存在');
      const householdId = url.searchParams.get('householdId');
      if (!src.householdId || householdId !== src.householdId) {
        return sendError(res, 400, '请从当前家庭私房菜复制到共享菜单');
      }
      if (!requireAccountHousehold(req, res, householdId)) return;
      if (!isHouseAdmin(req, householdId)) return sendError(res, 403, '只有这个家庭的管理员可以添加菜谱到共享菜单');
      if (state.dishes.some((dish) => !dish.householdId && dish.copySourceDishId === src.id)) {
        return sendError(res, 409, '这道私房菜已经添加到共享菜单了');
      }
      const copy = copyDishToScope(src, null, req);
      if (!copy) return sendError(res, 400, '菜品无法复制');
      const bad = categoryProblem(copy);
      if (bad) return sendError(res, 400, bad);
      const ingredientProblem = dishIngredientReferenceProblem(copy, null);
      if (ingredientProblem) return sendError(res, 400, ingredientProblem);
      state.dishes.unshift(copy);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: publicDish(copy) });
    }
    if (method === 'PATCH' && route[2] === 'status' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      const dish = state.dishes[idx];
      // 共享菜由任一家庭管理员维护；私菜只能由所属家庭管理员维护。
      if (dish.householdId ? !isHouseAdmin(req, dish.householdId) : !canWriteShared(req)) {
        return sendError(res, 403, '只有管理员能修改菜品供应状态');
      }
      const body = await readBody(req);
      const next = safeText(body && body.dishStatus, 20);
      if (!['active', 'paused'].includes(next)) return sendError(res, 400, '菜品状态不对');
      dish.dishStatus = next;
      dish.updatedAt = nowISO();
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: publicDish(dish) });
    }
    if (method === 'POST' && !id) {
      const body = await readBody(req);
      const dish = normDish(body);
      if (!dish) return sendError(res, 400, '菜名不能为空');
      const ingredientProblem = dishIngredientReferenceProblem(dish, dish.householdId);
      if (ingredientProblem) return sendError(res, 400, ingredientProblem);
      // 归属和作者都以服务端为准：客户端写了也不算
      if (!dish.householdId && !canWriteShared(req)) {
        return sendError(res, 403, '往共享菜单加菜要管理员');
      }
      if (dish.householdId && !isHouseAdmin(req, dish.householdId) && !isMyMember(req, dish.householdId)) {
        return sendError(res, 403, '只能往自己家加菜');
      }
      const who = whoami(req, dish.householdId);
      dish.authorId = who.kind === 'member' ? who.memberId : dish.authorId;
      dish.authorUserId = who.userId || dish.authorUserId || '';
      dish.authorName = who.name || dish.authorName;
      const bad = categoryProblem(dish);
      if (bad) return sendError(res, 400, bad);
      state.dishes.unshift(dish);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: publicDish(dish) });
    }
    if (method === 'PUT' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      if (!canWrite(req, state.dishes[idx])) {
        return sendError(res, 403, writeDenied(state.dishes[idx]));
      }
      const dish = normDish(await readBody(req), state.dishes[idx]);
      const ingredientProblem = dishIngredientReferenceProblem(dish, dish.householdId);
      if (ingredientProblem) return sendError(res, 400, ingredientProblem);
      // 作者不许改：这条要是你写的，以后就一直是你的
      dish.authorId = state.dishes[idx].authorId;
      dish.authorUserId = state.dishes[idx].authorUserId || dishAuthorUserId(state.dishes[idx]);
      dish.authorName = state.dishes[idx].authorName;
      // 也不能把别人的私菜拽到共享区去 —— 那是管理员的动作
      if (!state.dishes[idx].householdId && dish.householdId && !canWriteShared(req)) {
        return sendError(res, 403, '把共享菜改成仅本家可见，要管理员');
      }
      const bad = categoryProblem(dish);
      if (bad) return sendError(res, 400, bad);
      state.dishes[idx] = dish;
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: publicDish(dish) });
    }
    if (method === 'POST' && route[2] === 'duplicate' && id) {
      const src = state.dishes.find((d) => d.id === id);
      if (!src) return sendError(res, 404, '菜品不存在');
      if (src.householdId && !requireAccountHousehold(req, res, src.householdId)) return;
      if (!canWrite(req, src)) return sendError(res, 403, writeDenied(src));
      // 副本跟原菜一个归属：复制我家私菜不该把它变成全体共享
      const copy = normDish({ ...src, id: '', name: src.name + '（副本）' });
      copy.isFavorite = false;
      const who = whoami(req, copy.householdId);
      copy.authorId = who.kind === 'member' ? who.memberId : '';
      copy.authorUserId = who.userId || '';
      copy.authorName = who.name || '';
      state.dishes.unshift(copy);
      scheduleSave('dishes');
      return sendJSON(res, 200, { ok: true, data: publicDish(copy) });
    }
    if (method === 'DELETE' && id) {
      const idx = state.dishes.findIndex((d) => d.id === id);
      if (idx < 0) return sendError(res, 404, '菜品不存在');
      if (!canWrite(req, state.dishes[idx])) {
        return sendError(res, 403, writeDenied(state.dishes[idx]));
      }
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
      if (nextOwner && !requireAccountHousehold(req, res, nextOwner)) return;
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
      if (state.categories[idx].householdId && !requireAccountHousehold(req, res, state.categories[idx].householdId)) return;
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
      const body = await readBody(req);
      const account = accountSessionOf(req);
      const requestedHouseholdId = safeText(body.householdId, 40);
      if (account && !requestedHouseholdId) {
        return sendError(res, 403, '请先选择一个已加入的家庭，再提交点餐');
      }
      if (account && !state.households.some((h) => h.id === requestedHouseholdId)) {
        return sendError(res, 404, '这个家庭不存在');
      }
      const order = normOrder({ ...body, householdId: requestedHouseholdId || body.householdId });
      if (!requireAccountHousehold(req, res, order.householdId)) return;
      if (order.dishId) {
        const dish = state.dishes.find((d) => d.id === order.dishId);
        if (dish && dish.dishStatus === 'paused') {
          return sendError(res, 409, '这道菜目前暂停供应，不能新建点餐');
        }
      }
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
      if (!requireAccountHousehold(req, res, order.householdId)) return;
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
      if (!requireAccountHousehold(req, res, resolveHouseholdId(hid))) return;
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
      state.orders = state.orders.filter((o) => !(ids.has(o.id) && accountCanAccessHousehold(req, o.householdId)));
      scheduleSave('orders');
      return sendJSON(res, 200, { ok: true, data: { removed: before - state.orders.length } });
    }
    if (method === 'DELETE' && id) {
      const idx = state.orders.findIndex((o) => o.id === id);
      if (idx < 0) return sendError(res, 404, '点餐不存在');
      if (!requireAccountHousehold(req, res, state.orders[idx].householdId)) return;
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
    const current = state.settings.currentHouseholdId;
    // 没有全局默认家庭时，汇总接口返回全部库存的总览，避免把第一户冒充当前家庭。
    const mine = current
      ? state.pantry.filter((p) => p.householdId === current)
      : state.pantry;
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
  loadDevices();
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
