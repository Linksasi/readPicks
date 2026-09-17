# ReadPicks（拾词）项目完全理解指南

> 面向从零开始接触本项目的人：技术栈、整体架构、每一条核心数据流的端到端走读、核心函数索引、设计决策与踩坑。
> 配套阅读：`AGENTS.md`（约定与命令，更新代码前必读）、`mobile/README.md`（手机端专项）、`PLAN.md`（早期规划）。
> **第一次读源码？直接跳到 §15「源码阅读路径」，读完想提炼套路再看 §16「值得学习的点」。**

---

## 1. 这个项目是什么

**拾词 ReadPicks** = 桌面/移动双端划词查词工具 + 生词积累复习系统。选中英文单词/短语 → 悬浮卡即时弹出释义，自动带出**该词所在的段落/句子**做语境理解，查询自动进入生词本，用 **SM-2 间隔重复算法**安排复习，可导出 Anki。

一个产品理念贯穿全部代码（评估任何功能取舍时先问它服务哪一条）：

| 理念 | 在代码里的体现 |
|---|---|
| ① 不背中文意思，用英语理解英语 | 查词卡/复习卡英文释义渲染在中文之上；测过词汇量后中文释义自动折叠、弱化为灰色兜底（`popup.js:66`、`review.js:52`） |
| ② 真实语境 | 取词时自动带出所在段落（UIA TextPattern 扩展选区）；剪贴板历史回溯找语境句；整句翻译 + 「该词在本句的译法」+ 挖空复习（`{{c1::word}}`） |
| ③ 个性化 | 词汇量自测（60 题桶估计）→ 释义用词难度按用户水平标注 → 难词就地化解（点击浮层看简释，不用跳走） |
| ④ 不打扰阅读 | PC：UIA 直读不碰剪贴板、悬浮窗 `showInactive()` 不抢焦点、离线秒查。手机：悬浮卡浮在源应用上，关闭即回到阅读处 |
| ⑤ 阅读即积累 | 每次查词必落一条事件入库，SM-2 自动安排到期，托盘菜单常驻「今日复习（N）」 |

**两端各自独立可用**是硬性要求：手机端不依赖电脑也能查词/入库/复习（离线 mini 词典 + IndexedDB + LLM 直连），同步（`main/sync.js`）只做数据互通。

---

## 2. 技术栈总览

| 层 | 技术 | 用途 |
|---|---|---|
| PC 壳 | **Electron 37**（CommonJS，无构建系统，纯 JS 直写） | 桌面应用、三窗口、托盘 |
| PC 数据库 | **better-sqlite3**（同步 API） | 学习库 `words.db`（生词 + 事件流）+ 只读挂载词典库 |
| 间隔重复 | **supermemo**（npm 包，SM-2 实现） | 复习调度 |
| 本地词典 | **ECDICT**（官方 SQLite，851MB，`stardict` 表 76 万词条 + `lemma.en.txt` 词形还原） | 离线释义、词频(bnc)、柯林斯/牛津标注 |
| 翻译 | MyMemory（免费默认）/ 有道 / 百度 / DeepL / 任意 OpenAI 兼容 LLM | 在线兜底 + 语境解释 |
| 同步 | Node 原生 `http`（无框架），端口 9723，token 鉴权 | 局域网双向增量同步；同时静态托管手机页 |
| 二维码 | qrcode-generator（纯属性 SVG，符合 CSP） | 手机配对 |
| 手机 Web | 原生 HTML/CSS/JS，**无构建系统**，全局脚本约定 `rpdb/rpsync/rpllm/rpend/rpvocab/rpuuid` | 浏览器直用 + APK 共用同一份 `mobile/www` |
| 手机数据 | **IndexedDB**（`readpicks` 库） | 与 PC 同 schema 语义 |
| 安卓壳 | **Capacitor 8**（`mobile/android/`），JDK 21 | APK 封装 + 自定义原生插件 |
| 安卓原生 | 6 个 Java 类（划词入口/悬浮卡/无障碍语境/悬浮球/TTS） | 系统级取词能力 |

无 TypeScript、无前端框架、无打包器——所有渲染层都是「HTML + 外链 CSS + 全局 JS」，测试脚本用 `npx electron` 跑（better-sqlite3 编译到 Electron ABI，不能用 node 跑）。

---

## 3. 全景架构图

```
                       ┌────────────────── PC（Electron，Windows）──────────────────┐
                       │                                                           │
 全局热键 Alt+Q ──► main/hotkey.js ──取词──► main/index.js handleQuery() ─┐        │
   ① UIA 直读（常驻 PowerShell 跑 scripts/uia.ps1，不碰剪贴板，带段落）    │        │
   ② 回退：模拟 Ctrl+C + 剪贴板快照恢复                                   ▼        │
                       │                        ┌── ecdict.js    本地词典查询 ─┐        │
                       │                        ├── context.js   语境回溯（剪贴板历史+挖空）│
                       │                        ├── translate.js 翻译/LLM 适配（带缓存）──► 网络
                       │                        ├── en-def.js + vocabtest.js 词汇量/英英释义/难词
                       │                        └── db.js      学习库 words.db（words+queries）│
                       │                                      │                            │
                       │  悬浮窗 payload ◄── main/window.js showPopup()                     │
                       │      │                                                            │
                       │  renderer/popup.{html,js,css}（单词卡/句译卡）                      │
                       │  renderer/review.*（复习）   renderer/settings.*（设置）            │
                       │      └── window.tranen（preload.js contextBridge，唯一 IPC 通道）   │
                       │                                                                   │
                       │  main/sync.js —— HTTP :9723                                        │
                       │     POST /api/sync    push+pull 一次往返（LWW + uuid 并集）          │
                       │     POST /api/lookup  手机查词（复用 PC 词典与释义逻辑）             │
                       │     /app/             静态托管 mobile/www（扫码即用）               │
                       └──────────────────────────────┬────────────────────────────────────┘
                                                      │ 同一 Wi-Fi，x-sync-token 鉴权
                          ┌───────────────────────────┴───────────────────────────┐
                          │ 手机浏览器（扫码直用）          安卓 APK（Capacitor 8）│
                          │  同一份 mobile/www：            + 原生层：             │
                          │  app.js（复习/查词/词表/设置）   CardActivity 悬浮卡    │
                          │  db.js（IndexedDB 数据层）      无障碍语境服务          │
                          │  sync.js（同步客户端）          悬浮球服务              │
                          │  llm.js（LLM 直连）            ProcessText 插件(TTS等) │
                          │  en-def/vocab（mini 词典版算法）                        │
                          └────────────────────────────────────────────────────────┘
```

---

## 4. 目录结构导览

