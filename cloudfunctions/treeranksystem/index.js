/* KSST 演唱技能树 · 云端 treeranksystem  v11
   ─────────────────────────────────────────────────────────────
   本轮修复：老师自建的「学生档案」被误识别成技能树用户、还被分配了老师。

   现象：管理后台多出 3 个「微信用户」，各自带着老师（叶芷睿 / 邓宵），
         0 分 0 点；但技能树还没发正式版，这些人不可能进过技能树页面。

   根因（两处叠加，不是这次新建档）：
     ① 早期版本做过一次「只读联动」，把约课系统里老师自建的学生档案
        （users.tearchreOpenid_course）批量补建进 ksst_scores，名字默认
        「微信用户」、teacherId 直接取档案里的老师 openid。代码后来删了，
        但这些历史记录一直留在集合里。
     ② v10 为了修「新号选老师无限循环」，把准入①从「users 里有有效档案」
        放宽成「ksst_scores 有 _openid 即可」；而 hasPicked() 的「老记录兼容」
        又会把 teacherPicked 缺失 + teacherId 非空的记录直接判定为
        「本人选过老师」。两条一叠加 → 历史脏记录集体平反、浮上榜单和后台。

   v11 口径（唯一，board / adminList / manageList / 发点 / 改归属共用）：
     ① 真·本人进过技能树页面：ksst_scores.entered === true
        或 ksst_progress 里有该 _openid 的记录。
        —— entered 由 sync / bindTeacher / saveProgress 从微信上下文写入，
           前端伪造不了；progress 是 v8 起每个进页面的人必建的明细集合。
        老师自建学生档案两样都没有 → 永远挡在外面。
     ② 本人主动在选老师弹层点选过（teacherPicked===true）。
        老记录兼容仍保留，但必须先满足①，不再凭 teacherId 非空就平反。
     ③ 删除一切「从 users 档案批量补建 ksst_scores」的路径：
        ensureScore() 整段移除、manageList 不再给 virtual 人建档、
        manageCredits / adminSetTeacher 的 @usersDocId 分支改为直接拒绝。
        以后老师在约课系统里新增多少学生档案，都不会再进入技能树。

   历史脏记录：默认只做读取隔离（不删、不动任何数据），
   想物理清掉把 PURGE_FAKE_SCORES 改 true、重传、打开一次管理后台即可。

   顺带优化：eligibleRecords 不再为「自检统计」多读一遍 users 全集，
   board / adminList 只读 ksst_scores + ksst_progress 两个集合。

   前序能力全部保留：进度上云、分数由点亮数推导、额度 0 起/上限课程数、
   师生同榜、选完不能自己改、后台改归属、名字搜索、三关答题前端逻辑。
   本轮只改这一个云函数，小程序页面文件一个都不用动。
   ───────────────────────────────────────────────────────────── */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'ksst_scores';       // 榜单 / 额度 / 归属（轻量）
const PROG = 'ksst_progress';    // ★ v8：完整点亮明细（较重，单独集合）
const USERS = 'users';
const TEACHERS = 'teachers';

const DEFAULT_TEACHER_CREDITS = 0;   // 老师初始 0 点
const DEFAULT_STUDENT_CREDITS = 0;
const DEFAULT_TOTAL = 30;            // 兜底课程数；实际以 sync 传的 total 为准
const VER = 11;

/* 想把「现有老师账号」的额度也一次性清零，把下面改成 true 重传一次云函数，
   再改回 false 重传（否则每次 sync 都会清）。 */
const RESET_EXISTING_TEACHER_CREDITS = false;
/* ★ v11：可选清理历史脏记录。默认 false = 只做读取隔离、绝不删数据。
   想物理删除「老师自建档案被补建」的孤儿记录，改成 true、重传云函数、
   用老师号打开一次「管理后台」，看到人数正常后再改回 false 重传。 */
const PURGE_FAKE_SCORES = false;

/* 总管理员：所有老师用户的归属默认挂在他名下。
   留空则自动按名字查 teachers / users 集合的 _openid；
   若改名或查不到，把罗宇轩的 openid 直接填进引号里最稳。 */
const OWNER_NAME = '罗宇轩';
const OWNER_OPENID = '';

function ok(data) { return Object.assign({ ok: true, ver: VER }, data); }
function fail(msg) { return { ok: false, ver: VER, msg: msg }; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); }
function capOf(rec) { return clamp(num(rec && rec.total, DEFAULT_TOTAL), 1, 100); }

/* ---------- v8：云端进度集合 ksst_progress ----------
   结构：{ _openid, progress:{lit,picks,major,exams,everLit}, litCount, total, updatedAt }
   规范化只保留「值为 true 且 id 合法」的项，挡掉脏数据 / 恶意塞大对象。 */
