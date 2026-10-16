# 全局用户账户与家庭流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有家庭菜单服务中加入全局用户账户、跨家庭成员关系、5 户上限和绑定账号的 12 小时超级管理员授权，同时完成登录门禁、菜单/设置导航和便携版发布。

**Architecture:** `users.json` 保存全局用户身份，家庭成员关系继续兼容现有 `households.members` 并增加 `userId`。账户会话使用 `X-Account-Token`，普通家庭权限从当前用户与家庭关系计算；输入全局 `adminPin` 后签发绑定当前账号和设备、固定 12 小时的 `X-Auth-Token` 超级授权。服务端做最终权限裁判，前端只负责登录门禁、角色展示和入口隐藏。

**Tech Stack:** Node.js 原生 HTTP、JSON 文件存储、原生 JavaScript 单页前端、现有 `_selftest.js`/`_packtest.js`/`publish-selftest.js`、PowerShell、Git。

---

## 文件边界

- **Modify `server.js`**：用户存储/迁移、账户注册登录、账户令牌、超级授权、家庭上限、家庭成员关系和权限桥接。
- **Modify `public/app.js`**：新设备登录/注册门禁、账户令牌请求头、家庭选择、菜单和设置导航、超级授权提示。
- **Modify `public/index.html`**：底部导航名称与登录/家庭入口容器。
- **Modify `public/styles.css`**：登录页、家庭选择、账户设置和角色提示样式。
- **Modify `_selftest.js`**：账户、迁移、5 户上限、超级授权绑定和过期测试。
- **Modify `README.md`**：新用户流程、全局管理口令与 12 小时账号授权说明。
- **Modify `package.json` / `server.js` release log**：版本同步。
- **Generate `package/家庭菜单-便携版/` and ZIP**：最终源代码的发布产物。

## Task 1：先写账户与超级授权失败测试

**Files:**
- Modify: `_selftest.js`
- Test target: temporary server instance spawned by `_selftest.js`

- [ ] **Step 1: 扩展请求辅助函数支持账户令牌**

在 `req()` 和 `reqRaw()` 的参数中增加 `account`，发送 `X-Account-Token`；新增：

```js
async function registerAccount(loginId) {
  const r = await post('/api/account/register', { loginId });
  return { status: r.status, token: r.body?.data?.accountToken, user: r.body?.data?.user, body: r.body };
}

async function loginAccount(loginId, password = '123456') {
  const r = await post('/api/account/login', { loginId, password });
  return { status: r.status, token: r.body?.data?.accountToken, user: r.body?.data?.user, body: r.body };
}

async function authorizeSuper(pin, account) {
  const r = await post('/api/auth', { pin }, undefined, undefined, undefined, undefined, undefined, account);
  return { status: r.status, token: r.body?.data?.token, body: r.body };
}
```

保留旧的 `claim()`/`houseAuth()` 辅助函数，直到兼容迁移测试完成。

- [ ] **Step 2: 写账户注册、登录和默认凭据的失败测试**

在权限章节新增断言：

```js
const account = await registerAccount();
ok('注册自动生成登录 ID', account.status === 200 && /^用户-/.test(account.user.loginId));
ok('注册默认密码是 123456', (await loginAccount(account.user.loginId)).status === 200);
eq('错误账户密码被拒', (await loginAccount(account.user.loginId, 'wrong-password')).status, 401);
ok('用户响应不回传密码', account.user.password === undefined && account.user.passwordHash === undefined);
```

- [ ] **Step 3: 写超级授权必须绑定账户的失败测试**

设置全局管理口令后，测试没有账户令牌时拒绝，带正确账户令牌时成功，并能跨家庭修改：

```js
eq('没有账户令牌不能成为超级管理员', (await authorizeSuper('root-pin')).status, 401);
const superAuth = await authorizeSuper('root-pin', account.token);
eq('账户输入全局令牌成为超级管理员', superAuth.status, 200);
ok('超级授权令牌非空', typeof superAuth.token === 'string' && superAuth.token.length > 20);
```

- [ ] **Step 4: 写超级授权账号绑定和固定过期失败测试**

在测试服务器环境设置 `SUPER_GRANT_TTL_MS=80`，注册第二个账户；用第一个账户的超级令牌配第二个账户令牌访问受保护接口应返回 401，等待超过 80ms 后第一个账户的超级令牌也应返回 401。

- [ ] **Step 5: 运行测试确认新增测试失败**

Run: `node _selftest.js`

Expected: 新增账户接口返回 404 或超级授权绑定断言失败；保留失败输出，进入实现步骤。

## Task 2：实现用户存储、账户会话和数据迁移

**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: 增加 `users.json` 和默认状态**

在 `FILES` 中加入 `users: 'users.json'`，在 `defaultState()` 中加入 `users: []`。`loadState()` 用空数组兜底，并让 `saveNow()` 通过现有持久化循环写出 `users.json`。

- [ ] **Step 2: 增加密码摘要和用户规范化函数**

使用 Node `crypto.scryptSync`，格式固定为 `scrypt$<salt>$<digest>`；新增函数：

