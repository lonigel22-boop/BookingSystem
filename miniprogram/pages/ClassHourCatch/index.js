const app = getApp()
const moment = require('moment')
const readCache = require('../../utils/readCache.js')

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

  // 获取教师列表（★ 字典缓存：10 分钟内跨页面复用，不重复读 teachers）
  getTeachers() {
    wx.showLoading({ title: '加载中', mask: true })
    readCache.cachedRead('getTeacheres', { page: 0, pageSize: 100 }, 600)
      .then((resp) => {
        this.setData({ teachers: resp.result || [] })
        wx.hideLoading()
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
    this.setData({
      selectedTeacher: teacher
    })
    this.fetchCourseList()
  },

  // 选择日期
  onDateChange(e) {
    this.setData({
      selectedDate: e.detail.value
    })
    this.fetchCourseList()
  },

  /* ★ 读取优化：把「查课程」抽成一层带缓存的原始加载器。
     原来「看列表」和「导出」各发一次完全相同的 getMyCourse 请求，
     用户查完再导出 = 两次云函数调用 + 6 次数据库读。
     现在按 教师+月份 复用同一份原始数据，只查一次；条件变了自动重查。 */
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
      if (!res.result || !res.result.result || !res.result.result.data) {
        throw new Error('课程数据格式错误')
      }
      this._rawKey = key
      this._rawCourses = copy(res.result.result.data)
      this._rawInflight = null
      return copy(res.result.result.data)
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

  // 导出课时（★ 复用同一份原始数据，不再重复查库）
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