const PROG_KEYS = ['lit', 'picks', 'major', 'exams', 'everLit'];
function normalizeProgress(p) {
  const out = { lit: {}, picks: {}, major: {}, exams: {}, everLit: {} };
  if (!p || typeof p !== 'object') return out;
  PROG_KEYS.forEach(function (k) {
    const v = p[k];
    if (!v || typeof v !== 'object') return;
    const ids = Object.keys(v);
    for (let i = 0; i < ids.length && i < 200; i++) {
      const id = String(ids[i]);
      if (id.length > 40) continue;
      if (v[ids[i]] === true) out[k][id] = true;
    }
  });
  // 点亮过的都算「曾经点亮」（撤销后免答重学的依据）
  Object.keys(out.lit).forEach(function (id) { out.everLit[id] = true; });
  return out;
}
function countLit(pr) { return Object.keys(pr.lit || {}).length; }
async function myProgress(openid) {
  const r = await db.collection(PROG).where({ _openid: openid }).limit(1).get()
    .catch(function () { return { data: [] }; });
  return r.data.length ? r.data[0] : null;
}
async function dedupeProgress(openid) {
  const r = await db.collection(PROG).where({ _openid: openid }).limit(20).get()
    .catch(function () { return { data: [] }; });
  for (let i = 1; i < r.data.length; i++) {
    await db.collection(PROG).doc(r.data[i]._id).remove().catch(function () {});
  }
}

/* ★ v6 上榜资格判定（唯一口径，board / selfCheck / adminList 共用）
   本人在选老师弹层主动点选过（teacherPicked=true）才算。
   老记录（v5 及更早没有这个字段）做一次只读兼容：
     非老师、非后台代改、且已有非空归属 → 视为当年本人选过，避免老学生集体掉榜；
     老师记录 / 后台代改记录一律 false，必须本人再选一次。 */
function hasPicked(rec, pset) {
  if (!rec) return false;
  const tid = String(rec.teacherId || '').trim();
  if (!tid) return false;
  /* ★ v11：先确认本人真的进过技能树页面。
     老师自建档案被历史联动补建的记录（无 entered、无 progress）在这里
     直接被挡，不再凭 teacherId 非空就「平反」成已选老师。 */
  if (!isRealEntered(rec, pset)) return false;
  if (rec.teacherPicked === true) return true;
  /* 老记录兼容仍保留，但只对真实进过页面的用户生效 */
  if (rec.teacherPicked === undefined &&
      rec.isTeacher !== true && rec.teacherManaged !== true) return true;
  return false;
}

/* ★ 唯一判据：users 记录有非空 _openid 才是「微信用户档案」。
   空串 / 纯空格 / 'undefined' / 'null' 都算没有。 */
function cleanOpenid(u) {
  if (!u || typeof u !== 'object') return '';
  const s = String(u._openid === undefined || u._openid === null ? '' : u._openid).trim();
  if (!s || s === 'undefined' || s === 'null' || s === '0') return '';
  return s;
}
function isWechatUser(u) { return !!cleanOpenid(u); }

/* ★ v11：ksst_progress 是「本人真的进过技能树页面」的权威名单。
   前端每次进页面都 loadProgress；云端没记录就立刻 saveProgress 建一条，
   哪怕一节课都没点亮。老师自建的学生档案永远不会有这个记录。
   集合不可读时返回空集合，不影响已 sync 过的人（他们有 entered=true）。 */
async function progressOpenidSet() {
  const set = {};
  try {
    let page = 0;
    while (page < 10) {
      const r = await db.collection(PROG).skip(page * 100).limit(100).get()
        .catch(function () { return { data: [] }; });
      const d = r.data || [];
      d.forEach(function (x) { const o = cleanOpenid(x); if (o) set[o] = 1; });
      if (d.length < 100) break;
      page++;
    }
  } catch (e) {}
  return set;
}

/* ★ v11 唯一「进过技能树」判据：
   entered 由云函数从 getWXContext() 写入（sync / bindTeacher / saveProgress），
   前端拿不到也改不了；或 ksst_progress 里有明细。二者有一即可。 */
function isRealEntered(rec, pset) {
  const o = cleanOpenid(rec);
  if (!o) return false;
  if (rec && rec.entered === true) return true;
  return !!(pset && pset[o]);
}

async function myRecord(col, openid) {
  const r = await col.where({ _openid: openid }).limit(1).get();
  return r.data.length ? r.data[0] : null;
}
/* ★ v10：新号第一次进页面时，sync / saveProgress / bindTeacher 可能并发
   新建多条同 openid 记录。旧版一律保留第一条，会把「选老师」那条删掉
   → 下一轮 board 又说没选过。现在优先保留 teacherPicked=true 的那条，
   并把其他行上的关键状态合并过去，再删重复记录。 */
async function dedupe(col, openid) {
  const r = await col.where({ _openid: openid }).limit(20).get();
  const rows = r.data || [];
  if (rows.length < 2) return;
  let keep = rows[0];
  rows.forEach(function (x) {
    if (x.teacherPicked === true && keep.teacherPicked !== true) keep = x;
    else if ((x.teacherPicked === true) === (keep.teacherPicked === true) &&
             num(x.updatedAt, 0) > num(keep.updatedAt, 0)) keep = x;
  });
  const merge = {};
  rows.forEach(function (x) {
    if (x._id === keep._id) return;
    if (x.teacherPicked === true) {
      merge.teacherPicked = true;
      merge.teacherManaged = false;
      if (x.teacherId) merge.teacherId = x.teacherId;
      if (x.teacherName) merge.teacherName = x.teacherName;
    }
    if (num(x.credits, 0) > num(keep.credits, 0)) merge.credits = num(x.credits, 0);
  });
  if (Object.keys(merge).length) {
    await col.doc(keep._id).update({ data: merge }).catch(function () {});
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]._id !== keep._id) {
      await col.doc(rows[i]._id).remove().catch(function () {});
    }
  }
}
async function checkTeacher(col, openid, claimed) {
  const me = await myRecord(col, openid);
  if (!me) return null;
  if (me.isTeacher !== true && claimed !== true) return null;
  return me;
}

