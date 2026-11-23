// 云函数：treeranksystem —— KSST 技能树学习榜 + 解锁额度 + 师生归属
// v10 改动（本轮）：★ 修复「学生选完老师又无限弹出选老师弹层」
//   根因：eligibleRecords 用 validOpenidSet()（users 集合里 _openid 非空）
//     过滤「进过技能树」的人。但约课小程序的 addUsers 只在首页/我的页登录时
//     建档；学生若直接进技能树页，users 里可能还没有他 → board 的 entered
//     里没有 mine → mePicked 永远 false。即使 bindTeacher 把 teacherPicked
//     写成 true，每次 board 回来仍说「没选过」，前端把状态打回 false → 无限弹。
//   修法：ksst_scores._openid 是云函数从 cloud.getWXContext() 写入的、前端
//     伪造不了，本身就是「微信登录并进过技能树」的铁证，不该再要求 users
//     里另有档案。条件① 改为「ksst_scores 有建档且 _openid 非空」。
//     条件② hasPicked() 不变（老师自建档案 teacherPicked=false 仍被挡）。
//     同步放宽 manageCredits / adminSetTeacher 对 ksst_scores uid 的校验，
//     否则这个新号虽能上榜却发不了技能点。@usersDocId 分支仍严格校验。
//
// v9 改动：★ 管理后台名单与榜单准入规则彻底统一
//   - 抽出唯一口径 eligibleRecords(col)：① 进过技能树（ksst_scores 有建档
//     且 openid 在有效微信用户集合里）② 本人主动选过老师 hasPicked()
//   - board 与 adminList 都调用它，规则永远一致，不会改一处漏一处
//   - 后台不再出现「没进过技能树」「没选过老师」的人（virtual 行全部消失）
//   - adminList 新增可选 keyword（按名字 / 老师名模糊过滤），前端默认本地即时过滤
//   - 每行 uid 仍是 ksst_scores 文档 id，可直接传给 manageCredits(admin=true)
//     和 adminSetTeacher，加减点 / 改归属链路不变
//
// v8 改动：★ 课程点亮进度整体搬上云端
//   - 新建集合 ksst_progress：一个 openid 一条，存完整
//     { lit, picks, major, exams, everLit } 明细 + litCount + updatedAt
//   - 新增 action：loadProgress / saveProgress；sync 的 score 以云端进度为准
//   - 所有进入技能树页面的人都会建档：云端无记录时，前端把本机明细
//     上传一次作为迁移（老用户分数不丢）；之后换手机从云端拉回
//   - 榜单分数 score 由 saveProgress 推导，保证「分数 = 真实点亮数」
//   - 乐观锁 baseRev（单调修订号）：多设备同时改时返回冲突与最新进度，不互相覆盖
//   - 本机 wx.setStorageSync 降级为纯离线缓存 / 秒开渲染用，不再是主存储
//
// v7 改动：
//   ① 普通管理弹层收紧：老师只能给「本人主动选了自己」的学生加减技能点；
//      老师给自己加减点永远允许（不占用任何归属条件）。
//      系统默认归属 / 后台代改归属 / 没选过老师的人，都不再出现在普通加点列表里。
//   ② 新增后台发点：adminCredits 走 manageCredits(admin=true)，可给「所有」人加减点，
//      仍受有效微信用户判据与课程数上限约束。
//   ③ 归属改动的唯一入口 = 隐藏管理后台（isTeacher 才可进）；前端不再允许本人改老师。
//      已选过老师的学生被后台改归属时保留 teacherPicked，不掉榜。
//   ④ 隐藏后台升级为「统一管理页」：所有人的归属 + 技能点都在一处管。
//
// v6 改动：★ 重设定「能进入技能树排行榜」的条件
//   必须同时满足两条，缺一不可：
//     ① 进入过技能树这个页面 → ksst_scores 里有 sync 建的记录（且是有效微信用户）
//     ② 无论老师 / 非老师，都要本人在「选择你的老师」弹层里主动点选过
//        → teacherPicked === true 且 teacherId 非空
//   配套改动：
//     - 老师不再跳过选老师；前端名单里保证有「自己」这一项（罗宇轩选自己即可）
//     - sync 不再自动给老师写默认归属（否则前端误判「已绑定」而不弹选老师）
//     - 归属后台代改归属 ≠ 本人选取，adminSetTeacher 不写 teacherPicked，
//       后台只调整管理权，不能代替上榜资格（后台会标注「未选老师·未上榜」）
//     - 罗宇轩的总管理权保留：manageList/adminList 对「未主动选过的老师」仍默认归他名下
//     - 老的 teacherId 记录没有 teacherPicked，按新规则需本人重选一次才上榜
//     - board 额外返回 admitted / needPick 统计，前端把准入规则直接展示出来
//
// v5 改动：判据改回「微信用户档案 = users 里有非空 _openid」
//   - 上一版用 wechatid 之类字段当判据，方向错了：真实微信注册档案的标识就是
//     _openid，老师自建档案反而可能带「微信号」字段，于是又混了进来。
//   - 现在严格：users._openid 非空才算微信用户档案。
//   - ★ 额外堵一个坑：老师自建档案若是云开发 add 建的，_openid 会自动写成
//     「调用者（老师）自己的 openid」。这种记录虽非空但不是学生本人，
//     也判为自建档案挡掉（老师账号本身 isTeacher=true 保留）。
//   - ksst_scores 里没有对应有效微信档案的孤儿记录（旧联动补建的 fromBooking）
//     一律忽略：不进榜单、不进管理列表、不进后台、不能发点、不能改归属。
//
// 其余口径沿用 v3/v4：
//   老师初始额度 0；额度上限 = 课程数量之和；学生自选老师；
//   所有老师用户归属默认罗宇轩；归属后台仅底部连划 3 次进入。
//
// 微信 openid 由 cloud.getWXContext() 提供，前端拿不到也伪造不了。
// 权限：教学激励工具，isTeacher 由前端上报、云端弱校验，不是防作弊系统。

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
const VER = 10;