```js
function hashUserPassword(password) { /* random salt + scryptSync */ }
function verifyUserPassword(password, encoded) { /* timingSafeEqual */ }
function normalizeUser(input, prev) { /* id/loginId/displayName/emoji/passwordHash */ }
function generatedLoginId() { /* 用户- + 4 位随机大写字母数字，循环保证全局唯一 */ }
```

登录 ID 全局唯一，`safeText(..., 32).trim()` 后拒绝控制字符；注册缺省 ID 时调用 `generatedLoginId()`。

- [ ] **Step 3: 从现有家庭成员迁移全局用户**

在 `loadState()` 家庭规范化之后执行一次幂等迁移：

1. 有 `userId` 的成员复用对应用户。
2. 没有 `userId` 的旧成员按稳定 `member.id` 建立用户。
3. 旧 `password`/`pin` 转成 `passwordHash`；为空时使用默认 `123456` 的摘要，并标记 `legacyDefaultPassword: true`。
4. 全局登录 ID 冲突时追加 `-2`、`-3`，不按显示名合并。
5. 成员补上 `userId`，保留原成员 `id`、角色、作者关联和历史字段。
6. 迁移结果通过 `scheduleSave('users')` 与 `scheduleSave('households')` 落盘，重复启动不新增重复记录。

- [ ] **Step 4: 增加账户会话解析**

增加 `ACCOUNT_TTL = 30 * 24 * 60 * 60 * 1000` 和 `accountSessionOf(req)`，令牌从 `X-Account-Token` 读取，scope 为 `{ kind: 'account', userId, deviceId }`。账户令牌可滑动续期 30 天；注销或密码变更时撤销该用户全部账户令牌。

- [ ] **Step 5: 实现账户注册、登录、当前账户和退出接口**

在统一守卫之前增加：

- `POST /api/account/register`：缺省生成登录 ID，固定初始密码 `123456`，返回 `accountToken` 和不含密码的用户资料。
- `POST /api/account/login`：校验全局登录 ID 与密码，返回账户令牌、用户资料和可加入家庭摘要。
- `GET /api/account/me`：只接受账户令牌，返回当前用户和家庭关系。
- `POST /api/account/logout`：撤销当前账户令牌和绑定的超级授权。

- [ ] **Step 6: 运行账户测试确认通过**

Run: `node _selftest.js`

Expected: 注册、默认密码、错误密码、密码不回传、迁移幂等测试通过；超级授权测试暂时仍可能失败。

## Task 3：实现账号绑定的 12 小时超级管理员授权

**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: 改造全局 `/api/auth`**

保持请求体 `{ pin }` 兼容，但新增要求：当 `adminPin` 已设置时必须带有效 `X-Account-Token`。校验成功后签发 scope：

```js
{
  kind: 'super',
  userId: account.scope.userId,
  accountToken: account.token,
  deviceId: account.scope.deviceId,
  issuedAt: Date.now(),
  fixedExp: Date.now() + SUPER_GRANT_TTL_MS,
}
```

`SUPER_GRANT_TTL_MS` 默认 `12 * 60 * 60 * 1000`，仅测试时通过环境变量缩短。

- [ ] **Step 2: 让超级会话固定过期且绑定账户**

修改 `sessionOf()`：超级 scope 使用 `fixedExp`，不执行现有滑动续期；同时检查当前请求的账户令牌与 scope 中的 `accountToken`、`userId` 一致。`isSuperAdmin(req)` 只有在 `adminPin` 为空（兼容开放模式）或绑定检查通过时返回 true。

- [ ] **Step 3: 修改口令时撤销所有超级授权**

在 `PUT /api/settings` 修改或清除 `adminPin` 时清除所有 `kind: 'super'` 会话；账户会话继续保留。前端重新输入令牌后才能恢复超级权限。

- [ ] **Step 4: 完成绑定与过期测试**

Run: `node _selftest.js`

Expected: 没账户令牌拒绝、正确账户令牌成功、令牌不能跨账户使用、等待 TTL 后失效、修改全局口令使旧授权失效。

## Task 4：接通家庭关系、5 户上限和服务端数据范围

**Files:**
- Modify: `server.js`
- Test: `_selftest.js`

- [ ] **Step 1: 增加用户所属家庭和当前成员解析**

新增：

```js
function membershipsOf(userId) { /* households.members 中 userId 匹配 */ }
function memberForUser(householdId, userId) { /* 返回关系成员 */ }
function householdCountForUser(userId) { return membershipsOf(userId).length; }
function requireAccount(req) { /* 返回 account session 或 401 */ }
```

旧的 `X-Device-Token` 继续兼容；新账户令牌通过 `memberForUser()` 映射到当前家庭成员，使现有私菜作者和角色守卫继续工作。

- [ ] **Step 2: 让创建家庭和批准成员遵守 5 户上限**

家庭创建接口在写入前检查当前用户成员关系数 `< 5`，否则返回 409；创建者写入 `owner` 关系和 `userId`。批准加入申请前检查申请人账户的有效家庭数 `< 5`，超过时保留申请并返回可理解错误。

