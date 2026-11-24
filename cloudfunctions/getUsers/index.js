// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('getUsersEvent', event)
  let where =  { 
    name: new RegExp(event.name, 'i'), // 名字搜索
    'tearchreOpenid_course.teacherOpenid': event.teacherOpenid, // 学生的教师id搜索
    _openid: event._openid
  }
  if (event.filter && Object.keys(event.filter) && Object.keys(event.filter).length) {
    if (event.filter.teacherOpenid) {
      where = {...where, ...{
        'tearchreOpenid_course.teacherOpenid': _.nin([event.filter.teacherOpenid])
      }}
    }
    if (event.filter.isTeacher === false) {
      where = {...where, ...{
        isTeacher: event.filter.isTeacher
      }}
    }
  }
  const page = event.page
  const pageSize = event.pageSize
  console.log('where', where)
  // 显式指定返回字段，包含isTop
  const getResult = await db.collection('users').where(where)
    .field({
      _id: true,
      name: true,
      nickName: true,
      avatarUrl: true,
      isTop: true,
      tearchreOpenid_course: true,
      _openid: true,
      // ★ 只读优化附带修复：原来 field 漏了 isTeacher，
      //   导致前端拿不到身份、学生也会多发一次查课请求。仅多返回一个字段，不改数据。
      isTeacher: true
    })
    .skip(page * pageSize)
    .limit(pageSize)
    .get()
    .then(res => {
    console.log('获取数据成功', res)
    return res.data
  }).catch(err => {
    console.error('获取数据失败', err)
  })
  console.log('getResult', getResult)

  return getResult
}