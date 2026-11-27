// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command
const xlsx = require('node-xlsx')

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('导出条数', (event.data || []).length, '结课条数来源', (event.finishedCourses || []).length)
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
  console.log('数据条数', allData.length - 1)

  /* ★★ 还原「课时汇总」（原封不动照旧版）：
     按 学生名 + 课程名 + 校区 分组计数，按首次出现顺序输出，
     最后一行 A 列「总节数」、D 列总条数。数据全部来自 event.data，不查库。 */
  const summaryMap = {}
  const summaryOrder = []
  ;(event.data || []).forEach(item => {
    const sname = item.name || '未知学生'
    const cname = item.courseName || item.title || ''
    const shop = item.shopName || ''
    const key = sname + '|' + cname + '|' + shop
    if (!summaryMap[key]) {
      summaryMap[key] = { sname, cname, shop, count: 0 }
      summaryOrder.push(key)
    }
    summaryMap[key].count += 1
  })
  const summaryData = [['学生名', '课程名', '校区', '节数']]
  summaryOrder.forEach(k => {
    const g = summaryMap[k]
    summaryData.push([g.sname, g.cname, g.shop, g.count])
  })
  summaryData.push(['总节数', '', '', (event.data || []).length])

  /* ★★ 第 3 页「本月结课课程」：只要两列。
     只接受前端按「① 课程级结课标记 ② 最后一节在当月」筛好的两列清单。
     ⚠️ 不再扫 event.data 的 finished —— 那是单节完课状态（上过课就为 true），
        会把所有本月上过课但没结课的学生误统计进来。 */
  const finSeen = {}
  const finData = [['结课学生名称', '结课课程名称']]
  ;(Array.isArray(event.finishedCourses) ? event.finishedCourses : []).forEach(r => {
    if (!Array.isArray(r)) return
    const a = String(r[0] || '未知学生'), b = String(r[1] || '')
    const key = a + '|' + b
    if (!b || finSeen[key]) return
    finSeen[key] = 1
    finData.push([a, b])
  })

  let buffer = xlsx.build([
    {
      name: '课时明细',
      data: allData
    },
    {
      name: '课时汇总',
      data: summaryData
    },
    {
      name: '本月结课课程',
      data: finData
    }
  ])
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