```
ReadPicks/
├─ main/                     # Electron 主进程
│  ├─ index.js               # 入口：查询管线 handleQuery、IPC 注册、托盘、生命周期
│  ├─ hotkey.js              # 全局热键 + 取词（UIA 优先/剪贴板回退 + 常驻 PowerShell 通道）
│  ├─ db.js                  # SQLite 学习库 + SM-2 + 同步合并函数
│  ├─ sync.js                # 局域网同步服务端 + 手机查词端点 + 静态托管
│  ├─ ecdict.js              # ECDICT 本地词典查询/lemma 词形还原/释义解析
│  ├─ translate.js           # 翻译多 provider 适配 + LLM + 结果缓存
│  ├─ context.js             # 剪贴板历史回溯（找语境句）+ 挖空
│  ├─ vocabtest.js           # 词汇量自测（分桶抽样）+ 难词判定
│  ├─ en-def.js              # 英英释义构建（词典 + 词汇水平 → senses/hard/hints）
│  ├─ window.js              # 三窗口管理（悬浮窗状态机：pin/busy/drag 保护）
│  ├─ config.js              # config.json 读写（固定 %APPDATA%/readpicks）
│  └─ clipboard-watch.js     # 剪贴板轮询（记录语境 + autoPopup）
├─ preload.js                # contextBridge 暴露 window.tranen（renderer 唯一 API）
├─ renderer/                 # 三个窗口：popup / review / settings（各 html+css+js）
├─ mobile/
│  ├─ www/                   # 手机端 Web（浏览器与 APK 共用，无构建系统）
│  │  ├─ boot.js             # ES5 启动诊断（白屏自诊断 + UUID 回退）
│  │  ├─ app.js              # 主逻辑：四 tab（复习/查词/词表/设置）+ 悬浮卡模式
│  │  ├─ db.js               # IndexedDB 数据层（window.rpdb）
│  │  ├─ sync.js             # 同步客户端（window.rpsync）
│  │  ├─ llm.js              # LLM 直连（window.rpllm，APK 内走 CapacitorHttp 免 CORS）
│  │  ├─ en-def.js / vocab.js# mini 词典版英英释义/词汇量算法（IIFE，window.rpend/rpvocab）
│  │  └─ dict/mini.json      # 离线瘦身词典（build-mini-dict.js 生成，gitignore）
│  ├─ android/               # Capacitor 8 安卓工程
│  │  └─ app/src/main/java/com/readpicks/app/
│  │     ├─ MainActivity.java        # 主入口，转发 PROCESS_TEXT
│  │     ├─ CardActivity.java        # 划词悬浮卡（对话框式半透明 Activity）
│  │     ├─ ProcessTextPlugin.java   # Capacitor 插件：划词事件/TTS/剪贴板/卡片尺寸/悬浮球
│  │     ├─ SelectionPlugin.java     # Capacitor 插件：读无障碍语境缓存
│  │     ├─ ReadPicksAccessibilityService.java # 无障碍：监听文本选择缓存全文
│  │     ├─ SelectionHolder.java     # 进程级语境缓存（静态字段）
│  │     └─ FloatingBallService.java # 全局悬浮球（SYSTEM_ALERT_WINDOW 前台服务）
│  └─ capacitor.config.json
├─ scripts/
│  ├─ uia.ps1                # UIA 取词 PowerShell（必须 UTF-8 BOM）
│  ├─ build-mini-dict.js     # ECDICT → 手机端 mini.json
│  ├─ download-dict.js       # ECDICT 下载安装（断点续传/本地 zip 导入）
│  ├─ smoke-test.js / gui-test.js / uia-test.js / sync-test.js  # 测试（npx electron 跑）
│  └─ check-mobile-globals.js# 检查手机端全局脚本顶层 const 撞名（防白屏）
└─ 数据目录（不在仓库）：%APPDATA%/readpicks/
   ├─ words.db               # 学习库
   ├─ config.json            # 配置（含 sync token）
   ├─ clipboard-history.json # 语境历史
   ├─ ecdict/ecdict.db       # 851MB 词典（绝对不能删！）
   └─ uia.ps1                # 运行时从 asar 释放出来的取词脚本
```

---

## 5. PC 端（Electron）核心机制

### 5.1 进程模型与 IPC 安全

- 主进程 `main/index.js` 是一切能力的持有者；三个 renderer 窗口（popup/review/settings）通过 `preload.js` 的 `contextBridge` 拿到 `window.tranen`——这是 renderer 访问系统能力的**唯一**通道（contextIsolation + sandbox: true，renderer 禁止 `require('electron')`）。
- 所有 IPC handler 必须经 `handleIpc`/`onIpc`（`main/index.js:195-213`）注册，内部用 `isTrustedSender` 校验 `event.senderFrame.url` 必须是 `file://…/renderer/`——防止被注入的页面滥用主进程能力。
- CSP 约束：HTML 里**不能内联 `<style>` 或 style 属性**（`style-src 'self'` 会被拦截），样式一律外链 `.css`。

### 5.2 查询管线（最重要的数据流）

入口 `handleQuery(raw)`（`main/index.js:24`），一次完整查词：

```
原始文本
  │ cleanText()  hotkey.js:220 —— 去首尾引号括号/标点、PDF 断行合并（行尾连字符拼接）
  │ classify()   hotkey.js:242 —— 单词(≤50字符)/短语(≤5个纯字母词)=word，否则=sentence
  │ word 一律 toLowerCase（"Apple"/"apple" 合一，专名显示以语境句为准）
  ▼
context.push(text)                       # 原文进剪贴板历史（语境候选）
windowMgr.showPopup({loading:true})      # 立即弹「查询中」，查询后台并行（感知零延迟）
  ▼
kind==='word' → lookupWord()             # main/index.js:58，见下
kind==='sentence' → translateText()      # 纯整句翻译
  ▼
seq !== querySeq ? 丢弃 : showPopup()    # 慢查询过期丢弃，旧结果不覆盖新查询（querySeq 单调递增）
```

`lookupWord(word)`（`main/index.js:58-168`）组装单词卡 payload，多源汇合：

1. **本地词典** `ecdict.lookup()`：音标/中文释义/柯林斯星级/牛津3000/标签。若用户测过词汇量，`buildEnDefinition()`（`main/en-def.js:9`）追加英英释义区 + 难词标注 + 难词浮层提示 + `wordLevel`（该词相对用户的难度徽章）。
2. **语境回溯** `context.findContext(word)`：从剪贴板历史找包含该词的句子 → `makeCloze()` 挖空 → `translate.lookupInContext()`：LLM 时返回整句译 + 词中译法 + 译法解释 + 用法 + 句中生词 + `simple_def`（简单英语释义）；非 LLM 时只做整句翻译。
3. **兜底链**：词典未收录也无语境 → 在线翻译该词；有 LLM 且无语境 → 单独 `simpleDefinition()` 生成 COBUILD 风格一句英文释义。
4. **入库**：`dict || definition || wordInSentence` 至少一个有值才 `db.recordLookup()`（专有名词/乱码不污染生词本），返回查询次数/首次时间/历史。

### 5.3 取词：UIA 直读 + 剪贴板快照回退（`main/hotkey.js`）

这是本项目最有技术含量的部分之一，目标是「不碰剪贴板 + 顺带拿语境段落」：

**常驻 PowerShell 通道**（`ensurePs`/`sendCommand`，`hotkey.js:27-68`）：应用启动后 spawn 一个 `powershell.exe -Command -`（stdin 持续写入命令），生命周期内只启动一次，避免每次取词 400ms+ 的进程开销。命令以 `; Write-Output '__DONE__'` 结尾，stdout 按 `__DONE__` 标记切包回传；`psQueue` Promise 链保证命令串行，2s 保险超时。

**UIA 直读**（`grabViaUia` → `scripts/uia.ps1` 的 `Get-TranenSelection`）：
- P/Invoke `GetForegroundWindow()` → `AutomationElement.FromHandle` 拿前台窗口根元素；
- BFS 遍历控件树（上限 1500 个元素防卡死），对每个元素 `TryGetCurrentPattern(TextPattern)`；
- `GetSelection()` 有真实选中文本才算命中（地址栏空选区跳过）；
- 命中后把选区 `ExpandToEnclosingUnit(Paragraph)` 扩展拿所在段落（失败降级 Line，截 4000 字符）→ 这就是「选中一个词自动带出整段」的来源；
- JS 侧 1200ms 超时快速放弃（卡 UIA 时立即走回退，避免热键无响应）。

