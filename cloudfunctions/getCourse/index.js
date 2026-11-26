// 云函数入口文件 · 保险版（撤优化）
// 撤掉：「先取一页、满 100 才翻页」的读取优化循环
// 保留：返回结构 { data, errMsg }
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  try {
    const res = await db.collection('course').limit(100).get()
    return { data: (res && res.data) || [], errMsg: res && res.errMsg }
  } catch (err) {
    console.error('getCourse 未捕获异常（已兜底返回空数据）', err)
    return { data: [], errMsg: 'safe:empty-on-error' }
  }
}
