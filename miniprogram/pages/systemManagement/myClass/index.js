import moment from 'moment'
import { callCloudFunction, callCloudFunctionWithConfirm } from '../../../utils/cloudHelper'
Page({

  /**
   * 页面的初始数据
   */
  data: {
    showStartPicker: false,
    startDate: moment(new Date()).startOf('month').format("YYYY-MM-DD"),
    minEndDate: new Date().getTime(),
    endDate: moment(new Date()).endOf('month').format("YYYY-MM-DD"),
    activeNames: '',
    activeCourses: 0,
    userInfo: {},
    userName: '',
    userList: [], // 用户列表
    userListResult: [], // 用户列表
    page: 0, // 当前页码
    pageSize: 100, // 每页条数
    hasMore: true, // 是否有更多数据
    showNoteDialog: false, // 备注对话框显示状态
    noteContent: '', // 备注内容
    currentCourse: null, // 当前选中的课程
    lessonTitle: '', // 课节标题
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
  pickerDisplay() {
    this.setData({
      showStartPicker: true
    })
  },
  closePopup() {
    this.setData({
      showStartPicker: false
    })
  },
  currentTime(e) {
    console.log('e', e)
    this.setData({
      startDate: e.detail.currentTime,
      showStartPicker: false,
      minEndDate: new Date(e.detail.currentTime).getTime(),
      endDate: moment(new Date(e.detail.currentTime)).add(1, 'months').add(-1, 'day').format("YYYY-MM-DD"),
    })
  },
  endPickerDisplay() {
    this.setData({
      showEndPicker: true
    })
  },
  closeEndPopup() {
    this.setData({
      showEndPicker: false
    })
  },
  currentEndTime(e) {
    console.log('e', e)
    this.setData({
      endDate: e.detail.currentTime,
      showEndPicker: false
    })
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

  // 切换置顶状态
  async toggleTop(e) {
    const item = e.currentTarget.dataset.item
    const { userInfo } = this.data
    
    try {
      // 调用云函数更新sequence
      const newIsTop = !item.isTop
      const res = await wx.cloud.callFunction({
        name: 'updateUserSequence',
        data: {
          userId: item._id,
          sequence: newIsTop ? 0 : 1, // 置顶用户sequence为0，其他为1
          teacherOpenid: userInfo._openid
        }
      })
      
      if (res.result.success) {
        console.log('更新sequence成功', res.result)
        const userList = this.data.userList.map(user => {
          if (user._id === item._id) {
            return {
              ...user, 
              isTop: newIsTop,
              sequence: newIsTop ? 0 : 1 // 确保本地数据与云端同步
            }
          }
          return user
        })
        
        console.log('更新后的用户列表', userList)
        this.setData({
          userList,
          userListResult: this.sortUsers(userList)
        })
      } else {
        console.error('云函数返回失败', res.result)
        wx.showToast({
          title: '更新排序失败',
          icon: 'none'
        })
      }
    } catch (err) {
      console.error('更新排序失败:', err)
      wx.showToast({
        title: '更新排序失败',
        icon: 'none'
      })
    }
  },

  // 排序学生列表(置顶优先+云端sequence)
  sortUsers(users) {
    return [...users].sort((a, b) => {
      // 置顶学生优先
      if (a.isTop !== b.isTop) {
        return b.isTop - a.isTop
      }
      // 比较云端sequence (确保取消置顶后按sequence=1排序)
      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence
      }
      // 相同sequence时，按姓名排序
      const nameA = a.name || a.nickName || ''
      const nameB = b.name || b.nickName || ''
      const nameCompare = nameA.localeCompare(nameB, 'zh-Hans-CN', { 
        sensitivity: 'accent',
        usage: 'sort'
      })
      
      // 如果姓名也相同，按_openid排序确保稳定性
      if (nameCompare === 0) {
        return a._openid.localeCompare(b._openid)
      }
      return nameCompare
    })
  },
  async getUsers() {
    if (!this.data.hasMore) return; // 如果没有更多数据，则不再加载
    
    try {
      // 并行获取用户列表和sequence数据
      const [usersRes, sequenceRes] = await Promise.all([
        callCloudFunction('getUsers', {
          name: this.data.userName,
          teacherOpenid: this.data.userInfo._openid,
          page: this.data.page,
          pageSize: this.data.pageSize
        }, {
          loadingTitle: '加载学员数据中'
        }),
        wx.cloud.callFunction({
          name: 'getUserSequence',
          data: {
            teacherOpenid: this.data.userInfo._openid
          }
        })
      ])

      let tempResult = usersRes.result
      
      // 合并sequence数据到用户列表
      const usersWithSequence = tempResult.map(user => {
        const sequenceData = sequenceRes.result.data?.find(
          item => item.userId === user._id
        )
        return {
          ...user,
          isTop: sequenceData ? sequenceData.sequence === 0 : false,
          sequence: sequenceData ? sequenceData.sequence : 1
        }
      })
      
      // 使用统一的排序方法
      tempResult = this.sortUsers(usersWithSequence)
      
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
      if (usersRes.result.length < this.data.pageSize) {
        this.setData({
          hasMore: false
        })
      }
      console.log('学生', this.data.userList)
    } catch (e) {
      console.error('获取用户列表失败:', e)
      wx.showToast({
        title: '获取用户列表失败',
        icon: 'none'
      })
    }
  },
  getMycourse() {
    callCloudFunction('getMyCourse', {
      teacherOpenid: this.data.userInfo._openid,
      order: {
        string: 'startTime',
        order: 'asc' // desc降序 或 asc升序
      }
    }, {
      loadingTitle: '获取课程信息中'
    }).then(resp => {
      console.log('我的课程', resp)
      const data = resp.result.result.data

      // 最新时间课程
      let timestamps = data.map(item => item.startTime)
      let latestIndex = timestamps.indexOf(Math.max(...timestamps))
      let latestItem = latestIndex >= 0 ? data[latestIndex] : null

      let resultData = []
      this.data.userList.forEach(res => {
        res.course.course.forEach(el => {
          // 查询学生的课程
          let filterMyCourse = data.filter(element => {
            return element.courseId === el._id && res._openid === element._openid
          })
          if (filterMyCourse && filterMyCourse.length) {
            filterMyCourse.forEach(elp => {
              // 显示开始和结束时间(已经是北京时间)
              elp.startTimeFormat = moment(new Date(elp.startTime)).format('YYYY/MM/DD HH:mm')
              elp.endTimeFormat = elp.duration ? 
                moment(new Date(elp.startTime + elp.duration * 60 * 1000)).format('YYYY/MM/DD HH:mm') : 
                moment(new Date(elp.startTime + 30 * 60 * 1000)).format('YYYY/MM/DD HH:mm') // 默认30分钟
            })
            el.currentCourse = filterMyCourse
          } else {
            el.currentCourse = []
          }
        })
        resultData.push(res)
      })

      this.setData({
        userListResult: resultData
      })
      console.log('学生课程', resultData)
    }).catch(err => {
      console.log('获取课程失败', err)
    })
  },
  // 预约
  async toAppointment(e) {
    console.log('选择项', e.currentTarget.dataset.data)
    const student = e.currentTarget.dataset.student
    const course = e.currentTarget.dataset.data
    
    // 从学生课程历史中获取最后一次上课记录
    let lastCourse = null
    if (student.course && student.course.course && student.course.course.length > 0) {
      const courses = student.course.course[0].currentCourse || []
      if (courses.length > 0) {
        // 按时间排序获取最后一次上课记录
        lastCourse = courses.sort((a, b) => b.startTime - a.startTime)[0]
      }
    }

    wx.navigateTo({
      url: '/pages/systemManagement/appointmentCourseHandle/index',
      events: {
        currentCourseData: function(data) {
          console.log('currentCourseData', data)
        },
        currentStudentData: function(data) {
          console.log('currentStudent', data)
        }
      },
      success: function(res) {
        res.eventChannel.emit('currentCourseData', { 
          data: course,
          lastShop: lastCourse ? lastCourse.shopId : '',
          lastShopName: lastCourse ? lastCourse.shopName : '',
          lastRoom: lastCourse ? lastCourse.room : ''
        })
        res.eventChannel.emit('currentStudentData', { 
          data: student,
          lastShop: lastCourse ? lastCourse.shopId : '',
          lastShopName: lastCourse ? lastCourse.shopName : '',
          lastRoom: lastCourse ? lastCourse.room : ''
        })
      }
    })
  },
  // 删除课程
  deleteMyCourse(e) {
    const _id = e.currentTarget.dataset.data._id
    
    callCloudFunctionWithConfirm(
      'deleteMyCourse',
      { _id },
      {
        title: '提示',
        content: '确定取消？'
      },
      {
        loadingTitle: '处理中',
        showSuccess: true,
        successTitle: '取消成功'
      }
    ).then(res => {
      console.log('结果', res)
      this.getMycourse()
    }).catch(e => {
      console.log('用户取消操作或操作失败', e)
    })
  },

  editMyCourse(e) {
    console.log('选择项', e.currentTarget.dataset.data)
    wx.navigateTo({
      url: '/pages/systemManagement/courseEdit/index',
      events: {
        // 为指定事件添加一个监听器，获取被打开页面传送到当前页面的数据
        currentCourseData: function(data) {
          console.log('currentCourseData', data)
        },
        currentStudentData: function(data) {
          console.log('currentStudent', data)
        }
      },
      success: function(res) {
        res.eventChannel.emit('currentCourseData', { data: e.currentTarget.dataset.data })
        res.eventChannel.emit('currentStudentData', { data: e.currentTarget.dataset.data })
      }
    })
  },

  // 显示备注对话框
  showNoteDialog(e) {
    const courseData = e.currentTarget.dataset.data
    this.setData({
      showNoteDialog: true,
      currentCourse: courseData,
      noteContent: courseData.note || '',
      lessonTitle: courseData.lessonTitle || ''
    })
  },

  // 关闭备注对话框
  closeNoteDialog() {
    this.setData({
      showNoteDialog: false,
      noteContent: '',
      lessonTitle: '',
      currentCourse: null
    })
  },

  // 保存备注
  saveNote() {
    const _this = this
    if (!this.data.currentCourse) return

    wx.showLoading({
      title: '保存中'
    })

    wx.cloud.callFunction({
      name: 'editMyCourse',
      data: {
        _id: this.data.currentCourse._id,
        note: this.data.noteContent,
        lessonTitle: this.data.lessonTitle
      }
    }).then(res => {
      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success',
        duration: 1000
      })
      _this.getMycourse()
      _this.closeNoteDialog()
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({
        title: '保存失败',
        icon: 'none',
        duration: 1000
      })
    })
  }
})