Page({

  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {},
    userName: '',
    userList: [], // 用户列表
    total: 0,     // 列表人数（标题用）
    page: 0,      // 当前页码
    pageSize: 100,// 每页条数
    hasMore: true // 是否有更多数据
  },

  onLoad() {},
  onReady() {},

  /**
   * ★ 修正：原来 onShow 直接 getUsers()，而 getUsers 是 concat 追加，
   *   每次从编辑/添加页返回都会把全部学生再追加一遍 → 列表翻倍。
   *   改成 reload()：先清空再拉第一页。
   */
  onShow() {
    this.setData({ userInfo: wx.getStorageSync('userInfo') || {} })
    this.reload()
  },

  onHide() {},
  onUnload() {},
  onPullDownRefresh() {},
  onReachBottom() {},
  onShareAppMessage() {},

  reload() {
    this._loading = false
    this.setData({ userList: [], total: 0, page: 0, hasMore: true })
    this.getUsers()
  },

  getUsers() {
    if (!this.data.hasMore || this._loading) return
    this._loading = true
    if (this.data.page === 0) wx.showLoading({ title: '加载中' })
    wx.cloud.callFunction({
      name: 'getUsers',
      data: {
        name: this.data.userName,
        teacherOpenid: this.data.userInfo._openid,
        page: this.data.page,
        pageSize: this.data.pageSize
      }
    }).then((resp) => {
      this._loading = false
      wx.hideLoading()
      const result = (resp && Array.isArray(resp.result)) ? resp.result : []
      const mineOpenid = this.data.userInfo._openid

      result.forEach(res => {
        /* ★ 兜底：自建档案 / 老记录可能没有 tearchreOpenid_course，
           原来直接 .filter 会抛错，导致整页列表渲染失败。 */
        const arr = Array.isArray(res.tearchreOpenid_course) ? res.tearchreOpenid_course : []
        const mine = arr.filter(el => el && el.teacherOpenid === mineOpenid)
        const tags = []
        if (mine.length && Array.isArray(mine[0].course)) {
          mine[0].course.forEach(el => {
            if (el && el.title) tags.push(String(el.title))
          })
        }
        // 卡片里最多 3 个标签，其余折叠成「+N 门」，卡片高度才整齐
        res.courseTags = tags.slice(0, 3)
        res.courseMore = tags.length > 3 ? tags.length - 3 : 0
        // 保留原字段，兼容其它可能读取 courseName 的地方
        res.courseName = tags.map(t => '【' + t + '】').join('')
      })

      const data = this.data.userList.concat(result)
      this.setData({
        userList: data,
        total: data.length,
        page: this.data.page + 1
      })
      if (result.length < this.data.pageSize) {
        this.setData({ hasMore: false })
      }
    }).catch(() => {
      this._loading = false
      wx.hideLoading()
    })
  },

  searchUsers() {
    this.reload()
  },

  addStudent() {
    wx.navigateTo({
      url: '/pages/systemManagement/myStudentAdd/index'
    })
  },

  addStudentInfo() {
    wx.navigateTo({
      url: '/pages/systemManagement/addStudents/index'
    })
  },

  editStudent(e) {
    wx.navigateTo({
      url: '/pages/systemManagement/myStudentAdd/index',
      events: {
        currentStudentData: function (data) {
          console.log('监听事件', data)
        }
      },
      success: function (res) {
        res.eventChannel.emit('currentStudentData', { data: e.currentTarget.dataset.data })
      }
    })
  },

  deleteStudent(e) {
    const _this = this
    const params = e.currentTarget.dataset.data || {}
    /* ★ 兜底：没有本老师下的课程绑定时，原来 findIndex=-1 会把
       params.deleteCourse 设成 undefined 再丢给云函数 _.pull(undefined)。
       现在直接提示，不发无效写请求。 */
    const arr = Array.isArray(params.tearchreOpenid_course) ? params.tearchreOpenid_course : []
    const findIndex = arr.findIndex(res => res && res.teacherOpenid === _this.data.userInfo._openid)
    if (findIndex < 0) {
      wx.showToast({ title: '该学生没有课程记录', icon: 'none' })
      return
    }
    wx.showModal({
      title: '提示',
      content: '确定取消？',
      success (res) {
        if (!res.confirm) return
        wx.showLoading({ title: '加载中' })
        params.deleteCourse = arr[findIndex]
        // 参数与原来逐字段一致，云函数 deleteStudentsCourse 一字未改
        wx.cloud.callFunction({
          name: 'deleteStudentsCourse',
          data: params
        }).then(() => {
          wx.hideLoading()
          wx.showToast({ title: '已取消', icon: 'success', duration: 1500 })
          _this.reload()
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '操作失败', icon: 'none' })
        })
      }
    })
  }
})
