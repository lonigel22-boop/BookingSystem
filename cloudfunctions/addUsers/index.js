// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    console.log('event', event)
    // 查找用户，如果没有则会创建一条数据
    const result = await db.collection('users').where({
      _openid: event._openid
    }).get().then(async res => { 
      console.log('result', res)
      if (res.data && !res.data.length) {
        await db.collection('users').add({
          data: {
            _appid: event._appid ? event._appid : '',
            _openid: event._openid ? event._openid : '',
            nickName: event.nickName ? event.nickName : '',
            gender: event.gender ? event.gender : '',
            avatarUrl: event.avatarUrl ? event.avatarUrl : '',
            cloudID: event.cloudID ? event.cloudID : '',
            name: event.name ? event.name : '',
            fileID: '',
            position: '',
            introduce: '',
            isTeacher: false
          }
        }).then(resp => {
          return resp
        }).catch(errp => {
          return errp
        })
        return res
      } else {
        return res
      }
    })
    return result
  } catch(e) {
    console.error(e)
  }
}