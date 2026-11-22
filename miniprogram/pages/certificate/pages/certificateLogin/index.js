Page({
  data: {
    password: ''
  },

  onPasswordInput(e) {
    this.setData({
      password: e.detail.value
    })
  },

  login() {
    if (this.data.password === '210220') {
      wx.navigateTo({
        url: '/pages/certificate/pages/certificateManage/index'
      })
    } else if (this.data.password === '210826') {
      wx.navigateTo({
        url: '/pages/systemManagement/list/index'
      })
    } else {
      wx.showToast({
        title: '密码错误',
        icon: 'error',
        duration: 2000
      })
    }
  }
})