**剪贴板回退**（`grabSelection` 后半段，`hotkey.js:170-213`）：UIA 失败（不支持 TextPattern 的应用，如部分游戏/PDF）时——
1. 快照剪贴板全部格式（text/html/image/bookmark）→ 清空 → 发 `SendKeys('^c')`；
2. 每 40ms 轮询剪贴板（通常 50-150ms 读到，上限 800ms，失败重试一轮）；
3. **恢复快照**（按 image > html > text 优先级写回），用户剪贴板无感；
4. `watchSync(snap.text)` 通知 clipboard-watch 对齐基准，防止恢复内容被误当成新复制。

`onHotkey`（`hotkey.js:146`）：先弹「取词中」，3 秒内相同文本去重，`isSimulating` 重入保护。

> 记忆点（AGENTS.md/历史经验）：UIA 依赖前台应用支持 TextPattern（浏览器、Office、记事本等支持；自绘渲染的应用不支持）。「PC 语境失效」先查 `clipboard-history.json` 与运行日志再改码。

### 5.4 语境系统（`main/context.js`）

剪贴板历史回溯是「语境永远在场」的 PC 侧支柱：
- `push()`：最近 50 条复制记录，内存 + 防抖 1.5s 持久化到 `clipboard-history.json`；启动时 `init()` 加载（时间戳重置为当前，视为最近语境）。
- `findContext(word)`：从最新往回找 10 分钟内的文本，拆句（`.!?;。\n` 等）后用 `containsWord()` 匹配——先精确词边界，再经 **lemma 词形还原**匹配原形（复制的是 "was" 也能命中含 "be" 的句子？不，反着：查 "ran" 能通过 lemma 命中含 "run" 的句子）。排除查询词自身、句子必须比词长。
- `makeCloze()`：首个词边界命中替换为 `{{c1::word}}`（Anki 挖空语法），复习卡渲染成横线。

### 5.5 本地词典（`main/ecdict.js`）

- 只读挂载 `%APPDATA%/readpicks/ecdict/ecdict.db`（官方 ECDICT SQLite，`stardict` 表）。
- `lookup()` 三级尝试：小写精确 → lemma 还原原形 → 原样大小写。lemma 表来自 `lemma.en.txt`（格式 `be/4109826 -> is,was,are,...`，启动时解析成 `Map<变形, 原形>`）。
- `parseTranslation()`：中文释义 `"n. 苹果\nv. 认可"` → `[{pos, def}]`。
- `parseDefinition()`：英文释义（WordNet 格式）按行 + 行内多义项二次切分（`"n. xxx n. yyy"`），上限 8 条每条 140 字符——供英英释义区渲染。

### 5.6 翻译适配层（`main/translate.js`）

- `translateSentence()`（整句）：mymemory（免费默认）/ youdao（SHA256 v3 签名）/ baidu（MD5 签名）/ deepl（free/pro 双 host）/ llm。导出时包 `withCache`（10 分钟 TTL、200 条 LRU 淘汰）。
- `lookupInContext()`（语境查词）：provider 是 LLM → 要求返回 JSON `{sentence_translation, translation/word_in_sentence, explain, usage, words[], simple_def}`；否则退化为整句翻译。
- **LLM 工程**（值得细读）：
  - `cleanLlmText()` 反复剥离 `<think>` 推理块（DeepSeek-R1 类模型强制输出）+ ``` 围栏；
  - `extractJson()` 整体解析失败取**最后一个** `{...}` 片段（think 块里的示例 JSON 在前面，真实返回在最后）；
  - 句译用独立的 `TRANSLATE_PROMPT` 覆盖查词 systemPrompt（否则模型会反问「要查哪个词」）；
  - 用户测过词汇量时向 system prompt 注入用词难度约束（COBUILD 风格简单英语）。
- 超时统一 15s（AbortController）。

### 5.7 词汇量自测与个性化（`main/vocabtest.js` + `main/en-def.js`）

**测试**（借鉴 TestYourVocab 桶估计 + LexTALE 真假词）：
- 6 个 bnc 词频段（1-1k / 1k-2k / 2k-4k / 4k-8k / 8k-15k / 15k-50k），每段随机抽 8 个真词（纯小写、3-14 位、有释义）+ 12 个假词（预置 25 词池，运行时查库防撞），共 60 题洗牌。真假标记只留在主进程内存里，UI 只拿词表——防作弊。
- `finishTest()` 计分：每段通过率 = `(认识真词 - 假词误认/段数) / 段内题数`，× 段大小累加，封顶 50000，映射 CEFR（<2000=A1 … ≥12000=C2），写入 `config.vocabLevel`。

**个性化渲染数据**（`buildEnDefinition` 返回 `{senses, hard, hints, vocabLevel}`）：
- `levelInfo()`：词汇量 → `maxBnc = clamp(score×0.8, 1000, 40000)`，即释义用词难度上限；
- `annotateHardWords()`：释义文本中 bnc=-1（未收录）/0（语料外）/>maxBnc 的词标记为难词（带内存缓存）；
- `hardWordHints()`：批量 IN 查询（50 个一批）难词的中文首义 + 英文首义，点击难词就地浮层显示——「难词就地化解」；
- `wordLevel(bnc, score)`：查的词本身相对用户水平 → `within / above / far-above` 徽章。

### 5.8 学习库（`main/db.js`）

两张表（WAL 模式），**事件溯源 + 行状态**双结构是全项目同步设计的地基：

```sql
words   (word PK, phonetic, definition, first_seen, last_seen, query_count,
         note, efactor, interval, repetitions, due_date,        -- SM-2 状态
         updated_at,          -- LWW 合并依据
         deleted)             -- 墓碑：0/1
queries (id, word, context, context_cloze, sentence_translation,
         word_in_sentence, source, created_at, simple_def,
         uuid UNIQUE,         -- 事件身份（跨端并集，AUTOINCREMENT 各端会撞号所以用 uuid）
         srv_at)              -- 服务端接收时间（增量游标，权威时钟）
```

核心函数：
- `recordLookup()`（`db.js:91`）：words 表 upsert（计数+1）+ **每次查询必落一条 queries 事件行**（uuid 幂等）。墓碑词再查到 = 复活并重置 SM-2 进度。query_count 可由事件行数推导（同步合并用）。
- `reviewWord()`（`db.js:181`）：调 supermemo npm 包 `{interval, repetition, efactor} + grade → next`，`due_date = now + interval 天`。UI 打分映射：忘记=0、模糊=3、认识=5。
- `dueWords()`：`deleted=0 AND due_date<=now AND (due_date!=0 OR first_seen<now-1天)`——从未复习的词查询满一天自动到期。
- `getRecentContexts(words)`（`db.js:142`）：批量取每词「最近一条带挖空语境」的事件（无则退回最近一条），避免复习卡 N+1 查询——语境永远在场，哪怕最近一次查词没复制句子。
- `exportAnki()`（`db.js:217`）：UTF-8 制表符 txt，头部 `#separator:tab #html:true #columns:word,phonetic,translation,context,cloze #deck:ReadPicks 生词本`，附语境原句 + 挖空句两种字段。
- `removeWord()` 是墓碑（非物理删除）；`purgeWord()` 物理删除仅限测试。

### 5.9 局域网同步（`main/sync.js` + `db.js` 合并函数）

**拓扑**：PC 即服务端（`words.db` 就是服务端库），手机是客户端。默认端口 9723，首次启用 `crypto.randomBytes(16).hex` 生成配对 token，header `x-sync-token` + `crypto.timingSafeEqual` 恒时比较。`lanIP()` 按网段打分选地址（192.168 > 10 > 172.16-31）。

