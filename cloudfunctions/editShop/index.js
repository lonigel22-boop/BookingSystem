// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('event', event)
  const wxContext = cloud.getWXContext()

  await db.collection('shops').where({
    _id: event._id
  }).update({
    data: {
      time: event.time,
      address: event.address,
      phone: event.phone,
      room: event.room,
      value: event.value
    }
  }).then(res => {
    return {code: 200, msg: '保存成功'}
  })
}