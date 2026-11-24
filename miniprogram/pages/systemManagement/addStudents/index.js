const readCache = require('../../../utils/readCache.js')
Page({

  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {},
    students: [],
    name: '',
    showUser: false,
    userName: '',
    userList: [], // 用户列表
    page: 0, // 当前页码
    pageSize: 100, // 每页条数
    hasMore: true, // 是否有更多数据
    checkUsers: [],
    containeHeight: 0,
    showCourse: false,
    currentUser: '',
    checkCourse: [],
    courses: [],
    pageStatus: 'add',

    _id: '',
    name: '',
    nameMessage: '',
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const eventChannel = this.getOpenerEventChannel()
    const _this = this
    eventChannel.on('currentStudentData', function(data) {
      if (data.data) {
        let currentStudent = _this.data.students
        currentStudent.push(data.data)

        let checkUsers = _this.data.checkUsers
        checkUsers.push(data.data._openid)

        _this.setData({
          students: currentStudent,
          checkUsers: checkUsers,
          pageStatus: 'edit'
        })
      }
      console.log('学生', data.data, this.students)
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
    this.setData({
      userInfo: wx.getStorageSync('userInfo')
    })
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
          teacherOpenid: this.data.userInfo._openid
        }
      }
    }).then((resp) => {
      console.log('结果', resp)
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
      userList: [],
      hasMore: true,
      page: 0
    })
    this.getUsers()
  },
  addStudent() {
    this.setData({
      showUser: true
    })
    // this.searchUsers()
  },
  onClose() {
    this.setData({
      showUser: false
    })
  },
  checkUsersChange(event) {
    this.setData({
      checkUsers: event.detail,
    })
  },
  userToTeacher() {
    if (this.data.checkUsers && this.data.checkUsers.length) {
      let getSelectedStudents = []
      this.data.checkUsers.forEach(res => {
        const filterData = this.data.userList.filter(el => {
          return el._openid === res
        })
        if (filterData && filterData.length) {
          getSelectedStudents = getSelectedStudents.concat(filterData)
        }
      })
      this.setData({
        students: getSelectedStudents,
        showUser: false,
        checkUsers: [],
        userList: [],
        userName: ''
      })
    } else {
      if (!this.data.name) {
        this.setData({
          nameMessage: '请输入姓名'
        })
        return
      }
      wx.cloud.callFunction({
        name: 'getUsers',
        data: {
          name: this.data.name,
          page: 0,
          pageSize: 100
        }
      }).then(res => {
        console.log('结果', res)
        if (res.result && res.result.length) {
          wx.showToast({
            title: this.data.name + '已存在',
            icon: 'error',
            duration: 2000
          })
        } else {
          const data = {
            _appid: Math.random().toString(36),
            _openid: Math.random().toString(36),
            name: this.data.name,
            age: this.data.age,
            gender: this.data.gender,
            avatarUrl: '',
            cloudID: '',
            isTeacher: false
          }
          wx.cloud.callFunction({
            name: 'addUsers',
            data: data
          }).then((re) => {
            console.log('添加用户结果', re)
            wx.hideLoading()
            wx.showToast({
              title: '保存成功',
              icon: 'success',
              duration: 2000
            })
            let SD = []
            SD.push(data)
            this.setData({
              students: SD,
              showUser: false
            })
          }).catch((e) => {
            wx.hideLoading()
          })
        }
      })
    }
  },
  getCourse() {
    wx.showLoading({
      title: '加载中'
    })
    /* ★ 课程字典缓存：与「课程」页 / 课程管理页跨页复用同一份数据 */
    readCache.cachedRead('getCourse', {}, 300)
      .then((resp) => {
      this.setData({
        courses: resp.result.data
      })
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  selectCourse(event) {
    const data =  event.currentTarget.dataset.item
    console.log('selectCourse', event)
    let checkCourse = this.data.checkCourse
    if (data.tearchreOpenid_course && data.tearchreOpenid_course.length && this.data.pageStatus === 'edit') {
      // 当前教师下的学生课程
      const filterStudentCourse = data.tearchreOpenid_course.filter(res => {
        return res.teacherOpenid === this.data.userInfo._openid
      })
      console.log('当前学生的课程', filterStudentCourse)
      filterStudentCourse.forEach(res => {
        res.course.forEach(el => {
          if (!checkCourse.includes(el._id)) {
            checkCourse.push(el._id)
          }
        })
      })
    }else {
      checkCourse = []
    }
    this.setData({
      currentUser: data,
      checkCourse: checkCourse, // 课程id
      showCourse: true
    })
  },
  onCourseClose() {
    this.setData({
      showCourse: false
    })
  },
  checkCourseChange(event) {
    this.setData({
      checkCourse: event.detail,
    })
  },
  userToCourse() {
    wx.showLoading({
      title: '加载中'
    })

    let currentCourse = []
    let currentCourseName = ''
    this.data.checkCourse.forEach((res, index) => {
      const filterCourse = this.data.courses.filter((el, index) => {
        if (el._id === res) {
          currentCourseName += "【" + el.title + '】 '
        }
        return el._id === res
      })
      currentCourse = currentCourse.concat(filterCourse)
    })

    const userInfo = wx.getStorageSync('userInfo')
    const currentUser = this.data.currentUser
    const students = this.data.students
    students.forEach(res => {
      if (res._openid === currentUser._openid) {

        if (!res.tearchreOpenid_course) {
          res.tearchreOpenid_course = []
        }

        const filter_tearchreOpenid_course = res.tearchreOpenid_course.findIndex(el => {
          return el.teacherOpenid === userInfo._openid
        })
        let tearchreOpenid_course = { 
          teacherName: userInfo.name ? userInfo.name : userInfo.nickName,
          teacherOpenid: userInfo._openid,
          course: currentCourse
        }
        if (filter_tearchreOpenid_course >= 0) {
          res.tearchreOpenid_course[filter_tearchreOpenid_course] = tearchreOpenid_course
        } else {
          res.tearchreOpenid_course.push(tearchreOpenid_course)
        }
        res.courseName = currentCourseName
      }
    })
    this.setData({
      students: students,
      showCourse: false
    })
    console.log('students', students)
    wx.hideLoading()
  },
  cancle() {
    wx.navigateBack()
  },
  saveMyStudent() {
    if (this.data.students && !this.data.students.length) {
      wx.showModal({
        title: '提示',
        content:  '请选择学生',
        showCancel: false,
        success (res) {
          if (res.confirm) {
            console.log('用户点击确定')
          }
        }
      })
      return
    }

    let emptyCourse = ''
    this.data.students.forEach(res => {
      if (res.tearchreOpenid_course && res.tearchreOpenid_course.length) {
        res.tearchreOpenid_course.forEach(el => {
          if (el.course && !el.course.length) {
            emptyCourse += "【" + (res.name ? res.name : res.nickName) + "】"
          }
        })
      } else {
        emptyCourse += "【" + (res.name ? res.name : res.nickName) + "】"
      }
    })
    if (emptyCourse) {
      wx.showModal({
        title: '提示',
        content:  `请选择${emptyCourse}的课程`,
        showCancel: false,
        success (res) {
          if (res.confirm) {
            console.log('用户点击确定')
          }
        }
      })
      return
    }
    wx.cloud.callFunction({
      name: 'addStudentsCourse',
      data: {
        data: this.data.students
      }
    }).then((res) => {
      console.log('结果', res)
      this.setData({
        checkCourse: [],
        showCourse: false
      })
      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success',
        duration: 2000
      })
      setTimeout(() => {
        wx.directTo({
          url: '/pages/systemManagement/myStudent/index',
        })
      }, 500)
    }).catch((e) => {
      wx.hideLoading()
    })
  },
})