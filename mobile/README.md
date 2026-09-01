# 拾词 ReadPicks · 手机端

PC 是同步中枢（设置 → 同步 → 启动），手机浏览器扫码即用；安卓 App 用 Capacitor 打包本目录。

## 形态一：手机浏览器直接用（零安装，已可用）

1. PC 端「设置 → 🔄 同步 → 启动局域网同步」，点「显示配对二维码」
2. 手机连**同一 Wi-Fi**，相机扫码 → 自动打开拾词手机版并完成配对 + 首次全量同步
3. 之后每次打开页面自动增量双向同步；也可点右上角「⟳ 同步」手动触发

- 复习（语境挖空 + 英英释义优先，与 PC 完全同一条 SM-2 曲线）、查词、**词汇量自测**（与 PC 同算法：6 频段抽样 + 假词校准 + 桶估计，约 60 题 2 分钟）、词表浏览/删除
- 查词四级兜底：**离线 mini 词典**（含 WordNet 式英文释义 + 难词标注，8.1MB 随包分发）→ **PC 完整词典**（`/api/lookup`）→ **LLM 直连**（设置页填自己的 OpenAI 兼容接口，生成贴合词汇量的简单英语释义 + 语境句译；APK 内走原生请求不受 CORS 限制）→ **直连 MyMemory 在线翻译**（免费无需配置）→ 如实提示
- **两端完全独立**：手机不依赖电脑即可查词/入库/复习/个性化；同步只管数据互通（生词、语境、SM-2 进度、词汇量水平双向流动，谁后测谁生效）
- 数据存在手机 IndexedDB（`readpicks` 库），离线也能复习，联网后自动补同步

## 形态二：安卓 APK（已生成工程，含划词）

`mobile/android/` 是完整 Capacitor 8 工程，**已内置**：

- `PROCESS_TEXT` 划词入口：任何 App 里选中文字 → 系统菜单出现「拾词」→ 预填查询
- 无障碍语境服务（`ReadPicksAccessibilityService`）：监听文本选择事件缓存节点全文，查词入库时自动提取**所在句子**并挖空（划一个词带出整句；需在系统设置里开启无障碍，仅标准 TextView 渲染的 App 有效）
- 离线 mini 词典 + lemma 词形还原随包分发

打包（已在开发机验证通过，产物 5.9MB）：

```bash
cd mobile
npm install
npx electron ../scripts/build-mini-dict.js   # 生成 www/dict/mini.json（已 gitignore，需重新生成）
npx cap sync android
cd android && JAVA_HOME="C:/Program Files/Java/jdk-21" ./gradlew assembleDebug
# 产物 android/app/build/outputs/apk/debug/app-debug.apk
```

前置：**JDK 21**（Capacitor 8 要求；机器上另有 JDK 17 时用 `JAVA_HOME` 指向 21 即可）、Android SDK platform 36。`local.properties` 记录本机 SDK 路径（已 gitignore，换机器重建）。

APK 内配对：打开 App → 粘贴 PC 端配对链接（`http://IP:端口/app/?t=…`）→ 配对并同步。
（WebView 独立存储，与手机浏览器互不相通。）

## 重建离线词典

```bash
npx electron scripts/build-mini-dict.js [词头数=50000]
npx cap sync android   # APK 需重新同步资产
```

从 PC 的 ECDICT 抽高频词头（frq 序 + Collins/牛津补充）+ lemma 变形表，当前 4.4 万词头 / 4.1MB。

## 同步协议（实现参考）

- 端点：`POST /api/sync`（header `x-sync-token`），一次往返完成 push+pull；`POST /api/lookup` 手机查词
- push：本地新增事件行（`queries`，uuid 幂等）+ 脏词行（LWW，`updated_at` 新者胜）
- pull：游标（上次 `serverTime`），服务端返回 `updated_at`/`srv_at` 之后的词行（含墓碑）与事件行
- 删除是墓碑（`deleted=1`）；重新查到已删词 = 复活并重置 SM-2
- `query_count`/`last_seen` 由事件流推导，单调不回退，跨端并发查词不丢计数

## 目录

- `www/db.js` — IndexedDB 数据层（与 PC `main/db.js` 同 schema 语义）
- `www/sync.js` — 同步客户端（配对/增量拉推/设备身份）
- `www/vendor/supermemo.js` — SM-2 内嵌版（与 PC npm 包同实现，保证曲线一致）
- `www/app.js` / `www/app.css` / `www/index.html` — 复习/查询/词表/设置 UI
- `android/` — Capacitor 安卓工程（划词入口 + 无障碍服务；`npm run cap` 管理）
