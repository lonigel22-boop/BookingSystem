// 云函数入口文件 · 保险版（撤优化）
// 撤掉：「先取一页、满 100 才翻页」的读取优化循环
// 保留：原版 where 语义与返回结构 { data, errMsg }
// 新增：外层 try/catch，永不 reject
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  event = event || {}
  console.log('参数', event)
  try {
    const where = event.name ? { text: new RegExp(event.name, 'i') } : {}
    const res = await db.collection('shops').where(where).limit(100).get()
    return { data: (res && res.data) || [], errMsg: res && res.errMsg }
  } catch (err) {
    console.error('getShop 未捕获异常（已兜底返回空数据）', err)
    return { data: [], errMsg: 'safe:empty-on-error' }
  }
}