**端点**：
- `GET /api/ping` — 连通性 + 统计。
- `POST /api/lookup` — 手机查词：`lookupForMobile()`（`sync.js:65`）复用 PC 的 ecdict/buildEnDefinition/LLM simpleDef/在线翻译，**只读不入库**（手机本地入库后经同步回流）。
- `POST /api/sync` — **一次往返完成 push+pull**（`sync.js:167-194`）：
  1. push 落地：`db.applySyncBatch()`（事务原子）；
  2. 用户属性互通：vocabLevel 按 `takenAt` 新者胜（两端谁测都行）；
  3. **先取 `serverTime` 再读增量**（防漏：读之后落库的行 srv_at > serverTime，下轮必被拉到）；
  4. 返回 `updated_at >= 游标` 的词行（含墓碑）+ `srv_at >= 游标` 的事件行 + vocabLevel + serverTime。
- `/app/` — 静态托管 `mobile/www`（路径规范化防目录穿越，未命中回退 index.html；响应头带 CSP `default-src 'self'; style-src 'self'; connect-src 'self' https:`）。
- `pairQR()` — qrcode-generator 纯属性 SVG（CSP 允许），内容是 `http://IP:9723/app/?t=token`。

**冲突解决三件套**（PC/手机两份实现，语义严格一致）：
1. **词行 LWW**（`applyWordFromSync`）：`updated_at` 新者胜，同刻本地让远端（幂等）；远端时钟超前本地 5 分钟以上视为漂移钳制到当前时间（`CLOCK_SKEW_MS`）。
2. **事件流 uuid 并集**（`applyQueryFromSync`）：queries 是 append-only，按 uuid 去重永不冲突；事件先于词行到达时补一条词行骨架（防御）。
3. **计数推导**（`refreshCountsFromEvents`）：`query_count/last_seen = MAX(行值, 事件统计值)`——单调不回退，跨端并发查词不丢计数。

**游标**：手机端用上次 `serverTime` 做双向游标（`>=` 语义 + 幂等合并，重复收发无副作用）。

### 5.10 悬浮窗状态机（`main/window.js`）

无边框、透明、置顶（screen-saver 层级）、`skipTaskbar`，预创建（热键首次触发零等待）。关键状态：
- `showPopup()` 定位在鼠标右下（越界翻转），用 `_programmaticMove` 标志吞掉程序定位触发的 move 事件，区分用户拖拽；`showInactive()` 显示**不抢焦点**。
- 不自动隐藏的三重保护：`pinned`（钉住）/ `busy`（查询进行中，20s 兜底复位）/ 拖拽后 2s 抑制（`_lastUserMoveAt`）。
- renderer 侧鼠标移出 1.2s → `hidePopup`（仍受主进程保护）；✕ 或 Esc → `hidePopupForce` 无条件关闭。

---

## 6. 手机端 Web（`mobile/www/`）

### 6.1 无构建系统的工程约定（重要！）

全部是经典 `<script>` 全局加载，脚本间靠 `window.rpdb / rpsync / rpllm / rpend / rpvocab / rpuuid` 全局对象通信。**历史教训**：经典脚本顶层 `const` 挂到全局作用域，两个脚本声明同名顶层变量会直接 SyntaxError → 整页白屏。因此：
- 多函数工具模块（en-def.js / vocab.js / llm.js / boot.js）全部包 **IIFE** 只暴露一个命名空间；
- 新增脚本后必须跑 `npx electron scripts/check-mobile-globals.js` 检查撞名；
- `boot.js` 用纯 ES5 最先加载：未捕获错误上屏（防白屏不可诊断）、WebView 过旧探测（Chrome<92 无 randomUUID）、`window.rpuuid` 兜底。

### 6.2 数据层（`db.js`，window.rpdb）

IndexedDB `readpicks` 库三个 store，与 PC SQLite 严格同语义：
- `words`（keyPath `word`，索引 due/updated）、`queries`（keyPath `uuid`，索引 word/srv）、`meta`（KV：游标、脏词表、localSeq、vocabLevel 等）。
- 本地写全部走 `putWord()` → 自动记脏标记（`meta.dirtyWords` 数组）供增量 push；
- 本地事件落 `addEvent()`：自增 `localSeq` + `meta.eventSeqs[uuid]=seq` 映射——push 增量用「seq > 已推送 seq」判断，避免给 queries 行混入本地字段；
- `recordLookup / reviewWord / dueWords / getRecentContexts / applyWordFromSync / applyQueryFromSync` 与 PC 一一对应（墓碑复活、LWW、时钟钳制全同）。

### 6.3 查词四级兜底链（`app.js:267 runQuery`）

```
① 离线 mini 词典（dict/mini.json，~4-8MB 随包/懒加载，lemma 还原）
     未命中 ↓（已配对时）
② PC 完整词典  POST /api/lookup（含按词汇水平的英英释义 + LLM 简单释义）
     未命中/未配对 ↓
③ LLM 直连（设置页自填 OpenAI 兼容接口；APK 内走 CapacitorHttp 原生请求免 CORS）
     仍无 ↓
④ 直连 MyMemory 在线翻译（免费免配置，8s 超时）
     全失败 → 如实提示「没查到」
```

任何一级命中后继续叠加：**划词语境**（`captureSelectionContext`，见 6.4）或**剪贴板整句兜底** → LLM 出句译+词中译法（MyMemory 兜底句译）→ 渲染卡（英文在上、中文收起、`q-src` 标注来源链）→ 「加入生词本」= `rpdb.recordLookup()` + 触发同步回流 PC。

mini 词典由 `scripts/build-mini-dict.js` 生成：从 PC 的 ECDICT 按 frq 词频序抽 5 万词头 + 补 Collins/牛津标注词，截断释义，附 lemma 表和 bnc（难词判定/词汇量测试要用）。

### 6.4 划词语境（无障碍句提取）

`captureSelectionContext(word)`（`app.js:507`）：
1. Capacitor 插件 `Selection.getRecent({word})` 拿无障碍服务缓存的节点全文 + 选中下标（缓存超 90s 会触发原生侧主动扫描窗口树兜底）；
2. 2 分钟内的选中才算语境；`findWordInText()` 优先按选中下标定位该词，否则首次命中；
3. `extractSentence()` 按标点切出所在句子，空白归一化；
4. 在归一化句子上替换首个词边界命中为 `{{c1::…}}` 挖空。

剪贴板接力（`checkClipboard`，切到查词页时读剪贴板）：复制单词→提示一键查词；复制整句→粘贴输入框，删到要查的词后查，整句自动作语境挖空。

### 6.5 复习 / 词汇量 / LLM

- 复习（`app.js:116 loadReview` 起）：PC review.js 的移植——语境挖空正面、背面英文在上（simple_def → mini 词典 WordNet 义项+难词标注）中文 muted、忘记的词会话内重现（上限 2 次）、SM-2 走 `rpdb.reviewWord`（同一 supermemo 包）。
- 词汇量自测（`vocab.js`）：与 PC 同算法（6 频段 ×8 真词 + 12 假词 + 桶估计），数据源换成 mini.json 的 b 字段；结果写 `meta.vocabLevel` 并立即同步给 PC。
- `llm.js`：chat 请求 APK 内走 `CapacitorHttp`（原生层，不受 CORS 限制），浏览器回退 fetch；同样的 think 块清洗 + 取最后一个 JSON 片段 + 词汇量水平注入。

### 6.6 悬浮卡模式（cardMode）

APK 里从划词/悬浮球/分享拉起 `CardActivity` 时，网页收到 `processText {card:true}` 事件 → `enterCardMode()`：加 `card-mode` class 隐藏主导航，只渲染查词卡；JS 量内容高度 `P.setCardSize({widthPct, contentHeight})` 同步给原生调整窗口大小；入库成功 1.4s 后自动 `closeCard()`（原生 finish Activity，回到源应用阅读处）。

---

## 7. 安卓原生层（`mobile/android/`）

