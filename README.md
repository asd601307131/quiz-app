# 答题闯关 · 手机端答题应用（H5）

一个**零依赖、纯前端**的手机答题应用，打开即用：章节练习、随机组卷、限时模拟考试、错题本、成绩记录与用户体系。
默认数据全部存在浏览器本地（localStorage），不需要后端；需要微信登录或云端同步时，接上附带的示例后端即可。

```
Node >= 18 ｜ 无第三方依赖 ｜ 原生 ES Module + 原生 CSS ｜ 移动端优先适配
```

---

## 一、快速开始

```bash
cd quiz-app
npm run dev            # 等价于 node scripts/serve.mjs，默认 5173 端口
```

启动后终端会列出可用地址：

- `http://localhost:5173/` —— 电脑浏览器调试（建议开 F12 切到手机尺寸，如 iPhone 12）
- `http://<局域网IP>:5173/` —— **手机连同一 WiFi 直接打开**（地址由启动时实际网卡决定）

> 不需要 `npm install`，本项目没有第三方依赖。用 `npx serve` 或任何静态服务器托管也行。
> 注意：必须通过 http 服务打开（`file://` 直接双击 index.html 会因为 ES Module 的跨域限制报错）。

**地址打不开时的排查顺序**（都是实际踩过的坑）：

1. **先确认服务还活着**：终端窗口是否被关掉；重新 `npm run dev` 即可。
2. **手机打不开**：手机那个地址只有在「本机确实连了 WiFi/以太网」时才成立。
   如果本机走的是手机热点/蜂窝网络（网卡名如「手机网络」），或者 WiFi 显示 `Disconnected`，
   那个 IP 对本机之外没有意义，手机一定连不上——先让本机连上 WiFi，再重启服务看新地址。
3. **手机和电脑不在同一网络**（例如手机用流量）：需要内网穿透工具（cloudflared、ngrok 等），
   本服务的局域网地址无法跨网访问。
4. **手机连上了但一直转圈**：Windows 防火墙没放行 node 的入站，放行一次即可。
5. **换地址试试**：服务默认双栈监听，`localhost` / `127.0.0.1` / `[::1]` / 局域网 IP 都可用；
   只想本机访问、不想暴露到局域网时加 `--local`。

其他命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地静态服务（默认 5173，监听所有网卡） |
| `npm run dev -- 8080` | 指定端口 |
| `npm run dev -- 8080 --local` | 只监听回环，仅本机可访问 |
| `npm run dev -- 8080 --mock` | 额外开启 `/api/*` 模拟接口，验证「远端数据模式」 |
| `npm run check` | 题库 + 判分引擎自测（33 项断言，无需浏览器） |
| `npm run wechat` | 启动微信登录后端示例（见第五节） |
| `node scripts/e2e.mjs http://localhost:5173` | 用本机 Edge/Chrome 无头模式跑完整流程并截图 |

---

## 二、功能清单

**答题主线**

- 顺序答题：上一题 / 下一题、进度条、题号、题型与难度标签、标记本题
- 答题卡：题号宫格，区分已答/未答/答对/答错/已标记，点击题号直接跳题
- 练习模式：**作答即时判分**，立刻显示正确答案与解析，答错自动进错题本
- 考试模式：整卷倒计时、到时自动交卷、交卷前二次确认、交卷后统一判分
- 单选作答后可「自动下一题」（可在设置里关掉）

**组卷**

- 章节练习：5 个章节，逐章推进，记录每章练习进度
- 随机组卷：任选章节 × 难度组合，自定义题量（1–60）
- 模拟考试：自定义题量与时长（1–120 分钟），可选打乱选项顺序
- 错题复习：按错误次数排序，一键成套重练；复习答对自动移出错题本

**成绩与用户**

- 结果页：得分、正确率、用时、错题数、未作答数，**逐题解析**可回看每道题
- 成绩记录：历史列表 + 累计统计（答题数、正确率、最高分、累计用时、连续天数）
- 错题本：错误次数、上次错选、解析回顾，支持单题回顾与清空
- 用户体系：本地昵称/头像登录、微信一键登录（真实 OAuth 或本地演示）、退出登录、重置数据

**工程侧**

- 路由：hash 路由，10 个页面，支持浏览器前进/后退
- 安全：所有动态文本统一转义（`esc()`），无 `innerHTML` 拼接用户数据
- 适配：`viewport-fit=cover` + `env(safe-area-inset-bottom)` 适配刘海屏，`prefers-reduced-motion` 降级
- 兼容：localStorage 不可用（隐私模式）时自动降级到内存存储
- PWA：内含 `manifest.webmanifest`，可「添加到主屏幕」全屏运行

题库规模：**5 章节 / 60 道题**，含单选题、多选题、判断题，三种难度，每题带解析。

