// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  console.log('event', event)
  const fileId = event.fileId // 假设这是你传递给云函数的图片文件ID
  const res = await cloud.getTempFileURL({
    fileList: [fileId]
  })
  console.log('结果', res)
  

  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    file: res // 返回临时访问链接
  }
}