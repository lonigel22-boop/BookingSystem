// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  let getResult = ''
  console.log('event', event)
  event.data.forEach(async res => {
    getResult = await db.collection('teachers').where({_id: res._id}).update({
      data: {
        y: res.y
      }
    }).then(res => {
      console.log('成功', res)
      return res
    }).catch(err => {
      console.error('失败', err)
    })
  })
  console.log('getResult', getResult)
  return getResult
}