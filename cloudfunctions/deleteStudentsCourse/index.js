// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  console.log('event', event)
  const result = await db.collection('users')
    .where({
      _openid: event._openid
    })
    .update({
      data: {
        tearchreOpenid_course: _.pull(event.deleteCourse)
      }
    }).then(res => {
      console.log('更新成功', res)
      return res
    })
    .catch(err => {
      console.error('更新失败', err)
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