/* 想把「现有老师账号」的额度也一次性清零，把下面改成 true 重传一次云函数，
   再改回 false 重传（否则每次 sync 都会清）。 */
const RESET_EXISTING_TEACHER_CREDITS = false;

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
function hasPicked(rec) {
  if (!rec) return false;
  const tid = String(rec.teacherId || '').trim();
  if (!tid) return false;
  if (rec.teacherPicked === true) return true;
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
async function eligibleRecords(col) {
  const all = await loadScores(col);
  const entered = all.filter(function (x) { return !!cleanOpenid(x); });
  const rows = entered.filter(function (x) { return hasPicked(x); });
  const vs = await validOpenidSet();      // 仅用于自检统计，不再过滤
  return { rows: rows, entered: entered, stat: vs.stat };
}

/* ★ v10：ksst_scores 里已有建档的 openid 集合。
   manageCredits / adminSetTeacher 用 uid（ksst_scores 文档 id）定位人时，
   记录存在且 _openid 非空即可，不再要求 users 里另有档案；
   否则新号能上榜却发不了技能点。@usersDocId 分支仍走严格校验。 */
async function scoreOpenidSet(col) {
  const all = await loadScores(col);
  const set = {};
  all.forEach(function (x) { const o = cleanOpenid(x); if (o) set[o] = 1; });
  return set;
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

/* ---------- 合并「有效微信用户 users」+「技能树记录 ksst_scores」 ----------
   ★ 唯一入口是 users 里有非空 _openid 的微信用户档案。
     ksst_scores 只给这些人补 score / credits / 归属 / 文档 id；
     没有对应微信档案的孤儿记录一律丢弃，绝不凭空造人。 */
async function allPeople(col, owner) {
  const ur = await loadUsers();
  const scores = await loadScores(col);
  const map = {};

  ur.valid.forEach(function (u) {
    const key = cleanOpenid(u);
    if (!key) return;
    map[key] = {
      openid: key,
      usersDocId: String(u._id || ''),
      name: String(u.name || u.nickName || '').trim() || '微信用户',
      isTeacher: u.isTeacher === true,
      scoreDocId: '',
      score: 0, credits: 0, total: DEFAULT_TOTAL,
      teacherId: '', teacherName: '',
      teacherManaged: false, creditsManaged: false,
      teacherPicked: false,
      virtual: true
    };
  });

  let orphan = 0;
  scores.forEach(function (s) {
    if (!s) return;
    const key = cleanOpenid(s);
    if (!key) { orphan++; return; }
    const p = map[key];
    if (!p) { orphan++; return; }        // ★ 没有微信档案 → 丢弃
    p.scoreDocId = String(s._id);
    p.score = num(s.score, 0);
    p.credits = num(s.credits, 0);
    p.total = num(s.total, DEFAULT_TOTAL);
    p.teacherId = String(s.teacherId || '');
    p.teacherName = String(s.teacherName || '');
    p.isTeacher = p.isTeacher || s.isTeacher === true;
    p.teacherManaged = s.teacherManaged === true;
    p.creditsManaged = s.creditsManaged === true;
    // ★ 上榜资格：本人在选老师弹层里主动点选过才算（含老记录兼容）
    p.teacherPicked = hasPicked(s);
    p.virtual = false;
    if (s.name) p.name = String(s.name);   // 榜单昵称以技能树里自改的为准
  });

  const list = Object.keys(map).map(function (k) { return map[k]; });
  list._orphan = orphan;
  list._usersTotal = ur.all.length;
  list._filtered = ur.filtered.length;
  // ★ 所有「还没主动选过老师」的老师用户，管理视角默认归罗宇轩。
  //   这是管理权，不是上榜资格：这批人 teacherPicked 仍是 false，不进榜单。
  //   本人已经选过、或后台显式改过归属的，都不覆盖。
  list.forEach(function (p) {
    if (p.isTeacher && !p.teacherPicked && !p.teacherManaged && owner) {
      p.teacherId = owner;
      p.teacherName = OWNER_NAME;
    }
  });
  return list;
}

/* 给「只有 users 记录、还没进过技能树」的人补建 ksst_scores 记录。
   只写技能树集合，绝不回写 users 表，约课逻辑不受影响。 */
async function ensureScore(col, p, owner) {
  if (p.scoreDocId) return p;
  const data = {
    _openid: p.openid,
    name: p.name || '微信用户',
    score: 0, total: DEFAULT_TOTAL, credits: 0,
    isTeacher: p.isTeacher,
    teacherId: p.teacherId || (p.isTeacher ? owner : ''),
    teacherName: p.teacherName || '',
    teacherPicked: p.teacherPicked === true,   // 后台补建档不代替本人选取
    updatedAt: Date.now()
  };
  const r = await col.add({ data: data });
  p.scoreDocId = String(r._id);
  p.virtual = false;
  return p;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('拿不到微信身份，请在小程序里打开');
  const col = db.collection(COL);
  const action = event && event.action;
  const e = event || {};
  const owner = await ownerOpenid();

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
        updatedAt: now
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
    const people = await allPeople(col, owner);
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
    const el = await eligibleRecords(col);
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
      needPickCount: el.entered.length - el.rows.length,
      meEntered: !!me,
      mePicked: hasPicked(me),
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
    const fields = { name: name, score: scoreVal, total: total, updatedAt: Date.now() };
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
        fields.teacherPicked = cur.isTeacher !== true &&
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
    const el = await eligibleRecords(col);
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
      mePicked: !!(mine && hasPicked(mine)),
      meEntered: !!mine,
      wxValid: el.stat.valid.length, wxFiltered: el.stat.filtered.length
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
      updatedAt: Date.now()
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

    const people = await allPeople(col, owner);
    const list = [];
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const isMe = p.openid === OPENID;
      const pickedMine = p.teacherPicked === true && (
        String(p.teacherId || '') === key || String(p.teacherName || '') === key
      );
      if (!isMe && !pickedMine) continue;
      if (p.virtual) await ensureScore(col, p, owner);
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
          updatedAt: Date.now()
        } });
        target = await myRecord(col, OPENID);
      }
      uid = target._id;
    } else if (uid.charAt(0) === '@') {
      // 后台里只有 users 记录的人：★ 必须是有非空 _openid 的有效微信档案
      const ur = await db.collection(USERS).doc(uid.slice(1)).get().catch(function () { return null; });
      if (!ur || !ur.data || !isWechatUser(ur.data)) return fail('该档案不是微信用户，无法发放技能点');
      // ★ 文档级校验：这条 users 记录本身必须在有效微信名单里，
      //   挡掉「冒用老师 openid」的自建档案（否则会误给老师本人发点）
      const docSet = await validUserDocSet();
      if (!docSet[uid.slice(1)]) return fail('该档案不是微信用户，无法发放技能点');
      const vs = await validOpenidSet();
      if (!vs.set[cleanOpenid(ur.data)]) return fail('该档案不是微信用户，无法发放技能点');
      target = await myRecord(col, ur.data._openid);
      if (!target) {
        await col.add({ data: {
          _openid: ur.data._openid,
          name: String(ur.data.name || ur.data.nickName || '微信用户').trim() || '微信用户',
          score: 0, total: DEFAULT_TOTAL, credits: 0,
          teacherId: '', teacherName: '',
          isTeacher: ur.data.isTeacher === true,
          updatedAt: Date.now()
        } });
        target = await myRecord(col, ur.data._openid);
      }
      uid = target._id;
    } else {
      const r = await col.doc(uid).get().catch(function () { return null; });
      target = r && r.data;
      if (!target) return fail('找不到这个人');
      // ★ v10：uid 本身就指向 ksst_scores 记录，_openid 是云函数写的微信身份，
      //   记录存在且 openid 非空即可，不再要求 users 里另有档案（新号也能发点）。
      const sset = await scoreOpenidSet(col);
      if (!sset[cleanOpenid(target)]) {
        return fail('该记录不是有效的微信用户记录，无法发放技能点');
      }
    }

    const myKey = String(e.teacherKey || me.teacherId || me.name || '').trim();
    const sameGroup = myKey !== '' && (
      String(target.teacherId || '') === myKey || String(target.teacherName || '') === myKey
    );
    const isAdmin = e.admin === true;   // ★ 隐藏管理后台：可管所有人
    if (!isAdmin && target._openid !== OPENID) {
      // 普通管理弹层：本人永远可自加点；其余必须是「本人选了我」的学生
      if (!hasPicked(target) || !sameGroup) {
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
    const el = await eligibleRecords(col);
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
      // ★ 必须是有非空 _openid 的有效微信档案，老师自建档案不给改归属
      const ur = await db.collection(USERS).doc(uid.slice(1)).get().catch(function () { return null; });
      if (!ur || !ur.data || !isWechatUser(ur.data)) return fail('该档案不是微信用户，无法调整归属');
      // ★ 同上：必须这条 users 文档本身是有效微信档案
      const docSet = await validUserDocSet();
      if (!docSet[uid.slice(1)]) return fail('该档案不是微信用户，无法调整归属');
      const vs = await validOpenidSet();
      if (!vs.set[cleanOpenid(ur.data)]) return fail('该档案不是微信用户，无法调整归属');
      const rec = await myRecord(col, ur.data._openid);
      if (rec) {
        await col.doc(rec._id).update({ data: data });
      } else {
        await col.add({ data: Object.assign({
          _openid: ur.data._openid,
          name: String(ur.data.name || ur.data.nickName || '微信用户').trim() || '微信用户',
          score: 0, total: DEFAULT_TOTAL, credits: 0,
          isTeacher: ur.data.isTeacher === true
        }, data) });
      }
    } else {
      const r = await col.doc(uid).get().catch(function () { return null; });
      if (!r || !r.data) return fail('找不到这个人');
      // ★ v10：同 manageCredits，ksst_scores 记录存在且 openid 非空即可
      const sset = await scoreOpenidSet(col);
      if (!sset[cleanOpenid(r.data)]) {
        return fail('该记录不是有效的微信用户记录，无法调整归属');
      }
      await col.doc(uid).update({ data: data });
    }
    return ok({ teacherId: tid, teacherName: tname });
  }

  return fail('未知操作');
};
