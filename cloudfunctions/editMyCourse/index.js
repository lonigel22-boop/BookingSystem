// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/* 把字符串转成「精确且大小写不敏感」的房间正则。
   旧版直接 new RegExp(room, 'i') 是子串匹配：房间「A」会误匹配「AB」，
   房间名含 ()[] 等正则符号还会让查询异常乃至静默失败 → 漏报冲突。 */
function roomMatcher(room) {
  const esc = String(room == null ? '' : room).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + esc + '$', 'i')
}


exports.main = async (event, context) => {
  console.log('editMyCourse event', event)

  // ---------- 0. 取当前记录 + 参数校验 ----------
  if (!event._id) return { code: 400, msg: '缺少课程 ID' }

  const curRes = await db.collection('myCourses').doc(event._id).get().catch(err => {
    console.error('读取当前课程失败', err)
    return null
  })
  const cur = curRes && curRes.data
  if (!cur || !cur._id) return { code: 400, msg: '课程不存在或已被删除' }

  /* ★ 修复点 ①：旧的 `event.startTime || cur.startTime` 遇到 NaN 会悄悄
     回退到旧时间，却又把 NaN 写进库里，之后所有冲突检测都失真。
     现在显式校验，非法时间直接拒绝，不让脏数据落库。 */
  const rawStart = (event.startTime !== undefined && event.startTime !== null && event.startTime !== '')
    ? event.startTime : cur.startTime
  const newStart = Number(rawStart)
  if (!Number.isFinite(newStart) || newStart <= 0) {
    return { code: 400, msg: '上课时间无效，请重新选择时间' }
  }

  /* ★ 修复点 ②（核心 bug）：时长单位。
     库里 duration / endTime 从 addMyCourse 起就一直是「毫秒」
     （minute * 60 * 1000，例如 45 分钟 = 2700000）。
     旧版这里把毫秒当「分钟」又乘 60*1000：
       (Number(duration) > 1440 ? 44 : Number(duration)) * 60 * 1000
     毫秒永远 > 1440 → 恒 fallback 成 44 分钟。
     于是「冲突检测窗口」永远 44 分钟，而真正写入的 endTime 是
     startTime + 用户改后的真实时长：改课时后两者对不上，
     落在 [start+44min, start+真实时长] 的课就检测不到 → 偶尔不报冲突。 */
  let durationMs = Number(event.duration)
  if (!Number.isFinite(durationMs) || durationMs <= 0) durationMs = Number(cur.duration)
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    // 兼容没有 duration 的老记录：用原 endTime 反推，再兜底 45 分钟
    durationMs = Number(cur.endTime) > newStart
      ? Number(cur.endTime) - newStart
      : 45 * 60 * 1000
  }
  const MAX_DURATION = 24 * 60 * 60 * 1000
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION) {
    return { code: 400, msg: '课堂时长无效，请重新填写（1~1440 分钟）' }
  }

  const newEnd = newStart + durationMs
  const shopId = event.shopId || cur.shopId
  const room = event.room || cur.room
  const openid = event._openid || cur._openid

  /* ★ 修复点 ③：重叠判定改成标准「区间相交」。
     旧版只判「新开始落旧区间」或「新结束落旧区间」，
     漏掉「新时段完全包住旧时段」——把课时改长时必踩。 */
  const overlaps = (el) => {
    if (el._id === event._id) return false           // 排除正在修改的这节课
    const s = Number(el.startTime)
    const e = Number(el.endTime)
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false
    return newStart < e && newEnd > s                // 严格相交：首尾相接不算冲突
  }

  const describe = (list) => list.map(el =>
    `学生：${el.name || ''}—教师：${el.teacherName || ''}—` +
    `${new Date(el.startTime).toLocaleString()}~${new Date(el.endTime).toLocaleString()}`
  ).join(' ')

  /* ★ 修复点 ④：把「时间相交」下推到数据库条件里。
     旧版房间查询只有 `startTime > newStart-3h` 一个下界、没有上界，
     结束时间跨进新时段的早开长课查不到；学生查询还按「全集合 count」
     决定分页次数，多跑好几趟空读。现在一次精确查完，读次数明显下降。 */
  const baseWindow = {
    finished: false,
    startTime: _.lt(newEnd),
    endTime: _.gt(newStart),
    _id: _.neq(event._id)
  }
  const fields = {
    _id: true, startTime: true, endTime: true,
    name: true, teacherName: true, shopId: true, room: true
  }

  // 一次取够（条件已收窄到「时间相交」，正常只有几条）；极端情况翻页兜底
  const fetchOverlaps = async (extra) => {
    const where = Object.assign({}, baseWindow, extra)
    const MAX = 100
    const first = await db.collection('myCourses').where(where).field(fields).limit(MAX).get()
    let list = first.data || []
    if (list.length === MAX) {
      let page = 1
      while (page <= 20) {
        const r = await db.collection('myCourses').where(where).field(fields).skip(page * MAX).limit(MAX).get()
        const d = r.data || []
        list = list.concat(d)
        if (d.length < MAX) break
        page++
      }
    }
    return list.filter(overlaps)
  }

  // ---------- 1. 学生时间冲突 ----------
  const studentHit = await fetchOverlaps({ _openid: openid })
  if (studentHit.length) {
    return { code: 400, msg: '此时间学生已有课程：' + describe(studentHit) }
  }

  // ---------- 2. 同门店同房间时间冲突 ----------
  if (shopId && room) {
    const roomHit = await fetchOverlaps({ shopId: shopId, room: roomMatcher(room) })
    if (roomHit.length) {
      return { code: 400, msg: '此时间该房间已有课程：' + describe(roomHit) }
    }
  }

  // ---------- 3. 写入：endTime 一律由服务端按 startTime + duration 重算 ----------
  /* ★ 修复点 ⑤：旧版 `data = {...event}` 直接写前端传来的 endTime。
     前端一旦漏传 / 算错，库里 endTime 就与 duration 不一致，
     而后续所有冲突检测都读库里的 endTime → 一次错误会持续污染后面每次判断。
     现在服务端统一重算，保证库里数据永远自洽（不动其它字段、不改历史数据）。 */
  const patch = Object.assign({}, event, {
    startTime: newStart,
    endTime: newEnd,
    duration: durationMs
  })
  delete patch._id

  try {
    await db.collection('myCourses').where({ _id: event._id }).update({ data: patch })
    return { code: 200, msg: '修改成功', endTime: newEnd, duration: durationMs }
  } catch (err) {
    console.error('更新失败', err)
    return { code: 500, msg: '修改失败' }
  }
}
