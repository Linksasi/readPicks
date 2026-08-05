# ReadPicks 拾词 — 划词查词 + 语境记忆库 (Windows)

> 定稿日期：方案 v1.0（经 GitHub 同类工具调研修订，用户确认开工）

## 产品定位

Windows 桌面划词查词 + 语境记忆库：阅读英文网页/文献时选中生词一键查词；自动积累「单词 + 当时语境句子」形成个人语料库，SM-2 间隔重复复习，营造母语式学习环境。

差异化（调研确认的空白）：内置生词本 + 查询历史 + 语境句子 + 复习闭环。

## 核心流程

```
阅读中选中单词 → 按 Alt+Q（可配置）
  ├─ 模拟 Ctrl+C 取词（快照保存→复制→读取→恢复，剪贴板零污染）
  ├─ 自动判断：单词 or 句子
  ├─ 剪贴板回溯：近 1 分钟内复制过含该词的句子 → 自动作为语境
  └─ 悬浮窗（跟随鼠标、无边框、置顶）
      单词卡：单词/音标/词性释义/词频标签/第 N 次查询/上次语境
      语境区：原句 + 句译 + 该词在句中的译法
      自动入库：words + queries，查询次数 +1
  复习：托盘「今日复习」→ 挖空语境句(正面) + 释义句译(背面) → 认识/模糊/忘记
  导出：生词本 → Anki .txt
```

## 功能清单

- 抓词：全局快捷键 Alt+Q；模拟 Ctrl+C + 剪贴板快照恢复；可选「复制即弹」监听（默认关）；去重；自身窗口防递归；PDF 换行清理
- 查词：本地 ECDICT SQLite（官方 216MB release 库，首启引导下载可跳过）离线秒查；lemma 词形还原；在线句译（免费默认 + 有道/百度/DeepL/LLM 可配）；发音（有道 dictvoice 英美音）
- 语境：剪贴板历史回溯（1 分钟内含该词的句子自动作语境）；生词本字段含挖空语境句(ContextCloze)、整句译文、笔记、来源；查询历史折叠展示
- 复习：SM-2（npm supermemo 库）间隔重复；托盘今日复习三档自评；导出 Anki 制表符 .txt
- 设置：热键/触发模式/翻译源(key+model)/发音/词典管理

## 技术架构

```
Electron 37 + better-sqlite3 + supermemo + electron-builder
main/        index.js 入口 · hotkey.js 热键+模拟复制+快照恢复
             clipboard-watch.js 复制即弹轮询(防递归) · context.js 剪贴板回溯
             db.js words/queries/settings · ecdict.js 词典查询 · translate.js 翻译适配 · config.js
renderer/    popup.html 单词卡+句译+历史 · review.html 复习卡 · settings.html 设置
数据目录     %APPDATA%/tran-en/（config.json、words.db、ecdict/）
```

```sql
words(word PK, phonetic, definition, first_seen, last_seen, query_count,
      note, efactor, interval, repetitions, due_date)
queries(id PK, word, context, context_cloze, sentence_translation,
        word_in_sentence, source, created_at)
```

## 第一版不做（预留）

UI Automation 直读取词（用快照恢复替代，体验等效）、锚定选中文本矩形、多词典并排、云同步、OCR、输入翻译。

## 同类工具调研要点（2025-08）

- Pot(Tauri,19k⭐)：快捷键取词标杆；UIA 直读不碰剪贴板；无生词本
- CopyTranslator(Electron,18k⭐)：复制即译 + PDF 换行清理；模拟复制污染剪贴板
- nextai-translator：剪贴板快照恢复最完整方案（采用）
- 沙拉查词：语境优先 + 挖空卡片 + 生词本字段设计 + 只记不复习（借鉴，补上复习闭环）
- 沉浸式翻译：防误触哲学（自动弹默认关）
- ECDICT：官方提供现成 SQLite（ecdict-sqlite-28.zip 216MB）；官方无例句库 → 例句靠用户语境积累
