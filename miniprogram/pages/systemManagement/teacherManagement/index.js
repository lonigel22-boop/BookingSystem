Page({

  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {},
    teacherPage: 0, // 当前页码
    teacherPageSize: 100, // 每页条数
    teacherHasMore: true, // 是否有更多数据
    teacherName: '',
    teachers: [],
    page: 0, // 当前页码
    pageSize: 100, // 每页条数
    hasMore: true, // 是否有更多数据
    showUser: false,
    userName: '',
    userList: [],
    checkUsers: [],
    singleCardHeight: 50, // 单个卡片的高度，包括margin
    moving: false, // 是否正在移动  
    startY: 0, // 开始拖动时的Y坐标  
    movingIndex: -1, // 当前被拖动的元素的索引
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
    this.getTeachers()
    this.setData({
      userInfo: wx.getStorageSync('userInfo')
    })
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
  searchTeachers() {
    this.setData({
      teachers: [],
      teacherPage: 0,
      teacherHasMore: true
    })
    this.getTeachers()
  },
  getTeachers() {
    wx.showLoading({
      title: '加载中'
    })
    const _this = this
    wx.cloud.callFunction({
      name: 'getTeacheres',
      data: {
        name: _this.data.teacherName,
        page: _this.data.teacherPage,
        pageSize: _this.data.teacherPageSize
      }
    }).then((resp) => {
      console.log('结果', resp)
      const data = _this.data.teachers.concat(resp.result)
      data.forEach((res, i) => {
        res.x = 0
        res.y = i * _this.data.singleCardHeight
      })
      this.setData({
        teachers: data,
        teacherPage: this.data.teacherPage + 1
      })
      // 如果返回的数据长度小于pageSize，则说明已经是最后一页
      if (resp.result.length < this.data.pageSize) {
        this.setData({ teacherHasMore: false })
      }
      console.log('教师', _this.data.teachers)
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  handleTouchStart(e) {
    console.log('拖拽开始参数', e)
    // 记录开始拖动的元素索引  
    this.setData({
      moving: true,  
      movingIndex: e.currentTarget.dataset.index,  
      startY: e.touches[0].clientY, // 记录开始拖动时的Y坐标  
    })
  }, 
  handleMoveChange(e) {
    console.log('拖拽改变参数', e)
    if (this.data.moving && this.data.movingIndex !== -1) {
      const movingIndex = this.data.movingIndex
      const teachers = this.data.teachers
      const touchMoveY = e.touches[0].clientY
      const moveDistance = touchMoveY - this.data.startY; // 计算移动距离

      // 更新被拖动元素的位置  
      teachers[movingIndex].y += moveDistance
      
      // 注意：这里可能需要处理边界条件，防止元素移出视图
      this.setData({  
        teachers,
        startY: touchMoveY, // 更新开始Y坐标以便下一次计算
      })
    }
  },
  handleMoveEnd(e) {
    console.log('拖拽结束参数', e)
    if (this.data.moving) {  
      const movingItem = this.data.teachers[this.data.movingIndex]
      const sortedFields = [...this.data.teachers] 
      sortedFields.splice(this.data.movingIndex, 1) // 移除被拖动的元素  
  
      // 找到新位置并插入  
      const newIndex = sortedFields.findIndex(  
        (item) => item.y > movingItem.y  
      );  
      if (newIndex >= 0) {  
        sortedFields.splice(newIndex, 0, movingItem);  
      } else {  
        sortedFields.push(movingItem)
      }  
  
      // 重新设置元素位置  
      sortedFields.forEach((item, index) => {  
        item.y = index * this.data.singleCardHeight;  
      })
  
      this.setData({  
        moving: false,
        teachers: sortedFields,  
        movingIndex: -1, // 重置拖动索引  
      })
      console.log('拖拽结束', this.data.teachers)
      this.changeteachers(this.data.teachers)
    }  
  },
  changeteachers(data) {
    wx.showLoading({
      title: '加载中'
    })
    const _this = this
    wx.cloud.callFunction({
      name: 'changeTeachers',
      data: {
        data: data
      }
    }).then((res) => {
      console.log('更新成功', res)
      wx.hideLoading()
   }).catch((e) => {
      wx.hideLoading()
    })
  },
  addTeacher() {
    this.setData({
      showUser: true
    })
    this.searchUsers()
  },
  onClose() {
    this.setData({
      showUser: false
    })
  },
  searchUsers(){
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
        page: this.data.page,
        pageSize: this.data.pageSize,
        filter: {
          isTeacher: false
        }
      }
    }).then((resp) => {
      console.log('结果', resp)
      const data = this.data.userList.concat(resp.result)
      const dataResult = data.filter(res => {
        return res._openid.length > 13
      })
      this.setData({
        userList: dataResult,
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
  checkUsersChange(event) {
    this.setData({
      checkUsers: event.detail,
    })
  },
  userToTeacher() {
    let getUsers = []
    this.data.checkUsers.forEach(res => {
      const filterData = this.data.userList.filter(el => {
        if (el._openid === res) {
          el.isTeacher = true
          return true
        }
      })
      if (filterData && filterData.length) {
        getUsers = getUsers.concat(filterData)
      }
    })
    getUsers.forEach((res, index) => {
      res.y = (this.data.teachers.length + 1 + index) * (this.data.singleCardHeight ? this.data.singleCardHeight : 50)
    })
    console.log('选择的教师', getUsers)
    if (getUsers.length > 100) {
      wx.showModal({
        title: '提示',
        content: '一次最多选择100个',
        showCancel: false,
        success (res) {
          if (res.confirm) {
            console.log('用户点击确定')
          }
        }
      })
      return
    }
    wx.showLoading({
      title: '加载中'
    })
    const _this = this
    wx.cloud.callFunction({
      name: 'addTeachers',
      data: {
        data: getUsers
      }
    }).then((re) => {
      this.setData({
        checkUsers: [],
        showUser: false
      })
      _this.searchTeachers()
      wx.hideLoading()
   }).catch((e) => {
      wx.hideLoading()
    })
  },
  seleteTeacher(e) {
    const data = e.currentTarget.dataset.data
    const _this = this
    wx.showModal({
      title: '提示',
      content: `确定删除教师${data.name}？` ,
      success (res) {
        if (res.confirm) {
          console.log('用户点击确定')
          wx.showLoading({
            title: '加载中'
          })
          wx.cloud.callFunction({
            name: 'deleteTeacher',
            data: {
              _openid: data._openid
            }
          }).then((re) => {
            _this.searchTeachers()
            wx.hideLoading()
         }).catch((e) => {
            wx.hideLoading()
          })
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  }
})