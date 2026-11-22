// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('event', event)
  const wxContext = cloud.getWXContext()
  const orderStr = event.order && event.order.string ? event.order.string : '_id'
  const order = event.order && event.order.order ? event.order.order : 'asc'
  
  const where = {}
  if (event._openid) {
    where._openid = event._openid
  }
  if (event.teacherOpenid) {
    where.teacherOpenid = event.teacherOpenid
  }
  if (event.shopId) {
    where.shopId = event.shopId
  }
  if (event.startTime && event.endTime) {
    where.startTime = _.gte(event.startTime).and(_.lte(event.endTime))
  }
  if (typeof event.finished === 'boolean') {
    where.finished = event.finished
  }
  console.log('查询条件', where)

  // 查询是否是教师
  const isTeacher =  await db.collection('teachers').where({_openid: event.teacherOpenid}).get().then(res => {
    console.log('是否是教师', res)
    if(res.data.length > 0) {
      return res
    }
  })
  if (isTeacher.data && isTeacher.data.length <= 0 ) {
    return {
      data: []
    }
  }

  const MAX_LIMIT = 100
   // 先取出集合记录总数
   const countResult = await db.collection('myCourses').where(where).count()
   const total = countResult.total
   // 计算需分几次取
   const batchTimes = Math.ceil(total / 100)
   console.log('查询次数', batchTimes)
   // 承载所有读操作的 promise 的数组
  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    const promise =  db.collection('myCourses')
      .aggregate()
      .match(where)
      .lookup({
        from: 'users',
        localField: '_openid',
        foreignField: '_openid', // teacherOpenid
        as: 'studentInfo'
      })
      .sort({
        [orderStr]: order === 'asc' ? 1 : -1
      })
      .skip(i * MAX_LIMIT)
      .limit(MAX_LIMIT)
      .end()
    tasks.push(promise)
  }
  // 等待所有
  const courseResult = await Promise.all(tasks)
  console.log('courseResult', courseResult)
  let resultData = []
  if (courseResult.length > 0 ) {
    resultData =  courseResult.reduce((acc, cur) => {
      return (acc.data ? acc.data : acc.list).concat((cur.data ? cur.data : cur.list))
    })
  }
  console.log('resultData', resultData)

  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    result: { data: resultData.data ? resultData.data : resultData.list}
  }
}