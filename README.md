# ReadPicks 拾词 — 划词查词 · 语境理解 · 生词积累（Windows）

阅读英文网页/文献时，选中生词按 `Alt+Q` 即可查询；自动积累「单词 + 当时语境句子」，SM-2 间隔重复复习，营造母语式学习环境。

## 功能

- **划词查词**：选中单词按 `Alt+Q`（可改）→ 悬浮窗显示音标/词性/释义/词频标签/第 N 次查询；模拟复制取词，**剪贴板零污染**（自动恢复原内容，不影响你复制其他东西）
- **语境句子**：最近 1 分钟内复制过含该词的句子，自动作为语境——整句翻译 + 该词在句中的译法 + 挖空保存（`{{c1::word}}`）
- **句子翻译**：选中整句按热键 → 整句译文（PDF 复制断行自动清理）
- **生词本 + 历史**：每次查询入库（单词/音标/释义/语境/句译/时间/次数），单词卡可查看历史记录
- **复习**：SM-2 间隔重复（Anki 同款算法），托盘「今日复习」弹卡自评（认识/模糊/忘记）
- **导出 Anki**：设置 → 导出 Anki 生词本（制表符 .txt，Anki 直接导入）
- **离线词典**：ECDICT 76 万词条（音标/释义/词频/cet4-6/考研/雅思/托福标签），首次在设置里一键下载（约 216MB），之后离线秒查；词形还原（gave→give）
- **翻译源可选**：MyMemory（免费默认）/ 有道智云 / 百度翻译 / DeepL / OpenAI 兼容 LLM（DeepSeek、通义等；LLM 模式额外解释「为什么这么译」并提取句中其他生词）
- **可选项**：复制即弹（Ctrl+C 即查）、自动发音（英/美音）

## 开发运行

```bash
npm install          # 若 Electron 二进制下载慢：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start            # 启动应用（系统托盘常驻）
```

测试：

```bash
npx electron scripts/smoke-test.js   # 核心逻辑（数据库/SM-2/Anki/回溯/翻译）
npx electron scripts/gui-test.js     # GUI 全链路（IPC/渲染/持久化）
npx electron scripts/dl-test.js      # ECDICT 下载+查询验证
```

打包：

```bash
npx electron-builder --win nsis      # 安装包
npx electron-builder --win portable  # 免安装版
```

## 使用提示

1. 阅读时遇到生词 → 选中它 → 按 `Alt+Q`
2. 想让生词带上语境：把**包含该词的句子**复制一下（Ctrl+C），再查词——1 分钟内会自动带上语境
3. 选中整个句子按热键 = 整句翻译
4. 托盘菜单：今日复习 / 设置 / 退出
5. 首次使用建议：设置 → 词典 → 下载 ECDICT 离线词典；设置 → 翻译源 → 配置 LLM 可获得最佳语境解释

## 数据

- 配置：`%APPDATA%/tran-en/config.json`（目录名为早期命名，保持不变以兼容已有数据）
- 生词本：`%APPDATA%/tran-en/words.db`
- 词典：`%APPDATA%/tran-en/ecdict/`

## 技术栈

Electron 37 · better-sqlite3 · supermemo (SM-2) · electron-builder。零其他原生模块。

方案设计详见 [PLAN.md](PLAN.md)（含同类工具调研结论：Pot / CopyTranslator / 沙拉查词 / GoldenDict-ng 等的借鉴与取舍）。