- [ ] **Step 3: 改造加入申请为用户关系**

申请记录增加 `applicantUserId`；新申请必须有账户令牌。批准时按 `applicantUserId` 写入成员关系，重复申请按家庭与用户去重；旧的按姓名申请继续读但不再创建无账户成员。

- [ ] **Step 4: 收紧状态和跨家庭数据**

`GET /api/state` 在账户模型启用后要求账户令牌；普通用户只返回已加入家庭、当前家庭私菜/点餐/库存/计划/留言和共享菜单；超级授权返回全部数据。无账户只允许调用登录、注册、版本和健康检查接口。

- [ ] **Step 5: 写家庭上限和权限回归测试**

覆盖：创建者自动 owner、创建家庭不需要超级口令、加入第 6 户返回 409、普通用户看不到未加入家庭私菜/点餐、超级授权可跨家庭管理、最后管理员不能退出或降级。

## Task 5：前端登录门禁、账户工作区和导航

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`

- [ ] **Step 1: 增加账户令牌存储和请求头**

增加 `familyMenu.accountToken`，`api()` 自动发送 `X-Account-Token`；超级授权仍发送 `X-Auth-Token`。账户令牌失效时清空本地令牌并回到登录视图，不能静默展示旧家庭数据。

- [ ] **Step 2: 增加登录/注册视图**

在 `render()` 前检查账户令牌；无令牌时只渲染登录/注册卡片。注册表单允许空登录 ID（显示自动生成结果），密码空值使用 `123456`，并显示风险提示；登录成功后加载账户和家庭摘要。

- [ ] **Step 3: 增加家庭选择、创建和退出家庭入口**

登录后无当前家庭时显示“我的家庭”页；家庭切换写入现有 `LS_HOUSE`。创建家庭成功自动选中并显示“家庭管理员”；加入第 6 户时显示服务端返回的上限提示。

- [ ] **Step 4: 固定六栏导航**

`public/index.html`/`render()` 的顺序固定为：菜单、计划、点餐、留言、库存、设置。移除单独的“管理”底部栏目，把家庭、成员、加入申请、账户和平台配置卡片放进设置页；普通用户隐藏管理员卡片。

- [ ] **Step 5: 增加超级授权入口和状态提示**

设置页提供“输入全局管理令牌”入口；成功后显示“超级管理员 · 还剩约 X 小时”，到期后自动回到原角色。输入令牌只调用 `/api/auth`，不把令牌保存到用户资料；退出账户时清理账户和超级令牌。

- [ ] **Step 6: 运行前端语法检查**

Run: `node --check public/app.js`

Expected: exit code 0。

## Task 6：文档、版本和完整回归

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `server.js` release log
- Test: `_selftest.js`, `_packtest.js`, `publish-selftest.js`

- [ ] **Step 1: 更新 README 使用流程**

补充新设备登录/注册、自动登录 ID、默认密码 `123456` 风险提示、5 户上限、创建家庭立即成为管理员、全局管理令牌绑定当前账号 12 小时和超级管理员全部权限。

- [ ] **Step 2: 同步版本与更新日志**

将 `package.json.version`、`APP_VERSION` 和 `RELEASES[0]` 更新为同一个新版本，并列出全局账户、家庭上限、超级授权和导航调整。

- [ ] **Step 3: 运行完整验证**

Run:

```powershell
node --check server.js
node --check public/app.js
node _selftest.js
```

Expected: 两个语法检查 exit 0，服务端自测失败 0 项。

- [ ] **Step 4: 构建和检查便携版**

Run:

```powershell
node build-package.js
node _packtest.js
node publish-selftest.js
```

Expected: 便携版冷启动成功，包内不含真实账户、令牌、`orders.json`、`pantry.json`、API Key、备份和临时文件。

- [ ] **Step 5: 提交并推送**

确认 `git diff --check` 通过，只暂存源代码、测试和文档；提交消息使用 `feat: add global accounts and bound super admin sessions`，然后执行 `git push origin main`。若网络仍不可用，保留本地提交并记录远端未更新，不修改业务代码来绕过网络问题。

## 验收清单

- [ ] 新设备无账户令牌时只显示登录/注册，不显示家庭数据。
- [ ] 注册自动生成可修改 ID，默认密码 `123456` 可登录且有风险提示。
- [ ] 一个账户最多加入 5 个有效家庭，创建家庭立即成为 owner。
- [ ] 账户跨家庭切换不需要重新认领成员。
- [ ] 普通成员只能维护自己的私菜；家庭管理员能管理本家；超级管理员能管理所有家庭和平台配置。
- [ ] 超级授权必须同时绑定当前账户和设备，固定 12 小时后失效。
- [ ] 修改/清除全局管理口令会撤销所有超级授权。
- [ ] 菜单是第一栏，设置是最后一栏。
- [ ] 旧数据迁移幂等，作者、家庭和历史记录不丢。
- [ ] `_selftest.js`、语法检查、便携版冷启动和发布自检全部通过。
