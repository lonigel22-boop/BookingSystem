// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  console.log('event', event)

  const result = await db.collection('teachers').where({
    _openid: event._openid
  }).remove().then(async res => {
    return await db.collection('users').where({
      _openid: event._openid
    }).update({
      data: {
        isTeacher: false
      }
    }).then(el => {
      console.log('删除成功', el)
      return el
    })
  }).catch(err => {
    console.log('删除失败', err)
    return err
  })

  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    result
  }
}