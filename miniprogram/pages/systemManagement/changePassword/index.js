Page({

  /**
   * 页面的初始数据
   */
  data: {
    account: '',
    oldPassword: '',
    newPassword: '',
    accountError: '',
    oldPasswordError: '',
    newPasswordError: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  },
  loadByAccount() {
    if (!this.data.account || !this.data.oldPassword || !this.data.newPassword) {
      if (!this.data.account) {
        this.setData({
          accountError: '请输入账号'
        })
      } else {
        this.setData({
          accountError: ''
        })
      }
      if (!this.data.oldPassword) {
        this.setData({
          oldPasswordError: '请输入密码'
        })
      } else {
        this.setData({
          oldPasswordError: ''
        })
      }
      if (!this.data.newPassword) {
        this.setData({
          newPasswordError: '请输入密码'
        })
      } else {
        this.setData({
          newPasswordError: ''
        })
      }
    } else {
      wx.showLoading({
        title: '加载中'
      })
      const _this = this
      wx.cloud.callFunction({
        name: 'changePassword',
        data: {
          account: (_this.data.account).trim(),
          oldPassword: (_this.data.oldPassword).trim(),
          newPassword: (_this.data.newPassword).trim()
        }
      }).then((resp) => {
        console.log('结果', resp)
        wx.hideLoading()
        wx.showModal({
          title: '提示',
          content: resp.result.error,
          success (res) {
            if (res.confirm) {
              console.log('用户点击确定')
            } else if (res.cancel) {
              console.log('用户点击取消')
            }
          }
        })
      }).catch((e) => {
        wx.hideLoading()
      })
    }
  }
})