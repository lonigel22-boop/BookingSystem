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

  // ★ 读取优化 ①：教师校验
  //   原来无论是否传 teacherOpenid 都会读一次 teachers 集合、还返回整份文档；
  //   未传时条件被忽略而「碰巧通过」，学生查自己的课 / 房间统计按门店查，都白读一次。
  //   现在只有「显式传了 teacherOpenid」才校验，并用 count() 代替 get()
  //   （只回总数、不回文档，流量更小）；未传则跳过，实际行为与原来一致。
  //   顺带修掉原来 isTeacher 为 undefined 时会抛 TypeError 的隐患。
  if (event.teacherOpenid) {
    const teacherCount = await db.collection('teachers')
      .where({ _openid: event.teacherOpenid }).count()
    if (!teacherCount.total) return { data: [] }
  }

  // ★ 读取优化 ②：去掉「先 count() 再分页」的双读
  //   先取第一页，不足 100 条即已取完；只有满 100 条才继续翻页。
  //   常规调用：3 次读（教师 get + count + aggregate）→ 2 次；
  //   不传 teacherOpenid 的调用（房间统计、学生查自己课）：3 次 → 1 次。
  //   where / lookup / 排序 / 返回结构全部与原来一致，不改任何数据。
  const MAX_LIMIT = 100
  const buildQuery = (skip) => db.collection('myCourses')
    .aggregate()
    .match(where)
    .lookup({
      from: 'users',
      localField: '_openid',
      foreignField: '_openid',
      as: 'studentInfo'
    })
    .sort({
      [orderStr]: order === 'asc' ? 1 : -1
    })
    .skip(skip)
    .limit(MAX_LIMIT)
    .end()

  const listOf = (r) => (r && (r.list || r.data)) || []
  const first = await buildQuery(0)
  let resultData = listOf(first)

  if (resultData.length === MAX_LIMIT) {
    let page = 1
    while (page <= 50) {
      const r = await buildQuery(page * MAX_LIMIT)
      const d = listOf(r)
      resultData = resultData.concat(d)
      if (d.length < MAX_LIMIT) break
      page++
    }
  }
  console.log('课程条数', resultData.length)

  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    result: { data: resultData }
  }
}
