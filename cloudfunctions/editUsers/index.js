// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  try {
    console.log('event', event)
    const result = await db.collection('users').where({
      _openid: event._openid
    }).update({
      // data 传入需要局部更新的数据
      data: {
        nickName: event.nickName,
        avatarUrl: event.avatarUrl, 
        // name: event.name,
        // fileID: event.fileID,
        // position: event.position,
        // introduce: event.introduce
        name: _.set(event.name),
        fileID: _.set(event.fileID),
        position: _.set(event.position),
        introduce: _.set(event.introduce)
      }
    }).then(res => {
      console.log('成功', res)
      return res
    }).catch(err => {
      console.log('失败', err)
      return err
    })
    return {
      event,
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID,
      result: result
    }
  } catch(e) {
    console.error(e)
  }
}