 import moment from 'moment'
Page({

  /**
   * 页面的初始数据
   */
  data: {
    activeNames: 0,
    courseList: []
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const eventChannel = this.getOpenerEventChannel()
    const _this = this
    const tempData = []
    eventChannel.on('myCourseList', function(data) {
      console.log('myCourseList', data)
      _this.setData({
        courseList: data.data
      })
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
    this.getCourses()
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
  onChange(event) {
    this.setData({
      activeNames: event.detail,
    });
  },
  // 我的课程
  getCourses() {
    wx.showLoading({
      title: '加载中'
    })
    const userInfo = wx.getStorageSync('userInfo')
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        _openid: userInfo._openid,
        order: {
          string: 'startTime',
          order: 'asc' // desc降序，asc升序。
        }
      }
    }).then((resp) => {
      console.log('我的课程', resp)
      const tempResult = resp.result.result.data
      let getCourseList =  this.data.courseList
      getCourseList.forEach(el => {
        const filterCourse = tempResult.filter(element => {
          return element.courseId === el._id
        })
        if (filterCourse && filterCourse.length) {
          filterCourse.forEach(el => {
            el.startTime = moment(new Date(el.startTime)).format("YYYY-MM-DD HH:mm")
            el.endTime = moment(new Date(el.endTime)).format("YYYY-MM-DD HH:mm")
          })
          el.myCourse = filterCourse
        }
      })
      this.setData({
        courseList: getCourseList
      })
      console.log('我的课程内容',  this.data.courseList)
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  }
})