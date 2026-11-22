// pages/systemManagement/courseManagment/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    courses: []
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
    this.getCourse()
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
  // 全部课程查询
  getCourse() {
    wx.showLoading({
      title: '加载中'
    })
    wx.cloud.callFunction({
      name: 'getCourse'
    }).then((resp) => {
      console.log('课程', resp)
      this.setData({
        courses: resp.result.data
      })
      wx.hideLoading()
      this.getUsers()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  editCourse(e) {
    const data = e.currentTarget.dataset.data
    wx.navigateTo({
      url: '/pages/systemManagement/courseManagmentHandle/index',
      events: {
        currentCourse: function(data) {
          console.log('监听事件', data)
        }
        // 为指定事件添加一个监听器，获取被打开页面传送到当前页面的数据
      },
      success: function(res) {
        // 通过eventChannel向被打开页面传送数据
        res.eventChannel.emit('currentCourse', { data: data })
      }
    })
  },
  addCourse() {
    wx.navigateTo({
      url: '/pages/systemManagement/courseManagmentHandle/index'
    })
  },
  deleteCourse(e) {
    const data = e.currentTarget.dataset.data
    const _this = this
    wx.showModal({
      title: '提示',
      content: `确定删除课程：${data.title ? data.title : '-'}？` ,
      success (res) {
        if (res.confirm) {
          console.log('用户点击确定')
          wx.showLoading({
            title: '加载中'
          })
          wx.cloud.callFunction({
            name: 'deleteCourse',
            data: {
              _id: data._id
            }
          }).then((res) => {
            console.log('成功', res)
            _this.getCourse()
         }).catch((e) => {
          console.log('失败', e)
          })
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  },
  resetCourseStatus() {
    const _this = this
    wx.showModal({
      title: '提示',
      content: '确定要重置所有课程状态为待上课吗？',
      success (res) {
        if (res.confirm) {
          wx.showLoading({
            title: '处理中'
          })
          wx.cloud.callFunction({
            name: 'resetCourseStatus'
          }).then((res) => {
            wx.hideLoading()
            if (res.result && res.result.success) {
              wx.showToast({
                title: '重置成功',
                icon: 'success',
                duration: 2000
              })
              _this.getCourse()
            } else {
              wx.showToast({
                title: '重置失败',
                icon: 'error',
                duration: 2000
              })
            }
          }).catch((e) => {
            wx.hideLoading()
            wx.showToast({
              title: '重置失败',
              icon: 'error',
              duration: 2000
            })
          })
        }
      }
    })
  }
})