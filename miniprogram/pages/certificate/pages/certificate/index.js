const db = wx.cloud.database()

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

  getUserInfo() {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      this.setData({
        userInfo: userInfo
      })
    }
  },

  onSearchInput(e) {
    this.setData({
      searchText: e.detail.value
    })
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