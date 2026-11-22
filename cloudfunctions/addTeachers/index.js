// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('event', event)
  const result = await db.collection('teachers').add({
    data: event.data
  }).then(async res => {
    let openids = []
    event.data.forEach(el => {
      openids.push(el._openid)
    })
    return await db.collection('users').where({
      _openid: _.in(openids)
    }).update({
      data: {
        isTeacher: true
      }
    }).then(el => {
      console.log('插入成功', el)
      return el
    })
  }).catch(err => {
    console.error('插入失败', err)
    return err
  })
  return result
}