// 云函数入口文件
const cloud = require('wx-server-sdk')  

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('event', event)
  const wxContext = cloud.getWXContext()

  const timeResult = await db.collection('course').where({
      _id: event.courseId
  }).get().then(async resp => {
    console.log('查询结果', resp)
    if (resp.data && resp.data.length) {
      return resp.data[0].minute
    } else {
      return { code: 400, msg: '没有课程时长，请检查课程设置'}
    }
  })
  console.log('当前单节课时长', timeResult)
  if (timeResult && timeResult.code) {
    return { code: 400, msg: '没有课程时长或者该课程不存在，请检查课程设置'}
  }
  // 一节课多长时间毫秒数
  const minute = (Number(timeResult) > 60 * 24 ? 44 : Number(timeResult)) * 60 * 1000

    // 查询时间限定3小时毫秒数
  const timelimit = 60 * 3 * 60 * 1000

  const data = {
    startTime: event.startTime,
    endTime: event.startTime + minute,
    teacherName: event.teacherName,
    teacherOpenid: event.teacherOpenid,
    shopName: event.shopName,
    shopId: event.shopId,
    courseId: event.courseId,
    courseName: event.courseName,
    _openid: event._openid,
    name: event.name,
    room: event.room,
    duration: Number(minute),
    finished: event.finished
  }

  const timeJudgment = (filterData) => {
    return filterData.filter(el => {
      return  (event.startTime >= el.startTime && event.startTime < el.endTime) || (event.startTime + minute >= el.startTime && event.startTime + minute < el.endTime)
    })
  }
  const nameAndTine = (resultData) => {
    let nameCourse = ''
    resultData.forEach(el => {
      nameCourse += `学生：${el.name ? el.name : ''}—教师：${el.teacherName ? el.teacherName : ''}—${new Date(el.startTime).toLocaleString()}~${new Date(el.endTime).toLocaleString()}`
    })
    return nameCourse
  }
  
  // 查询学生课程-----------------------------------
  const MAX_LIMIT_COURSE = 100
   // 先取出集合记录总数
   // 为所有数据库操作添加错误处理
   const countCourses = await db.collection('myCourses')
     .where({finished: false})
     .count()
     .catch(err => {
       console.error('查询课程总数失败:', err);
       return {total: 0};
     });
   const totalCourses = countCourses.total
   // 计算需分几次取
   const batchTimesCourses = Math.ceil(totalCourses / 100)
   // 承载所有读操作的 promise 的数组
  const tasksCourses = []
  for (let i = 0; i < batchTimesCourses; i++) {
    // 当前查询获取了所有字段，可以只获取需要的字段
    const promise = db.collection('myCourses')
      .where({_openid: event._openid, finished: false})
      .field({startTime: true, endTime: true, name: true, teacherName: true, shopId: true, room: true}) // 只获取必要字段
      .skip(i * MAX_LIMIT_COURSE)
      .limit(MAX_LIMIT_COURSE)
      .get()
    tasksCourses.push(promise)
  }
  // 等待所有
  const dataResult =  (await Promise.all(tasksCourses)).reduce((acc, cur) => {
    return {
      data: acc.data.concat(cur.data),
      errMsg: acc.errMsg,
    }
  })
  console.log('dataResult', dataResult)

  // 查询学生时间冲突
  if (dataResult.data && dataResult.data.length) {
    const filterData = timeJudgment(dataResult.data)
    console.log('学生时间', filterData)
    if (filterData && filterData.length) {
      return { code: 400, msg: '此时间有课程：' + nameAndTine(filterData)}
    }
  }

  // 查询所有未结课课程-----------------------------------
  // 查询次房间次时间冲突
  const MAX_LIMIT_TEACHER = 100
  // 先取出集合记录总数
  const countResultTeacher = await db.collection('myCourses').where({finished: false}).count()
  const totalTeacher = countResultTeacher.total
  // 计算需分几次取
  const batchTimesTeacher = Math.ceil(totalTeacher / 100)
  // 承载所有读操作的 promise 的数组
  const tasksTeacher = []
  for (let i = 0; i < batchTimesTeacher; i++) {
    const promise = db.collection('myCourses').where({
      shopId: event.shopId,
      startTime: _.gt(event.startTime - timelimit),
      room: new RegExp(event.room, 'i'),
      finished: false
    }).skip(i * MAX_LIMIT_TEACHER).limit(MAX_LIMIT_TEACHER).get()
    tasksTeacher.push(promise)
  }
  // 等待所有
  const tearcherCourse =  (await Promise.all(tasksTeacher)).reduce((acc, cur) => {
    return {
      data: acc.data.concat(cur.data),
      errMsg: acc.errMsg,
    }
  })
  console.log('tearcherCourse', tearcherCourse)
  console.log('此房间此时间', tearcherCourse)
  if (tearcherCourse.data && tearcherCourse.data.length) {
    const filterTearcherCourse = timeJudgment(tearcherCourse.data)
    if (filterTearcherCourse && filterTearcherCourse.length) {
      return { code: 400, msg: '此时间有课程：' + nameAndTine(filterTearcherCourse)}
    }
  }

  console.log("开始时间:" + new Date(data.startTime), "结束时间:" + new Date(data.endTime))

  return await db.collection('myCourses').add({
    data: data
  }).then(res => {
    console.log('myCourses', res)
    return { code: 200, msg: '添加成功'}
  })
}