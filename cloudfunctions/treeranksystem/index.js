// 云函数：treeranksystem —— KSST 技能树学习榜 + 解锁额度 + 师生归属
// 微信 openid 由 cloud.getWXContext() 提供，前端拿不到也伪造不了。
//
// 数据口径（ksst_scores 集合，一个 openid 一条）：
//   name / score / total   昵称、当前点亮数、课程总数
//   credits                老师发放的「解锁额度总量」；可点亮条件 score < credits
//                          撤销 / 清空时 score 变小，额度自动恢复，无需额外扣还
//   teacherId / teacherName 归属的老师（学生选老师时写入；老师自己也写自己的 key）
//   isTeacher              是否老师（来自前端 userInfo，仅用于管理权限）
//
// 权限说明：这是教学激励工具，isTeacher 由前端上报、云端做弱校验，
// 能挡住普通学生误操作，但不是防作弊系统。若以后要强校验，可在云端
// 另建老师 openid 白名单集合替换 checkTeacher()。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'ksst_scores';

const DEFAULT_TEACHER_CREDITS = 30;  // 老师初始额度：老师自己一进来就能点
const DEFAULT_STUDENT_CREDITS = 0;  // 学生初始额度：必须等老师发放
const MAX_CREDITS = 999;

function ok(data) { return Object.assign({ ok: true }, data); }
function fail(msg) { return { ok: false, msg: msg }; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); }

