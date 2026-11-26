// 云函数入口文件 · 保险版（撤优化）
// 撤掉：v16 新增的「teacherOpenid 缺失就提前返回失败」分支
// 保留：原版「先查后更/新增」逻辑与返回结构
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  event = event || {}
  const { userId, sequence, teacherOpenid } = event
  try {
    const checkRes = await db.collection('sequence')
      .where({ userId: userId, teacherOpenid: teacherOpenid }).get()
    if (checkRes.data && checkRes.data.length > 0) {
      await db.collection('sequence').doc(checkRes.data[0]._id).update({
        data: { sequence: sequence, updatedAt: db.serverDate() }
      })
    } else {
      await db.collection('sequence').add({
        data: {
          userId: userId, teacherOpenid: teacherOpenid, sequence: sequence,
          createdAt: db.serverDate(), updatedAt: db.serverDate()
        }
      })
    }
    return { success: true, message: 'Sequence updated successfully' }
  } catch (err) {
    console.error('updateUserSequence 未捕获异常（已兜底）', err)
    return { success: false, message: 'safe:empty-on-error' }
  }
}
