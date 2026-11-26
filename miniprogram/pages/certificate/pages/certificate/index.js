const db = wx.cloud.database()

// 隐藏口令：在证书验证框输入 ksstbelt 进入 beltsystem 隐藏页（首页不再放入口）
const BELT_CODE = 'ksstbelt'

Page({
  data: {
    searchText: '',
    certificate: null,
    showNoResult: false,
    userInfo: null
  },

  onLoad() {
    this.getUserInfo()
  },

  // 从腰带系统返回后清掉口令残留，不把口令留在输入框里给旁人看到
  onShow() {
    if (this._isBeltCode(this.data.searchText)) {
      this.setData({
        searchText: '',
        certificate: null,
        showNoResult: false
      })
    }
  },

  _isBeltCode(v) {
    return String(v || '').trim().toLowerCase() === BELT_CODE
  },

  // 证书系统入口本身仅老师可见；这里再兜一层，与原「腰带系统仅老师」口径一致
  _canEnterBelt() {
    const u = this.data.userInfo
    return !!(u && u.isTeacher)
  },

  _enterBelt() {
    if (this._beltNavigating) return
    this._beltNavigating = true
    wx.navigateTo({
      url: '/pages/beltsystem/index',
      complete: () => {
        this._beltNavigating = false
      }
    })
  },

  getUserInfo() {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      this.setData({
        userInfo: userInfo
      })
    }
  },

  onSearchInput(e) {
    const v = e.detail.value || ''
    this.setData({
      searchText: v
    })
    // 输完口令直接进，不必再点「查询」
    if (this._isBeltCode(v) && this._canEnterBelt()) {
      this._enterBelt()
    }
  },

  searchCertificate() {
    const searchText = this.data.searchText
    if (!searchText) {
      wx.showToast({
        title: '请输入证书编号或姓名',
        icon: 'none'
      })
      return
    }

    // 检查是否输入了特定密码
    if (searchText === 'wowmusic') {
      if (this.data.userInfo && this.data.userInfo.isTeacher) {
        wx.navigateTo({
          url: '/pages/certificate/pages/certificateLogin/index'
        })
      } else {
        this.setData({
          certificate: null,
          showNoResult: true
        })
        wx.showToast({
          title: '未找到相关证书',
          icon: 'none'
        })
      }
      return
    }

    // 腰带系统隐藏口令：命中则不发起证书查询，直接跳转
    if (this._isBeltCode(searchText)) {
      if (this._canEnterBelt()) {
        this.setData({
          searchText: '',
          certificate: null,
          showNoResult: false
        })
        this._enterBelt()
      } else {
        // 非老师：伪装成普通查无结果，不暴露隐藏功能
        this.setData({
          certificate: null,
          showNoResult: true
        })
        wx.showToast({
          title: '未找到相关证书',
          icon: 'none'
        })
      }
      return
    }

    wx.showLoading({
      title: '查询中'
    })

    const _ = db.command
    db.collection('Certificate')
      .where(_.or([
        {
          certificateNumber: searchText
        },
        {
          name: searchText
        }
      ]))
      .get()
      .then(res => {
        wx.hideLoading()
        if (res.data.length > 0) {
          this.setData({
            certificate: res.data[0],
            showNoResult: false
          })
        } else {
          this.setData({
            certificate: null,
            showNoResult: true
          })
          wx.showToast({
            title: '未找到相关证书',
            icon: 'none'
          })
        }
      })
      .catch(err => {
        console.error('查询证书失败：', err)
        wx.hideLoading()
        wx.showToast({
          title: '查询失败',
          icon: 'error'
        })
      })
  },

  viewCertificate() {
    if (this.data.certificate && this.data.certificate.certificateUrl) {
      const url = `${app.globalData.apiBaseUrl}/${this.data.certificate.certificateUrl}`
      wx.downloadFile({
        url: url,
        success: (res) => {
          const filePath = res.tempFilePath
          wx.openDocument({
            filePath: filePath,
            success: function (res) {
              console.log('打开文档成功')
            },
            fail: function(err) {
              console.error('打开文档失败:', err)
              wx.showToast({
                title: '打开证书失败',
                icon: 'none'
              })
            }
          })
        },
        fail: (err) => {
          console.error('下载文件失败:', err)
          wx.showToast({
            title: '下载证书失败',
            icon: 'none'
          })
        }
      })
    }
  },

  navigateToAdmin() {
    wx.navigateTo({
      url: '/pages/certificate/pages/certificateLogin/index'
    })
  }
})