/* ---------- 读 users 全集（分页，避免 100 条上限漏人） ----------
   分类结果：
     valid      有效微信用户档案（_openid 非空，且不是老师自建档案）
     noOpenid   没有 _openid（后台导入 / 手动加的老师自建档案）
     teacherOwn _openid 指向某位老师（云开发 add 自动写调用者 openid 的自建档案）
     filtered   noOpenid + teacherOwn，全部挡在系统外
   自检 selfCheck 会把这几个数字摊出来，一眼验证判据是否生效。 */
async function loadUsers() {
  let all = [], page = 0;
  while (page < 10) {
    const r = await db.collection(USERS).skip(page * 100).limit(100).get()
      .catch(function () { return { data: [] }; });
    const d = r.data || [];
    all = all.concat(d);
    if (d.length < 100) break;
    page++;
  }
  // 老师 openid 集合：users 里 isTeacher=true 的 + teachers 集合里的
  const tset = {};
  all.forEach(function (u) {
    if (u && u.isTeacher === true) { const o = cleanOpenid(u); if (o) tset[o] = 1; }
  });
  try {
    const t = await db.collection(TEACHERS).limit(100).get().catch(function () { return { data: [] }; });
    (t.data || []).forEach(function (x) { const o = cleanOpenid(x); if (o) tset[o] = 1; });
  } catch (e) {}

  const valid = [], noOpenid = [], teacherOwn = [];
  all.forEach(function (u) {
    const o = cleanOpenid(u);
    if (!o) { noOpenid.push(u); return; }
    // 老师账号自己保留；非老师记录却用了老师 openid → 判定为老师自建档案
    if (u.isTeacher !== true && tset[o]) { teacherOwn.push(u); return; }
    valid.push(u);
  });
  return {
    all: all, valid: valid,
    noOpenid: noOpenid, teacherOwn: teacherOwn,
    filtered: noOpenid.concat(teacherOwn),
    teacherSet: tset
  };
}
/* 有效微信用户的 openid 集合（榜单 / 发点 / 改归属都按它严格过滤） */
async function validOpenidSet() {
  const r = await loadUsers();
  const set = {};
  r.valid.forEach(function (u) { const o = cleanOpenid(u); if (o) set[o] = 1; });
  return { set: set, stat: r };
}
/* ★ @usersDocId 分支专用：必须校验「这条 users 文档本身」是有效微信档案。
   只看它的 _openid 在不在有效集合里是不够的——老师自建档案若被云开发 add
   写成老师自己的 openid，那个 openid 确实在集合里，会被误判成老师本人。 */
async function validUserDocSet() {
  const r = await loadUsers();
  const set = {};
  r.valid.forEach(function (u) { if (u._id) set[String(u._id)] = 1; });
  return set;
}
async function loadScores(col) {
  let all = [], page = 0;
  while (page < 10) {
    const r = await col.skip(page * 100).limit(100).get()
      .catch(function () { return { data: [] }; });
    const d = r.data || [];
    all = all.concat(d);
    if (d.length < 100) break;
    page++;
  }
  return all;
}

/* ★★ v10：唯一「准入」口径，board / adminList 共用，规则永远一致。
   两条同时满足：
     ① 进入过技能树：ksst_scores 有建档且 _openid 非空。
        ★ 不再要求 users 集合里另有档案 —— 这个 _openid 是云函数从
          cloud.getWXContext() 写入的，前端拿不到也伪造不了，本身就是
          「该微信用户登录过技能树」的铁证。约课小程序 addUsers 只在
          首页/我的页登录时建档，直接进技能树的新号 users 里可能为空，
          旧口径会把真人永远判成「没进过页面」→ 选老师无限循环。
        ★ 老师自建档案仍被条件②挡住：ensureScore 补建时写
          teacherPicked=false，hasPicked() 返回 false，不会凭空上榜。
     ② 本人主动选过老师：hasPicked(rec)
   返回原始 ksst_scores 记录，调用方各自排序 / 映射字段。
   entered 仅满足条件①，用于统计「还没选老师的人数」。
   stat 仍带 users 判据统计，供 selfCheck 诊断展示，不参与过滤。 */
async function eligibleRecords(col, pset) {
  const all = await loadScores(col);
  /* ★ v11：entered 只认「真进过技能树页面」的人，不再是有 _openid 就算 */
  const entered = all.filter(function (x) { return isRealEntered(x, pset); });
  const rows = entered.filter(function (x) { return hasPicked(x, pset); });
  return {
    rows: rows, entered: entered,
    /* 统计用：被隔离的历史脏记录数（不删数据，只不显示） */
    fake: all.length - entered.length,
    stat: { valid: [], filtered: [] }
  };
}

