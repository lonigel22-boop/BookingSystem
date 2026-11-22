App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'wowmusic-booking-system-cf7f200b',
        traceUser: true
      })
    }
    this.checkUpdateVersion()
    this.initGlobalCache()
  },
  globalData: {
    hasLogin: false,
    userInfo: null,
    systemInfo: null,
    cache: {}
  },
  initGlobalCache() {
    wx.getSystemInfo({
      success: (res) => {
        this.globalData.systemInfo = res
      }
    })
    const token = wx.getStorageSync('token')
    if (token) {
      this.globalData.hasLogin = true
      this.getUserInfo()
    }
  },
  getUserInfo() {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      this.globalData.userInfo = userInfo
    }
  },
  setCache(key, value, expire = 3600) {
    this.globalData.cache[key] = {
      data: value,
      expire: Date.now() + expire * 1000
    }
  },
  getCache(key) {
    const cache = this.globalData.cache[key]
    if (cache && cache.expire > Date.now()) {
      return cache.data
    }
    return null
  },
  checkUpdateVersion() {
    const updateManager = wx.getUpdateManager()
    updateManager.onCheckForUpdate(function(res) {
      console.log('检测版本更新', res)
      if (res.hasUpdate) {
        updateManager.onUpdateReady(function() {
          wx.showModal({
            title: '更新提示',
            content: '新版本已经准备好，是否重启应用？',
            success(res) {
              if (res.confirm) {
                updateManager.applyUpdate();
              }
            }
          })
        })

        updateManager.onUpdateFailed(function() {
          wx.showModal({
            title: '已经有新版本咯~',
            content: '请您删除当前小程序，到微信 "发现-小程序" 页，重新搜索打开呦~',
          })
        })
      }
    })
  },

})