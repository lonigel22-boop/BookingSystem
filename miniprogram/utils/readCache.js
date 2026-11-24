/**
 * readCache —— 只读云函数调用的「在途合并 + 短期结果缓存」
 *
 * 目的：减少云函数 / 云数据库的非必要、重复读取（流量消耗）。
 * 只用于「读」类调用；任何写入（add / edit / delete / sync）都不要走这里。
 *
 * 特性：
 *  1) 同一参数同时发出多个请求 → 只真正调用一次云函数，其余复用同一个 Promise
 *  2) 结果按「云函数名 + 参数」缓存一段时间，重复进页面不再读库
 *  3) 缓存按参数隔离（不同门店 / 日期 / openid 互不串数据）
 *  4) 返回深拷贝，调用方改数据不会污染缓存
 *  5) 写操作后可 invalidate(name) 主动失效，避免列表显示旧数据
 *
 * 复用 app.js 里已有的 globalData.cache / setCache / getCache。
 */

const PREFIX = 'rc:v1:'
const inflight = {}

function stableKey(name, data) {
  const obj = data || {}
  const keys = Object.keys(obj).sort()
  const parts = keys.map(function (k) {
    const v = obj[k]
    if (v && typeof v === 'object') {
      try { return k + '=' + JSON.stringify(v) } catch (e) { return k + '=[obj]' }
    }
    return k + '=' + String(v)
  })
  return PREFIX + name + ':' + parts.join('&')
}

function clone(v) {
  if (v === null || v === undefined) return v
  try { return JSON.parse(JSON.stringify(v)) } catch (e) { return v }
}

function app_() {
  try { return getApp() } catch (e) { return null }
}

/**
 * 带缓存地调用只读云函数
 * @param {String} name 云函数名
 * @param {Object} data 参数
 * @param {Number} ttl 缓存秒数，默认 300 秒；传 0 表示只合并在途、不缓存结果
 * @returns {Promise} 与 wx.cloud.callFunction 完全相同的返回结构
 */
function cachedRead(name, data, ttl) {
  const app = app_()
  const key = stableKey(name, data)
  const hit = app && app.getCache ? app.getCache(key) : null
  if (hit !== null && hit !== undefined) return Promise.resolve(clone(hit))

  if (inflight[key]) return inflight[key].then(clone)

  const p = wx.cloud.callFunction({ name: name, data: data || {} })
    .then(function (res) {
      delete inflight[key]
      if (app && app.setCache && ttl !== 0) app.setCache(key, clone(res), ttl === undefined ? 300 : ttl)
      return res
    })
    .catch(function (err) {
      delete inflight[key]
      throw err
    })
  inflight[key] = p
  return p.then(clone)
}

/** 让某个云函数的所有只读缓存失效（写操作后调用） */
function invalidate(name) {
  const app = app_()
  if (!app || !app.globalData || !app.globalData.cache) return
  const head = PREFIX + name + ':'
  Object.keys(app.globalData.cache).forEach(function (k) {
    if (k.indexOf(head) === 0) delete app.globalData.cache[k]
  })
  Object.keys(inflight).forEach(function (k) {
    if (k.indexOf(head) === 0) delete inflight[k]
  })
}

/** 清空全部只读缓存（改资料 / 切换身份后调用） */
function invalidateAll() {
  const app = app_()
  if (app && app.globalData && app.globalData.cache) {
    Object.keys(app.globalData.cache).forEach(function (k) {
      if (k.indexOf(PREFIX) === 0) delete app.globalData.cache[k]
    })
  }
  Object.keys(inflight).forEach(function (k) { delete inflight[k] })
}

/** 身份档案专用缓存：按微信 openid 隔离，换账号自动失效 */
const ID_HEAD = 'id:v1:'
function getIdentity(openid) {
  const app = app_()
  if (!app || !app.getCache || !openid) return null
  return app.getCache(ID_HEAD + openid)
}
function setIdentity(openid, user, ttl) {
  const app = app_()
  if (app && app.setCache && openid) app.setCache(ID_HEAD + openid, clone(user), ttl || 60)
}
function invalidateIdentity(openid) {
  const app = app_()
  if (app && app.globalData && app.globalData.cache) {
    if (openid) delete app.globalData.cache[ID_HEAD + openid]
    else Object.keys(app.globalData.cache).forEach(function (k) {
      if (k.indexOf(ID_HEAD) === 0) delete app.globalData.cache[k]
    })
  }
}

module.exports = {
  cachedRead: cachedRead,
  invalidate: invalidate,
  invalidateAll: invalidateAll,
  getIdentity: getIdentity,
  setIdentity: setIdentity,
  invalidateIdentity: invalidateIdentity
}
