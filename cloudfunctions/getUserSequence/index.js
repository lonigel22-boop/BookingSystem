// 云函数入口文件 · 保险版（撤优化）
// 撤掉：v16 新增的「teacherOpenid 缺失就提前返回」分支
// 保留：原版返回结构 { success, data, message }
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  event = event || {}
  try {
    const where = {}
    if (event.teacherOpenid) where.teacherOpenid = event.teacherOpenid
    const res = await db.collection('sequence').where(where).get()
    return { success: true, data: (res && res.data) || [], message: 'Sequence data retrieved successfully' }
  } catch (err) {
    console.error('getUserSequence 未捕获异常（已兜底）', err)
    return { success: false, data: [], message: 'safe:empty-on-error' }
  }
}
