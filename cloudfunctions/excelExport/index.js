// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command
const xlsx = require('node-xlsx')

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('event', event)
  const wxContext = cloud.getWXContext()

  let datdCVS = `${event.name}${event.month}月课时(${new Date().getTime()}).xlsx`
  let allData = []
  const  header = ['name', 'classHour', 'teacherName', 'startTime', 'endTime', 'shopName', 'room', 'courseName', 'finished']
  const row = ['学生名', '课时数', '教师', '开始时间', '结束时间', '校区', '房间', '课程名', '课程状态']
  allData.push(row)
  event.data.forEach((item, index) => { 
    const values = header.map(key => {
      return item[key] || ''
    })
    allData.push(values)
  })
  console.log('数据', allData)

  let buffer = xlsx.build([{
    name: 'mySheetName',
    data: allData
  }])
  console.log('buffer', buffer)
  const fileID = await cloud.uploadFile({
    cloudPath: 'excel/' + datdCVS,
    fileContent: buffer,
    success: res => {
      console.log('文件上传成功，fileID:', res)
      return res
    },
    fail: err => {
      console.error('文件上传失败', err)
      return '上传失败'
    }
  })
  
  return fileID
}