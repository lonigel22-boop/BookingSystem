// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境
const fs = require('fs')
const path = require('path')

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  console.log('event', event)
  // 上传图片到云存储
  const fileID = await cloud.uploadFile({
    cloudPath: 'pictures/' + wxContext.OPENID + '.png', // 指定上传到云端的文件名
    fileContent: new Buffer(event.fileContent, 'base64'), // 小程序文件路径
    // fileContent: event.fileContent, // 小程序文件路径
    success: res => {
      // 获取文件 ID
      const fileID = res.fileID;
      console.log('图片上传成功，fileID:', fileID);
      // 在这里可以执行其他逻辑，例如将文件ID保存到数据库
      return fileID
    },
    fail: err => {
      console.error('图片上传失败', err)
      return '上传失败'
    }
  })
  return fileID
}