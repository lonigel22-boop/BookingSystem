// 云函数入口文件 · 保险版（撤优化）
// 【保留】v4 的业务修复：时长毫秒、endTime 服务端重算、标准区间相交冲突检测、NaN 拒绝
// 【撤掉】「时间相交下推到 where」+ 满 100 翻页的读取优化循环、roomMatcher 正则加强
//         → 退回「取回候选再在 JS 里严格过滤」，最直白、不会因查询条件写错而漏判
// 【新增】外层 try/catch，任何异常返回 {code:500,msg}，永不 reject
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  event = event || {}
  try {
    console.log('addMyCourse event', event)

    const courseRes = await db.collection('course').where({ _id: event.courseId }).get()
    if (!courseRes.data || !courseRes.data.length || !(Number(courseRes.data[0].minute) > 0)) {
      return { code: 400, msg: '没有课程时长或者该课程不存在，请检查课程设置' }
    }
    const minutes = Number(courseRes.data[0].minute)
    const minute = (minutes > 60 * 24 ? 44 : minutes) * 60 * 1000

    const newStart = Number(event.startTime)
    if (!Number.isFinite(newStart) || newStart <= 0) {
      return { code: 400, msg: '上课时间无效，请重新选择时间' }
    }
    const newEnd = newStart + minute

    // 严格区间相交：首尾相接不算冲突
    const overlaps = (el) => {
      const s = Number(el.startTime), e = Number(el.endTime)
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false
      return newStart < e && newEnd > s
    }
    const describe = (list) => list.map(el =>
      `学生：${el.name || ''}—教师：${el.teacherName || ''}—` +
      `${new Date(el.startTime).toLocaleString()}~${new Date(el.endTime).toLocaleString()}`
    ).join(' ')

    // 最朴素：按学生 / 门店房间各取一批，JS 里过滤（不做 where 下推、不翻页优化）
    const fetchAll = async (where) => {
      const r = await db.collection('myCourses').where(where).limit(100).get()
      let list = (r && r.data) || []
      if (list.length === 100) {
        const r2 = await db.collection('myCourses').where(where).skip(100).limit(100).get()
        list = list.concat((r2 && r2.data) || [])
      }
      return list
    }

    const studentHit = (await fetchAll({ finished: false, _openid: event._openid })).filter(overlaps)
    if (studentHit.length) return { code: 400, msg: '此时间学生已有课程：' + describe(studentHit) }

    if (event.shopId && event.room) {
      const roomHit = (await fetchAll({ finished: false, shopId: event.shopId }))
        .filter(el => String(el.room || '') === String(event.room))
        .filter(overlaps)
      if (roomHit.length) return { code: 400, msg: '此时间该房间已有课程：' + describe(roomHit) }
    }

    const data = {
      startTime: newStart, endTime: newEnd,
      teacherName: event.teacherName, teacherOpenid: event.teacherOpenid,
      shopName: event.shopName, shopId: event.shopId,
      courseId: event.courseId, courseName: event.courseName,
      _openid: event._openid, name: event.name, room: event.room,
      duration: Number(minute), finished: event.finished
    }
    await db.collection('myCourses').add({ data: data })
    return { code: 200, msg: '添加成功', endTime: newEnd, duration: Number(minute) }
  } catch (err) {
    console.error('addMyCourse 未捕获异常（已兜底）', err)
    return { code: 500, msg: '服务暂时不可用，请稍后重试' }
  }
}
