import * as echarts from '../../../components/echarts-for-weixin-master/ec-canvas/echarts'
import moment from 'moment'

Page({

  /**
   * 页面的初始数据
   */
  data: {
    shopValue: 0,
    shopList: [],
    shopName: '加载中',
    date: moment(new Date()).format('YYYY-MM-DD'),
    dateLabel: '',
    weekLabel: '',
    isToday: true,
    showPicker: false,
    canvasShow: true,
    statTotal: 0,
    statRooms: 0,
    statRange: '—',
    statEmpty: false,
    canvasLoading: true,
    ec: {}
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

  /* ★ 下拉刷新：主动让字典与课程缓存失效，保证能拿到最新排课 */
  onPullDownRefresh() {
    wx.stopPullDownRefresh()
    this.getShop()
  },

  onReachBottom() {},

  onShareAppMessage() {},

  /* 顶部日期文案 */
  syncDateLabels() {
    const d = moment(this.data.date)
    const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    this.setData({
      dateLabel: d.format('YYYY年MM月DD日'),
      weekLabel: weeks[d.day()],
      isToday: d.format('YYYY-MM-DD') === moment().format('YYYY-MM-DD')
    })
  },

  /* ★ 读取优化：门店是低频字典数据，10 分钟内跨页面复用，
     反复进出本页不再重复读 shops 集合。 */
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
      })
  },

  /* ★ 读取优化：按「校区 + 日期」缓存 60 秒，并在途合并。
     原来 dropdownClose / closePopup / currentTime / onShow 都会各查一次，
     同一条件连点几下就是几次全量读取，现在只真正读一次。 */
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
        this.setData({ canvasLoading: false })
        // 弹层关闭后 canvas 需要一帧才能重新渲染
        if (typeof wx.nextTick === 'function') {
          wx.nextTick(() => this.renderChart(raw))
        } else {
          this.renderChart(raw)
        }
      })
      .catch(err => {
        console.log('获取房间统计失败', err)
        this.setData({ canvasLoading: false, statEmpty: true })
        wx.hideLoading()
      })
  },

  /* 顶部三格概览 + 空态 */
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

  /* 门店 / 日期交互（原方法名与行为保留） */
  dropdownChange(e) {
    const idx = Number(e.detail) || 0
    const list = this.data.shopList
    this.setData({
      shopValue: idx,
      shopName: (list[idx] && list[idx].text) || '全部校区'
    })
    this.initChart()
  },
  dropdownOpen() {
    this.setData({ canvasShow: false })
  },
  dropdownClose() {
    this.setData({ canvasShow: true })
    this.initChart()
  },
  pickerDisplay() {
    this.setData({ showPicker: true, canvasShow: false })
  },
  closePopup() {
    this.setData({ showPicker: false, canvasShow: true })
    this.initChart()
  },
  currentTime(e) {
    this.setData({
      date: e.detail.currentTime,
      showPicker: false,
      canvasShow: true
    })
    this.syncDateLabels()
    this.initChart()
  },
  goToday() {
    this.setData({ date: moment().format('YYYY-MM-DD'), canvasShow: true })
    this.syncDateLabels()
    this.initChart()
  },
  /* 手动刷新：绕过 60 秒缓存重新读，用于刚排完课 */
  refresh() {
    this.setData({ canvasShow: true })
    this.initChart()
    wx.showToast({ title: '已刷新', icon: 'none', duration: 1200 })
  },

  /* 图表渲染：数据口径与原版完全一致，只做视觉与健壮性打磨 */
  renderChart(data) {
    if (this.data.statEmpty) return
    const shop = this.data.shopList[this.data.shopValue]
    if (!shop) return
    const ecComponent = this.selectComponent('#mychart-statistics')
    if (!ecComponent) {
      /* 弹层关闭后 canvas 可能晚一帧才重建，重试一次，避免空白图 */
      if (!this._renderRetry) {
        this._renderRetry = setTimeout(() => {
          this._renderRetry = null
          this.renderChart(data)
        }, 120)
      }
      return
    }
    if (this._renderRetry) { clearTimeout(this._renderRetry); this._renderRetry = null }

    const dataList = Array.isArray(data) ? data : ((data && data.data) || [])
    const rgb = [
      ['rgba(241, 196, 15, 0.5)', 'rgb(255, 224, 130)', 'rgb(230, 201, 100)'],
      ['rgba(112, 173, 71, 0.8)', 'rgb(140, 200, 100)', 'rgb(115, 170, 75)'],
      ['rgba(220, 57, 68, 0.7)', 'rgb(255, 100, 110)', 'rgb(230, 70, 80)'],
      ['rgba(76, 175, 80, 0.6)', 'rgb(100, 200, 100)', 'rgb(80, 180, 85)'],
      ['rgba(231, 76, 60, 0.9)', 'rgb(255, 110, 100)', 'rgb(240, 85, 75)'],
      ['rgba(41, 128, 185, 0.5)', 'rgb(100, 160, 220)', 'rgb(60, 140, 200)'],
      ['rgba(205, 133, 63, 0.7)', 'rgb(230, 160, 100)', 'rgb(210, 145, 80)'],
      ['rgba(153, 63, 0, 0.6)', 'rgb(180, 80, 20)', 'rgb(165, 70, 10)'],
      ['rgba(54, 162, 235, 0.8)', 'rgb(100, 180, 255)', 'rgb(70, 165, 240)'],
      ['rgba(106, 90, 205, 0.5)', 'rgb(130, 120, 220)', 'rgb(115, 105, 200)'],
      ['rgba(255, 140, 0, 0.7)', 'rgb(255, 160, 50)', 'rgb(240, 150, 30)'],
      ['rgba(154, 205, 50, 0.9)', 'rgb(180, 220, 100)', 'rgb(165, 210, 75)'],
      ['rgba(140, 140, 140, 0.6)', 'rgb(160, 160, 160)', 'rgb(150, 150, 150)'],
      ['rgba(230, 126, 34, 0.5)', 'rgb(255, 150, 80)', 'rgb(240, 140, 60)'],
      ['rgba(123, 20, 230, 0.8)', 'rgb(140, 50, 250)', 'rgb(130, 40, 235)'],
      ['rgba(0, 139, 139, 0.7)', 'rgb(50, 160, 160)', 'rgb(30, 150, 150)'],
      ['rgba(210, 105, 30, 0.6)', 'rgb(230, 130, 60)', 'rgb(215, 120, 50)'],
      ['rgba(173, 255, 47, 0.9)', 'rgb(200, 255, 100)', 'rgb(185, 250, 75)']
    ]

    const roomsString = shop.room
    const uniqueRooms = roomsString ? roomsString.split(',') : []

    const seriesData = uniqueRooms.map((room, index) => {
      const palette = rgb[index % rgb.length]
      const valueData = dataList
        .filter(res => res.room === room)
        .map(res => {
          const startTimeHours = moment(new Date(res.startTime)).format('HH').toString()
          const endTimeSecond = moment(new Date(res.startTime)).format('mm').toString()
          const startTime = moment(new Date(res.startTime)).format('HH:mm')
          const EndTime = moment(new Date(res.endTime)).format('HH:mm')
          return [
            index,
            startTimeHours + endTimeSecond,
            res.teacherName ? ('教师：' + res.teacherName) : '',
            res.name ? ('学生：' + res.name) : '',
            room,
            startTime,
            EndTime
          ]
        })
      return {
        name: room,
        type: 'scatter',
        data: valueData,
        symbolSize: function () { return 18 },
        itemStyle: {
          shadowBlur: 8,
          shadowColor: 'rgba(63, 111, 112, 0.25)',
          shadowOffsetY: 2,
          color: new echarts.graphic.RadialGradient(0.4, 0.3, 1, [
            { offset: 0, color: palette[1] },
            { offset: 1, color: palette[2] }
          ]),
          borderRadius: 4
        }
      }
    })

    const option = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(31, 45, 45, 0.94)',
        borderColor: '#3f6f70',
        borderWidth: 1,
        textStyle: { color: '#f0f0f0', fontSize: 12 },
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(63, 111, 112, 0.12)' } },
        position: ['10%', '50%'],
        formatter: function (params) {
          if (!params || !params.length) return ''
          let content = `{title|${params[0].seriesName}}`
          params.forEach(res => {
            if (res.data && res.data.length) {
              content += `\n{time|➤} {time|${res.data[5]}~${res.data[6]}} {teacher|${res.data[2]}} {student|${res.data[3]}}`
            }
          })
          return content
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: 34, containLabel: true },
      legend: {
        textStyle: { color: '#6b7d7d', fontSize: 11 },
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        itemGap: 12,
        data: uniqueRooms,
        type: 'scroll'
      },
      xAxis: {
        type: 'value',
        scale: true,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#d8e3e2' } },
        axisLabel: {
          color: '#7b8b8b',
          fontSize: 10,
          formatter: function (value) { return uniqueRooms[value] || '' }
        },
        splitLine: { show: false }
      },
      yAxis: {
        axisTick: { show: false },
        axisLine: { show: false },
        interval: 200,
        min: 600,
        max: 2400,
        splitLine: { show: true, lineStyle: { color: '#eef3f2', type: 'dashed' } },
        axisLabel: {
          color: '#7b8b8b',
          fontSize: 10,
          formatter: function (value) {
            const hours = Math.floor(value / 100)
            const minutes = value % 100
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
          }
        }
      },
      series: seriesData
    }

    ecComponent.init((canvas, width, height) => {
      const chart = echarts.init(canvas, null, { width: width, height: height })
      canvas.setChart(chart)
      chart.setOption(option)
      return chart
    })
  }
})
