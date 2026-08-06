# ReadPicks 拾词

> 划词查词 · 语境理解 · 生词积累复习（Windows 桌面）

[English](README.en.md) | 中文

阅读英文网页、文献、PDF 时，选中生词按 `Alt+Q` 即查——悬浮窗显示音标、释义、词频；同时自动记录「单词 + 当时语境句子」，用 SM-2 间隔重复算法复习，把阅读中遇到的生词变成真正属于自己的词汇，营造母语式学习环境。

---

## 设计理念

**不背中文意思，用英语理解英语，在语境中自然习得。**

- **英英释义优先**：像母语者学新词那样——用你已经会的词解释生词（键盘 = "the thing you use to type on a computer"），而不是建立"英文 ↔ 中文"的翻译映射；中文只是弱化的对照兜底
- **语境即老师**：单词的意义来自它所在的句子。自动带出语境、整句翻译、挖空复习——脱离语境背单词，效率极低
- **适配你的水平**：先测词汇量，再按你的水平生成释义——每个词的解释都在你的舒适区内，超出水平的词就地化解，还会告诉你"这个词对你难不难"
- **不打扰阅读**：划词即查、零等待、不污染剪贴板——查词像呼吸一样自然，不打断阅读心流
- **阅读即积累**：每一次查询都是一次积累，SM-2 在恰当的时间把旧词带回你面前；在阅读中"再次遇到"就是最好的复习

---

## ✨ 功能特性

### 🖱️ 划词即查（UIA 直读，剪贴板零污染）

- **全局热键** `Alt+Q`（可在设置中自定义），任意应用内生效
- 优先通过 **Windows UI Automation 直读**选中文本及所在段落——完全不碰剪贴板
- UIA 不可用时自动回退：**模拟 Ctrl+C + 剪贴板快照恢复**（保存原文本/HTML/图片 → 复制 → 读取 → 立即还原），用完即恢复，不影响你复制其他内容
- **自动识别类型**：1 个单词或 ≤5 词的短语 → 单词卡；更长的文本 → 整句翻译
- **文本清洗**：自动去掉选中的首尾标点、引号；PDF 复制的断行自动合并（行尾连字符拼接、其余空格拼接）
- 3 秒内重复查询自动去重；悬浮窗预创建，按热键**零等待**弹出「查询中」占位

### 🧠 语境理解（差异化核心）

- **剪贴板历史回溯**：自动检索最近 10 分钟内复制过的句子，找到包含该词的那句作为语境，无需手动操作
- **本句译法**：整句翻译 + 该词**在本句中的确切含义**（区别于词典的通用释义）
- **挖空保存**：语境句自动生成填空格式 `{{c1::word}}`，复习时先回忆再揭晓
- 配置 **LLM 翻译源**后额外获得：为什么在这里这么译、词性/搭配/语法用法、句中其他值得学习的生词

### 🗂️ 单词卡界面

- 单词 + 音标 + 🇬🇧 英式 / 🇺🇸 美式发音（有道在线发音）
- 词频与考试标签（来自 ECDICT：`cet4` `cet6` 考研 / 雅思 / 托福 / 专四专八等）
- **查询历史**：每次查询的语境、句译、时间线折叠展示
- **我的笔记**：为每个词记录用法、记忆方法
- **最近查询**快速入口、📌 钉住悬浮窗、`Esc` 关闭

### 📚 生词本与 SM-2 复习

- 每次查询自动入库：单词 / 音标 / 释义 / 语境 / 句译 / 首次与最近查询时间 / 查询次数
- **SM-2 间隔重复**（Anki 同款算法），托盘「今日复习」弹卡，自评 **忘记 / 模糊 / 认识**
- 生词本管理：总数、到期数统计，支持删除单词

### 🗃️ Anki 导出

设置页一键导出制表符 `.txt`（UTF-8，自动带 `#separator:tab` / `#deck` / `#tags` 头部），Anki 直接导入。

### 📖 离线词典（ECDICT）

- **76 万词条**：音标、释义、词频、考试标签全覆盖
- 设置页**一键下载**（约 216MB，支持断点续传）或**从本地 zip 安装**（国内网络慢时浏览器下载后导入）
- 安装后**离线秒查**；内置 **lemma 词形还原**（`gave` → `give`）
- 未安装词典也能用：自动走在线翻译兜底

### 🌐 多翻译源（可切换）