Capacitor 8 工程，`appId=com.readpicks.app`，两个 Activity 注册同样的两个自定义插件（MainActivity 与 CardActivity 各自注册，因为 WebView bridge 各挂一套）。

### 7.1 三个划词入口（`AndroidManifest.xml`）

| 入口 | 机制 | 代码路径 |
|---|---|---|
| 系统选择菜单「拾词」 | CardActivity 的 `ACTION_PROCESS` intent-filter，**priority=999** 抢占菜单优先位（系统不提供排序 API，priority 是唯一杠杆） | `forwardProcessText` 取 `EXTRA_PROCESS_TEXT` → `ProcessTextPlugin.receive(text, card=true)` |
| 分享 | CardActivity 的 `ACTION_SEND` text/plain | 同上，取 `EXTRA_TEXT` |
| 悬浮球 | `FloatingBallService`（SYSTEM_ALERT_WINDOW 系统悬浮窗 + specialUse 前台服务常驻）：46dp 小球，拖动记忆位置（SharedPreferences），轻点拉起 CardActivity | 解决自绘选区菜单（PDF/笔记类 App）无法划词的场景 |

热路径 vs 冷启动：`receive()` 先 `notifyListeners("processText")` 推给 WebView；冷启动时 WebView 尚未监听，JS 启动时 `getPending()` 补投递（`ProcessTextPlugin.java:21-41`）。

### 7.2 悬浮卡（`CardActivity.java`）

**关键决策**：窗口形态用 Android 原生「对话框式 Activity」（`CardTheme`，`windowIsFloating`），窗口本身只有卡片大小——窗口外由系统合成，必然露出源应用 + 对话框压暗。**不依赖 WebView 透明**（部分设备 WebView 透明不可靠，这是踩过坑后的方案，见记忆 `mobile-floating-window-lessons`）。`excludeFromRecents + taskAffinity=""` 不进任务栈；`Gravity.CENTER` 屏幕居中（用户偏好）；尺寸由 JS 回报驱动：宽度 = 屏宽 × widthPct（60-100 滑杆），高度 = min(内容高度×density + 8dp, 60% 屏高)。

### 7.3 无障碍语境服务（`ReadPicksAccessibilityService.java` + `SelectionPlugin.java`）

- 监听全系统 `TYPE_VIEW_TEXT_SELECTION_CHANGED` 事件，跳过拾词自身包名，把「节点全文 + 选区下标 + 包名 + 时间戳」存进程级静态缓存 `SelectionHolder`（≤200k 字符）。
- 网页内容（Chrome）事件常带整段文本但不带下标（-1）——文本本身就是语境，JS 侧按词定位兜底。
- `scanSelectionIntoHolder(word)`（`ReadPicksAccessibilityService.java:74`）：选区事件不触发的应用，查词卡打开时主动扫描各窗口文本节点树（深度限 25，跳过自己，多个命中取最长文本——段落优于标题行）。
- 服务只能由用户在系统设置里开启（`SelectionPlugin.openAccessibilitySettings()` 跳转），仅标准 TextView 渲染的 App 有效。

### 7.4 ProcessTextPlugin（杂能力集合）

划词事件桥接、`closeCard`（finish Activity）、`setCardSize`、`readClipboard`（前台读剪贴板，接力查词用）、`speak`（系统 TTS，语言回退链 US→UK→系统默认，错误经 `ttsError` 事件回报网页——国产 ROM 常无 TTS 数据）、`overlayStatus/setBall/openOverlaySettings`（悬浮球授权与开关）。

---

## 8. 端到端数据流走读（把上面的模块串起来）

**场景 A：PC 上选中 "resilient" 按 Alt+Q**
1. `onHotkey` → 立即弹「查询中」→ `grabViaUia()`：常驻 PowerShell 跑 uia.ps1，BFS 前台窗口找到 TextPattern 控件，拿选中词 + 扩展到段落 → 段落进 `context.push()`。
2. `handleQuery`：cleanText → classify=word → lowerCase → `lookupWord("resilient")`。
3. `ecdict.lookup` 命中（音标/释义/柯林斯三星）；测过词汇量（如 B2）→ `buildEnDefinition` 给出 WordNet 义项并标出 "pertinacity" 这类超水平难词（带浮层提示）。
4. `context.findContext` 从剪贴板历史找到含 "resilient" 的句子 → 挖空 → LLM 返回整句译/词中译法/解释/simple_def。
5. `db.recordLookup`：words 表计数 +1，queries 落一条 uuid 事件。
6. 悬浮卡渲染：英文释义区（simpleDef 或 senses+难词）在上，中文释义折叠，语境区带高亮原句+句译，徽章显示「第 3 次查询」。
7. 手机端下次同步 pull 到这条事件与词行，手机复习队列里出现该词的挖空卡。

**场景 B：手机上任意 App 选中 "resilient" → 点「拾词」**
1. 系统 PROCESS_TEXT intent 拉起 CardActivity（对话框窗口浮在原文上，背景压暗）。
2. `forwardProcessText` → `ProcessTextPlugin.receive(text, card=true)` → WebView `enterCardMode()` + `runQuery("resilient")`。
3. 四级兜底①命中 mini 词典（lemma 还原支持复数/时态）。
4. `Selection.getRecent` 拿无障碍缓存的源应用节点全文 → 提取所在句 → 挖空 → LLM/CapacitorHttp 出句译与词中译法。
5. 「加入生词本」→ IndexedDB recordLookup（脏词+事件）→ `runSync` push 给 PC（或稍后自动同步）→ PC 生词本出现该词，两端 SM-2 从此共用一条曲线。

**场景 C：复习**
- PC：托盘「今日复习（N）」→ review 窗口 `review:due`（dueWords + getRecentContexts + buildEnDefinition 组卡）→ 空格翻面 → 1/2/3 打分 → `review:answer` → supermemo 更新 due_date。
- 手机：复习 tab `rpdb.dueWords(50)` → 同一套渲染逻辑 → `rpdb.reviewWord` → 下次同步 push 回 PC。

---

## 9. 同步协议速查（实现新端点/新端时对照）

```
POST /api/sync          header: x-sync-token
请求 { device:{id,name}, cursors:{words,queries},      ← 上次 serverTime
       words:[脏词行], queries:[seq>pushedSeq 的本地事件],
       meta:{vocabLevel} }
响应 { ok, applied:{appliedWords,appliedQueries},
       words:[updated_at>=游标，含墓碑], queries:[srv_at>=游标],
       meta:{vocabLevel}, serverTime }                  ← serverTime 在读增量之前取
合并规则：词行 LWW(updated_at+时钟钳制)；事件 uuid 并集；
         query_count/last_seen=MAX(行值,事件推导)；vocabLevel 按 takenAt 新者胜
删除=墓碑(deleted=1)；重新查到=复活重置 SM-2
```

改动 SM-2 或计数逻辑时必须同步更新 `scripts/sync-test.js` 的合并断言（AGENTS.md 约定）。

---

## 10. 核心函数快速索引

