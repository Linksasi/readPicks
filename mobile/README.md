# 拾词 ReadPicks · 手机端

PC 是同步中枢（设置 → 同步 → 启动），手机浏览器扫码即用；要装成 App 则用 Capacitor 打包本目录。

## 形态一：手机浏览器直接用（零安装，已可用）

1. PC 端「设置 → 🔄 同步 → 启动局域网同步」，点「显示配对二维码」
2. 手机连**同一 Wi-Fi**，相机扫码 → 自动打开拾词手机版并完成配对 + 首次全量同步
3. 之后每次打开页面自动增量双向同步；也可点右上角「⟳ 同步」手动触发

- 支持复习（语境挖空 + 英英释义优先，与 PC 完全同一条 SM-2 曲线）、词表浏览/删除
- 数据存在手机 IndexedDB（`readpicks` 库），离线也能复习，联网后自动补同步

## 形态二：Capacitor 打包 APK（真 App，后续划词功能的基础）

前置：Node、Android Studio（含 SDK 33+）、JDK 17。

```bash
cd mobile
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "拾词" com.readpicks.app --web-dir www
npx cap add android
npx cap open android   # 或 npx cap sync && cd android && ./gradlew assembleDebug
```

产物：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

APK 内配对：打开 App → 粘贴 PC 端配对链接（`http://IP:端口/app/?t=…`）→ 配对并同步。
（WebView 独立存储，与手机浏览器互不相通。）

## 同步协议（实现参考）

- 端点：`POST /api/sync`（header `x-sync-token`），一次往返完成 push+pull
- push：本地新增事件行（`queries`，uuid 幂等）+ 脏词行（LWW，`updated_at` 新者胜）
- pull：游标（上次 `serverTime`），服务端返回 `updated_at`/`srv_at` 之后的词行（含墓碑）与事件行
- 删除是墓碑（`deleted=1`）；重新查到已删词 = 复活并重置 SM-2
- `query_count`/`last_seen` 由事件流推导，单调不回退，跨端并发查词不丢计数

## 目录

- `www/db.js` — IndexedDB 数据层（与 PC `main/db.js` 同 schema 语义）
- `www/sync.js` — 同步客户端（配对/增量拉推/设备身份）
- `www/vendor/supermemo.js` — SM-2 内嵌版（与 PC npm 包同实现，保证曲线一致）
- `www/app.js` / `www/app.css` / `www/index.html` — 复习/词表/设置 UI
