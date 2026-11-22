// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
// const MAX_LIMIT = 100

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('event', event)

  let where =  { 
    name: new RegExp(event.name, 'i'), // 名字搜索
  }

  const page = event.page
  const pageSize = event.pageSize

  const getResult = await db.collection('teachers').where(where).skip(page * pageSize).limit(pageSize).orderBy('y', 'asc').get().then(res => {
    console.log('获取数据成功', res)
    return res.data
  }).catch(err => {
    console.error('获取数据失败', err)
  })
  console.log('getResult', getResult)

  return getResult
}