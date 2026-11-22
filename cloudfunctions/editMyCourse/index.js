// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  console.log('event', event)

  // 获取当前课程信息，用于冲突检查
  let currentCourse = null;
  if (event._id) {
    try {
      const currentCourseResult = await db.collection('myCourses').where({
        _id: event._id
      }).get();
      
      if (currentCourseResult.data && currentCourseResult.data.length > 0) {
        currentCourse = currentCourseResult.data[0];
      }
    } catch (err) {
      console.error('获取当前课程信息失败:', err);
    }
  }

  // 确定用于冲突检查的参数
  const checkStartTime = event.startTime || (currentCourse ? currentCourse.startTime : null);
  const checkShopId = event.shopId || (currentCourse ? currentCourse.shopId : null);
  const checkRoom = event.room || (currentCourse ? currentCourse.room : null);
  const checkOpenId = event._openid || (currentCourse ? currentCourse._openid : null);

  // 只有在需要检查冲突时才获取课程时长
  let minute = 0;
  // 使用传递的duration或当前课程的duration
  const duration = event.duration || (currentCourse ? currentCourse.duration : 0);
  if (checkStartTime && checkShopId && checkRoom) {
    // 一节课多长时间毫秒数
    minute = (Number(duration) > 60 * 24 ? 44 : Number(duration)) * 60 * 1000
  }

  // 查询时间限定3小时毫秒数
  const timelimit = 60 * 3 * 60 * 1000

  const timeJudgment = (filterData) => {
    return filterData.filter(el => {
      // 排除当前正在修改的课程
      if (el._id === event._id) {
        return false;
      }
      return  (checkStartTime >= el.startTime && checkStartTime < el.endTime) || (checkStartTime + minute >= el.startTime && checkStartTime + minute < el.endTime)
    })
  }
  
  const nameAndTine = (resultData) => {
    let nameCourse = ''
    resultData.forEach(el => {
      nameCourse += `学生：${el.name ? el.name : ''}—教师：${el.teacherName ? el.teacherName : ''}—${new Date(el.startTime).toLocaleString()}~${new Date(el.endTime).toLocaleString()} `
    })
    return nameCourse
  }
  
  // 只有在需要检查冲突时才进行冲突检查
  if (checkStartTime && checkShopId && checkRoom) {
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
        .where({_openid: checkOpenId, finished: false})
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
        shopId: checkShopId,
        startTime: _.gt(checkStartTime - timelimit),
        room: new RegExp(checkRoom, 'i'),
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
  }

  const data = { ...event }

  // 确保删除_id字段
  delete data._id
  
  // 添加调试日志
  console.log('准备更新的数据:', data)
  console.log('更新条件:', { _id: event._id })

  try {
    const result = await db.collection('myCourses').where({
      _id: event._id
    }).update({
      data: { ...data }
    });
    console.log('更新成功', result)
    return { code: 200, msg: '修改成功' }
  } catch (err) {
    console.log('更新失败', err)
    return { code: 500, msg: '修改失败' }
  }
}