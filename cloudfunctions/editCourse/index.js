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
  }).update({
    data: {
      age: event.age,
      expense_level_1: event.expense_level_1,
      expense_level_2: event.expense_level_2,
      expense_level_3: event.expense_level_3,
      minute: event.minute,
      numbers: event.numbers,
      periods: event.periods,
      pitch_number: event.pitch_number,
      require: event.require,
      target: event.target,
      title: event.title
    }
  }).then(res => {
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