| 功能 | 函数 | 位置 |
|---|---|---|
| 查询管线 | `handleQuery` | main/index.js:24 |
| 单词卡组装 | `lookupWord` | main/index.js:58 |
| IPC 安全注册 | `handleIpc` / `onIpc` | main/index.js:195 |
| 取词总控 | `grabSelection`（UIA→剪贴板回退） | main/hotkey.js:160 |
| UIA 脚本 | `Get-TranenSelection` | scripts/uia.ps1:21 |
| PowerShell 通道 | `sendCommand`（`__DONE__` 协议） | main/hotkey.js:51 |
| 文本清洗/分类 | `cleanText` / `classify` | main/hotkey.js:220 / :242 |
| 语境查找/挖空 | `findContext` / `makeCloze` | main/context.js:84 / :102 |
| 词典查询/lemma | `lookup` | main/ecdict.js:59 |
| 翻译路由/LLM | `translateSentence` / `llm` / `extractJson` | main/translate.js:35 / :164 / :90 |
| 词汇量测试 | `startTest` / `finishTest` | main/vocabtest.js:79 / :102 |
| 难词标注/化解 | `annotateHardWords` / `hardWordHints` / `wordLevel` | main/vocabtest.js:184 / :211 / :249 |
| 英英释义构建 | `buildEnDefinition` | main/en-def.js:9 |
| 查询入库（事件溯源） | `recordLookup` | main/db.js:91 |
| SM-2 复习 | `reviewWord` | main/db.js:181 |
| 语境回捞（批量） | `getRecentContexts` | main/db.js:142 |
| Anki 导出 | `exportAnki` | main/db.js:217 |
| 同步合并 | `applySyncBatch` / `applyWordFromSync` / `applyQueryFromSync` / `refreshCountsFromEvents` | main/db.js:312 / :256 / :278 / :299 |
| 同步服务端 | `handleApi`（/api/sync、/api/lookup）/ `lookupForMobile` / `pairQR` | main/sync.js:153 / :65 / :264 |
| 悬浮窗状态机 | `showPopup` / `setBusy` | main/window.js:58 / :85 |
| 悬浮卡渲染 | `renderWord` / `renderSenses` | renderer/popup.js:31 / :230 |
| 复习渲染/打分 | `render` / `answer` | renderer/review.js:21 / :92 |
| 手机查词四级兜底 | `runQuery` | mobile/www/app.js:267 |
| 手机划词语境 | `captureSelectionContext` / `findWordInText` / `extractSentence` | mobile/www/app.js:507 / :527 / :546 |
| 手机入库/同步 | `addToWordbook` / `doSync` | mobile/www/app.js:482 / mobile/www/sync.js:38 |
| 手机数据层 | `recordLookup` / `reviewWord` / `applySyncBatch 同族` | mobile/www/db.js:108 / :157 / :236 |
| 手机 LLM | `chat` / `simpleDefinition` / `lookupInContext` | mobile/www/llm.js:21 / :84 / :96 |
| 安卓划词转发 | `forwardProcessText`（两个 Activity 各一份） | MainActivity.java:27 / CardActivity.java:95 |
| 安卓悬浮卡尺寸 | `applySize` / `applyWindowSize` | CardActivity.java:58 / :66 |
| 安卓语境缓存 | `onAccessibilityEvent` / `cacheSelection` / `scanSelectionIntoHolder` | ReadPicksAccessibilityService.java:33 / :56 / :74 |
| 安卓悬浮球 | FloatingBallService 触摸逻辑（拖动/轻点） | FloatingBallService.java:61 |

---

## 11. 工程约束与安全清单（改码前必看，均来自 AGENTS.md 与代码注释）

1. **数据目录固定** `%APPDATA%/readpicks`（`main/config.js getDataDir`）——测试入口下 app.name 是 "Electron"，用 `app.getPath('userData')` 会数据错位；勿改。旧目录 `tran-en` 首次启动自动迁移。
2. **renderer 禁止 `require('electron')`**，一律 `window.tranen`；新 IPC 必须 `handleIpc/onIpc`（sender 校验），禁止裸 `ipcMain.handle/on`。
3. **CSP `style-src 'self'`**：不能内联 `<style>`/style 属性（手机端同理，服务端响应头同约定）；所以二维码用纯属性 SVG、动画用 CSS 类。
4. **测试必须 `npx electron` 跑**（better-sqlite3 是 Electron ABI）。⚠️ 永远不要运行 `scripts/zip-install-test.js`——它会删用户数据目录里的真实词典（851MB ECDICT）。
5. `scripts/uia.ps1` 必须 UTF-8 BOM（PowerShell 5.1）；PowerShell 不允许空 catch 块（写 `catch { $null = 1 }`）。
6. 随打包分发的脚本要加进 `package.json build.files`（uia.ps1/download-dict.js 已在列）；mobile/www 改动后 APK 需 `npx cap sync android`。
7. git 提交用 `git -c user.name="ReadPicks" -c user.email="readpicks@local" commit`；勿提交 node_modules/dist/logs/.reasonix。
8. 查询词统一小写；所有用户可见查询路径必须过滤 `deleted = 0`。
9. 手机端新增脚本：包 IIFE + 跑 `check-mobile-globals.js`（全局撞名会白屏）。
10. 改 better-sqlite3 或 Electron 版本后：`npx electron-builder install-app-deps` 重建原生模块。
11. 打包/下载国内镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、`ELECTRON_BUILDER_BINARIES_MIRROR=…`、词典下载 `TRANEN_DL_MIRROR`。

---

## 12. 开发与测试命令

```bash
npm start                                  # 开发运行
npx electron scripts/smoke-test.js         # 核心逻辑（db/SM-2/Anki/回溯/翻译/分类）
npx electron scripts/gui-test.js           # GUI 全链路（IPC/渲染/持久化/tab）
npx electron scripts/uia-test.js           # UIA 取词 + PowerShell 常驻通道
npx electron scripts/sync-test.js          # 同步链路（迁移/LWW/墓碑/并集/协议往返/手机查词端点）
npx electron scripts/build-mini-dict.js    # 生成手机端 mini 词典（需 ECDICT）
npx electron scripts/check-mobile-globals.js  # 手机端全局撞名检查
npx electron-builder --win portable        # 打包（先设镜像）
# 安卓：cd mobile && npm i && npx cap sync android && cd android && JAVA_HOME=<JDK21> ./gradlew assembleDebug
```

调试工具链（历史经验）：安卓问题先在 MCP 模拟器复现（`android-emulator` 插件），悬浮卡像素级测量用 `scripts/rp-eval.js`；PC 语境失效先查 `clipboard-history.json`（证据在数据目录，不在代码）。

---

## 13. 关键设计决策速记（为什么是这样）

| 决策 | 原因 |
|---|---|
| 取词用 UIA 而非剪贴板 | 不碰用户剪贴板（不打扰）+ 能顺带拿所在段落（语境）；剪贴板方案只做回退，且回退时快照恢复全部格式 |
| 常驻 PowerShell 而非每次 spawn | 每次 spawn 400ms+，常驻 + stdin 命令通道 + `__DONE__` 切包，取词延迟降到几十 ms |
| words + queries 双表，事件流独立于行状态 | query_count 跨端并发不丢（事件推导）；语境/句译/简单释义可回捞；同步只需「行 LWW + 事件 uuid 并集」两种无冲突规则 |
| 删除用墓碑 | 删除要跨设备传播；queries 事件保留，重新拾取时语境可回捞 |
| 游标用服务端 `srv_at` 而非设备时钟 | 各设备时钟不可信，服务端权威时钟防漏防重 |
| 手机端 mini 词典 + 四级兜底 | 两端独立可用是硬要求：离线秒查优先，联网时逐级增强，任何一级失败不阻塞 |
| 手机悬浮卡用原生对话框 Activity 而非 WebView 透明 | WebView 透明/窗口 dim 在部分设备不可靠；windowIsFloating 由系统合成窗口外区域，必然正确 |
| 无构建系统（PC 与手机都是） | 降低工具链复杂度，代价是手机端要靠 IIFE+检查脚本防全局撞名、PC 靠 CommonJS 模块边界 |
| PROCESS_TEXT intent-filter priority=999 | 系统不提供选择菜单排序 API，priority 是抢占菜单优先位的唯一杠杆 |
| 复习卡「忘记」会话内重现（上限 2 次） | SM-2 状态已即时更新，重现只做当次巩固；上限防单卡死循环 |

