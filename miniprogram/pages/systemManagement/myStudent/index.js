Page({

  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {},
    userName: '',
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
    this.getUsers()
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
  getUsers() {
    if (!this.data.hasMore) return // 如果没有更多数据，则不再加载
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
      resp.result.forEach(res => {
        res.courseName = ''
        const filterStudent = res.tearchreOpenid_course.filter(el => {
          return el.teacherOpenid === this.data.userInfo._openid
        })
        if (filterStudent && filterStudent.length) {
          filterStudent[0].course.forEach(el => {
            res.courseName += '【' + el.title + '】'
          }) 
        } 
      })
      const data = this.data.userList.concat(resp.result)
      this.setData({
        userList: data,
        page: this.data.page + 1
      })
      // 如果返回的数据长度小于pageSize，则说明已经是最后一页
      if (resp.result.length < this.data.pageSize) {
        this.setData({ hasMore: false })
      }
      console.log('用户', this.data.userList)
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  searchUsers() {
    this.setData({
      hasMore: true,
      userList: [],
      page: 0
    })
    this.getUsers()
  },
  addStudent() {
    wx.navigateTo({
      url: '/pages/systemManagement/myStudentAdd/index',
    })
  },
  addStudentInfo() {
    wx.navigateTo({
      url: '/pages/systemManagement/addStudents/index',
    })
  },
  editStudent(e) {
    wx.navigateTo({
      url: '/pages/systemManagement/myStudentAdd/index',
      events: {
        // 为指定事件添加一个监听器，获取被打开页面传送到当前页面的数据
        currentStudentData: function(data) {
          console.log('监听事件', data)
        }
      },
      success: function(res) {
        res.eventChannel.emit('currentStudentData', { data: e.currentTarget.dataset.data })
      }
    })
  },
  deleteStudent(e) {
    const _this = this
    wx.showModal({
      title: '提示',
      content: '确定取消？',
      success (res) {
        if (res.confirm) {
          wx.showLoading({
            title: '加载中'
          })
          const params = e.currentTarget.dataset.data
          const findIndex = params.tearchreOpenid_course.findIndex(res => {
            return res.teacherOpenid === _this.data.userInfo._openid
          })
          params.deleteCourse = params.tearchreOpenid_course[findIndex]
          wx.cloud.callFunction({
            name: 'deleteStudentsCourse',
            data: params
          }).then(resp => {
            console.log('删除结果', resp)
            wx.hideLoading()
            _this.searchUsers()
          })
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  }
})