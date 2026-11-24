/* 房间统计 · 时间轴版
   把原来的 echarts 散点图完全换成「房间 × 时间」进度条：
   每个房间一行轨道，有课的时段亮成色块，宽度＝时长、位置＝开始时间。
   纯 WXML/WXSS 渲染，不再依赖 ec-canvas / echarts（少一个大包、不会因 canvas 初始化失败空白）。
   数据口径、筛选、日期、概览、下拉刷新、导出等原有能力全部保留。 */

const moment = require('moment')

/* 房间配色：柔和、区分度高，按房间顺序循环 */
const PALETTE = [
  '#3f6f70',
  '#5a8d89',
  '#6f9e7b',
  '#8aa88f',
  '#a08f72',
  '#6b8f9c',
  '#4e7f86',
  '#9aab8f',
  '#7f9b96',
  '#b08968',
  '#5f8f88',
  '#8a9a76'
];const HOUR = 60                 // 分钟
const LANE_H = 56               // 每个重叠层高度（rpx）
const TRACK_PAD = 16            // 轨道上下留白（rpx）

function pad(n) { return String(n).padStart(2, '0') }
function hhmm(min) {
  const m = Math.max(0, Math.min(1440, Math.round(min)))
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60)
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

/* 兼容 myCourses 里学生名的几种字段 */
function studentOf(c) {
  if (c.name) return c.name
  const si = c.studentInfo
  if (Array.isArray(si) && si[0]) return si[0].name || si[0].nickName || ''
  return ''
}

