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
    maxDate: moment(new Date()).add(30, 'days').hours(22).minutes(0).valueOf(),
    formatter(type, value) {
      if (type === 'year') return `${value}年`
      if (type === 'month') return `${value}月`
      if (type === 'day') return `${value}日`
      if (type === 'hour') return `${value}时`
      if (type === 'minute') return `${value}分`
      return value
    },
    startTime: '',        // 仅用于展示的字符串
    startTimeTs: 0,       // ★ 真正提交用的时间戳（不再靠 new Date(字符串) 反解析）
    endTimeText: '',      // ★ 结束时间展示，随「时间 / 时长」实时更新
    showShop: false,
    shop: '',
    shopList: [],
    searchShopName: '',
    checkShop: '',
    currentShop: {},
    showRoom: false,
    checkRoom: '',
    room: '',
    roomList: [],
    currentCourseId: '',
    duration: null        // ★ 单位统一为「毫秒」（与 addMyCourse / editMyCourse 一致）
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const eventChannel = this.getOpenerEventChannel()
    const _this = this

    /* 上一个页面可能 emit 两个事件、内容相同，这里做幂等，避免重复 setData */
    const applyCourse = (data) => {
      if (_this._courseLoaded) return
      const src = (data && data.data) || {}
      // 兼容 {data: 课程} 与 {data: {data: 课程}} 两种历史嵌套
      const c = (src.data && src.data._id) ? src.data : src
      if (!c || !c._id) return
      _this._courseLoaded = true

      const startTs = Number(c.startTime)
      /* ★ 修复：库里 duration 是毫秒。旧版页面把它当「分钟」显示成了
         duration/60000+1，输入时又 (输入值-1)*60000，来回差 1 分钟，
         再加上 WXML 的 +1，用户看到的分钟数与实际提交的时长始终对不上。 */
      let durationMs = Number(c.duration)
      if (!(durationMs > 0)) {
        // 老记录没有 duration：用 endTime 反推，再兜底 45 分钟
        durationMs = (Number(c.endTime) > startTs)
          ? Number(c.endTime) - startTs
          : 45 * 60 * 1000
      }

      _this.setData({
        currentCourseId: c._id,
        currentDate: startTs > 0 ? startTs : Date.now(),
        startTime: startTs > 0 ? moment(new Date(startTs)).format('YYYY/MM/DD HH:mm') : '',
        startTimeTs: startTs > 0 ? startTs : 0,
        shop: c.shopName || '',
        checkShop: c.shopId || '',
        room: c.room || '',
        checkRoom: c.room || '',
        currentShop: { _id: c.shopId || '', text: c.shopName || '' },
        duration: durationMs
      })
      _this.refreshEndTimeText()
      console.log('课程数据：', c)
    }

    eventChannel.on('currentCourseData', applyCourse)
    eventChannel.on('currentStudentData', applyCourse)

    this.getShops()
  },

  /* 结束时间 = 开始时间戳 + 时长（毫秒），统一在一处算，避免各方法各写一套 */
  refreshEndTimeText() {
    const ts = Number(this.data.startTimeTs)
    const d = Number(this.data.duration)
    this.setData({
      endTimeText: (ts > 0 && d > 0)
        ? moment(new Date(ts + d)).format('YYYY/MM/DD HH:mm')
        : ''
    })
  },

  // 保存
  saveAppointment() {
    const d = this.data
    if (!d.startTimeTs || !(Number(d.duration) > 0) || !d.shop || !d.room) {
      wx.showModal({
        title: '提示',
        content: !d.startTimeTs ? '请选择时间'
          : !(Number(d.duration) > 0) ? '请填写课堂时长'
            : !d.shop ? '请选择门店' : '请选择房间',
        showCancel: false
      })
      return
    }

    wx.showLoading({ title: '加载中' })
    wx.cloud.callFunction({
      name: 'editMyCourse',
      data: {
        _id: d.currentCourseId,
        startTime: d.startTimeTs,
        /* ★ endTime 不再由前端算：服务端会按 startTime + duration 统一重算，
           保证库里 endTime 与时长永远自洽，后续冲突检测不会再被脏数据带偏。 */
        duration: Number(d.duration),   // 毫秒
        shopName: d.currentShop.text,
        shopId: d.currentShop._id,
        room: d.room
      }
    }).then((resp) => {
      console.log('结果', resp)
      wx.hideLoading()
      const r = (resp && resp.result) || {}
      if (r.code !== 200) {
        wx.showModal({
          title: '提示',
          content: r.msg || '修改失败',
          showCancel: false
        })
      } else {
        wx.showToast({ title: '修改成功', icon: 'success', duration: 2000 })
        wx.navigateBack()
      }
    }).catch((e) => {
      wx.hideLoading()
      wx.showModal({ title: '提示', content: '修改失败', showCancel: false })
    })
  },

  // 取消
  cancleCourse() {
    wx.navigateBack()
  },

  // 时间------------------------------
  seletedDateTime() {
    this.setData({ showDateTime: true })
  },

  closeDateTime() {
    this.setData({ showDateTime: false })
  },

  onInput(e) {
    // datetime-picker 值变化事件，保留空实现避免未定义处理函数的告警
  },

  dateConfirm(e) {
    const ts = Number(e.detail)
    if (!Number.isFinite(ts) || ts <= 0) {
      wx.showToast({ title: '时间选择无效', icon: 'none' })
      return
    }
    const selectedTime = new Date(ts)
    selectedTime.setSeconds(0, 0)
    const startTs = selectedTime.getTime()
    /* ★ 修复：旧版在同一个 setData 里写了两个同名 startTime，
       时间戳被后面的格式化字符串覆盖；保存时又用 new Date('YYYY/MM/DD HH:mm')
       反解析，iOS 上可能得到 NaN → 冲突检测被悄悄跳过。 */
    this.setData({
      startTime: moment(new Date(startTs)).format('YYYY/MM/DD HH:mm'),
      startTimeTs: startTs,
      showDateTime: false
    })
    this.refreshEndTimeText()
  },

  dateCancel() {
    this.setData({ showDateTime: false })
  },

  // 门店------------------------------
  seletedShop() {
    this.setData({ showShop: true })
  },

  onShopClose() {
    this.setData({ showShop: false })
  },

  getShops() {
    wx.showLoading({ title: '加载中' })
    /* 保底版：直连查询，不依赖任何缓存模块 */
    wx.cloud.callFunction({
      name: 'getShop',
      data: { name: this.data.searchShopName }
    }).then((resp) => {
        const list = (resp && resp.result && resp.result.data) || []
        this.setData({ shopList: list })
        const hit = list.filter(res => res._id === this.data.checkShop)
        if (hit && hit.length) {
          this.setData({
            roomList: hit[0].room ? hit[0].room.split(',') : [],
            currentShop: hit[0]
          })
        }
        wx.hideLoading()
      }).catch((e) => {
        console.log('获取门店失败', e)
        wx.hideLoading()
      })
  },

  searchShop() {
    this.setData({ shopList: [] })
    this.getShops()
  },

  checkShopChange(event) {
    this.setData({ checkShop: event.detail })
    const hit = this.data.shopList.filter(res => res._id === this.data.checkShop)
    if (hit && hit.length) {
      this.setData({ roomList: hit[0].room ? hit[0].room.split(',') : [] })
    }
  },

  saveShop() {
    const hit = this.data.shopList.filter(res => res._id === this.data.checkShop)
    this.setData({
      shop: hit && hit.length ? hit[0].text : '',
      currentShop: hit && hit.length ? hit[0] : [],
      showShop: false,
      room: ''
    })
  },

  seletedRoom() {
    this.setData({ showRoom: true })
  },

  closeRoom() {
    this.setData({ showRoom: false })
  },

  checkRoomChange(event) {
    this.setData({ checkRoom: event.detail })
  },

  /* ★ 修复：旧版写成 (输入值 - 1) * 60 * 1000，输入的分钟数永远少 1 分钟；
      并且 WXML 显示时又 +1，来回对不上。现在 1 分钟 = 60000 毫秒，所见即所得。 */
  onDurationChange(e) {
    const minutes = Number(e.detail)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      wx.showToast({ title: '请输入 1~1440 的分钟数', icon: 'none' })
      return
    }
    this.setData({ duration: minutes * 60 * 1000 })
    this.refreshEndTimeText()
  },

  saveRoom() {
    this.setData({
      room: this.data.checkRoom,
      showRoom: false
    })
    /* ★ 修复：旧版这里直接用了未定义的变量 duration，
       会抛 ReferenceError；改成统一调用刷新方法。 */
    this.refreshEndTimeText()
  }
})
