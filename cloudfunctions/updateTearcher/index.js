// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()

  console.log('event', event)
  const result = await db.collection('teachers').where({
    _openid: event._openid,
  }).update({
    data: {
      nickName: event.nickName,
      avatarUrl: event.avatarUrl,
      name: event.name,
      position: event.position,
      introduce: event.introduce,
    }
  }).then(res => {
    return res
  })

  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    result: result
  }
}