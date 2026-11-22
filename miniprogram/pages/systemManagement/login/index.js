// pages/systemManagement/login/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    account: '',
    password: '',
    accountError: '',
    passwordError: ''
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
    if (!this.data.account || !this.data.password) {
      if (!this.data.account) {
        this.setData({
          accountError: '请输入账号'
        })
      } else {
        this.setData({
          accountError: ''
        })
      }
      if (!this.data.password) {
        this.setData({
          passwordError: '请输入密码'
        })
      } else {
        this.setData({
          passwordError: ''
        })
      }
    } else {
      wx.showLoading({
        title: '加载中'
      })
      const _this = this
      wx.cloud.callFunction({
        name: 'login',
        data: {
          account: (_this.data.account).trim(),
          password: (_this.data.password).trim()
        }
      }).then((resp) => {
        console.log('结果', resp)
        wx.hideLoading()
        if (resp.result.code === 404) {
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
        } else {
          wx.navigateTo({
            url: '/pages/systemManagement/list/index',
            events: {
              // 为指定事件添加一个监听器，获取被打开页面传送到当前页面的数据
            },
            success: function(res) {
            }
          })
        }
      }).catch((e) => {
        wx.hideLoading()
      })
    }
  },
  toChange() {
    wx.navigateTo({
      url: '/pages/systemManagement/changePassword/index'
    })
  }
})