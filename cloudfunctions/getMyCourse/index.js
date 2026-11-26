// 云函数入口文件 · 保险版 v2（修 -501000 响应超 1MiB）
// 【根因】原版 aggregate + lookup 把 users【整份文档】join 进每条课程，
//   且全量无上限返回。users 档案内含 tearchreOpenid_course 大数组（每个 course
//   又带 currentCourse 明细），几百条课程叠起来轻松超过 1048576 B。
//   网关在函数成功返回之后拒绝 → 前端拿到 callFunction:fail -501000。
//   「只有罗宇轩正常」= 他名下课程少、包小；邓宵等人课程多、包过 1MiB。
//   数据随排课累积跨过阈值 → 「突然不行」「回退旧版也不行」全部自洽。
// 【修法】① lookup 结果只保留前端真正读的 3 个字段（无损裁剪，体积降几十倍）
//         ② return 前量字节，极端情况再按条数二分截断（<900KB 保险丝）
//         ③ 保留 result.data 结构与全部业务字段、保留 v1 的 aggregate→get 兜底
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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


/* 房间统计页 studentOf() 只读 si[0].name / nickName；
   myClass 只读课程自身的 courseId / _openid / startTime / endTime / duration。
   所以 join 进来的整份 users 文档只需留这 3 个字段。 */
function slimStudentInfo(list) {
  return (list || []).map(row => {
    const si = row && row.studentInfo
    if (!si) return row
    const slim = (Array.isArray(si) ? si : [si]).map(u => ({
      _openid: u && u._openid,
      name: u && u.name,
      nickName: u && u.nickName
    }))
    return Object.assign({}, row, { studentInfo: slim })
  })
}

exports.main = async (event, context) => {
  event = event || {}
  const wxContext = cloud.getWXContext()
  const make = () => ({
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    result: { data: [] }
  })

  try {
    console.log('getMyCourse event', event)
    const where = {}
    if (event._openid) where._openid = event._openid
    if (event.teacherOpenid) where.teacherOpenid = event.teacherOpenid
    if (event.shopId) where.shopId = event.shopId
    if (event.startTime && event.endTime) {
      where.startTime = _.gte(event.startTime).and(_.lte(event.endTime))
    }
    if (typeof event.finished === 'boolean') where.finished = event.finished

    const orderStr = (event.order && event.order.string) ? event.order.string : '_id'
    const orderAsc = !(event.order && event.order.order === 'desc')

    let list = []
    try {
      const r = await db.collection('myCourses')
        .aggregate()
        .match(where)
        .lookup({ from: 'users', localField: '_openid', foreignField: '_openid', as: 'studentInfo' })
        .sort({ [orderStr]: orderAsc ? 1 : -1 })
        .limit(1000)
        .end()
      list = (r && (r.list || r.data)) || []
      console.log('aggregate 返回', list.length)
    } catch (aggErr) {
      console.error('aggregate 失败，退回 where().get()', aggErr)
      try {
        const r2 = await db.collection('myCourses').where(where).limit(100).get()
        list = (r2 && r2.data) || []
        if (list.length === 100) {
          const r3 = await db.collection('myCourses').where(where).skip(100).limit(100).get()
          list = list.concat((r3 && r3.data) || [])
        }
      } catch (getErr) {
        console.error('兜底 get 也失败', getErr)
        list = []
      }
    }

    // ★ 无损裁剪：整份 users 档案 → 3 个字段
    list = slimStudentInfo(list)

    const resp = make()
    // ★ 体积保险丝：整体超 900KB 才按条数截断（裁字段后通常远不到）
    return capResp(resp, list, d => { resp.result.data = d })
  } catch (err) {
    console.error('getMyCourse 未捕获异常（已兜底返回空数据）', err)
    const resp = make()
    resp._safe = 'empty-on-error'
    return resp
  }
}
