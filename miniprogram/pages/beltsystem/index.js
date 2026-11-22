/* KSST · 换算 kg 正式版（新 10kg 传感器）
 * ESP32 每帧：ch1 = 方向翻正后的 R，ch2 = b (counts/kg)
 *   ch2 > 0 → kg 模式：点「开始记录」冻结 R0 → kg = (R - R0) / b（正数）
 *   ch2 = 0 → 保险回退：直出 counts
 * ★ 固定 4px/s；16000px 到顶直接停；Y 轴标数移到滚动区外的固定列，横滑不动
 * 保留：独立 1s 采样、全量 CSV、自动量程、无预热
 */

const SERVICE_KEY = 'cddf1001'
const CHAR_KEY    = 'cddf1002'
const isDataService = (u) => (u || '').toLowerCase().indexOf(SERVICE_KEY) >= 0
const isDataChar    = (u) => (u || '').toLowerCase().indexOf(CHAR_KEY) >= 0

const R0_FRAMES = 15
const FIXED_PX = 4
const MAX_CANVAS_W = 16000

function median(arr) {
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}
function axisLab(v) {
  const a = Math.abs(v)
  if (a >= 10000) return (v / 1000).toFixed(0) + 'k'
  return String(Math.round(v))
}

Page({
  data: {
    connected: false,
    deviceId: '',
    serviceId: '',
    charId: '',
    currentForce: '0.00',
    unit: 'kg',
    recording: false,
    pointCount: 0,
    peak: '0.00',
    average: '0.00',
    baseline: '--',
    slope: '--',
    canvasW: 320,
    scrollLeft: 0,
    followHint: '4px/s · 自动跟随中',
    // ★ 固定 Y 轴列的文字（不进滚动画布）
    yHi: '1.0',
    yUnit: 'kg',
    yLo: '0.0'
  },

  _canvas: null,
  _ctx: null,
  _cssW: 0,
  _cssH: 0,
  _viewW: 320,
  _chartTimer: null,
  _sampleTimer: null,
  _scanTimer: null,
  _foundOn: false,
  _listenerOn: false,
  _records: [],
  _rawBuf: [],
  _lastR: 0,
  _b: 0,
  _R0: null,
  _tick: 0,
  _peak: -Infinity,
  _sum: 0,
  _count: 0,
  _autoFollow: true,
  _lastYTxt: '',          // ★ 避免每 500ms 都 setData 一次

  PX_PER_SEC: FIXED_PX,   // 恒定 4，全程不改
  GRID_SEC: 5,
  PAD_L: 16,              // ★ Y 轴标签挪出去了，画布内左边距收窄
  PAD_R: 16,

  onReady() {
    this.measureView()
    this.registerBLEListener()
  },
  onUnload() { this.disconnect() },

  isCal() { return this._b > 0 },
  fmtVal(v) { return this.isCal() ? v.toFixed(2) : String(Math.round(v)) },

  neededWidth() {
    const lastT = this._records.length ? this._records[this._records.length - 1].t : 0
    return this.PAD_L + (lastT + 4) * this.PX_PER_SEC + this.PAD_R
  },

  applyWidthPolicy() {
    const need = this.neededWidth()
    if (need <= MAX_CANVAS_W) return true
    this.forceStopByLimit()
    return false
  },

  forceStopByLimit() {
    this.stopSampleLoop()
    this.stopChartLoop()
    const w = Math.min(MAX_CANVAS_W, Math.max(this._viewW, Math.round(this.neededWidth())))
    this.setData({
      recording: false,
      canvasW: w,
      scrollLeft: w,
      followHint: '已达 16000px 上限 · 记录已停止'
    }, () => this.resizeAndDraw())
    console.log('⛔ 画布达 16000px 上限，记录停止（数据全量保留）。共',
                this._records.length, '点，CSV 可导出')
    wx.showToast({ title: '画布已到上限，记录停止，请导出', icon: 'none', duration: 4000 })
  },

  measureView() {
    const q = wx.createSelectorQuery()
    q.select('#chartScroll').fields({ size: true }).exec((res) => {
      if (res && res[0] && res[0].width) {
        this._viewW = res[0].width
        console.log('滚动视窗宽 =', this._viewW, 'px')
      }
      const w = Math.max(this._viewW, 320)
      this.setData({ canvasW: w }, () => this.resizeAndDraw())
    })
  },

  resizeAndDraw() {
    const q = wx.createSelectorQuery()
    q.select('#forceCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return
      const canvas = res[0].node
      if (this._canvas !== canvas || !this._ctx) {
        this._canvas = canvas
        this._ctx = canvas.getContext('2d')
      }
      const W = Math.min(Math.round(res[0].width), MAX_CANVAS_W)
      canvas.width = W
      canvas.height = res[0].height
      this._cssW = W
      this._cssH = res[0].height
      this.drawChart()
    })
  },

  updateCanvasWidth(follow) {
    const w = Math.min(MAX_CANVAS_W,
                       Math.max(this._viewW, Math.round(this.neededWidth())))
    const patch = {}
    if (w !== this.data.canvasW) patch.canvasW = w
    if (follow && this._autoFollow) patch.scrollLeft = w

    if (Object.keys(patch).length) {
      this.setData(patch, () => {
        if (patch.canvasW !== undefined) this.resizeAndDraw()
        else this.drawChart()
      })
    } else this.drawChart()
  },

  onChartScroll(e) {
    const d = e.detail
    const atRight = (d.scrollWidth - d.scrollLeft - this._viewW) < 40
    const was = this._autoFollow
    this._autoFollow = atRight
    if (was !== atRight) {
      this.setData({
        followHint: atRight
          ? this.PX_PER_SEC + 'px/s · 自动跟随中'
          : '回看中（点「跳到最新」恢复）'
      })
    }
  },

  jumpToLatest() {
    this._autoFollow = true
    this.setData({
      scrollLeft: this.data.canvasW,
      followHint: this.PX_PER_SEC + 'px/s · 自动跟随中'
    })
  },

  /* ★ 画布只画：网格 + X 时间刻度 + 曲线
   *   Y 轴数字 / 单位 / px/s 标记全部移出，交给左侧固定列显示 */
  drawChart() {
    const ctx = this._ctx
    if (!ctx) return

    const W = this._cssW, H = this._cssH
    const PX = this.PX_PER_SEC, G = this.GRID_SEC
    const padL = this.PAD_L, padR = this.PAD_R, padT = 12, padB = 30
    const cal = this.isCal()

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#11152b'
    ctx.fillRect(0, 0, W, H)

    const plotH = H - padT - padB

    // X 竖向网格 + 时间刻度（跟着曲线一起滚，是对的）
    ctx.strokeStyle = '#22305a'
    ctx.lineWidth = 1
    ctx.fillStyle = '#6b7590'
    ctx.font = '10px sans-serif'
    for (let s = 0; ; s += G) {
      const x = padL + s * PX
      if (x > W - padR) break
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, padT + plotH)
      ctx.stroke()
      ctx.fillText(s + 's', x + 2, H - 8)
    }
    // 横向网格（水平线，横滑看不出位移，保留）
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W - padR, y)
      ctx.stroke()
    }

    // 自动量程 → 只更新左侧固定列的文字，不画到画布上
    const all = this._records
    let lo = Infinity, hi = -Infinity
    all.forEach(r => {
      if (r.force < lo) lo = r.force
      if (r.force > hi) hi = r.force
    })
    if (!isFinite(lo)) { lo = 0; hi = 1 }
    if (hi - lo < 1) hi = lo + 1
    const margin = (hi - lo) * 0.08
    lo -= margin; hi += margin
    const span = hi - lo

    const hiTxt = cal ? hi.toFixed(1) : axisLab(hi)
    const loTxt = cal ? lo.toFixed(1) : axisLab(lo)
    const uTxt  = cal ? 'kg' : 'R'
    const key = hiTxt + '|' + uTxt + '|' + loTxt
    if (key !== this._lastYTxt) {
      this._lastYTxt = key
      this.setData({ yHi: hiTxt, yUnit: uTxt, yLo: loTxt })
    }

    if (all.length === 0) {
      ctx.fillStyle = '#55617a'
      ctx.font = '12px sans-serif'
      ctx.fillText('点「开始记录」冻结基线后拉传感器（1 秒 1 点）', padL + 8, padT + 20)
      return
    }

    const pts = all.filter(r => (padL + r.t * PX) <= (W - padR))
    if (pts.length === 0) return

    const xOf = (t) => padL + t * PX
    const yOf = (f) => padT + plotH - ((f - lo) / span) * plotH

    ctx.strokeStyle = '#00d4ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    pts.forEach((r, i) => {
      const x = xOf(r.t), y = yOf(r.force)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    if (pts.length === 1) {
      ctx.fillStyle = '#00d4ff'
      ctx.beginPath()
      ctx.arc(xOf(pts[0].t), yOf(pts[0].force), 3.5, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.lineTo(xOf(pts[pts.length - 1].t), padT + plotH)
      ctx.lineTo(padL, padT + plotH)
      ctx.closePath()
      ctx.fillStyle = 'rgba(0,212,255,0.12)'
      ctx.fill()
    }

    const last = pts[pts.length - 1]
    ctx.fillStyle = '#00ff88'
    ctx.beginPath()
    ctx.arc(xOf(last.t), yOf(last.force), 3, 0, Math.PI * 2)
    ctx.fill()
  },

  startChartLoop() {
    if (this._chartTimer) clearInterval(this._chartTimer)
    this._chartTimer = setInterval(() => this.drawChart(), 500)
  },
  stopChartLoop() {
    if (this._chartTimer) { clearInterval(this._chartTimer); this._chartTimer = null }
  },

  startSampleLoop() {
    if (this._sampleTimer) clearInterval(this._sampleTimer)
    this.sampleOneSecond()
    this._sampleTimer = setInterval(() => this.sampleOneSecond(), 1000)
  },
  stopSampleLoop() {
    if (this._sampleTimer) { clearInterval(this._sampleTimer); this._sampleTimer = null }
  },

  sampleOneSecond() {
    if (!this.data.recording) return

    const cal = this.isCal()
    let v
    if (cal && this._R0 !== null) {
      v = (this._lastR - this._R0) / this._b
    } else {
      v = this._lastR
    }
    if (!isFinite(v)) v = 0

    const t = this._tick
    this._tick += 1

    this._records.push({ t, force: cal ? Number(v.toFixed(2)) : Math.round(v) })

    this._sum += v
    this._count += 1
    if (v > this._peak) this._peak = v

    if (!this.applyWidthPolicy()) return

    this.setData({
      pointCount: this._count,
      peak: isFinite(this._peak) ? this.fmtVal(this._peak) : '0',
      average: this.fmtVal(this._sum / this._count)
    })
    this.updateCanvasWidth(true)

    console.log('采样 t=', t, 's  R=', Math.round(this._lastR),
                ' R0=', this._R0, ' b=', this._b,
                ' kg=', this.fmtVal(v), ' 点数=', this._count)
  },

  registerBLEListener() {
    if (this._listenerOn) return
    this._listenerOn = true

    wx.onBLECharacteristicValueChange((res) => {
      const cid = res.characteristicId || ''
      if (cid && !isDataChar(cid)) return

      const ab = res.value
      if (!ab) return
      const u8 = new Uint8Array(ab)
      if (u8.length >= 7 &&
          u8[0] === 112 && u8[1] === 104 && u8[2] === 121 &&
          u8[3] === 112 && u8[4] === 104 && u8[5] === 111 && u8[6] === 120) return
      if (u8.length < 4) return

      const dv = new DataView(ab)
      const R  = dv.getFloat32(0, true)
      const bb = u8.length >= 8 ? dv.getFloat32(4, true) : -1
      if (!isFinite(R)) return

      if (bb >= 0) this._b = bb
      this._lastR = R

      this._rawBuf.push(R)
      if (this._rawBuf.length > R0_FRAMES) this._rawBuf.shift()

      const cal = this.isCal()
      let val
      if (cal) {
        val = this._R0 !== null
          ? (R - this._R0) / this._b
          : (R - median(this._rawBuf)) / this._b
      } else val = R

      this.setData({
        currentForce: this.fmtVal(val),
        unit: cal ? 'kg' : 'counts',
        slope: cal ? this._b.toFixed(1) : '--'
      })
    })

    wx.onBLEConnectionStateChange((r) => {
      if (!r.connected) {
        this.stopSampleLoop()
        this.stopChartLoop()
        this.setData({ connected: false, recording: false })
        wx.showToast({ title: '腰带断开', icon: 'none' })
      }
    })
  },

  initBLE() {
    this.registerBLEListener()
    wx.showLoading({ title: '初始化蓝牙', mask: true })
    wx.openBluetoothAdapter({
      success: () => { wx.hideLoading(); this.startScan() },
      fail: (err) => {
        wx.hideLoading()
        console.log('openBluetoothAdapter fail', err)
        wx.showToast({ title: '蓝牙初始化失败，请开蓝牙并给微信权限', icon: 'none', duration: 3000 })
      }
    })
  },

  startScan() {
    wx.showLoading({ title: '扫描腰带', mask: true })
    if (!this._foundOn) {
      this._foundOn = true
      wx.onBluetoothDeviceFound((res) => {
        res.devices.forEach(d => {
          const name = d.name || d.localName || ''
          if (name.indexOf('KSST') >= 0) {
            console.log('找到设备', name, d.deviceId)
            if (this._scanTimer) clearTimeout(this._scanTimer)
            wx.stopBluetoothDevicesDiscovery()
            wx.hideLoading()
            if (!this.data.connected) this.connect(d.deviceId)
          }
        })
      })
    }
    wx.startBluetoothDevicesDiscovery({
      services: [], allowDuplicatesKey: true,
      success: () => console.log('scan start'),
      fail: (e) => { wx.hideLoading(); console.log('scan fail', e) }
    })
    if (this._scanTimer) clearTimeout(this._scanTimer)
    this._scanTimer = setTimeout(() => {
      wx.stopBluetoothDevicesDiscovery()
      wx.hideLoading()
      if (!this.data.connected) {
        wx.showToast({ title: '没找到 KSST_Belt，确认 ESP32 已上电', icon: 'none', duration: 3000 })
      }
    }, 10000)
  },

  connect(deviceId) {
    wx.createBLEConnection({
      deviceId, timeout: 10000,
      success: () => {
        this.setData({ connected: true, deviceId })
        wx.showToast({ title: '已连接', icon: 'success' })
        this.getService(deviceId)
      },
      fail: (e) => { console.log('connect fail', e); wx.showToast({ title: '连接失败', icon: 'none' }) }
    })
  },

  getService(deviceId) {
    wx.getBLEDeviceServices({
      deviceId,
      success: (sRes) => {
        console.log('全部服务', sRes.services.map(s => s.uuid))
        let serviceId = ''
        sRes.services.forEach(s => { if (!serviceId && isDataService(s.uuid)) serviceId = s.uuid })
        if (!serviceId) {
          wx.showToast({ title: '没找到数据服务 cddf1001', icon: 'none', duration: 3000 })
          return
        }
        this.setData({ serviceId })

        wx.getBLEDeviceCharacteristics({
          deviceId, serviceId,
          success: (cRes) => {
            let charId = ''
            cRes.characteristics.forEach(c => { if (!charId && isDataChar(c.uuid)) charId = c.uuid })
            if (!charId) {
              cRes.characteristics.forEach(c => {
                if (!charId && (c.properties.notify || c.properties.indicate)) charId = c.uuid
              })
            }
            if (!charId) { wx.showToast({ title: '没找到 cddf1002 数据特征', icon: 'none' }); return }
            this.setData({ charId })

            wx.notifyBLECharacteristicValueChange({
              deviceId, serviceId, characteristicId: charId, state: true,
              success: () => console.log('✅ Notify 开启（ch1=R, ch2=b）'),
              fail: (err) => {
                console.log('❌ Notify 失败', err)
                wx.showToast({ title: '数据监听开启失败', icon: 'none' })
              }
            })
          },
          fail: (e) => console.log('getCharacteristics fail', e)
        })
      },
      fail: (e) => console.log('getServices fail', e)
    })
  },

  toggleRecord() {
    if (!this.data.connected) { wx.showToast({ title: '先连接腰带', icon: 'none' }); return }
    if (this.data.recording) {
      this.stopSampleLoop()
      this.stopChartLoop()
      this.setData({ recording: false })
      wx.showToast({ title: '记录已停止（基线仍保留）', icon: 'success' })
      return
    }

    const base = this._rawBuf.length ? median(this._rawBuf) : this._lastR
    this._R0 = base

    this._records = []
    this._tick = 0
    this._peak = -Infinity
    this._sum = 0
    this._count = 0
    this._autoFollow = true

    this.setData({
      recording: true,
      pointCount: 0,
      peak: '0',
      average: '0',
      baseline: String(Math.round(base)),
      canvasW: Math.max(this._viewW, 320),
      scrollLeft: 0,
      followHint: '4px/s · 自动跟随中'
    }, () => {
      this.resizeAndDraw()
      this.startChartLoop()
      this.startSampleLoop()
    })

    console.log('✅ R0 已冻结 =', base, ' b =', this._b)
    wx.showToast({ title: '基线已冻结，1 秒 1 点', icon: 'success' })
  },

  clearData() {
    this.stopSampleLoop()
    this.stopChartLoop()
    this._records = []
    this._rawBuf = []
    this._R0 = null
    this._tick = 0
    this._peak = -Infinity
    this._sum = 0
    this._count = 0
    this._autoFollow = true
    this._lastYTxt = ''

    this.setData({
      recording: false,
      pointCount: 0,
      peak: '0',
      average: '0',
      currentForce: '0',
      baseline: '--',
      canvasW: Math.max(this._viewW, 320),
      scrollLeft: 0,
      followHint: '4px/s · 自动跟随中',
      yHi: '1.0',
      yUnit: this.isCal() ? 'kg' : 'R',
      yLo: '0.0'
    }, () => this.resizeAndDraw())

    wx.showToast({ title: '已清空，基线解除', icon: 'success' })
  },

  exportExcel() {
    const recs = this._records
    if (!recs || recs.length < 1) {
      wx.showToast({ title: '无记录数据：先点开始记录', icon: 'none', duration: 3000 })
      return
    }

    wx.showLoading({ title: '生成表格', mask: true })
    const cal = this.isCal()
    let csv = cal ? '时间(s),力值(kg)\n' : '时间(s),原始计数(counts)\n'
    recs.forEach(r => { csv += r.t + ',' + r.force + '\n' })

    const fs = wx.getFileSystemManager()
    const prefix = cal ? 'KSST_KG_' : 'KSST_RAW_'
    const filePath = wx.env.USER_DATA_PATH + '/' + prefix + Date.now() + '.csv'

    fs.writeFile({
      filePath, data: '\ufeff' + csv, encoding: 'utf8',
      success: () => {
        wx.hideLoading()
        console.log('导出成功 共', recs.length, '行  R0=', this._R0, ' b=', this._b)
        wx.openDocument({
          filePath, fileType: 'csv', showMenu: true,
          success: () => {},
          fail: (e) => {
            wx.hideLoading()
            console.log('openDocument fail', e)
            wx.showToast({ title: '打开失败，可用右上角转发', icon: 'none' })
          }
        })
      },
      fail: (e) => {
        wx.hideLoading()
        console.log('writeFile fail', e)
        wx.showToast({ title: '导出失败', icon: 'none' })
      }
    })
  },

  disconnect() {
    this.stopSampleLoop()
    this.stopChartLoop()
    if (this._scanTimer) { clearTimeout(this._scanTimer); this._scanTimer = null }
    if (this.data.deviceId) wx.closeBLEConnection({ deviceId: this.data.deviceId })
    wx.closeBluetoothAdapter()
    this._R0 = null
    this._rawBuf = []
    this.setData({
      connected: false, recording: false, deviceId: '',
      currentForce: '0', baseline: '--'
    })
  }
})