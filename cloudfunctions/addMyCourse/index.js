// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

/* 房间精确匹配（大小写不敏感）。旧版 new RegExp(room,'i') 是子串匹配：
   「A」会误匹配「AB」，房间名含 ()[] 等符号还会让查询异常。*/
function roomMatcher(room) {
  const esc = String(room == null ? '' : room).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + esc + '$', 'i')
}

exports.main = async (event, context) => {
  console.log('addMyCourse event', event)

  // ---------- 0. 课程时长（沿用原有口径：course.minute 是「分钟」）----------
  const courseRes = await db.collection('course').where({ _id: event.courseId }).get()
  if (!courseRes.data || !courseRes.data.length || !(Number(courseRes.data[0].minute) > 0)) {
    return { code: 400, msg: '没有课程时长或者该课程不存在，请检查课程设置' }
  }
  const minutes = Number(courseRes.data[0].minute)
  /* 与 editMyCourse 保持同一单位：duration / endTime 一律是「毫秒」 */
  const minute = (minutes > 60 * 24 ? 44 : minutes) * 60 * 1000

  /* ★ 修复：显式校验时间，避免 NaN 落库（NaN 会让后续所有冲突检测失真） */
  const newStart = Number(event.startTime)
  if (!Number.isFinite(newStart) || newStart <= 0) {
    return { code: 400, msg: '上课时间无效，请重新选择时间' }
  }
  const newEnd = newStart + minute

  const data = {
    startTime: newStart,
    endTime: newEnd,
    teacherName: event.teacherName,
    teacherOpenid: event.teacherOpenid,
    shopName: event.shopName,
    shopId: event.shopId,
    courseId: event.courseId,
    courseName: event.courseName,
    _openid: event._openid,
    name: event.name,
    room: event.room,
    duration: Number(minute),
    finished: event.finished
  }

  /* ★ 修复点：重叠判定改成标准「区间相交」。
     旧版只判「新开始落旧区间 / 新结束落旧区间」，漏掉「新时段完全包住旧时段」。
     与 editMyCourse 用同一套口径，新建和修改的判断结果才一致。 */
  const overlaps = (el) => {
    const s = Number(el.startTime)
    const e = Number(el.endTime)
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false
    return newStart < e && newEnd > s
  }
  const describe = (list) => list.map(el =>
    `学生：${el.name || ''}—教师：${el.teacherName || ''}—` +
    `${new Date(el.startTime).toLocaleString()}~${new Date(el.endTime).toLocaleString()}`
  ).join(' ')

  /* ★ 把「时间相交」下推到查询条件：
     旧版按全集合 count 决定分页（多跑 2 次读），房间查询又只有 startTime 下界；
     现在条件精确，一次取完，读次数从 5+ 降到 3。 */
  const baseWindow = {
    finished: false,
    startTime: _.lt(newEnd),
    endTime: _.gt(newStart)
  }
  const fields = {
    _id: true, startTime: true, endTime: true,
    name: true, teacherName: true, shopId: true, room: true
  }
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
  const studentHit = await fetchOverlaps({ _openid: event._openid })
  if (studentHit.length) {
    return { code: 400, msg: '此时间学生已有课程：' + describe(studentHit) }
  }

  // ---------- 2. 同门店同房间时间冲突 ----------
  if (event.shopId && event.room) {
    const roomHit = await fetchOverlaps({ shopId: event.shopId, room: roomMatcher(event.room) })
    if (roomHit.length) {
      return { code: 400, msg: '此时间该房间已有课程：' + describe(roomHit) }
    }
  }

  console.log('开始时间:' + new Date(data.startTime), '结束时间:' + new Date(data.endTime))

  return await db.collection('myCourses').add({ data: data }).then(() => {
    return { code: 200, msg: '添加成功', endTime: newEnd, duration: Number(minute) }
  })
}
