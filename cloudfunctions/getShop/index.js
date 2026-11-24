// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const MAX_LIMIT = 100

// 云函数入口函数
// ★ 读取优化：原来「先 count() 全集合，再按 100 条分页 get()」，
//   集合通常只有几条门店 → 每次调用固定 2 次数据库读。
//   现在先取第一页；不足 100 条说明已经取完，直接返回（1 次读）。
//   只有满 100 条才继续翻页，且按 where 实际结果翻，不再按全集合 count 空跑。
//   返回结构 { data, errMsg } 与原来完全一致，不动任何数据。
exports.main = async (event, context) => {
  console.log('参数', event)
  const MAX_LIMIT = 100
  const where = event.name ? { text: new RegExp(event.name, 'i') } : {}
  const col = db.collection('shops')

  const first = await col.where(where).limit(MAX_LIMIT).get()
  let data = first.data || []
  let errMsg = first.errMsg

  if (data.length === MAX_LIMIT) {
    let page = 1
    while (page <= 50) {
      const r = await col.where(where).skip(page * MAX_LIMIT).limit(MAX_LIMIT).get()
      const d = r.data || []
      data = data.concat(d)
      if (d.length < MAX_LIMIT) break
      page++
    }
  }
  return { data: data, errMsg: errMsg }
}