async function myRecord(col, openid) {
  const r = await col.where({ _openid: openid }).limit(1).get();
  return r.data.length ? r.data[0] : null;
}
// 兜底：万一早先版本并发 add 出重复记录，任何一次 sync/bind 都顺手清理成一条
async function dedupe(col, openid) {
  const r = await col.where({ _openid: openid }).limit(20).get();
  for (let i = 1; i < r.data.length; i++) {
    await col.doc(r.data[i]._id).remove().catch(function () {});
  }
}
async function checkTeacher(col, openid, claimed) {
  const me = await myRecord(col, openid);
  if (!me) return null;
  // 旧记录可能还没写入 isTeacher，允许前端上报的身份兜底（教学工具级弱校验）
  if (me.isTeacher !== true && claimed !== true) return null;
  return me;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('拿不到微信身份，请在小程序里打开');
  const col = db.collection(COL);
  const action = event && event.action;
  const e = event || {};

  /* ---------- 同步分数 / 昵称 / 身份 ---------- */
  if (action === 'sync') {
    const name  = String(e.name || '').trim();
    const score = Number(e.score);
    const total = Number(e.total);
    if (name.length < 2 || name.length > 16) return fail('昵称需 2–16 个字');
    if (!Number.isInteger(total) || total < 1 || total > 100) return fail('课程总数无效');
    if (!Number.isInteger(score) || score < 0 || score > total) return fail('分数超出范围');

    await dedupe(col, OPENID);
    const cur = await myRecord(col, OPENID);
    const isTeacher = e.isTeacher === true;
    const fields = { name: name, score: score, total: total, updatedAt: Date.now() };
    // 身份只在上报时更新；不传就不动，避免学生误清老师的标记
    if (e.isTeacher !== undefined) fields.isTeacher = isTeacher;
    // 老师把自己的归属 key 也写进记录，manageList 靠它认领学生
    if (e.teacherKey !== undefined && e.teacherKey !== null && e.teacherKey !== '') {
      fields.teacherId = String(e.teacherKey);
    }
    if (!cur) {
      fields.credits = isTeacher ? DEFAULT_TEACHER_CREDITS : DEFAULT_STUDENT_CREDITS;
      fields.teacherName = '';
      fields.teacherId = fields.teacherId || '';
      await col.add({ data: Object.assign({ _openid: OPENID }, fields) });
    } else {
      // 兼容升级前的旧记录：没有 credits 就按身份补一个初始额度
      if (cur.credits === undefined || cur.credits === null) {
        fields.credits = isTeacher ? DEFAULT_TEACHER_CREDITS : DEFAULT_STUDENT_CREDITS;
      }
      if (cur.teacherId === undefined) fields.teacherId = fields.teacherId || '';
      if (cur.teacherName === undefined) fields.teacherName = '';
      await col.doc(cur._id).update({ data: fields });
    }
    const me = await myRecord(col, OPENID);
    return ok({
      score: score,
      credits: num(me.credits, 0),
      teacherId: me.teacherId || '',
      teacherName: me.teacherName || ''
    });
  }

  /* ---------- 读榜单（师生同榜，顺带把额度/归属带给前端） ---------- */
  if (action === 'board') {
    const r = await col.orderBy('score', 'desc').orderBy('updatedAt', 'asc').limit(100).get();
    const list = r.data.map(function (x) {
      return {
        name: x.name || '微信用户',
        score: num(x.score, 0),
        credits: num(x.credits, 0),
        teacherId: x.teacherId || '',
        teacherName: x.teacherName || '',
        updatedAt: num(x.updatedAt, 0),
        me: x._openid === OPENID
      };
    });
    return ok({ list: list });
  }

  /* ---------- 学生选老师 / 老师认领自己 ---------- */
  if (action === 'bindTeacher') {
    const tid   = String(e.teacherId || '').trim();
    const tname = String(e.teacherName || '').trim();
    if (!tid) return fail('请选择一位老师');
    await dedupe(col, OPENID);
    const fields = { teacherId: tid, teacherName: tname, updatedAt: Date.now() };
    const cur = await myRecord(col, OPENID);
    if (!cur) {
      fields.name = String(e.name || '微信用户').trim() || '微信用户';
      fields.score = 0; fields.total = 30;
      fields.credits = e.isTeacher === true ? DEFAULT_TEACHER_CREDITS : DEFAULT_STUDENT_CREDITS;
      fields.isTeacher = e.isTeacher === true;
      await col.add({ data: Object.assign({ _openid: OPENID }, fields) });
    } else {
      await col.doc(cur._id).update({ data: fields });
    }
    return ok({ teacherId: tid, teacherName: tname });
  }

  /* ---------- 老师：我 + 我的学生（管理技能点） ---------- */
  if (action === 'manageList') {
    const me = await checkTeacher(col, OPENID, e.isTeacher === true);
    if (!me) return fail('仅老师可进入管理', 403);
    const key = String(e.teacherKey || me.teacherId || me.name || '').trim();
    if (!key) return fail('未识别到老师身份，请先在「我的」页确认老师信息', 403);

    /* ★ 联动约课系统：把「我的学生」页认定的学生也纳入管理。
       users.tearchreOpenid_course[].teacherOpenid === 老师 openid 即为名下学生。
       只补建缺失的 ksst_scores 记录，绝不回写 users 表（约课逻辑不受影响）。
       后台改过归属的记录 teacherId 会变成别的 key，这里自然不会再认。 */
    const teacherName = me.name || '';
    let booking = [];
    try {
      const bu = await db.collection('users')
        .where({ 'tearchreOpenid_course.teacherOpenid': key })
        .limit(100).get();
      booking = bu.data || [];
    } catch (err) { /* users 集合或字段不存在时静默跳过 */ }

    for (let i = 0; i < booking.length; i++) {
      const u = booking[i];
      if (!u || !u._openid || u._openid === OPENID) continue;
      const exist = await col.where({ _openid: u._openid }).limit(1).get();
      if (exist.data.length) continue;
      await col.add({ data: {
        _openid: u._openid,
        name: String(u.name || u.nickName || '微信用户').trim() || '微信用户',
        score: 0, total: 30, credits: 0,
        teacherId: key, teacherName: teacherName,
        isTeacher: false, fromBooking: true,
        updatedAt: Date.now()
      } });
    }

    const r = await col.limit(100).get();
    // 归属键兼容两种口径：老师 openid（主），或老师显示名（旧数据兼容）
    const list = r.data.filter(function (x) {
      return x._openid === OPENID ||
             String(x.teacherId || '') === key ||
             String(x.teacherName || '') === key;
    }).map(function (x) {
      return {
        uid: x._id,                       // 只回传文档 id，不暴露 openid
        name: x.name || '微信用户',
        score: num(x.score, 0),
        credits: num(x.credits, 0),
        teacherName: x.teacherName || '',
        isTeacher: x.isTeacher === true,
        me: x._openid === OPENID
      };
    });
    list.sort(function (a, b) { return (b.me ? 1 : 0) - (a.me ? 1 : 0) || a.name.localeCompare(b.name); });
    return ok({ list: list, teacherKey: key });
  }

  /* ---------- 老师：发放 / 收回解锁额度 ---------- */
  if (action === 'manageCredits') {
    const me = await checkTeacher(col, OPENID, e.isTeacher === true);
    if (!me) return fail('仅老师可管理技能点', 403);
    const uid = String(e.uid || '');
    const delta = Number(e.delta);
    if (!uid) return fail('缺少目标');
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 30) return fail('调整数量需为 1–30 的整数');

    const r = await col.doc(uid).get().catch(function () { return null; });
    const target = r && r.data;
    if (!target) return fail('找不到这个人');
    // 只能改自己，或归属同一位老师的学生（id / 名字任一匹配即可）
    const myKey = String(e.teacherKey || me.teacherId || me.name || '').trim();
    const sameGroup = myKey !== '' && (
      String(target.teacherId || '') === myKey || String(target.teacherName || '') === myKey
    );
    if (target._openid !== OPENID && !sameGroup) return fail('只能管理自己名下的学生', 403);

    const used = num(target.score, 0);
    // 收回时不能把已点亮的点数收成负数：下限 = 当前已点亮数
    const next = clamp(num(target.credits, 0) + delta, used, MAX_CREDITS);
    await col.doc(uid).update({ data: { credits: next, updatedAt: Date.now() } });
    return ok({ credits: next, score: used });
  }

  /* ---------- 隐藏后台：所有人 + 归属（统一改归属） ---------- */
  if (action === 'adminList') {
    const me = await checkTeacher(col, OPENID, e.isTeacher === true);
    if (!me) return fail('仅老师可进入管理后台', 403);
    const r = await col.limit(100).get();
    const list = r.data.map(function (x) {
      return {
        uid: x._id,
        name: x.name || '微信用户',
        score: num(x.score, 0),
        credits: num(x.credits, 0),
        teacherId: x.teacherId || '',
        teacherName: x.teacherName || '',
        isTeacher: x.isTeacher === true,
        me: x._openid === OPENID
      };
    });
    list.sort(function (a, b) { return (b.me ? 1 : 0) - (a.me ? 1 : 0) || b.score - a.score; });
    return ok({ list: list });
  }

  if (action === 'adminSetTeacher') {
    const me = await checkTeacher(col, OPENID, e.isTeacher === true);
    if (!me) return fail('仅老师可调整归属', 403);
    const uid = String(e.uid || '');
    if (!uid) return fail('缺少目标');
    const tid   = String(e.teacherId || '').trim();
    const tname = String(e.teacherName || '').trim();
    const r = await col.doc(uid).get().catch(function () { return null; });
    if (!r || !r.data) return fail('找不到这个人');
    // 不允许把别人的老师记录清空成学生（保护老师身份），其余随意
    await col.doc(uid).update({ data: {
      teacherId: tid, teacherName: tname, updatedAt: Date.now()
    } });
    return ok({ teacherId: tid, teacherName: tname });
  }

  return fail('未知操作');
};
