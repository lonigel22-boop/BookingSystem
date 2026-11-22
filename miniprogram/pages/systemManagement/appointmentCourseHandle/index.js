  import moment from 'moment'
  Page({

    /**
     * 页面的初始数据
     */
    data: {
      userInfo: {},
      showDateTime: false,
      currentDate: new Date().getTime(),
      minDate: moment(new Date()).subtract(5, 'years').valueOf(),
      maxDate:  moment(new Date()).add(30, 'days').hours(22).minutes(0).valueOf(),
      formatter(type, value) {
        if (type === 'year') return `${value}年`
        if (type === 'month')  return `${value}月`
        if (type === 'day')  return `${value}日`
        if (type === 'hour')  return `${value}时`
        if (type === 'minute')  return `${value}分`
        return value
      },
      startTime: '',
      teacher: '',
      currentTeacher: {},
      shop: '',
      teachers: [],
      page: 0,
      limit: 100,
      count: 0,
      showTeacher: false,
      searchName: '',
      checkTeacher: '',
      showShop: false,
      shopList: [],
      searchShopName: '',
      checkShop: '',
      currentShop: {},
      currentCourse: {},
      currentStudent: {},
      showRoom: false,
      checkRoom: '',
      room: '',
      roomList: []
    },

    /**
     * 生命周期函数--监听页面加载
     */
    onLoad(options) {
      const eventChannel = this.getOpenerEventChannel()
      const _this = this
      
      eventChannel.on('currentCourseData', function(data) {
        const currentCourse = data.data.currentCourse
        _this.setData({
          currentCourse: data.data,
          currentDate: currentCourse && currentCourse.length ? 
            moment(new Date(currentCourse[currentCourse.length - 1].startTime)).add(7, 'days').valueOf() : 
            new Date().getTime(),
          startTime: currentCourse && currentCourse.length ? 
            moment(new Date(currentCourse[currentCourse.length - 1].startTime)).add(7, 'days').format('YYYY/MM/DD HH:mm') : '',
          // 使用从myClass页面传递的上次上课信息
          checkShop: data.lastShop || '',
          shop: data.lastShopName || '',
          room: data.lastRoom || '',
          checkRoom: data.lastRoom || ''
        })
        console.log('课程', _this.data.currentCourse)
        _this.getShops()
      })

      eventChannel.on('currentStudentData', function(data) {
        _this.setData({
          currentStudent: data.data,
          // 使用从myClass页面传递的上次上课信息
          checkShop: data.lastShop || '',
          shop: data.lastShopName || '',
          room: data.lastRoom || '',
          checkRoom: data.lastRoom || ''
        })
        console.log('学生', _this.data.currentStudent)
        _this.getShops()
      })

      this.getShops()
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
      const getUserInfo = wx.getStorageSync('userInfo')
      this.setData({
        userInfo: getUserInfo,
        teacher: getUserInfo.name ? getUserInfo.name : getUserInfo.nickName
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
    // 保存
    saveAppointment() {
      if (!this.data.startTime || !this.data.shop || !this.data.room ) {
        wx.showModal({
          title: '提示',
          content: !this.data.startTime ? 
                    '请选择时间' : !this.data.shop ? 
                          '请选择门店' : !this.data.room ? "请选择房间" :
                          '' ,
          showCancel: false,
          success (res) {
            if (res.confirm) {
              console.log('用户点击确定')
            }
          }
        })
      } else {
        wx.showLoading({
          title: '加载中'
        })
        const userInfo = wx.getStorageSync('userInfo')
        const currentStudent = this.data.currentStudent
        wx.cloud.callFunction({
          name: 'addMyCourse',
          data: {
            startTime: new Date(this.data.startTime).getTime(),
            endTime: new Date(this.data.startTime).getTime() + (30 * 60 * 1000), // 默认30分钟课程
            teacherName: userInfo.name ? userInfo.name : userInfo.nickName,
            teacherOpenid:  userInfo._openid,
            shopName: this.data.currentShop.text,
            shopId: this.data.currentShop._id,
            courseId: this.data.currentCourse._id,
            courseName: this.data.currentCourse.title,
            _openid: currentStudent._openid,
            name: currentStudent.name ? currentStudent.name : currentStudent.nickName,
            room: this.data.room,
            duration: 29*60*1000, // 默认30分钟
            finished: new Date(this.data.startTime).getTime() < new Date().getTime()
          }
        }).then((resp) => {
          console.log('结果', resp)
          wx.hideLoading()
          const code = resp.result.code
          const msg = resp.result.msg
          if (code !== 200) {
            wx.showModal({
              title: '提示',
              content:  msg,
              showCancel: false,
              success (res) {
                if (res.confirm) {
                  console.log('用户点击确定')
                }
              }
            })
          } else {
            wx.showToast({
              title: '保存成功',
              icon: 'success',
              duration: 2000
            })
            wx.navigateBack()
          }
        }).catch((e) => {
          wx.hideLoading()
        })
      }
    },
    // 取消
    cancleCourse() {
      wx.redirectTo({
        url: '/pages/systemManagement/myClass/index'
      })
    },
    // 时间------------------------------
    seletedDateTime() {
      this.setData({
        showDateTime: true
      })
    },
    closeDateTime() {
      this.setData({
        showDateTime: false
      })
    },
    onInput(event) {
      this.setData({
        getDate: event.detail,
      })
    },
  // dateConfirm(e) {
  //   console.log('时间', e)
  //   this.setData({
  //    startTime:  moment(new Date(e.detail)).format('YYYY/MM/DD HH:mm'),
  //     showDateTime: false
  //   })
  // },
    dateConfirm(e) {
      console.log('时间', e)
      const selectedTime = new Date(e.detail)
      // 将分钟调整为整点，避免时间选择器返回的秒和毫秒影响
      selectedTime.setSeconds(0, 0)
      
      // 验证时间是否有效
      if (isNaN(selectedTime.getTime())) {
        wx.showToast({
          title: '时间选择无效',
          icon: 'none'
        })
        return
      }

      this.setData({
        // 存储UTC时间戳用于后端传输
        startTime: selectedTime.getTime(),
        // 直接显示选择的时间(已经是北京时间)
        startTime: moment(selectedTime).format('YYYY/MM/DD HH:mm'),
        showDateTime: false
      })
    },
    dateCancel() {
      this.setData({
        showDateTime: false,
      })
    },
    // 教师------------------------------
    getTeachers() {
      wx.showLoading({
        title: '加载中'
      })
      wx.cloud.callFunction({
        name: 'getTeacheres'
      }).then((resp) => {
        console.log('教师', resp)
        const userInfo = wx.getStorageSync('userInfo')
        const data = resp.result.data.filter(res => {
          return res._openid === userInfo.teacherOpenid
        })
        this.setData({
          teacher: data && data.length ?  data[0].name : '',
          currentTeacher: data && data.length ? data[0] : {},
          count: resp.result.count
        })
        wx.hideLoading()
      }).catch((e) => {
        wx.hideLoading()
      })
    },
    // 门店------------------------------
    seletedShop() {
      this.setData({
        showShop: true
      })
    },
    onShopClose() {
      this.setData({
        showShop: false
      })
    },
    getShops() {
      wx.showLoading({
        title: '加载中'
      })
      wx.cloud.callFunction({
        name: 'getShop',
        data: {
          name: this.data.searchShopName
        }
      }).then((resp) => {
        console.log('门店', resp)
        this.setData({
          shopList: resp.result.data
        })
        const getShop = this.data.shopList.filter(res => {
          return res._id === this.data.checkShop
        })
        if (getShop && getShop.length) {
          this.setData({
            roomList: getShop[0].room ? getShop[0].room.split(',') : [],
            currentShop: getShop[0]
          })
        }
        wx.hideLoading()
      }).catch((e) => {
        wx.hideLoading()
      })
    },
    searchShop() {
      this.setData({
        shopList: []
      })
      this.getShops()
    },
    checkShopChange(event) {
      this.setData({
        checkShop:  event.detail,
      })
      const getShop = this.data.shopList.filter(res => {
        return res._id === this.data.checkShop
      })
      if (getShop && getShop.length) {
        this.setData({
          roomList: getShop[0].room ? getShop[0].room.split(',') : [],
        })
      }
    },
    saveShop() {
      const getShop = this.data.shopList.filter(res => {
        return res._id === this.data.checkShop
      })
      this.setData({
        shop: getShop && getShop.length ? getShop[0].text : '',
        currentShop: getShop && getShop.length ? getShop[0] : [],
        showShop: false,
        room: ''
      })
    },
    seletedRoom() {
      this.setData({
        showRoom: true
      })
    },
    closeRoom() {
      this.setData({
        showRoom: false
      })
    },
    checkRoomChange(event) {
      this.setData({
        checkRoom: event.detail,
      })
    },
    saveRoom() {
      this.setData({
        room: this.data.checkRoom,
        showRoom: false
      })
    }
  })