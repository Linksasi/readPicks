// 同步链路测试：schema 迁移 / 合并语义（LWW、墓碑、事件并集、计数推导）/ 服务端协议往返
// npx electron scripts/sync-test.js
const { app } = require('electron');

app.whenReady().then(async () => {
  let origSync = null;
  try {
    const assert = (cond, label) => { if (!cond) throw new Error('FAIL: ' + label); console.log('PASS', label); };
    const db = require('../main/db');
    const config = require('../main/config');
    const sync = require('../main/sync');

    // 保存用户真实 sync 配置，测试结束恢复（测试会临时改写 enabled/port/token）
    origSync = JSON.parse(JSON.stringify(config.load().sync || {}));

    db.init();

    // 1. schema 迁移：新列存在，历史行 uuid/srv_at 已回填
    const rawDb = require('better-sqlite3')(require('path').join(config.getDataDir(), 'words.db'));
    const wcols = rawDb.prepare('PRAGMA table_info(words)').all().map((c) => c.name);
    const qcols = rawDb.prepare('PRAGMA table_info(queries)').all().map((c) => c.name);
    assert(wcols.includes('updated_at') && wcols.includes('deleted'), 'words.updated_at/deleted 列存在');
    assert(qcols.includes('uuid') && qcols.includes('srv_at'), 'queries.uuid/srv_at 列存在');
    const nullUuid = rawDb.prepare('SELECT COUNT(*) AS c FROM queries WHERE uuid IS NULL').get().c;
    const zeroSrv = rawDb.prepare('SELECT COUNT(*) AS c FROM queries WHERE srv_at = 0').get().c;
    assert(nullUuid === 0 && zeroSrv === 0, '历史行 uuid/srv_at 全量回填');
    rawDb.close();

    // 2. recordLookup：每次查询都落事件行，uuid 唯一；裸查词也计数
    db.purgeWord('syncapple');
    db.recordLookup({ word: 'syncapple', definition: 'n. 苹果' });
    db.recordLookup({ word: 'syncapple', definition: 'n. 苹果', context: 'An apple a day.', contextCloze: 'An {{c1::apple}} a day.' });
    const w = db.getWord('syncapple');
    assert(w.query_count === 2, 'query_count 由事件推导=2');
    assert(w.updated_at > 0 && w.deleted === 0, 'updated_at 已维护、非墓碑');

    // 3. 墓碑：删除后不进任何用户视图，同步增量仍携带
    db.removeWord('syncapple');
    const dead = db.getWord('syncapple');
    assert(dead.deleted === 1, '删除=墓碑');
    assert(db.dueWords().every((x) => x.word !== 'syncapple') && db.allWords().every((x) => x.word !== 'syncapple'), '墓碑不进词表/复习');
    const inc = db.getWordsSince(0);
    assert(inc.some((x) => x.word === 'syncapple' && x.deleted === 1), '同步增量携带墓碑');

    // 4. 复活：重新查询 → 进度重置
    const rec = db.recordLookup({ word: 'syncapple', definition: 'n. 苹果' });
    assert(rec.queryCount === 1, '墓碑复活计数从 1 开始');
    assert(db.getWord('syncapple').deleted === 0, '复活后非墓碑');

    // 5. 合并语义：LWW（旧不让新，新覆盖旧）
    const now = Date.now();
    db.applySyncBatch({ words: [{ word: 'syncapple', note: '旧笔记', updated_at: now - 100000 }] });
    assert(db.getWord('syncapple').note === '', '更旧的远端行不让位于本地（LWW 拒绝）');
    db.applySyncBatch({ words: [{ word: 'syncapple', note: '手机笔记', updated_at: now + 1000 }] });
    assert(db.getWord('syncapple').note === '手机笔记', '更新的远端行覆盖本地（LWW 接受）');
    // 时钟漂移钳制：无历史的新词带超前时间到达 → 钳到当前时间落地
    db.purgeWord('syncskew');
    db.applySyncBatch({ words: [{ word: 'syncskew', note: '未来笔记', updated_at: now + 3600 * 1000 }] });
    const skewRow = db.getWord('syncskew');
    assert(skewRow.note === '未来笔记' && skewRow.updated_at <= now + 6000, '超前时钟被钳制且内容落地');

    // 6. 事件并集：同 uuid 幂等，不同 uuid 并入；计数推导不回退
    const before = db.getWord('syncapple').query_count;
    const uuid1 = require('crypto').randomUUID();
    const applied1 = db.applySyncBatch({ queries: [{ uuid: uuid1, word: 'syncapple', context: 'Sync ctx.', context_cloze: 'Sync {{c1::ctx}}.', created_at: now }] });
    assert(applied1.appliedQueries === 1, '远端事件并入');
    const applied2 = db.applySyncBatch({ queries: [{ uuid: uuid1, word: 'syncapple', context: 'Sync ctx.', created_at: now }] });
    assert(applied2.appliedQueries === 0, '同 uuid 重复推送被忽略（幂等）');
    assert(db.getWord('syncapple').query_count === before + 1, '计数随事件单调 +1 不回退');

    // 7. 服务端协议往返
    // 先把 LWW 实验留下的未来时间戳归一化，避免污染游标语义
    const norm = require('better-sqlite3')(require('path').join(config.getDataDir(), 'words.db'));
    norm.prepare('UPDATE words SET updated_at = ? WHERE updated_at > ?').run(Date.now(), Date.now());
    norm.close();
    config.update({ sync: { enabled: true, port: 9731, token: 'testtoken0123456789abcdef' } });
    const st = await sync.start();
    assert(st.running, '同步服务启动');
    const base = 'http://127.0.0.1:9731';
    const j = async (path, opt = {}) => {
      const r = await fetch(base + path, opt);
      return { code: r.status, body: await r.json().catch(() => null) };
    };
    const hdr = { 'Content-Type': 'application/json', 'x-sync-token': 'testtoken0123456789abcdef' };

    const bad = await j('/api/ping');
    assert(bad.code === 401, '无 token 访问被拒（401）');

    const ping = await j('/api/ping', { headers: hdr });
    assert(ping.code === 200 && ping.body.ok, 'ping 鉴权通过');

    // 手机查词端点：词典命中（本地 ECDICT）或未收录（在线翻译兜底），均不带副作用
    const ecdict = require('../main/ecdict');
    ecdict.init();
    const lemmaHit = ecdict.lookup('running');
    assert(lemmaHit && lemmaHit.matchedBase === 'run', 'lemma 词形还原（解析器修复回归）');
    const lk = await j('/api/lookup', { method: 'POST', headers: hdr, body: JSON.stringify({ word: 'Apple' }) });
    assert(lk.code === 200 && lk.body.word === 'apple', 'lookup 归一化小写');
    assert(lk.body.found === true && Array.isArray(lk.body.defs) && lk.body.defs.length > 0, 'lookup 词典命中返回释义');
    const lk2 = await j('/api/lookup', { method: 'POST', headers: hdr, body: JSON.stringify({ word: 'zzzznooooword' }) });
    assert(lk2.code === 200 && (lk2.body.found === false || lk2.body.translated), 'lookup 未收录：离线时 found=false，有网时在线兜底');
    const totalBefore = db.stats();
    await j('/api/lookup', { method: 'POST', headers: hdr, body: JSON.stringify({ word: 'apple' }) });
    assert(db.stats() === totalBefore, 'lookup 不在 PC 生词本入库（手机本地入库）');

    // 首次全量 pull（游标 0）→ 收到 syncapple 的词行与事件
    const first = await j('/api/sync', { method: 'POST', headers: hdr, body: JSON.stringify({ device: { id: 'dev-test', name: '测试手机' }, cursors: { words: 0, queries: 0 } }) });
    assert(first.code === 200 && first.body.words.some((x) => x.word === 'syncapple'), '全量 pull 携带词行');
    assert(first.body.queries.some((q) => q.word === 'syncapple'), '全量 pull 携带语境事件');

    // 用服务端时间做游标 → 增量为空
    const t1 = first.body.serverTime;
    const second = await j('/api/sync', { method: 'POST', headers: hdr, body: JSON.stringify({ cursors: { words: t1, queries: t1 } }) });
    assert(second.body.words.length === 0 && second.body.queries.length === 0, '游标之后增量为空');

    // 手机 push 一条新词 → 服务端可见，另一设备拉增量能收到
    const push = await j('/api/sync', { method: 'POST', headers: hdr, body: JSON.stringify({
      device: { id: 'dev-test', name: '测试手机' },
      cursors: { words: t1, queries: t1 },
      words: [{ word: 'syncpear', phonetic: '/peə/', definition: 'n. 梨', query_count: 1, first_seen: t1, last_seen: t1, efactor: 2.5, interval: 0, repetitions: 0, due_date: 0, updated_at: t1, deleted: 0 }],
      queries: [{ uuid: require('crypto').randomUUID(), word: 'syncpear', context: 'She peeled a pear.', context_cloze: 'She peeled a {{c1::pear}}.', created_at: t1 }],
    }) });
    assert(push.body.applied.appliedWords === 1 && push.body.applied.appliedQueries === 1, '手机 push 落地');
    const third = await j('/api/sync', { method: 'POST', headers: hdr, body: JSON.stringify({ cursors: { words: t1, queries: t1 } }) });
    assert(third.body.words.some((x) => x.word === 'syncpear') && third.body.queries.some((q) => q.word === 'syncpear'), '其他设备可拉到该词增量');
    assert(db.getWord('syncpear').query_count >= 1, 'push 落地后计数正确');

    // 状态/二维码
    const status = sync.status();
    assert(status.running && Array.isArray(status.devices) && status.devices.some((d) => d.id === 'dev-test'), '设备出现在同步状态');
    const qr = sync.pairQR();
    if (qr.svg) assert(qr.svg.includes('<svg') && qr.url.startsWith('http'), '配对二维码 SVG 生成');

    // 静态托管：手机扫码打开的页面
    const page = await fetch(base + '/app/');
    const html = await page.text();
    assert(page.status === 200 && html.includes('拾词') && html.includes('app.js'), '手机端页面经 /app/ 托管');
    assert((page.headers.get('content-security-policy') || '').includes('api.mymemory.translated.net'), 'CSP 放行 MyMemory（未配对在线兜底可用）');
    assert((await fetch(base + '/', { redirect: 'manual' })).status === 302, '根路径 302 到 /app/');
    const evil = await fetch(base + '/app/..%2f..%2fpackage.json');
    assert(evil.status !== 200 || !(await evil.text()).includes('"main"'), '目录穿越被拒');

    // 直连在线翻译（手机端未配对兜底走的就是这个接口；网络受限时仅警告）
    try {
      const mm = await fetch('https://api.mymemory.translated.net/get?q=apple&langpair=en%7Czh-CN');
      const jd = await mm.json();
      console.log('INFO mymemory 直连返回:', (jd && jd.responseData && jd.responseData.translatedText) || '无');
    } catch (e) {
      console.log('WARN mymemory 直连失败（网络受限时正常）:', e.message);
    }

    sync.stop();
    assert(!sync.status().running, '同步服务停止');

    // 清理测试词（墓碑也物理清掉，不污染真实生词本）
    db.purgeWord('syncapple');
    db.purgeWord('syncpear');
    db.purgeWord('syncskew');

    console.log('ALL SYNC TESTS DONE');
  } catch (e) {
    console.error('SYNC TEST FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    if (origSync) require('../main/config').update({ sync: origSync });
  }
  app.exit(process.exitCode || 0);
});