| 翻译源 | 说明 |
|---|---|
| **MyMemory**（默认） | 免费、无需配置，适合日常使用 |
| **有道智云** | 需 appKey/appSecret，控制台申请 |
| **百度翻译** | 需 appId/密钥，开放平台申请 |
| **DeepL** | 需 apiKey，支持免费版/付费版接口 |
| **LLM（OpenAI 兼容）** | DeepSeek、通义千问等；可自定义 baseUrl/model/**系统提示词**；查词时额外给出「本句译法 + 为什么这么译 + 用法 + 句中其他生词」 |
| 仅本地词典 | 完全离线，不看在线翻译 |

所有翻译结果带 **10 分钟缓存**，重复查询不重复请求。

### 📊 词汇量自测（个性化简单英语释义）

- **60 题 · 2 分钟**：从 BNC 语料按词频分 6 档分层抽样，混入伪词校准（借鉴 TestYourVocab 桶估计 + LexTALE 真假词法），完全离线
- 结果：词汇量估算值 + CEFR 级别（A1-C2）+ 各频段通过率
- **测完立刻生效**：查词时不再只给中文——先展示「适合你词汇水平的简单英语释义」（你会的词解释生词，而不是死记中文意思）
  - **LLM 模式**：无论是否复制了语境，查词都会按你的词汇水平生成 COBUILD 风格一句话简单释义（未配 LLM 时自动降级离线释义）
  - **离线模式**：展示英英释义，超出你水平的词标为虚线高亮，**点击就地显示**该词的中文第一义 + 英文简释，不用再查一次
  - **词难度徽章**：单词卡直接显示这个词对你的难度——✓ 在你水平内 / ▲ 略超 / ▲▲ 远超（悬停看词频排名）
- 支持键盘快速答题（→/空格 = 认识，←/X = 不认识），随时可重新测试

### 🎛️ 其他

- **复制即弹**（可选）：开启后 Ctrl+C 复制即自动弹窗查词
- 托盘常驻、单实例锁；数据目录自动迁移（旧命名 `tran-en` → `readpicks`）

---

## 🚀 快速开始

### 方式一：直接运行源码（开发/自用）

```bash
# 1. 安装依赖（国内网络慢时先设置 Electron 镜像，见「常见问题」）
npm install

# 2. 启动应用（系统托盘常驻）
npm start
```

### 方式二：打包安装包

```bash
npx electron-builder --win nsis      # 安装包
npx electron-builder --win portable  # 免安装绿色版
```

### 首次使用向导

1. 打开设置（托盘右键 → 设置）
2. **词典**：下载 ECDICT 离线词典（约 216MB），或跳过——未装词典也能用在线翻译
3. **翻译源**：默认 MyMemory 免费可用；想要「语境逐词解释」效果，建议配置 LLM（如 DeepSeek）
4. 打开任意英文页面，选中生词按 `Alt+Q` 体验

---

## 📖 使用指南

| 操作 | 方法 |
|---|---|
| **查单词/短语** | 选中文本 → 按 `Alt+Q` |
| **查词带语境** | 先 `Ctrl+C` 复制一句**包含该词**的句子（10 分钟内）→ 再选中该词按 `Alt+Q`，语境自动出现 |
| **整句翻译** | 选中整个句子 → 按 `Alt+Q`（自动走句子翻译，PDF 断行自动清理） |
| **听发音** | 单词卡上点 🇬🇧 / 🇺🇸 |
| **复习** | 托盘 → 「今日复习」→ 弹卡自评 忘记 / 模糊 / 认识 |
| **导出 Anki** | 设置 → 生词本 → 导出 Anki 生词本 |
| **记笔记** | 单词卡 → 「我的笔记」→ 保存 |
| **测词汇量** | 设置 → 常规 → 「词汇量自测」（60 题，测完查词显示适配水平的英文释义） |
| **钉住/关闭** | 📌 钉住悬浮窗；`Esc` 或 ✕ 关闭 |

> 💡 小技巧：阅读时遇到生词，顺手先把**整个句子**复制一下再查词，日积月累就形成了带真实语境的个人语料库。

---

## ⚙️ 设置详解

| 设置项 | 说明 | 默认 |
|---|---|---|
| 全局热键 | 任意应用内触发取词 | `Alt+Q` |
| 复制即弹 | 监听剪贴板变化，复制即弹窗 | 关 |
| 默认翻译源 | mymemory / youdao / baidu / deepl / llm / 仅本地词典 | `mymemory` |
| LLM Base URL | OpenAI 兼容接口地址 | `https://api.deepseek.com/v1` |
| LLM 模型 | 模型名 | `deepseek-chat` |
| LLM 系统提示词 | 控制返回 JSON 结构，可自定义 | 内置默认 |

**翻译源申请地址**：有道 [ai.youdao.com](https://ai.youdao.com) · 百度 [fanyi-api.baidu.com](https://fanyi-api.baidu.com) · DeepL [deepl.com/zh/pro-api](https://www.deepl.com/zh/pro-api)

---

## 💾 数据与存储

数据目录固定为 `%APPDATA%/readpicks/`：

```
%APPDATA%/readpicks/
├── words.db                生词本 + 查询历史（SQLite，WAL 模式）
├── config.json             应用配置（热键/翻译源/开关）
├── clipboard-history.json  剪贴板历史（语境回溯数据源）
├── ecdict/
│   └── ecdict.db           ECDICT 离线词典（约 216MB，只读）
└── uia.ps1                 运行时生成的 UIA 取词脚本
```

**words.db 双表结构**：

- `words` — 生词主表：`word`（主键）、`phonetic`、`definition`、`first_seen`、`last_seen`、`query_count`、`note`，以及 SM-2 状态列 `efactor` / `interval` / `repetitions` / `due_date`
- `queries` — 查询历史：每次查询的 `context`（语境原句）、`context_cloze`（挖空）、`sentence_translation`（句译）、`word_in_sentence`（词在句中的译法）、`source`（来源）、时间戳

> 旧版本数据目录名为 `tran-en`，首次启动会自动整体迁移（重命名或复制），无需手动处理。

---

## 🔧 技术架构

```
选中文本 ──按热键──▶ 取词（UIA 直读 → 回退剪贴板快照恢复）
                        │
                        ▼
                 文本清洗 + 类型判定（词/短语/句子）
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
      单词卡：ECDICT 本地词典      句子：在线翻译
      + 剪贴板历史回溯找语境
      + 语境整句翻译（本句译法）
      + LLM 逐词解释（可选）
           │
           ▼
      自动入库 words + queries ──▶ 悬浮窗展示
           │
           ▼
      SM-2 复习（托盘） ◀──▶ Anki 导出
```

关键设计：

- **常驻 PowerShell 命令通道**：取词与 Ctrl+C 模拟通过一个常驻的 PowerShell 进程执行（`__DONE__` 标记协议返回输出），避免每次按键 400ms+ 的进程启动开销；`uia.ps1` 必须带 UTF-8 BOM（PowerShell 5.1）
- **Electron 37 + better-sqlite3 + supermemo**：零其他原生模块；better-sqlite3 为同步 API，WAL 模式保证读写性能
- 单实例锁防止重复启动；托盘图标常驻，窗口全隐藏

完整方案设计（同类工具调研与取舍）见 [PLAN.md](PLAN.md)。

---

## 🛠️ 开发

**环境要求**：Windows 10/11 · Node.js 18+ · npm

```bash
npm install          # 安装依赖（postinstall 自动重建 better-sqlite3）
npm start            # 开发运行
```

**测试**（⚠️ 必须用 `npx electron` 跑，better-sqlite3 是 Electron ABI，node 直接跑会报错）：

```bash
npx electron scripts/smoke-test.js   # 核心逻辑：数据库 / SM-2 / Anki 导出 / 语境回溯 / 翻译
npx electron scripts/gui-test.js     # GUI 全链路：IPC / 渲染 / 持久化
npx electron scripts/uia-test.js     # UIA 取词 + PowerShell 常驻通道
npx electron scripts/dl-test.js      # ECDICT 下载 + 查询验证
npx electron scripts/vocab-test.js   # 词汇量自测：抽样 / 假词校准 / 计分 / 难词标注
npx electron scripts/e2e-vocab-test.js  # 端到端：带词汇量的真实查词渲染（英英释义/浮层/徽章）
npx electron scripts/perf-test.js    # 性能基准
```

**打包**：

```bash
npx electron-builder --win nsis      # 安装包
npx electron-builder --win portable  # 免安装版
```

### 常见问题

**Q：npm install / 打包下载 Electron 太慢？**
国内网络请使用镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

打包时再设置：
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

**Q：热键没反应？**
可能是其他应用占用了 `Alt+Q`，在设置中换一个热键；UIA 取词在部分老旧应用上可能失败，会自动回退剪贴板方案。

---

## 📄 许可证

[MIT](LICENSE) © 2026 Linksasi
