import moment from 'moment'
Page({

  /**
   * 页面的初始数据
   */
  data: {
    activeNames: 0,
    activeCourses: 0,
    userInfo: {},
    userList: [], // 用户列表
    page: 0, // 当前页码
    pageSize: 100, // 每页条数
    hasMore: true, // 是否有更多数据
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
    this.setData({
      userInfo: wx.getStorageSync('userInfo')
    })
    this.getResertUsers()
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
  onChange(e) {
    this.setData({
      activeNames: e.detail
    })
  },
  onChangeCourse(e) {
    this.setData({
      activeCourses: e.detail
    })
  },
  getResertUsers() {
    this.setData({
      userList: [],
      page: 0,
      hasMore: true
    })
    this.getUsers()
  },
  getUsers() {
    if (!this.data.hasMore) return; // 如果没有更多数据，则不再加载
    wx.showLoading({
      title: '加载中'
    })
    wx.cloud.callFunction({
      name: 'getUsers',
      data: {
        name: this.data.userName,
        teacherOpenid: this.data.userInfo._openid,
        page: this.data.page,
        pageSize: this.data.pageSize
      }
    }).then((resp) => {
      console.log('结果', resp)
      const tempResult = resp.result
      
      tempResult.forEach(res => {
         let filterCourse = res.tearchreOpenid_course.filter(el => {
          return el.teacherOpenid === this.data.userInfo._openid
        })
        if (filterCourse && filterCourse.length) {
          res.course = filterCourse[0]
        }
      })
      const tempData = this.data.userList.concat(tempResult)
      this.setData({
        userList: tempData,
        page: this.data.page + 1
      })
      this.getMycourse()
      // 如果返回的数据长度小于pageSize，则说明已经是最后一页
      if (resp.result.length < this.data.pageSize) {
        this.setData({
          hasMore: false
        })
      }
      console.log('学生', this.data.userList)
    }).catch((e) => {
    })
  },
  getMycourse() {
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        teacherOpenid: this.data.userInfo._openid,
        order: {
          string: 'startTime',
          order: 'asc' // desc降序 或 asc升序
        }
      }
    }).then(resp => {
      console.log('我的课程', resp)
      const tempData = this.data.userList
      tempData.forEach(res => {
        res.course.course.forEach(el => {
          let filterMyCourse = resp.result.result.data.filter(element => {
            return element.courseId === el._id && res._openid === element._openid
          })
          if (filterMyCourse && filterMyCourse.length) {
            filterMyCourse.forEach(elp => {
              elp.startTimeFormat = moment(new Date(elp.startTime)).format('YYYY/MM/DD HH:mm')
            })
            el.currentCourse = filterMyCourse
          }
        })
      })
      this.setData({
        userList: tempData
      })
      wx.hideLoading()
      console.log('学生课程', this.data.userList)
    }).catch(err => {
      wx.hideLoading()
    })
  },
  // 删除课程
  deleteMyCourse(e) {
    const _id = e.currentTarget.dataset.data._id
    const _this = this
    wx.showModal({
      title: '提示',
      content: '确定取消？',
      success (res) {
        if (res.confirm) {
          wx.showLoading({
            title: '加载中'
          })
          wx.cloud.callFunction({
            name: 'deleteMyCourse',
            data: {
              _id: _id
            }
          }).then(res => {
            console.log('结果', res)
            wx.showToast({
              title: '成功',
              icon: 'success',
              duration: 1000
            })
            _this.getMycourse()
          })
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  }
})