/* ★ v11 可选清理：只删除「无 entered、无 progress」的历史孤儿记录，
   绝不碰任何真实用户（真用户 sync 过就有 entered=true）。
   默认关闭；打开方式见文件顶部 PURGE_FAKE_SCORES 注释。 */
async function purgeFake(col, pset) {
  const all = await loadScores(col);
  let n = 0;
  for (let i = 0; i < all.length; i++) {
    if (isRealEntered(all[i], pset)) continue;
    await col.doc(all[i]._id).remove().catch(function () {});
    n++;
  }
  return n;
}

/* ---------- 罗宇轩的 openid ---------- */
async function ownerOpenid() {
  if (OWNER_OPENID) return String(OWNER_OPENID).trim();
  try {
    const t = await db.collection(TEACHERS).where({ name: OWNER_NAME }).limit(1).get();
    if (t.data && t.data.length) { const o = cleanOpenid(t.data[0]); if (o) return o; }
  } catch (e) {}
  try {
    const u = await db.collection(USERS).where({ name: OWNER_NAME }).limit(5).get();
    const wx = (u.data || []).filter(isWechatUser);
    const hit = wx.filter(function (x) { return x.isTeacher === true; })[0] || wx[0];
    if (hit) return cleanOpenid(hit);
  } catch (e) {}
  return '';
}

/* ---------- 技能树名单（只读） ----------
   ★ v11：不再从 users 集合「造人」。
     以前 allPeople 会给每个 users 档案建一条 virtual 记录，manageList
     再 ensureScore 把它写进 ksst_scores —— 这正是「老师新增学生档案
     就被技能树识别并分配老师」的口子。现在名单只来自 ksst_scores，
     且必须通过 isRealEntered（真进过技能树页面）。
     「我」那一行由 manageList 末尾兜底，不依赖 users。 */
