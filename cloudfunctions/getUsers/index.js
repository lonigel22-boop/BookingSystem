// 云函数入口文件 · 保险版 v2（同源风险：users 档案内嵌大数组）
// 保留原版 where / field 投影 / 返回数组结构；
// 新增：返回前量字节，超 900KB 按条数截断，避免 -501000 让整个页面挂掉。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/* ─────────────── 响应体积闸门（修 -501000） ───────────────
   微信云开发 callFunction 响应上限 1 MiB = 1048576 B。
   超过时网关在函数【成功返回之后】直接拒绝，函数内 try/catch 抓不到。
   所以在 return 之前自己量一次，超了就裁，留 64KB 余量。 */
const SAFE_BYTES = 900 * 1024
function byteLen(v) {
  try { return Buffer.byteLength(JSON.stringify(v), 'utf8') }
  catch (e) { return 1 << 30 }
}
/* 把 list 裁到「整个 resp 装得下」；二分找最大可保留条数。
   返回 { data, _capped, _total, _kept }，全部作为附加字段，不改动原有结构。 */
function capResp(resp, list, setData) {
  let data = Array.isArray(list) ? list : []
  const put = (d) => { setData(d); return resp }
  if (byteLen(put(data)) <= SAFE_BYTES) {
    resp._capped = false
    return resp
  }
  let lo = 0, hi = data.length, keep = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (byteLen(put(data.slice(0, mid))) <= SAFE_BYTES) { keep = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  put(data.slice(0, keep))
  resp._capped = true
  resp._total = data.length
  resp._kept = keep
  console.error('[响应体积] 已裁剪避免 -501000：原', data.length, '条 → 保留', keep, '条')
  return resp
}


exports.main = async (event, context) => {
  event = event || {}
  console.log('getUsersEvent', event)
  try {
    const where = { name: new RegExp(event.name || '', 'i') }
    if (event.teacherOpenid) {
      where['tearchreOpenid_course.teacherOpenid'] = event.teacherOpenid
    }
    if (event._openid) where._openid = event._openid

    const page = Number(event.page) || 0
    const pageSize = Number(event.pageSize) || 100

    const res = await db.collection('users')
      .where(where)
      .field({
        _id: true, name: true, nickName: true, avatarUrl: true,
        isTop: true, tearchreOpenid_course: true, _openid: true, isTeacher: true
      })
      .skip(page * pageSize)
      .limit(pageSize)
      .get()
    const rows = (res && Array.isArray(res.data)) ? res.data : []

    // 体积闸门：数组作为整体返回，包一层哨兵对象来量，但不改变最终返回类型
    if (byteLen(rows) <= SAFE_BYTES) return rows
    let lo = 0, hi = rows.length, keep = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (byteLen(rows.slice(0, mid)) <= SAFE_BYTES) { keep = mid; lo = mid + 1 }
      else hi = mid - 1
    }
    console.error('[响应体积] getUsers 已裁剪：原', rows.length, '条 → 保留', keep, '条')
    return rows.slice(0, keep)
  } catch (err) {
    console.error('getUsers 未捕获异常（已兜底返回空数组）', err)
    return []
  }
}
