// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()

  console.log('event', event)
  const result = await db.collection('course').where({
    _id: event._id
  }).remove().then(res => {
    console.log('成功', res)
    return res
  }).catch(err => {
    console.log('失败' ,err)
    return res
  })

  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    result
  }
}