async function allPeople(col, owner, pset) {
  const scores = await loadScores(col);
  const map = {};
  scores.forEach(function (s) {
    if (!s || !isRealEntered(s, pset)) return;
    const key = cleanOpenid(s);
    map[key] = {
      openid: key, usersDocId: '',
      name: String(s.name || '').trim() || '微信用户',
      isTeacher: s.isTeacher === true,
      scoreDocId: String(s._id),
      score: num(s.score, 0), credits: num(s.credits, 0),
      total: num(s.total, DEFAULT_TOTAL),
      teacherId: String(s.teacherId || ''), teacherName: String(s.teacherName || ''),
      teacherManaged: s.teacherManaged === true,
      creditsManaged: s.creditsManaged === true,
      teacherPicked: hasPicked(s, pset),
      virtual: false
    };
  });
  const list = Object.keys(map).map(function (k) { return map[k]; });
  list._orphan = 0; list._usersTotal = list.length; list._filtered = 0;
  /* 老师账号的管理视角默认归罗宇轩：仅展示，不写库、不影响上榜资格。
     只作用于 isTeacher 的真实账号，绝不碰学生档案。 */
  list.forEach(function (p) {
    if (p.isTeacher && !p.teacherPicked && !p.teacherManaged && owner) {
      p.teacherId = owner; p.teacherName = OWNER_NAME;
    }
  });
  return list;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('拿不到微信身份，请在小程序里打开');
  const col = db.collection(COL);
  const action = event && event.action;
  const e = event || {};
  const owner = await ownerOpenid();
  /* ★ v11：本次请求内有效的「真进过技能树」名单（ksst_progress）。
     board / adminList / manageList / 发点 / 改归属全部复用这一份判据。 */
  const pset = await progressOpenidSet();
  if (PURGE_FAKE_SCORES && action === 'adminList' && e.isTeacher === true) {
    await purgeFake(col, pset);
  }

  /* ---------- ★ v8：读取本人的云端课程点亮进度 ----------
     所有进入技能树页面的人都会调用。云端没记录时返回 exists:false，
     前端会把本机明细上传一次作为迁移（老用户分数不丢）。 */
  if (action === 'loadProgress') {
    await dedupeProgress(OPENID);
    const cur = await myProgress(OPENID);
    if (!cur) {
      const sc = await myRecord(col, OPENID).catch(function () { return null; });
      return ok({ exists: false, progress: null, litCount: 0, rev: 0,
                  legacyScore: sc ? num(sc.score, 0) : 0 });
    }
    const pr = normalizeProgress(cur.progress);
    return ok({
      exists: true, progress: pr,
      litCount: countLit(pr),
      total: num(cur.total, DEFAULT_TOTAL),
      rev: num(cur.rev, num(cur.updatedAt, 0))
    });
  }

  /* ---------- ★ v8：保存完整点亮明细，并让榜单分数严格跟随进度 ----------
     乐观锁：前端带 baseRev（上次拉到的单调修订号）；若云端已被别的设备
     更新过，返回 conflict + 最新进度，前端覆盖本地后重新渲染，不互相覆盖。
     ★ 用 rev 而不是时间戳：同一毫秒内连续两次写入，Date.now() 会相等，
       时间戳做锁会漏判冲突。baseRev=0 表示「不校验」（首次建档 / 离线恢复）。 */
  if (action === 'saveProgress') {
    const pr = normalizeProgress(e.progress);
    const litCount = countLit(pr);
    const total = Number(e.total);
    if (!Number.isInteger(total) || total < 1 || total > 100) return fail('课程总数无效');
    if (litCount > total) return fail('点亮数超过课程总数');

    await dedupeProgress(OPENID);
    const cur = await myProgress(OPENID);
    const base = num(e.baseRev, 0);
    const curRev = cur ? num(cur.rev, num(cur.updatedAt, 0)) : 0;
    if (cur && base > 0 && curRev !== base) {
      const latest = normalizeProgress(cur.progress);
      return {
        ok: false, ver: VER, conflict: true,
        msg: '进度已在另一台设备更新，已同步最新进度',
        progress: latest, litCount: countLit(latest),
        rev: curRev
      };
    }

    const now = Date.now();
    const nextRev = curRev + 1;
    const data = {
      progress: pr, litCount: litCount, total: total,
      rev: nextRev, updatedAt: now
    };
    if (cur) {
      await db.collection(PROG).doc(cur._id).update({ data: data });
    } else {
      await db.collection(PROG).add({ data: Object.assign({ _openid: OPENID }, data) });
    }

    /* ★ 榜单分数只由云端进度推导：score = litCount。
       这样换手机、撤销、清空之后，榜单和进度永远一致，也不会出现
       「前端传了个假分数」和真实点亮数对不上的情况。 */
    const scoreRec = await myRecord(col, OPENID);
    if (scoreRec) {
      await col.doc(scoreRec._id).update({
        data: { score: litCount, total: total, updatedAt: now }
      });
    } else {
      // 极少数情况：进度先到、榜单记录还没建（sync 尚未跑完）→ 补建一条
      await col.add({ data: {
        _openid: OPENID,
        name: String(e.name || '微信用户').trim() || '微信用户',
        score: litCount, total: total, credits: 0,
        teacherId: '', teacherName: '', teacherPicked: false,
        isTeacher: e.isTeacher === true,
        entered: true, updatedAt: now
      } });
    }
    return ok({ litCount: litCount, score: litCount, total: total, rev: nextRev, updatedAt: now });
  }

  /* ---------- 云端自检 ---------- */
  if (action === 'selfCheck') {
    let readable = false, count = 0, err = '';
    try {
      await col.limit(1).get();
      readable = true;
      try { count = (await col.count()).total; } catch (e2) {}
    } catch (err2) { err = String((err2 && err2.message) || err2); }
    const ur = await loadUsers();
    const people = await allPeople(col, owner, pset);
    const me = await myRecord(col, OPENID).catch(function () { return null; });
    // ★ v8：进度集合是否可读、本人是否已建档、云端点亮数
    let progReadable = false, progCount = 0, progErr = '';
    try {
      await db.collection(PROG).limit(1).get();
      progReadable = true;
      try { progCount = (await db.collection(PROG).count()).total; } catch (e3) {}
    } catch (e4) { progErr = String((e4 && e4.message) || e4); }
    const prog = await myProgress(OPENID);
    // ★ v9：准入口径统计（榜单 / 后台共用同一份），一眼验证「没选老师的人确实被挡了」
    const el = await eligibleRecords(col, pset);
    return ok({
      ver: VER, env: cloud.DYNAMIC_CURRENT_ENV, collection: COL,
      progressCollection: PROG,
      progReadable: progReadable, progErr: progErr, progCount: progCount,
      progExists: !!prog, progLit: prog ? countLit(normalizeProgress(prog.progress)) : 0,
      readable: readable, err: err,
      count: count, userCount: ur.all.length,
      // ★ 判据统计：老师自建档案到底有没有被挡住，看这几个数
      judge: '_openid 非空',
      wxValid: ur.valid.length,
      wxNoOpenid: ur.noOpenid.length,
      wxTeacherOwn: ur.teacherOwn.length,
      wxFiltered: ur.filtered.length,
      wxOrphanScores: people._orphan || 0,
      peopleCount: people.length,
      ownerOpenid: owner, ownerName: OWNER_NAME,
      courseTotal: me ? num(me.total, DEFAULT_TOTAL) : DEFAULT_TOTAL,
      // ★ v6 上榜准入：① 进过技能树页 ② 本人选过老师（师生都要）
      boardRule: '① 进入过技能树 ② 本人选过老师（后台名单同规则）',
      eligibleCount: el.rows.length,
      enteredCount: el.entered.length,
      fakeCount: el.fake || 0,
      needPickCount: el.entered.length - el.rows.length,
      meEntered: !!me,
      mePicked: hasPicked(me, pset),
      openid: OPENID,
      me: me ? {
        name: me.name || '', score: num(me.score, 0), total: num(me.total, 30),
        credits: me.credits === undefined || me.credits === null ? '(缺字段)' : num(me.credits, 0),
        isTeacher: me.isTeacher === true,
        teacherId: me.teacherId || '', teacherName: me.teacherName || '',
        teacherPicked: me.teacherPicked === true
      } : null,
      actions: ['selfCheck','sync','board','bindTeacher','manageList','manageCredits','adminList','adminSetTeacher','loadProgress','saveProgress']
    });
  }

  /* ---------- 同步分数 / 昵称 / 身份 ---------- */
  if (action === 'sync') {
    const name  = String(e.name || '').trim();
    const score = Number(e.score);
    const total = Number(e.total);
    if (name.length < 2 || name.length > 16) return fail('昵称需 2–16 个字');
    if (!Number.isInteger(total) || total < 1 || total > 100) return fail('课程总数无效');
    // ★ v8：前端传的 score 只是兜底值（云端会用 ksst_progress.litCount 覆盖），
    //   所以不再按 total 卡它，避免老版本页面传大分数时被误拦。
    if (!Number.isInteger(score) || score < 0 || score > 1000) return fail('分数格式无效');

    await dedupe(col, OPENID);
    const cur = await myRecord(col, OPENID);
    const isTeacher = e.isTeacher === true;
    /* ★ v8：score 不再信任前端传值。只要云端已有进度明细，
       就用它的 litCount；只有还没迁到云端（老记录）时才沿用前端值。 */
    let scoreVal = score;
    const progRec = await myProgress(OPENID);
    if (progRec) scoreVal = countLit(normalizeProgress(progRec.progress));
    const fields = { name: name, score: scoreVal, total: total,
                     entered: true, updatedAt: Date.now() };
    if (e.isTeacher !== undefined) fields.isTeacher = isTeacher;
    // ★ 不再自动给老师写默认归属。老师也必须自己在弹层里选一次老师，
    //   自动写会让前端 myTeacherId 非空 → 误判「已绑定」→ 选老师弹层永远不出现。
    //   罗宇轩的总管理权由 manageList / adminList 的展示兜底保留。
    if (!cur) {
      fields.credits = isTeacher ? DEFAULT_TEACHER_CREDITS : DEFAULT_STUDENT_CREDITS;
      fields.teacherId = '';
      fields.teacherName = '';
      fields.teacherPicked = false;
      await col.add({ data: Object.assign({ _openid: OPENID }, fields) });
    } else {
      if (cur.credits === undefined || cur.credits === null) {
        fields.credits = isTeacher ? DEFAULT_TEACHER_CREDITS : DEFAULT_STUDENT_CREDITS;
      }
      if (cur.teacherId === undefined) fields.teacherId = '';
      if (cur.teacherName === undefined) fields.teacherName = '';
      /* 老记录迁移（v5 及更早没有 teacherPicked 字段）：
         - 非老师且 teacherId 非空 → 他当年确实自己选过老师，补 true 保留上榜
         - 老师 / 后台代改归属的记录 → 没本人点选过，补 false，需自己选一次才上榜 */
      if (cur.teacherPicked === undefined) {
        /* ★ v11：只有「本人真的进过技能树页面」才允许老记录兼容；
           老师自建档案的历史补建记录不会被自动写成已选老师。 */
        fields.teacherPicked = isRealEntered(cur, pset) &&
          cur.isTeacher !== true &&
          cur.teacherManaged !== true &&
          String(cur.teacherId || '').trim() !== '';
      }
      if (RESET_EXISTING_TEACHER_CREDITS && isTeacher) fields.credits = 0;
      await col.doc(cur._id).update({ data: fields });
    }
    const me = await myRecord(col, OPENID);
    return ok({
      score: num(me.score, scoreVal),
      credits: num(me.credits, 0),
      total: num(me.total, DEFAULT_TOTAL),
      teacherId: me.teacherId || '',
      teacherName: me.teacherName || '',
      teacherPicked: me.teacherPicked === true
    });
  }

  /* ---------- 读榜单（师生同榜）----------
     ★ v6 准入两条，缺一不可：
       ① 进过技能树页面：ksst_scores 有记录，且是有效微信用户档案
          （旧联动补建的孤儿记录、老师自建档案一律挡掉）
       ② 本人在选老师弹层主动点选过：teacherPicked===true 且 teacherId 非空
       老师 / 学生一视同仁；后台代改归属不算本人选取。 */
  if (action === 'board') {
    // ★ v9：与 adminList 共用同一份准入口径（eligibleRecords）
    const el = await eligibleRecords(col, pset);
    const entered = el.entered;
    const rows = el.rows.slice().sort(function (a, b) {
      return num(b.score, 0) - num(a.score, 0) || num(a.updatedAt, 0) - num(b.updatedAt, 0);
    });
    const list = rows.map(function (x) {
      return {
        name: x.name || '微信用户',
        score: num(x.score, 0),
        credits: num(x.credits, 0),
        total: num(x.total, DEFAULT_TOTAL),
        teacherId: x.teacherId || '',
        teacherName: x.teacherName || '',
        updatedAt: num(x.updatedAt, 0),
        teacherPicked: true,       // 能上榜的一定是本人选过老师的
        me: x._openid === OPENID
      };
    });
    const mine = entered.filter(function (x) { return x._openid === OPENID; })[0];
    return ok({
      list: list, total: DEFAULT_TOTAL, ownerOpenid: owner,
      admitted: el.rows.length,
      needPick: entered.length - el.rows.length,
      entered: entered.length,
      mePicked: !!(mine && hasPicked(mine, pset)),
      meEntered: !!mine,
      wxValid: 0, wxFiltered: 0, fakeCount: el.fake || 0
    });
  }

  /* ---------- 本人选老师（★ 老师也要选，不再跳过） ----------
     这是「能进榜单」的唯一入口：只有这里会写 teacherPicked=true。
     后台 adminSetTeacher 改归属只动管理权，不写这个标记。 */
  if (action === 'bindTeacher') {
    const tid   = String(e.teacherId || '').trim();
    const tname = String(e.teacherName || '').trim();
    if (!tid) return fail('请选择一位老师');
    await dedupe(col, OPENID);
    const fields = {
      teacherId: tid, teacherName: tname,
      teacherPicked: true, teacherManaged: false,
      entered: true, updatedAt: Date.now()
    };
    const cur = await myRecord(col, OPENID);
    if (!cur) {
      fields.name = String(e.name || '微信用户').trim() || '微信用户';
      fields.score = 0; fields.total = DEFAULT_TOTAL;
      fields.credits = e.isTeacher === true ? DEFAULT_TEACHER_CREDITS : DEFAULT_STUDENT_CREDITS;
      fields.isTeacher = e.isTeacher === true;
      await col.add({ data: Object.assign({ _openid: OPENID }, fields) });
    } else {
      await col.doc(cur._id).update({ data: fields });
    }
    return ok({ teacherId: tid, teacherName: tname });
  }

  /* ---------- 老师：我 + 本人选了我的学生 ----------
     ★ v7 收紧：学生必须是「本人主动在选老师弹层里点选过我」(teacherPicked=true)
       且归属 key 与我一致，才能由我加减技能点。
       系统默认归属、后台代改归属、从没选过老师的人一律不出现在普通加点列表。
       「我」那一行永远保留：老师给自己加减点不受任何归属条件限制。 */
  if (action === 'manageList') {
    if (e.isTeacher !== true) return fail('仅老师可进入管理');
    const me = await checkTeacher(col, OPENID, true) ||
               { name: '', teacherId: '', isTeacher: true };
    const key = String(e.teacherKey || me.teacherId || me.name || '').trim();
    if (!key) return fail('未识别到老师身份，请先在「我的」页确认老师信息');

    const people = await allPeople(col, owner, pset);
    const list = [];
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const isMe = p.openid === OPENID;
      const pickedMine = p.teacherPicked === true && (
        String(p.teacherId || '') === key || String(p.teacherName || '') === key
      );
      if (!isMe && !pickedMine) continue;
      /* ★ v11：不再给「只有 users 档案」的人自动补建 ksst_scores。
         老师新增的学生档案不会因此进入技能树、更不会被分配老师。 */
      list.push({
        uid: p.scoreDocId || '__me__',
        name: p.name || '微信用户',
        score: p.score,
        credits: p.credits,
        total: p.total,
        teacherName: p.teacherName || '',
        isTeacher: p.isTeacher,
        me: p.openid === OPENID
      });
    }
    if (!list.some(function (x) { return x.me; })) {
      list.unshift({
        uid: '__me__', name: String(e.myName || me.name || '我'),
        score: 0, credits: 0, total: DEFAULT_TOTAL,
        teacherName: '', isTeacher: true, me: true
      });
    }
    list.sort(function (a, b) {
      return (b.me ? 1 : 0) - (a.me ? 1 : 0) ||
             (b.isTeacher ? 1 : 0) - (a.isTeacher ? 1 : 0) ||
             a.name.localeCompare(b.name);
    });
    return ok({ list: list, teacherKey: key, ownerOpenid: owner });
  }

  /* ---------- 发放 / 收回解锁额度 ---------- */
  if (action === 'manageCredits') {
    if (e.isTeacher !== true) return fail('仅老师可管理技能点');
    const me = await checkTeacher(col, OPENID, true) ||
               { name: '', teacherId: '', isTeacher: true };
    const delta = Number(e.delta);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) {
      return fail('调整数量需为整数');
    }

    let uid = String(e.uid || '');
    let target;
    if (!uid || uid === '__me__') {
      target = await myRecord(col, OPENID);
      if (!target) {
        await col.add({ data: {
          _openid: OPENID,
          name: String(e.name || me.name || '微信用户').trim() || '微信用户',
          score: 0, total: DEFAULT_TOTAL, credits: 0,
          teacherId: String(e.teacherKey || me.teacherId || '').trim(),
          teacherName: me.name || '', isTeacher: true,
          entered: true, updatedAt: Date.now()
        } });
        target = await myRecord(col, OPENID);
      }
      uid = target._id;
    } else if (uid.charAt(0) === '@') {
      /* ★ v11：彻底关闭「从 users 档案补建技能树记录」的入口。
         老师在约课系统里新增的学生档案不是技能树用户，不给发点。 */
      return fail('该档案不是技能树用户，无法发放技能点', 403);
    } else {
      const r = await col.doc(uid).get().catch(function () { return null; });
      target = r && r.data;
      if (!target) return fail('找不到这个人');
      // ★ v11：必须是真进过技能树页面的用户，历史脏记录一律拒绝
      if (!isRealEntered(target, pset)) {
        return fail('该记录不是真实进入过技能树的用户，无法发放技能点', 403);
      }
    }

    const myKey = String(e.teacherKey || me.teacherId || me.name || '').trim();
    const sameGroup = myKey !== '' && (
      String(target.teacherId || '') === myKey || String(target.teacherName || '') === myKey
    );
    const isAdmin = e.admin === true;   // ★ 隐藏管理后台：可管所有人
    if (!isAdmin && target._openid !== OPENID) {
      // 普通管理弹层：本人永远可自加点；其余必须是「本人选了我」的学生
      if (!hasPicked(target, pset) || !sameGroup) {
        return fail('只能给选了自己的学生调整技能点（改归属请到管理后台）', 403);
      }
    }

    const used = num(target.score, 0);
    const cap = capOf(target);                       // 上限 = 课程数量之和
    const next = clamp(num(target.credits, 0) + delta, used, Math.max(used, cap));
    await col.doc(uid).update({ data: { credits: next, creditsManaged: true, updatedAt: Date.now() } });
    return ok({ credits: next, score: used, total: cap,
                me: target._openid === OPENID, admin: isAdmin });
  }

  /* ---------- 统一管理后台：名单与榜单同规则 ----------
     ★ v9：不再列出所有有效微信用户，只列 eligibleRecords() 的人，
       即「① 进过技能树 ② 本人选过老师」两条都满足 —— 和上榜规则完全一致。
       所以没选过老师的学生、从没进过技能树的人，后台都不再出现。
       每行 uid = ksst_scores 文档 id，可直接传给 manageCredits(admin=true)
       或 adminSetTeacher；加减点 / 改归属链路不变。
       可选 keyword：按名字或老师名模糊过滤（前端默认本地即时过滤，
       这个参数给列表很大 / 以后改服务端分页时用）。 */
  if (action === 'adminList') {
    if (e.isTeacher !== true) return fail('仅老师可进入管理后台', 403);
    const el = await eligibleRecords(col, pset);
    const kw = String(e.keyword || '').trim().toLowerCase();
    let rows = el.rows;
    if (kw) {
      rows = rows.filter(function (s) {
        const n = String(s.name || '').toLowerCase();
        const t = String(s.teacherName || '').toLowerCase();
        return n.indexOf(kw) >= 0 || t.indexOf(kw) >= 0;
      });
    }
    const list = rows.map(function (s) {
      const used = num(s.score, 0), credits = num(s.credits, 0);
      return {
        uid: String(s._id),
        name: String(s.name || '微信用户'),
        score: used,
        credits: credits,
        left: Math.max(0, credits - used),
        teacherId: String(s.teacherId || ''),
        teacherName: String(s.teacherName || ''),
        isTeacher: s.isTeacher === true,
        teacherPicked: true,
        eligible: true,
        virtual: false,
        me: s._openid === OPENID
      };
    });
    list.sort(function (a, b) {
      return (b.me ? 1 : 0) - (a.me ? 1 : 0) ||
             (b.isTeacher ? 1 : 0) - (a.isTeacher ? 1 : 0) ||
             b.score - a.score ||
             String(a.name).localeCompare(String(b.name));
    });
    return ok({
      list: list, ownerOpenid: owner,
      total: el.rows.length, matched: list.length, keyword: kw,
      fakeCount: el.fake || 0,
      boardRule: '① 进过技能树 ② 本人选过老师（后台与榜单同规则）'
    });
  }

  if (action === 'adminSetTeacher') {
    if (e.isTeacher !== true) return fail('仅老师可调整归属', 403);
    const uid = String(e.uid || '');
    if (!uid) return fail('缺少目标');
    const tid   = String(e.teacherId || '').trim();
    const tname = String(e.teacherName || '').trim();
    // ★ v7：这是「改老师」的唯一入口（学生本人已不能再改）。
    //   只改管理归属，不动 teacherPicked：
    //     - 原本本人选过老师的学生 → 保留 true，不掉榜（他确实完成过选取动作）
    //     - 从没选过的人 → 仍是 false，不凭空上榜
    //   归属 key 变了以后，新老师可按需给这名学生发点（普通弹层按新 key 认领）。
    const data = {
      teacherId: tid, teacherName: tname,
      teacherManaged: true, updatedAt: Date.now()
    };
    if (uid.charAt(0) === '@') {
      /* ★ v11：同上，不再接受 users 档案作为改归属目标 */
      return fail('该档案不是技能树用户，无法调整归属', 403);
    } else {
      const r = await col.doc(uid).get().catch(function () { return null; });
      if (!r || !r.data) return fail('找不到这个人');
      // ★ v11：真进过技能树页面的用户才能改归属
      if (!isRealEntered(r.data, pset)) {
        return fail('该记录不是真实进入过技能树的用户，无法调整归属', 403);
      }
      /* ★ v11：已经是榜单用户的「老记录」（teacherPicked 字段缺失、靠兼容进榜），
         后台改归属会写 teacherManaged=true，让兼容失效 → 掉榜。
         这里把「已在榜」状态固化成 teacherPicked=true，保证不掉榜。
         从没选过老师的人本来就不在后台名单里，不会被这条凭空抬上来。 */
      if (hasPicked(r.data, pset) && r.data.teacherPicked !== true) {
        data.teacherPicked = true;
      }
      await col.doc(uid).update({ data: data });
    }
    return ok({ teacherId: tid, teacherName: tname });
  }

  return fail('未知操作');
};
