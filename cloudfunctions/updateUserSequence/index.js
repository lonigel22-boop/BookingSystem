// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 云函数入口函数
exports.main = async (event, context) => {
  const db = cloud.database()
  const { userId, sequence, teacherOpenid } = event
  
  try {
    // 检查是否已存在记录
    const checkRes = await db.collection('sequence')
      .where({
        userId: userId,
        teacherOpenid: teacherOpenid
      })
      .get()

    if (checkRes.data.length > 0) {
      // 更新现有记录
      await db.collection('sequence').doc(checkRes.data[0]._id).update({
        data: {
          sequence: sequence,
          updatedAt: db.serverDate()
        }
      })
    } else {
      // 创建新记录
      await db.collection('sequence').add({
        data: {
          userId: userId,
          teacherOpenid: teacherOpenid,
          sequence: sequence,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    }

    return {
      success: true,
      message: 'Sequence updated successfully'
    }
  } catch (err) {
    console.error(err)
    return {
      success: false,
      message: 'Failed to update sequence',
      error: err
    }
  }
}