---

## 三、目录结构

```
quiz-app/
├─ index.html                     入口（含 meta viewport、PWA manifest 引用）
├─ manifest.webmanifest           PWA 配置
├─ package.json                   脚本入口（无依赖）
├─ src/
│  ├─ app.js                      路由表、视图分派、全局错误兜底、启动流程
│  ├─ styles/app.css              全部样式（设计变量 + 组件样式）
│  ├─ data/questions.js           题库：章节、题目、答案、解析
│  ├─ core/
│  │  ├─ engine.js                判分与组卷引擎（纯函数，可 Node 端测试）
│  │  ├─ store.js                 localStorage 封装 + 事件总线（成绩/错题/统计/设置）
│  │  ├─ state.js                 当前答题会话（跨页面共享）
│  │  └─ utils.js                 转义、时间格式化、洗牌等工具
│  ├─ ui/ui.js                    轻量 UI 基元：h() 建 DOM、顶部栏、标签栏、弹窗、Toast
│  ├─ services/
│  │  ├─ auth.js                  登录（本地 / 微信 OAuth / 演示模式）
│  │  └─ api.js                   数据访问层：本地优先，可切远端
│  └─ views/
│     ├─ home.js                  首页、章节、组卷设置、错题本、记录、我的、404
│     ├─ quiz.js                  答题页、答题卡、结果页、错题回顾
│     └─ login.js                 登录页
├─ server/wechat-login-server.mjs 微信网页授权后端示例（零依赖）
├─ scripts/
│  ├─ serve.mjs                   本地静态服务器（含可选 API Mock）
│  ├─ check.mjs                   题库 + 引擎自测
│  └─ e2e.mjs                     无头浏览器端到端验证 + 截图
└─ screenshots/                   e2e 产出的 17 张界面截图
```

---

## 四、路由表

| 路由 | 页面 |
| --- | --- |
| `#/home` | 首页（统计 + 四种模式入口 + 章节进度 + 最近记录） |
| `#/chapters` / `#/chapter/:id` | 章节列表 / 章节详情 |
| `#/setup/practice` / `#/setup/exam` | 随机组卷设置 / 考试设置 |
| `#/quiz/chapter/:id` | 章节顺序练习 |
| `#/quiz/random?c=&d=&n=` | 随机组卷练习（`c` 章节、`d` 难度、`n` 题量） |
| `#/quiz/exam?c=&d=&n=&t=` | 模拟考试（`t` 时长，分钟） |
| `#/quiz/wrong?ids=` | 错题复习 |
| `#/sheet` | 答题卡 |
| `#/result/:sessionId` | 成绩与逐题解析 |
| `#/review/:questionId` | 错题单题回顾 |
| `#/wrong` / `#/history` / `#/profile` / `#/login` | 错题本 / 记录 / 我的 / 登录 |

---

## 五、接入后端与微信登录

### 5.1 切到远端数据

前端默认走本地。在地址后加 `?api=<后端地址>` 即切换到远端模式（页面内所有数据请求改走后端接口）：

```
http://localhost:5173/?api=http://localhost:8787
```

也可以在 `index.html` 里写死：

```html
<script>window.__QUIZ_API_BASE__ = 'https://your-api.example.com';</script>
```

**接口约定**（字段与本地结构一致，见 `src/services/api.js`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 `{ ok: true }` |
| GET | `/api/chapters` | 章节列表（含 `stats`） |
| GET | `/api/questions?chapterId=&difficulty=` | 题目列表 |
| POST | `/api/sessions` | 保存成绩（记录对象整体上报） |
| POST | `/api/wrong` | 上报错题 `{ questionId, wrongCount }` |

前端对失败是**降级不阻断**的：远端接口异常会自动回退本地题库并打印警告，答题流程不受影响。

> 想在本地验证远端模式，用 `npm run dev -- 8080 --mock`，然后访问 `http://localhost:8080/?api=http://localhost:8080`。

### 5.2 微信网页授权登录

`server/wechat-login-server.mjs` 是一个零依赖的完整示例（适用于公众号内嵌 H5）：

```bash
# Windows PowerShell
$env:WECHAT_APPID='wx1234567890'; $env:WECHAT_SECRET='你的AppSecret'; $env:WEB_ORIGIN='http://localhost:5173'; npm run wechat

# macOS / Linux
WECHAT_APPID=wx... WECHAT_SECRET=... WEB_ORIGIN=http://localhost:5173 npm run wechat
```

流程：

1. 前端点击「微信一键登录」→ `GET /api/wechat/url?redirect=<当前页>` 拿到授权地址
2. 跳转微信授权（`snsapi_userinfo`），微信回跳 `GET /api/wechat/callback?code=&state=`
3. 后端用 code 换 `access_token` + `openid`，再拉取昵称头像，生成**一次性 ticket**（5 分钟过期）
4. 后端 302 回前端 `?wx_ticket=xxx`，前端 `GET /api/wechat/profile?ticket=xxx` 换取用户信息并完成登录

