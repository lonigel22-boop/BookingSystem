const app = getApp()
const moment = require('moment')

/* ★ 页面可打开性加固：
   这个页面之前在 app.json 里漏注册，点「课时导出」会毫无反应（已补注册）。
   顺手让 readCache 变成可选依赖：即使某次部署漏了 utils/readCache.js，
   页面也能正常加载，只是少了跨页缓存，不会再整页打不开。 */
let readCache = null
try {
  readCache = require('../../utils/readCache.js')
} catch (e) {
  readCache = null
}
const callRead = (name, data, ttl) =>
  (readCache && readCache.cachedRead)
    ? readCache.cachedRead(name, data, ttl)
    : wx.cloud.callFunction({ name: name, data: data || {} })

Page({
  data: {
    teachers: [],
    selectedTeacher: null,
    selectedDate: '',
    loading: false,
    courseList: []
  },

  onLoad() {
    this.getTeachers()
  },

  // 获取教师列表（字典缓存：10 分钟内跨页面复用；模块缺失时自动直连）
  getTeachers() {
    wx.showLoading({ title: '加载中', mask: true })
    callRead('getTeacheres', { name: '', page: 0, pageSize: 100 }, 600)
      .then((resp) => {
        const r = resp && resp.result
        // 兼容云函数直接返回数组 / 返回 { data: [] } 两种结构
        const list = Array.isArray(r) ? r : (r && Array.isArray(r.data) ? r.data : [])
        this.setData({ teachers: list })
        wx.hideLoading()
        if (!list.length) {
          wx.showToast({ title: '暂无教师数据', icon: 'none' })
        }
      })
      .catch((e) => {
        console.error('获取教师列表失败', e)
        wx.hideLoading()
        wx.showToast({ title: '获取教师列表失败', icon: 'none' })
      })
  },

  // 选择教师
  onTeacherSelect(e) {
    const teacher = e.currentTarget.dataset.teacher
    if (!teacher) return
    this.setData({ selectedTeacher: teacher })
    this.fetchCourseList()
  },

  // 选择日期
  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value })
    this.fetchCourseList()
  },

  /* 把「查课程」抽成一层带缓存的原始加载器：
     看列表和导出复用同一份原始数据，只查一次；条件变了自动重查。 */
  loadRawCourses() {
    const teacher = this.data.selectedTeacher
    const dateStr = this.data.selectedDate
    if (!teacher || !dateStr) return Promise.reject(new Error('请先选择教师和日期'))

    const key = (teacher._openid || '') + '|' + dateStr
    const copy = (d) => JSON.parse(JSON.stringify(d))
    if (this._rawKey === key && this._rawCourses) return Promise.resolve(copy(this._rawCourses))
    if (this._rawInflight && this._rawInflightKey === key) return this._rawInflight

    const [year, month] = dateStr.split('-')
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0)

    const p = wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        teacherOpenid: teacher._openid,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        order: { string: 'startTime', order: 'asc' }
      }
    }).then(res => {
      const r = res && res.result
      const list = (r && r.result && r.result.data) || (r && r.data) || []
      if (!Array.isArray(list)) throw new Error('课程数据格式错误')
      this._rawKey = key
      this._rawCourses = copy(list)
      this._rawInflight = null
      return copy(list)
    }).catch(e => {
      this._rawInflight = null
      throw e
    })
    this._rawInflight = p
    this._rawInflightKey = key
    return p
  },

  // 获取课程列表（展示用格式化，复用 loadRawCourses 的原始数据）
  fetchCourseList() {
    if (!this.data.selectedTeacher || !this.data.selectedDate) return

    wx.showLoading({ title: '加载中', mask: true })
    this.loadRawCourses().then(resultData => {
      resultData.forEach((el, index) => {
        el.classHour = `第${index + 1}节`
        const [date, time] = moment(el.startTime).format('YYYY-MM-DD HH:mm').split(' ')
        el.startTime = `${date}\n${time}`
        el.title = (el.lessonTitle || el.courseName || el.title)
        el.location = `${el.shopName}\n${el.room ? el.room : ''}`
        el.studentName = (el.name || '未知学生')
      })
      this.setData({ courseList: resultData })
      wx.hideLoading()
    }).catch(error => {
      console.error('获取课程数据失败', error)
      wx.hideLoading()
      wx.showToast({ title: '获取课程数据失败', icon: 'none' })
    })
  },

  // 导出课时（复用同一份原始数据，不再重复查库）
  exportClassHours() {
    if (!this.data.selectedTeacher || !this.data.selectedDate) {
      wx.showToast({ title: '请选择教师和日期', icon: 'none' })
      return
    }

    wx.showLoading({ title: '导出中', mask: true })
    const [year, month] = this.data.selectedDate.split('-')
    this.loadRawCourses().then(resultData => {
      resultData.forEach((el, index) => {
        el.classHour = index + 1
        el.startTime = moment(el.startTime).format('YYYY-MM-DD HH:mm:ss')
        el.endTime = moment(el.endTime).format('YYYY-MM-DD HH:mm:ss')
        delete el.finished
        delete el.status
      })

      wx.cloud.callFunction({
        name: 'excelExport',
        data: {
          data: resultData,
          month: parseInt(month),
          name: this.data.selectedTeacher.name || this.data.selectedTeacher.nickName
        }
      }).then(async resp => {
        if (!resp.result || !resp.result.fileID) {
          throw new Error('导出文件ID获取失败')
        }
        await wx.cloud.getTempFileURL({
          fileList: [resp.result.fileID]
        }).then(response => {
          wx.hideLoading()
          wx.setClipboardData({
            data: response.fileList[0].tempFileURL,
            success(res) {
              wx.showToast({ title: '下载链接已复制到剪贴板', icon: 'success', duration: 2000 })
              wx.showModal({
                title: '下载链接已复制到剪贴板',
                content: '你可以将剪贴板中的内容粘贴到浏览器下载。',
                showCancel: false,
                success(modalSuccess) { console.log('用户点击了确定') }
              })
            },
            fail(err) { wx.showToast({ title: '复制剪贴板失败', icon: 'none' }) }
          })
        }).catch(error => {
          console.error('获取文件链接失败', error)
          wx.hideLoading()
          wx.showToast({ title: '获取文件链接失败', icon: 'none' })
        })
      }).catch(error => {
        console.error('导出失败', error)
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
      })
    }).catch(error => {
      console.error('获取课程数据失败', error)
      wx.hideLoading()
      wx.showToast({ title: '获取课程数据失败', icon: 'none' })
    })
  }
})
