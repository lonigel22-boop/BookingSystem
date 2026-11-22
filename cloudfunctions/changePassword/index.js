// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

const crypto  = require('crypto')

function passwordCrypto(keyStr, ivStr, password) {
  // 生成一个随机的 32 字节 AES-256 密钥
  const key = keyStr ? Buffer.from(keyStr, 'base64') :  crypto.randomBytes(32)

  // 生成一个随机的初始化向量
  const iv = ivStr ? Buffer.from(ivStr, 'base64') : crypto.randomBytes(16)
  
  // 创建 cipher 对象
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  
  let encrypted = cipher.update(password, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const result = {
    iv: iv.toString('base64'),
    key: key.toString('base64'),
    encryptedData: encrypted
  }
  return result
}

function decryptPassword(key, iv, encryptedData) {
  // 验证参数是否完整
  if (!encryptedData || !key || !iv) {
    throw new Error('缺少解密所需的参数')
  }

  // 将十六进制字符串的密钥和IV转换回Buffer
  const keyBuffer = Buffer.from(key, 'base64')
  const ivBuffer = Buffer.from(iv, 'base64')
  console.log('解密函数数据', keyBuffer, ivBuffer)
  // 创建 decipher 对象
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, ivBuffer)

  // 解密密码
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  // 返回解密后的密码
  console.log('解密函数密码', decrypted)
  return { success: true, decryptedPassword: decrypted }
}

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('参数', event)

  const wxContext = cloud.getWXContext()

  const result = await db.collection('account').where({
    // _openid: event._openid,
    account: event.account
  }).get().then(async res => {
    console.log('res', res)

    decryptPassword(res.data[0].key, res.data[0].iv,  res.data[0].password) // 解密函数

    if (res.data && !res.data.length) {
      return { error: '账号不存在', code: 404}
    }
    const oldCryptoResult = passwordCrypto(res.data[0].key, res.data[0].iv, event.oldPassword)
    const newCryptoResult = passwordCrypto(res.data[0].key, res.data[0].iv, event.newPassword)
    
    console.log('加密后', oldCryptoResult, newCryptoResult)
    if (res.data && res.data[0].password !== oldCryptoResult.encryptedData) {
      return {error: '旧密码错误', code: 404}
    } else if (newCryptoResult.encryptedData === oldCryptoResult.encryptedData) {
      return {error: '新密码不能等于旧密码', code: 404}
    } else {
      return await db.collection('account').where({
        account: event.account
      }).update({
        data: {
          password: newCryptoResult.encryptedData,
          iv: newCryptoResult.iv,
          key: newCryptoResult.key
        }
      }).then(res => {
        console.log('成功', res)
        return { error: '保存成功', code: 200 }
      }).catch(err => {
        console.log('失败' ,err)
        return { error: '保存失败', code: 400 }
      })
    }
  })
  return result
}