安全要点（示例里已实现，生产环境请再补）：`state` 防 CSRF、ticket 一次性且短时有效、每天定时清理过期票据。

### 5.3 未配置后端时的演示模式

没有后端也能完整演示用户体系：点「微信一键登录」会提示这是**演示模式**，在本地生成一个稳定的假 openid 并完成登录，之后「我的」页会标记为「微信登录（演示模式）」，不会误认为真实授权。

---

## 六、数据结构

题库（`src/data/questions.js`，与后端表结构对齐）：

```js
{
  id: 'js-04',
  chapterId: 'js',            // 章节 id
  difficulty: 'medium',       // easy | medium | hard
  type: 'single',             // single 单选 | multiple 多选 | judge 判断
  stem: '题干文本',
  options: ['选项A', '选项B', '选项C', '选项D'],   // 纯文本数组，字母按顺序派生
  answer: ['B'],              // 正确选项字母（多选可多项，顺序无关）
  analysis: '答案解析',
  tags: ['事件循环'],
}
```

> 约定：`options` 只存文本，选项字母 A/B/C/D 由顺序自动派生，避免字母与选项错位。
> 判断题固定 `options: ['正确', '错误']`。

本地存储键（`src/core/store.js`，统一前缀 `quizapp.v1.`）：

| 键 | 内容 |
| --- | --- |
| `quizapp.v1.user` | 当前用户（id、昵称、头像、来源） |
| `quizapp.v1.sessions` | 答题记录（最多保留 200 条，含逐题明细） |
| `quizapp.v1.wrong` | 错题本（错误次数、上次错选、时间） |
| `quizapp.v1.stats` | 累计统计（答题数、正确数、次数、最高分、连续天数） |
| `quizapp.v1.settings` | 设置（自动下一题、打乱选项、默认题量与时长） |

**判分规则**：每题等分，满分 100，保留 1 位小数；多选题采用「全对才得分」；未作答计入 `unanswered` 且不得分。

---

## 七、测试与验证

```bash
npm run check      # 题库结构与判分引擎：33 项断言
```

覆盖：题目 id 唯一性、字段完整性、答案与题型匹配（单选 1 项、多选 ≥2 项、判断 2 选 1）、
选项字母范围、章节统计一致性、答案归一化（去重/排序/过滤空值）、
章节与难度筛选、错题重练取题、全对/全错/全空的边界判分。

```bash
node scripts/e2e.mjs http://localhost:5173
```

用本机 Edge/Chrome 无头模式、390×844 手机视口真实渲染，走完 8 组场景（首页 → 章节练习即时反馈 →
自动下一题开关 → 答题卡 → 交卷判分与逐题解析 → 错题本/记录 → 限时考试与交卷确认 → 我的/登录），
**27 项断言全部通过**，并把每一步截图到 `screenshots/`（17 张）。

最近一次实测结果：

```
题库 + 引擎自测：33 通过, 0 失败
端到端验证：    27 通过, 0 失败（页面无 JS 报错）
```

---

## 八、部署

纯静态产物，把 `quiz-app/` 目录整体上传到任意静态托管（Nginx、OSS+CDN、Vercel、Netlify、GitHub Pages）即可。
要点：

1. 启用 HTTPS —— 微信授权与后续接口都要求 HTTPS；
2. 若托管在子路径（如 `example.com/quiz/`），使用相对路径引用（本项目已经是相对路径），无需额外配置；
3. 需要「刷新不 404」时，把未知路径回退到 `index.html`（本项目用 hash 路由，通常不需要）；
4. 生产环境建议把 `?api=` 换成写死域名，避免用户手动传参；
5. 需要云端成绩与真实用户体系时，把 `scripts/serve.mjs` 里的 Mock 换成真实后端，按第五节的接口约定实现即可。

---

## 九、已知边界

- 默认纯本地存储：同一浏览器内数据完整，**换设备/清缓存后不保留**；需要跨端请接后端（第五节）。
- 答题会话只在当前页面生命周期内有效：中途退出会提示「本次作答不会保存」，这是有意设计，避免出现半份答卷。
- 判分为「每人每题等分」的简化模型，如需按题型/难度加权、部分给分、防作弊（切屏检测、限时单题），在 `src/core/engine.js` 的 `gradeSession` 与 `src/views/quiz.js` 上扩展即可。
- 未做题目乱序的分层抽样（目前是等概率随机抽题），如需按难度配比组卷，在 `buildPaper` 中按 `difficulty` 分组抽取即可。
