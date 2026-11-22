import moment from 'moment'
Page({

  /**
   * 页面的初始数据
   */
  data: {
    minDate: moment(new Date()).startOf('month').valueOf(),
    maxDate: moment(new Date()).add('1', 'month').endOf('month').valueOf(),
    formatter(day) {
      // console.log('day', day)
      const date = day.date.getDate()

      if (date === new Date().getDate()) {
        day.text = '今天'
      }

      return day
    },
    userInfo: '',
    rowHeight: 64,
    courseData: [],
    dialogShow: false
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
    this.getMycourse()
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
  getMycourse() {
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        teacherOpenid: wx.getStorageSync('userInfo')._openid,
        finished: false,
        startTime: this.data.minDate,
        endTime: this.data.maxDate,
        order: {
          string: 'startTime',
          order: 'asc' // desc降序 或 asc升序
        }
      }
    }).then(res => {
      console.log('课程', res)
      const result = res.result.result.data
      const _this = this
      this.setData({
        formatter: function(e) {
          const time = result.filter(resp => {
            return new Date(resp.startTime).getMonth() + 1 === e.date.getMonth() + 1 && new Date(resp.startTime).getDate() === e.date.getDate()
          })
          let info = ''
          time.forEach(el => {
            info = `${moment(new Date(el.startTime)).format('HH:mm')}-${moment(new Date(el.endTime)).format('HH:mm')}${el.name}`
          })
          e.topInfo = info
          e.bottomInfo = time && time.length ? '查看更多' : ''
          _this.setData({
            courseData: result
          })

          if (e.date.getDate()  === new Date().getDate()) {
            e.text = '今天'
          }

          return e
        }
      })
    }).catch(err => {

    })
  },
  lookMore(e) {
    const time = this.data.courseData.filter(resp => {
      return new Date(resp.startTime).getDate() === new Date(e.detail).getDate()
    })
    const timeCopy = JSON.parse(JSON.stringify(time))
    const timeResult = timeCopy.map(res => {
      res.startTime = moment(new Date(res.startTime)).format("YYYY/MM/DD HH:mm:ss")
      return res
    })
    if (timeResult && timeResult.length) {
      this.setData({
        dialogShow: true,
        dialogMessage: timeResult
      })
    }
  }
})