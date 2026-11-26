  import moment from 'moment'
const readCache = require('../../../utils/readCache.js')

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
      startTime: '',       // 展示用字符串
      startTimeTs: 0,      // ★ 真正提交用的时间戳
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
          startTimeTs: currentCourse && currentCourse.length ?
            moment(new Date(currentCourse[currentCourse.length - 1].startTime)).add(7, 'days').valueOf() : 0,
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
      if (!this.data.startTimeTs || !this.data.shop || !this.data.room ) {
        wx.showModal({
          title: '提示',
          content: !this.data.startTimeTs ? 
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
        /* ★ 用显式时间戳，不再 new Date('YYYY/MM/DD HH:mm') 反解析（iOS 可能得到 NaN）。 */
        const startTs = Number(this.data.startTimeTs)
        if (!Number.isFinite(startTs) || startTs <= 0) {
          wx.hideLoading()
          wx.showModal({ title: '提示', content: '上课时间无效，请重新选择', showCancel: false })
          return
        }
        wx.cloud.callFunction({
          name: 'addMyCourse',
          data: {
            startTime: startTs,
            /* ★ endTime / duration 不再由前端传：旧版这里写「30 分钟」和「29 分钟」
               两个互相矛盾的值，而 addMyCourse 本来就按 course.minute 重算。
               交给服务端统一计算，保证库里 endTime 与 duration 永远自洽。 */
            teacherName: userInfo.name ? userInfo.name : userInfo.nickName,
            teacherOpenid:  userInfo._openid,
            shopName: this.data.currentShop.text,
            shopId: this.data.currentShop._id,
            courseId: this.data.currentCourse._id,
            courseName: this.data.currentCourse.title,
            _openid: currentStudent._openid,
            name: currentStudent.name ? currentStudent.name : currentStudent.nickName,
            room: this.data.room,
            finished: startTs < Date.now()
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

      /* ★ 修复：旧版同一个 setData 里写了两个 startTime，
         时间戳被格式化字符串覆盖，保存时只能靠反解析字符串。 */
      this.setData({
        startTime: moment(selectedTime).format('YYYY/MM/DD HH:mm'),
        startTimeTs: selectedTime.getTime(),
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
    /* ★ 减少调用：onLoad + 两个 eventChannel 回调最多 3 次 getShops → 只发 1 次云函数。
       在途合并 + 300 秒短缓存；每次调用仍各自执行 applyShopSelection，
       保证后到的 checkShop（上次上课门店）仍被正确选中。
       搜索框带不同 name → 自动不同缓存键，不会串数据。
       写门店后由 shopManagement 的 invalidate('getShop') 统一失效。 */
    getShops() {
      wx.showLoading({
        title: '加载中'
      })
      readCache.cachedRead('getShop', { name: this.data.searchShopName }, 300).then((resp) => {
          const list = (resp && resp.result && resp.result.data) || []
          this.setData({ shopList: list })
          this.applyShopSelection(list)
          wx.hideLoading()
        }).catch((e) => {
          console.log('获取门店失败', e)
          wx.hideLoading()
        })
    },
    applyShopSelection(list) {
      const hit = (list || []).filter(res => res._id === this.data.checkShop)
      if (hit && hit.length) {
        this.setData({
          roomList: hit[0].room ? hit[0].room.split(',') : [],
          currentShop: hit[0]
        })
      }
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