---

## 14. 「我想改 X」快速定位

| 想做的事 | 去哪里 |
|---|---|
| 查词卡显示内容/顺序 | `main/index.js lookupWord`（payload 组装）+ `renderer/popup.js renderWord`（渲染）+ `renderer/popup.css` |
| 取词行为（热键/超时/回退） | `main/hotkey.js`、`scripts/uia.ps1`、默认热键在 `main/config.js DEFAULTS.hotkey` |
| 翻译源/LLM 提示词 | `main/translate.js`（PC）、`mobile/www/llm.js`（手机）；默认 systemPrompt 在 `config.js DEFAULTS.providers.llm` |
| 英英释义/难词规则 | `main/en-def.js`、`main/vocabtest.js`（PC）；`mobile/www/en-def.js`（手机 mini 版） |
| 词汇量算法 | `main/vocabtest.js` / `mobile/www/vocab.js`（两份必须保持同语义） |
| 复习卡片/打分 | `renderer/review.js`（PC）、`mobile/www/app.js` 复习段（手机） |
| SM-2/到期规则 | `main/db.js reviewWord/dueWords`（supermemo 包参数） |
| 同步协议/合并规则 | `main/sync.js` + `main/db.js` 底部合并函数 + `mobile/www/sync.js` + `mobile/www/db.js`（四处同语义） |
| 悬浮窗行为 | `main/window.js`（主进程状态机）+ `renderer/popup.js`（renderer 侧） |
| 手机悬浮卡 | `mobile/android/.../CardActivity.java`（窗口）+ `app.js cardMode 段`（网页）+ `ProcessTextPlugin.java setCardSize` |
| 划词入口/权限 | `mobile/android/app/src/main/AndroidManifest.xml` |
| 语境提取（手机） | `ReadPicksAccessibilityService.java`（缓存）+ `app.js captureSelectionContext`（提句挖空） |
| mini 词典内容/体积 | `scripts/build-mini-dict.js`（截断规则/词头数） |
| 配置项/默认值 | `main/config.js DEFAULTS` |

---

## 15. 源码阅读路径（从哪开始、按什么顺序）

路径设计原则：**沿数据流自顶向下，不按目录顺序读**。先走通「按下热键 → 卡片上屏」这条产品主干，再逐层补齐支撑模块；同步（最难的部分）放在主干扎实之后；手机端先读与 PC 同语义的部分（对照读，重复度高所以很快）。

```
阶段0 跑起来 ──► 阶段1 主干回路 ──► 阶段2 取词 ──► 阶段3 数据地基 ──► 阶段4 内容供给
                                                                        │
      阶段9 测试即文档 ◄── 阶段8 安卓原生 ◄── 阶段7 手机Web ◄── 阶段6 同步 ◄── 阶段5 窗口
```

### 阶段 0：先跑起来（半小时，不要跳过）

`npm start` → 按住选中一个词按 `Alt+Q` → 看悬浮卡 → 托盘开「今日复习」翻几张卡 → 设置里测一次词汇量。再到 `%APPDATA%/readpicks/` 打开 `words.db`（任意 SQLite 工具）看 `words`/`queries` 两张表里刚产生什么数据，打开 `clipboard-history.json` 看语境历史。**代码里所有字段名都会在这些数据里出现**，之后读码时有实感可对照。

### 阶段 1：主干回路（~750 行，产品脊椎）

| 顺序 | 文件 | 行数 | 读法 |
|---|---|---|---|
| 1 | `preload.js` | 33 | 一分钟扫完：IPC 边界长什么样，`window.tranen` 有哪些方法 |
| 2 | `main/index.js` | 401 | 只精读三个函数：`handleQuery`(:24)、`lookupWord`(:58)、`registerIpc`(:215)；托盘/生命周期扫过 |
| 3 | `renderer/popup.js` | 372 | 重点 `renderWord`(:31)：拿阶段 2 读到的 payload 字段逐个对回 DOM 元素 |

**Checkpoint**（答得出再往下）：
- 从按下 Alt+Q 到卡片上屏，完整事件序列是什么？（提示：先弹「查询中」还是先查？）
- payload 里 `simpleDef`、`enDefinition`、`contextCloze` 分别由哪个模块负责填？
- `querySeq` 是干什么的，删掉它会出什么 bug？

### 阶段 2：取词黑科技（~330 行，平台特色）

| 4 | `main/hotkey.js` | 250 | 重点 `ensurePs/sendCommand`(:27/:51)、`grabViaUia`(:105)、`grabSelection`(:160)、`cleanText/classify`(:220/:242) |
| 5 | `scripts/uia.ps1` | 83 | 对照 hotkey.js 的调用读：BFS 遍历、TextPattern、段落扩展 |

**Checkpoint**：`__DONE__` 标记如何解决「子进程输出没有边界」的问题？UIA 失败后剪贴板快照为什么要存 text/html/image 三种格式再恢复？

### 阶段 3：数据地基（~450 行，全项目的地基）

| 6 | `main/db.js` | 328 | 精读 `recordLookup`(:91)、`reviewWord`(:181)、`getRecentContexts`(:142)、`dueWords`(:192)；**底部同步合并函数(:243 起)第一遍跳过**，阶段 6 回来读 |
| 7 | `main/context.js` | 112 | 剪贴板历史 → `findContext` → `makeCloze`，和阶段 1 的 `context.push` 调用点连起来 |
| 8 | `main/config.js` | 113 | 快速过：数据目录为何固定、deepMerge 配置 patch |

**Checkpoint**：为什么每次查询都要落一条 `queries` 事件行（哪怕裸查词没语境）？「墓碑复活」是发生在哪个函数的哪一行？

### 阶段 4：内容供给层（~500 行，释义从哪来）

| 9 | `main/ecdict.js` | 130 | `lookup`(:59) 的三级尝试 + lemma 表 |
| 10 | `main/translate.js` | 229 | 重点 `cleanLlmText`(:78)、`extractJson`(:90)、`llm`(:164) 的提示词注入 |
| 11 | `main/en-def.js` + `main/vocabtest.js` | 22+259 | 词汇量 score → `maxBnc` → 难词标注 → `hardWordHints` 这条换算链 |

**Checkpoint**：词汇量 8000 分的用户查词，`wordLevel` 徽章的判定线是多少 bnc？`extractJson` 为什么要取**最后一个** `{...}` 而不是第一个？

### 阶段 5：窗口状态机与剩余 renderer（~500 行，可快读）

| 12 | `main/window.js` | 141 | 悬浮窗三重防隐藏（pinned/busy/拖拽抑制）与 `_programmaticMove` |
| 13 | `main/clipboard-watch.js` | 36 | 800ms 轮询 + 防递归 |
| 14 | `renderer/review.js` | 234 | SM-2 的 UI 面：挖空正面渲染、打分映射、会话内重现 |
| 15 | `renderer/settings.js` | 378 | 扫过即可：每个 tab 调哪些 IPC |

### 阶段 6：同步（~700 行对照读，全项目最难）

| 16 | `main/sync.js` | 273 | 服务端视角：`handleApi`(:153) 的 /api/sync 一次往返 |
| 17 | `main/db.js:243-326` | 回补 | `applyWordFromSync/applyQueryFromSync/refreshCountsFromEvents` 合并三件套 |
| 18 | `mobile/www/sync.js` + `mobile/www/db.js` | 116+289 | **对照读**：客户端视角，函数一一同名同语义，边读边找差异 |

**Checkpoint**：`serverTime` 为什么必须在读增量**之前**取（sync.js:181 注释）？两台设备同时改同一个词的 note，谁赢？手机离线查了 3 次同一个词，PC 为什么不会少计数？

