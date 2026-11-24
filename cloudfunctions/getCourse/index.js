// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const MAX_LIMIT = 100

// 云函数入口函数
// ★ 读取优化：同 getShop，去掉「count + 分页」双读，
//   先取一页，不足 100 条即完成（常规 2 次读 → 1 次读），返回结构不变。
exports.main = async (event, context) => {
  const MAX_LIMIT = 100
  const col = db.collection('course')
  const first = await col.limit(MAX_LIMIT).get()
  let data = first.data || []
  let errMsg = first.errMsg

  if (data.length === MAX_LIMIT) {
    let page = 1
    while (page <= 50) {
      const r = await col.skip(page * MAX_LIMIT).limit(MAX_LIMIT).get()
      const d = r.data || []
      data = data.concat(d)
      if (d.length < MAX_LIMIT) break
      page++
    }
  }
  return { data: data, errMsg: errMsg }
}
