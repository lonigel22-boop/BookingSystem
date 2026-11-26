// 云函数入口文件 · 保险版（撤优化）
// 【保留】v4 的业务修复：时长毫秒不再二次换算、endTime 服务端重算、
//         标准区间相交（含「新时段包住旧课」）、NaN 拒绝、不回写前端 endTime
// 【撤掉】「时间相交下推 where」+ 翻页优化、roomMatcher 正则加强
// 【新增】外层 try/catch，任何异常返回 {code:500,msg}，永不 reject
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  event = event || {}
  try {
    console.log('editMyCourse event', event)
    if (!event._id) return { code: 400, msg: '缺少课程 ID' }

    const curRes = await db.collection('myCourses').doc(event._id).get()
    const cur = curRes && curRes.data
    if (!cur || !cur._id) return { code: 400, msg: '课程不存在或已被删除' }

    const rawStart = (event.startTime !== undefined && event.startTime !== null && event.startTime !== '')
      ? event.startTime : cur.startTime
    const newStart = Number(rawStart)
    if (!Number.isFinite(newStart) || newStart <= 0) {
      return { code: 400, msg: '上课时间无效，请重新选择时间' }
    }

    // 时长是「毫秒」；前端不传 duration 时回退库里的原值（取消自定义时长后走这条）
    let durationMs = Number(event.duration)
    if (!Number.isFinite(durationMs) || durationMs <= 0) durationMs = Number(cur.duration)
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      durationMs = Number(cur.endTime) > newStart
        ? Number(cur.endTime) - newStart : 45 * 60 * 1000
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 24 * 60 * 60 * 1000) {
      return { code: 400, msg: '课堂时长无效' }
    }
    const newEnd = newStart + durationMs
    const shopId = event.shopId || cur.shopId
    const room = event.room || cur.room
    const openid = event._openid || cur._openid

    const overlaps = (el) => {
      if (el._id === event._id) return false
      const s = Number(el.startTime), e = Number(el.endTime)
      if (!Number.isFinite(s) || !Number.isFinite(e)) return false
      return newStart < e && newEnd > s
    }
    const describe = (list) => list.map(el =>
      `学生：${el.name || ''}—教师：${el.teacherName || ''}—` +
      `${new Date(el.startTime).toLocaleString()}~${new Date(el.endTime).toLocaleString()}`
    ).join(' ')

    const fetchAll = async (where) => {
      const r = await db.collection('myCourses').where(where).limit(100).get()
      let list = (r && r.data) || []
      if (list.length === 100) {
        const r2 = await db.collection('myCourses').where(where).skip(100).limit(100).get()
        list = list.concat((r2 && r2.data) || [])
      }
      return list
    }

    const studentHit = (await fetchAll({ finished: false, _openid: openid })).filter(overlaps)
    if (studentHit.length) return { code: 400, msg: '此时间学生已有课程：' + describe(studentHit) }

    if (shopId && room) {
      const roomHit = (await fetchAll({ finished: false, shopId: shopId }))
        .filter(el => String(el.room || '') === String(room))
        .filter(overlaps)
      if (roomHit.length) return { code: 400, msg: '此时间该房间已有课程：' + describe(roomHit) }
    }

    const patch = Object.assign({}, event, {
      startTime: newStart, endTime: newEnd, duration: durationMs
    })
    delete patch._id
    await db.collection('myCourses').where({ _id: event._id }).update({ data: patch })
    return { code: 200, msg: '修改成功', endTime: newEnd, duration: durationMs }
  } catch (err) {
    console.error('editMyCourse 未捕获异常（已兜底）', err)
    return { code: 500, msg: '服务暂时不可用，请稍后重试' }
  }
}