### 阶段 7：手机端 Web（~1800 行，但 1/3 与 PC 同语义）

| 19 | `mobile/www/boot.js` | 49 | 为什么用 ES5、rpuuid 兜底什么 |
| 20 | `mobile/www/db.js` | 补读 | 阶段 6 读过同步半边，补 `recordLookup`(:108)、脏词标记、`eventSeqs` |
| 21 | `mobile/www/app.js` | 1018 | 重点三处：`runQuery`(:267) 四级兜底、`captureSelectionContext`(:507)、cardMode(:569 起)；复习/词表是 PC 的移植，对照扫过 |
| 22 | `llm.js` / `en-def.js` / `vocab.js` | 300 | 与 PC 对应模块对照，确认「同语义移植」都一致（这正是这个项目的维护纪律） |

### 阶段 8：安卓原生（~700 行 Java）

| 23 | `AndroidManifest.xml` | 先看懂三个入口：PROCESS_TEXT(priority=999) / SEND / 悬浮球服务 |
| 24 | `MainActivity.java` → `ProcessTextPlugin.java` | 36+183：intent 转发、热路径事件 vs 冷启动 getPending、TTS 回退链 |
| 25 | `CardActivity.java` | 109：对话框 Activity 为什么不依赖 WebView 透明、尺寸如何由 JS 驱动 |
| 26 | `ReadPicksAccessibilityService.java` + `SelectionHolder` + `SelectionPlugin` | 语境缓存的两条路（事件监听 + 主动扫描） |
| 27 | `FloatingBallService.java` | 162：SYSTEM_ALERT_WINDOW 悬浮窗、拖动/轻点判定、前台服务 |

### 阶段 9：测试即文档（半天）

`scripts/smoke-test.js` → `sync-test.js` → `gui-test.js`。这个项目没有单元测试框架，**测试脚本的断言就是行为规格**——`sync-test.js` 尤其值得精读，它把 LWW/墓碑/计数推导的预期行为全部写成可执行断言。改核心逻辑前先看这里。

### 三个通用读法建议

1. **拿一个词贯穿全程**：选一个生词（如 "resilient"），在心里跟踪它从 UIA 选区 → payload 字段 → SQLite 行 → 同步 JSON → 手机 IndexedDB → 复习卡挖空的完整旅程，比通读更有效。
2. **跑测试对照断言**：每读完一个模块跑对应测试脚本，看断言印证你的理解（注意：必须 `npx electron` 跑，别用 node）。
3. **看 git 历史补「为什么」**：`git log --oneline` + 关键文件的提交信息（如悬浮卡三次改版 28d9f67 → 3ea6e92 → f52709d）记录了踩坑过程，代码注释里的「为什么不」大多源于此。

---

## 16. 值得学习的点（可迁移的工程模式）

这些模式不绑定本项目，换到任何代码库都用得上。每条给出代码位置，读的时候可以带着「这个套路我下个项目哪里能用」的问题。

**① 用数据建模消掉并发冲突（事件溯源的实用子集）** —— `main/db.js:91,299`
词行用 LWW、查询事件用 append-only + uuid 并集、计数由事件推导取 `MAX` 单调不回退。这是 CRDT 思想的极简落地：并发冲突不靠锁解决，而是让数据结构本身「怎么合并都不坏」。适合一切需要多端同步的本地优先应用。

**② 分布式教科书原理的工程化落地** —— `db.js:11,259`、`sync.js:181`
LWW 不直接信设备时钟（超前 5 分钟视为漂移钳制）；增量游标用服务端权威时钟且**先取 serverTime 再读增量**（防漏一行注释讲透）；游标用 `>=` + 幂等合并使重复收发无副作用。273 行代码展示了「知道原理」和「能做对」之间的全部细节。

**③ 常驻子进程 + 微型文本协议** —— `main/hotkey.js:27-68`
每次 spawn PowerShell 要 400ms+，改成常驻进程往 stdin 写命令，用 `__DONE__` 标记切包、Promise 链串行化命令、2s 保险超时。这是「消除进程启动开销 + 在无结构 stdout 上自建 RPC」的一手范例。

**④ 优雅降级链：每层外部依赖都有 plan B，失败要诚实** —— `hotkey.js:160`、`app.js:267`
UIA 失败退剪贴板快照；手机查词 mini 词典 → PC 词典 → LLM 直连 → MyMemory → 如实提示「没查到」；TTS 语言 US→UK→系统默认。关键细节：**来源标签（srcLabel）如实告诉用户结果来自哪一级**——降级不隐瞒，这是产品可信度的来源。

**⑤ 竞态治理的朴素工具箱（不引框架）** —— `index.js:22,36`、`hotkey.js:13,146`
单调递增 `querySeq` 丢弃过期慢查询、`isSimulating` 重入保护、3 秒重复查询去重、`psQueue` 串行化、`busy` 20s 兜底复位。全是「一个变量 + 早退」的土办法，却把异步竞态管得干干净净。

**⑥ 感知零延迟 ≠ 实际零延迟** —— `index.js:34,385`、`window.js:85`、`app.js:1007`
先弹「查询中」再后台查、悬浮窗预创建（首次热键零等待）、查询期间禁止自动隐藏（防「等结果时窗口消失」）、离线词典进页面就后台预载。延迟工程的一半在心理感知。

**⑦ 桌面应用按 Web 应用设防** —— `preload.js`、`index.js:189-213`、`sync.js:57-62,123-131`
contextIsolation + sandbox + contextBridge 白名单 API；IPC 按 `senderFrame.url` 校验来源；token 比较用 `timingSafeEqual` 防时序攻击；静态服务路径规范化防目录穿越；渲染层 escapeHtml 纪律 + 事件绑定处用 DOM 构建而非 innerHTML。Electron 应用的安全清单基本齐了。

**⑧ Windows 自动化一手范式** —— `scripts/uia.ps1`、`hotkey.js:170-213`
UIA TextPattern 读选区（BFS 限 1500 元素防卡死、Paragraph→Line 逐级降级扩展语境）、模拟 Ctrl+C 时对剪贴板做全格式快照恢复（text/html/image/bookmark）。做任何「读取其他应用内容」的工具都用得上。

**⑨ 把产品理念编码成可断言的结构** —— `popup.js:66`、`db.js:142`
「英文释义在中文之上」不是文档口号，而是 DOM 顺序 + 中文 muted class；「语境永远在场」由 `getRecentContexts` 的回捞兜底实现（最近一次没复制句子，就回捞历史上有过的语境）。理念要落到代码结构和测试断言上才不会腐烂。

**⑩ 务实的技术选型与「boring 方案」原则** —— 全项目
无构建系统（代价用 IIFE 纪律 + `check-mobile-globals.js` 检查脚本偿还）、删除用墓碑而非物理删、悬浮卡放弃 WebView 透明改用原生对话框 Activity（设备碎片化下选必然正确的方案）、Anki 导出用 TSV 头部约定。选型逻辑始终是「跨设备/跨环境必然稳定」优先于「技术上更优雅」。

**⑪ 刻意复制时的防漂移纪律** —— `mobile/www/db.js` vs `main/db.js`、`vocab.js` vs `vocabtest.js`
两端无共享代码库（一个 Node 一个浏览器），SM-2/合并/词汇量算法各有一份同语义实现。防漂移手段：注释互相指认（「与 PC xx 同语义」）、`sync-test.js` 断言锁行为、AGENTS.md 明文约定「改 SM-2 必须同步改 sync-test 断言」。适合 monorepo 外的双端项目参考。

---

*本文档基于 2026-09 的代码库现状编写；若结构大改，请对照最新代码修订。*
