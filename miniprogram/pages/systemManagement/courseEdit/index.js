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
    showShop: false,
    shopList: [],
    searchShopName: '',
    checkShop: '',
    currentShop: {},
    showRoom: false,
    checkRoom: '',
    room: '',
    roomList: [],
    currentCourseId: '',
    duration: null // 初始值为空，由用户输入决定
  },


  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const eventChannel = this.getOpenerEventChannel()
    const _this = this
    eventChannel.on('currentCourseData', function(data) {
      // 计算课程时长(分钟)
      const duration = data.data.duration || data.data.data.duration || null // 优先使用传递的duration，无默认值
      _this.setData({
        currentCourseId: data.data._id || data.data.data._id, // 修正获取_id的方式
        currentDate: data.data.startTime ? moment(new Date(data.data.startTime)).valueOf() : new Date().getTime(),
        startTime: data.data.startTime ? moment(new Date(data.data.startTime)).format('YYYY/MM/DD HH:mm') : '',
        endTime: data.data.startTime ? 
          moment(new Date(data.data.startTime + duration)).format('YYYY/MM/DD HH:mm') : '',
        checkShop: data.data.shopId || '',
        shop: data.data.shopName || '',
        room: data.data.room || '',
        checkRoom: data.data.room || '',
        currentShop: {
          _id: data.data.shopId || '',
          text: data.data.shopName || ''
        },
        duration: duration // 保存课程时长
      })
      console.log('课程数据：', data.data)
    })

    this.getShops()
  },

  // 保存
// 保存
saveAppointment() {
  if (!this.data.startTime || !this.data.shop || !this.data.room) {
    wx.showModal({
      title: '提示',
      content: !this.data.startTime ? 
                '请选择时间' : !this.data.shop ? 
                      '请选择门店' : !this.data.room ? "请选择房间" : '',
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
    wx.cloud.callFunction({
      name: 'editMyCourse',
      data: {
        _id: this.data.currentCourseId,
        startTime: new Date(this.data.startTime).getTime(),
        endTime: new Date(this.data.startTime).getTime() + this.data.duration,
        shopName: this.data.currentShop.text,
        shopId: this.data.currentShop._id,
        room: this.data.room,
        duration: this.data.duration
      }
    }).then((resp) => {
      console.log('结果', resp)
      wx.hideLoading()
      // 检查云函数返回的code
      const code = resp.result.code
      const msg = resp.result.msg
      if (code !== 200) {
        // 如果code不为200，显示错误信息
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
        // 如果code为200，表示修改成功
        wx.showToast({
          title: '修改成功',
          icon: 'success',
          duration: 2000
        })
        wx.navigateBack()
      }
    }).catch((e) => {
      wx.hideLoading()
      wx.showModal({
        title: '提示',
        content: '修改失败',
        showCancel: false
      })
    })
  }
},

  // 取消
  cancleCourse() {
    wx.navigateBack()
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

      dateConfirm(e) {
        const selectedTime = new Date(e.detail)
        // 确保分钟为整点，并清除秒和毫秒
        selectedTime.setMinutes(Math.floor(selectedTime.getMinutes()), 0, 0)
      
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

  onDurationChange(e) {
  // 从事件对象中获取输入值，并转换为毫秒
  const duration = (Number(e.detail) - 1 ) * 60 * 1000; 
  // 更新数据
  this.setData({
    duration
  });
},

  saveRoom() {
    this.setData({
      room: this.data.checkRoom,
      showRoom: false
    })
    // 重新计算结束时间
    if (this.data.startTime) {
      const endTime = moment(new Date(this.data.startTime) + duration).format('YYYY/MM/DD HH:mm')
      this.setData({
        endTime
      })
    }
  },

})