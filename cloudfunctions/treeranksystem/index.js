// 云函数：treeranksystem —— KSST 技能树学习榜
// 微信 openid 由 cloud.getWXContext() 提供，前端拿不到也伪造不了。
// 一个 openid 一条记录；sync 时顺带写入最新昵称，实现「改名后榜单名字跟着变」。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'ksst_scores';

function ok(data) { return Object.assign({ ok: true }, data); }
function fail(msg) { return { ok: false, msg: msg }; }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('拿不到微信身份，请在小程序里打开');
  const col = db.collection(COL);
  const action = event && event.action;

  /* ---- 提交分数：按 openid 覆盖写「当前点亮数」 ---- */
  if (action === 'sync') {
    const name  = String((event && event.name) || '').trim();
    const score = Number(event && event.score);
    const total = Number(event && event.total);
    if (name.length < 2 || name.length > 16) return fail('昵称需 2–16 个字');
    if (!Number.isInteger(total) || total < 1 || total > 100) return fail('课程总数无效');
    if (!Number.isInteger(score) || score < 0 || score > total) return fail('分数超出范围');

    const data = { name: name, score: score, total: total, updatedAt: Date.now() };
    const r = await col.where({ _openid: OPENID }).limit(1).get();
    if (r.data.length) {
      await col.doc(r.data[0]._id).update({ data: data });
    } else {
      // 云函数里 add 不会自动带 _openid，必须显式写
      await col.add({ data: Object.assign({ _openid: OPENID }, data) });
    }
    return ok({ score: score });
  }

  /* ---- 读榜单：分数降序，同分先达到者靠前 ---- */
  if (action === 'board') {
    const r = await col.orderBy('score', 'desc').orderBy('updatedAt', 'asc').limit(100).get();
    const list = r.data.map(function (x) {
      return {
        name: x.name || '微信用户',
        score: Number(x.score) || 0,
        updatedAt: Number(x.updatedAt) || 0,
        me: x._openid === OPENID      // 前端靠这个标记认出「我」，不需要暴露 openid
      };
    });
    return ok({ list: list });
  }

  return fail('未知操作');
};
