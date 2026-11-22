// pages/systemManagement/courseManagmentHandle/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    _id: '',
    age: '',
    expense_level_1: 0,
    expense_level_2: 0,
    expense_level_3: 0,
    minute: 45,
    numbers: "1",
    periods: 1,
    pitch_number: 12,
    require: '',
    target: '',
    title: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const eventChannel = this.getOpenerEventChannel()
    const _this = this
    eventChannel.on('currentCourse', function(data) {
      if (Object.keys(data.data) && Object.keys(data.data).length) {
        Object.keys(data.data).forEach(res => {
          _this.setData({
            [res]: data.data[res]
          })
        })
      }
    })
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
  handleCourse() {
    wx.showLoading({
      title: '加载中'
    })
    const _this = this
    if (this.data._id) {
      wx.cloud.callFunction({
        name: 'editCourse',
        data: {
          _id: _this.data._id,
          age: _this.data.age,
          expense_level_1: _this.data.expense_level_1,
          expense_level_2: _this.data.expense_level_2,
          expense_level_3: _this.data.expense_level_3,
          minute: _this.data.minute,
          numbers: _this.data.numbers,
          periods: _this.data.periods,
          pitch_number: _this.data.pitch_number,
          require: _this.data.require,
          target: _this.data.target,
          title: _this.data.title
        }
      }).then((resp) => {
        console.log('结果', resp)
        wx.hideLoading()
        wx.showToast({
          title: '保存成功',
          icon: 'success',
          duration: 2000
        })
        setTimeout(() => {
          wx.redirectTo({
            url: '/pages/systemManagement/courseManagment/index',
          })
        }, 500)
      }).catch((e) => {
        wx.hideLoading()
      })
    } else {
      wx.cloud.callFunction({
        name: 'addCourse',
        data: {
          age: _this.data.age,
          expense_level_1: _this.data.expense_level_1,
          expense_level_2: _this.data.expense_level_2,
          expense_level_3: _this.data.expense_level_3,
          minute: _this.data.minute,
          numbers: _this.data.numbers,
          periods: _this.data.periods,
          pitch_number: _this.data.pitch_number,
          require: _this.data.require,
          target: _this.data.target,
          title: _this.data.title
        }
      }).then((resp) => {
        console.log('结果', resp)
        wx.hideLoading()
        wx.showToast({
          title: '保存成功',
          icon: 'success',
          duration: 2000
        })
        setTimeout(() => {
          wx.redirectTo({
            url: '/pages/systemManagement/courseManagment/index',
          })
        }, 500)
      }).catch((e) => {
        wx.hideLoading()
      })
    }
  }
})