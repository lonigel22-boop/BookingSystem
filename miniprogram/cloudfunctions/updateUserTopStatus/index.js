// 云函数入口文件
const cloud = require('wx-server-sdk')

// 初始化云环境
cloud.init({
  env: 'wowmusic-booking-system-cf7f200b'
})

// 云函数入口函数
exports.main = async (event, context) => {
  const { userId, isTop, teacherOpenid } = event
  
  try {
    // 验证参数
    if (!userId || typeof isTop !== 'boolean' || !teacherOpenid) {
      throw new Error('参数不完整')
    }

    const db = cloud.database()
    const _ = db.command

    // 更新用户置顶状态
    const result = await db.collection('users').doc(userId).update({
      data: {
        isTop: isTop,
        updateTime: _.serverDate()
      }
    })

    // 验证操作者权限
    const user = await db.collection('users').doc(userId).get()
    if (user.data.teacherOpenid !== teacherOpenid) {
      throw new Error('无权限操作此用户')
    }

    return {
      code: 0,
      message: '操作成功',
      data: result
    }
  } catch (err) {
    console.error('更新置顶状态失败:', err)
    return {
      code: -1,
      message: err.message,
      data: null
    }
  }
}