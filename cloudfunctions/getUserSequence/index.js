// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 云函数入口函数
exports.main = async (event, context) => {
  const db = cloud.database()
  const { teacherOpenid } = event
  
  try {
    // 获取该班级所有用户的sequence记录
    const res = await db.collection('sequence')
      .where({
        teacherOpenid: teacherOpenid
      })
      .get()

    return {
      success: true,
      data: res.data,
      message: 'Sequence data retrieved successfully'
    }
  } catch (err) {
    console.error(err)
    return {
      success: false,
      data: [],
      message: 'Failed to get sequence data',
      error: err
    }
  }
}