Page({

  data: {
    shopValue: 0,
    shopList: [],
    shopName: '加载中',
    date: moment(new Date()).format('YYYY-MM-DD'),
    dateLabel: '',
    weekLabel: '',
    isToday: true,
    showPicker: false,
    statTotal: 0,
    statRooms: 0,
    statRange: '—',
    statEmpty: false,
    canvasLoading: true,
    timeline: null,        // ★ 时间轴数据
    activeCourse: null     // ★ 点亮的课程详情
  },

  onLoad(options) {
    this.syncDateLabels()
  },

  onReady() {},

  onShow() {
    this.getShop()
  },

  onHide() {},

  onUnload() {},

  onPullDownRefresh() {
    wx.stopPullDownRefresh()
    this.getShop()
  },

  onReachBottom() {},

  onShareAppMessage() {},

  syncDateLabels() {
    const d = moment(this.data.date)
    const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    this.setData({
      dateLabel: d.format('YYYY年MM月DD日'),
      weekLabel: weeks[d.day()],
      isToday: d.format('YYYY-MM-DD') === moment().format('YYYY-MM-DD')
    })
  },

  getShop() {
    wx.showLoading({ title: '加载中' })
    wx.cloud.callFunction({ name: 'getShop', data: {} })
      .then((resp) => {
        const list = (resp && resp.result && resp.result.data) || []
        this.setData({
          shopList: list,
          shopName: (list[this.data.shopValue] && list[this.data.shopValue].text) || '全部校区'
        })
        wx.hideLoading()
        this.initChart()
      })
      .catch((e) => {
        console.log('获取门店失败', e)
        wx.hideLoading()
        this.setData({ canvasLoading: false, statEmpty: true })
      })
  },

  initChart() {
    const shop = this.data.shopList[this.data.shopValue]
    if (!shop) return

    const dayStart = new Date(this.data.date)
    const startTime = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()).getTime()
    const endTime = startTime + 24 * 60 * 60 * 1000
    const params = {
      shopId: shop._id,
      startTime: startTime,
      endTime: endTime,
      order: { string: 'startTime', order: 'asc' }
    }

    this.setData({ canvasLoading: true })
    wx.cloud.callFunction({ name: 'getMyCourse', data: params })
      .then(resp => {
        const r = resp && resp.result
        const raw = (r && r.result && r.result.data) || (r && r.data) || []
        this.applyStats(raw)
        this.setData({
          canvasLoading: false,
          timeline: this.buildTimeline(raw, shop, startTime)
        })
      })
      .catch(err => {
        console.log('获取房间统计失败', err)
        this.setData({ canvasLoading: false, statEmpty: true, timeline: null })
        wx.hideLoading()
      })
  },

  applyStats(list) {
    const arr = Array.isArray(list) ? list : []
    const starts = arr.map(c => Number(c.startTime)).filter(n => !isNaN(n))
    const ends = arr.map(c => Number(c.endTime)).filter(n => !isNaN(n))
    const rooms = {}
    arr.forEach(c => { if (c.room) rooms[c.room] = 1 })

    let range = '—'
    if (starts.length) {
      const fmt = (t) => moment(new Date(t)).format('HH:mm')
      const last = ends.length ? Math.max.apply(null, ends) : Math.max.apply(null, starts)
      range = fmt(Math.min.apply(null, starts)) + '–' + fmt(last)
    }
    this.setData({
      statTotal: arr.length,
      statRooms: Object.keys(rooms).length,
      statRange: range,
      statEmpty: arr.length === 0
    })
  },

  /* ★ 核心：把课程列表变成「房间 × 时间」进度条数据 */
  buildTimeline(raw, shop, dayStartTs) {
    const arr = Array.isArray(raw) ? raw : []
    const spanDay = 24 * HOUR

    /* 1. 房间清单：门店配置的房间 + 当天实际用到的房间 */
    const configured = (shop.room || '').split(',').map(s => s.trim()).filter(Boolean)
    const used = []
    arr.forEach(c => {
      const r = (c.room || '').trim()
      if (r && used.indexOf(r) < 0) used.push(r)
    })
    let roomNames = configured.slice()
    used.forEach(r => { if (roomNames.indexOf(r) < 0) roomNames.push(r) })
    if (!roomNames.length) roomNames = ['未指定房间']

    /* 2. 课程归一化成「当天分钟数」 */
    const courses = arr.map((c, i) => {
      const s0 = Number(c.startTime)
      let e0 = Number(c.endTime)
      if (isNaN(s0)) return null
      let s = clamp((s0 - dayStartTs) / 60000, 0, spanDay)
      let e = isNaN(e0) ? s + 45 : clamp((e0 - dayStartTs) / 60000, 0, spanDay)
      if (e <= s) e = Math.min(spanDay, s + 30)
      const roomRaw = (c.room || '').trim()
      return {
        key: 'c' + i,
        room: roomRaw && roomNames.indexOf(roomRaw) >= 0 ? roomRaw : roomNames[0],
        s: s,
        e: e,
        timeText: hhmm(s) + '–' + hhmm(e),
        startText: hhmm(s),
        student: studentOf(c) || '—',
        teacher: c.teacherName || '—',
        course: c.lessonTitle || c.courseName || c.title || '课程',
        shop: c.shopName || shop.text || ''
      }
    }).filter(Boolean)

    /* 3. 时间轴范围：默认 08:00–22:00，被早课/晚课自动撑开 */
    let axisStart = 8 * HOUR
    let axisEnd = 22 * HOUR
    courses.forEach(c => {
      axisStart = Math.min(axisStart, Math.floor(c.s / HOUR) * HOUR)
      axisEnd = Math.max(axisEnd, Math.ceil(c.e / HOUR) * HOUR)
    })
    axisStart = clamp(axisStart, 0, spanDay - 4 * HOUR)
    axisEnd = clamp(axisEnd, axisStart + 4 * HOUR, spanDay)
    const span = axisEnd - axisStart
    const pct = (m) => ((m - axisStart) / span) * 100

    /* 4. 刻度：每小时一条网格线，每 2 小时显示文字 */
    const ticks = []
    const firstTick = Math.ceil(axisStart / HOUR) * HOUR
    for (let t = firstTick; t <= axisEnd; t += HOUR) {
      ticks.push({
        key: 't' + t,
        left: +pct(t).toFixed(3),
        label: hhmm(t),
        showLabel: (t / HOUR) % 2 === 0
      })
    }

    /* 5. 每个房间一行：重叠课程自动分层，互不遮挡 */
    const rooms = roomNames.map((name, ri) => {
      const color = PALETTE[ri % PALETTE.length]
      const list = courses.filter(c => c.room === name).sort((a, b) => a.s - b.s)
      const laneEnds = []
      const blocks = list.map(c => {
        let lane = laneEnds.findIndex(end => end <= c.s + 0.01)
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(0) }
        laneEnds[lane] = c.e
        const left = +pct(c.s).toFixed(3)
        const width = +Math.max(1.6, pct(c.e) - pct(c.s)).toFixed(3)
        return {
          key: c.key,
          left: left,
          width: width,
          top: lane * LANE_H + TRACK_PAD / 2,
          timeText: c.timeText,
          startText: c.startText,
          student: c.student,
          teacher: c.teacher,
          course: c.course,
          shop: c.shop,
          shortText: width >= 15 ? c.timeText : (width >= 7 ? c.startText : '')
        }
      })
      const laneCount = Math.max(1, laneEnds.length)
      return {
        name: name,
        color: color,
        count: list.length,
        blocks: blocks,
        trackH: laneCount * LANE_H + TRACK_PAD
      }
    })

    /* 6. 今天的「现在」竖线 */
    let nowLeft = -1
    if (this.data.isToday) {
      const nowMin = (Date.now() - dayStartTs) / 60000
      if (nowMin >= axisStart && nowMin <= axisEnd) nowLeft = +pct(nowMin).toFixed(3)
    }

    return {
      rooms: rooms,
      ticks: ticks,
      nowLeft: nowLeft,
      hasNow: nowLeft >= 0,
      axisText: hhmm(axisStart) + ' – ' + hhmm(axisEnd)
    }
  },

  /* 点亮色块 → 详情卡 */
  onBlockTap(e) {
    const ds = e.currentTarget.dataset || {}
    const room = (this.data.timeline && this.data.timeline.rooms || []).find(r => r.name === ds.room)
    if (!room) return
    const b = room.blocks.find(x => x.key === ds.key)
    if (!b) return
    this.setData({
      activeCourse: {
        room: room.name,
        color: room.color,
        timeText: b.timeText,
        student: b.student,
        teacher: b.teacher,
        course: b.course,
        shop: b.shop,
        dayLabel: this.data.dateLabel
      }
    })
  },
  closeDetail() { this.setData({ activeCourse: null }) },
  noop() {},

  /* 门店 / 日期交互（方法名与行为保留） */
  dropdownChange(e) {
    const idx = Number(e.detail) || 0
    const list = this.data.shopList
    this.setData({
      shopValue: idx,
      shopName: (list[idx] && list[idx].text) || '全部校区'
    })
    this.initChart()
  },
  dropdownOpen() {},
  dropdownClose() { this.initChart() },
  pickerDisplay() { this.setData({ showPicker: true }) },
  closePopup() { this.setData({ showPicker: false }); this.initChart() },
  currentTime(e) {
    this.setData({
      date: e.detail.currentTime,
      showPicker: false
    })
    this.syncDateLabels()
    this.initChart()
  },
  goToday() {
    this.setData({ date: moment().format('YYYY-MM-DD') })
    this.syncDateLabels()
    this.initChart()
  },
  refresh() {
    this.initChart()
    wx.showToast({ title: '已刷新', icon: 'none', duration: 1200 })
  }
})
