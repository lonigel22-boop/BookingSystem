const app = getApp()
const moment = require('moment')

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

  // 获取教师列表
  getTeachers() {
    wx.showLoading({
      title: '加载中',
      mask: true
    })
    wx.cloud.callFunction({
      name: 'getTeacheres',
      data: {
        page: 0,
        pageSize: 100
      }
    }).then((resp) => {
      console.log('教师列表', resp)
      this.setData({
        teachers: resp.result || []
      })
      wx.hideLoading()
    }).catch((e) => {
      console.error('获取教师列表失败', e)
      wx.hideLoading()
      wx.showToast({
        title: '获取教师列表失败',
        icon: 'none'
      })
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

  // 获取课程列表
  fetchCourseList() {
    if (!this.data.selectedTeacher || !this.data.selectedDate) return

    wx.showLoading({
      title: '加载中',
      mask: true
    })

    const [year, month] = this.data.selectedDate.split('-')
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0)
    
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        teacherOpenid: this.data.selectedTeacher._openid,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        order: {
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(res => {
      if (!res.result || !res.result.result || !res.result.result.data) {
        throw new Error('课程数据格式错误')
      }
      const resultData = res.result.result.data
      resultData.forEach((el, index) => {
        el.classHour = `第${index + 1}节`
        const [date, time] = moment(el.startTime).format('YYYY-MM-DD HH:mm').split(' ')
        el.startTime = `${date}\n${time}`
        el.title = (el.lessonTitle || el.courseName || el.title)
        el.location = `${el.shopName}\n${el.room ? el.room : ''}`
        el.studentName = (el.name || '未知学生')
      })
      this.setData({
        courseList: resultData
      })
      wx.hideLoading()
    }).catch(error => {
      console.error('获取课程数据失败', error)
      wx.hideLoading()
      wx.showToast({
        title: '获取课程数据失败',
        icon: 'none'
      })
    })
  },

  // 导出课时
  exportClassHours() {
    if (!this.data.selectedTeacher || !this.data.selectedDate) {
      wx.showToast({
        title: '请选择教师和日期',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: '导出中',
      mask: true
    })

    const [year, month] = this.data.selectedDate.split('-')
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0)
    
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        teacherOpenid: this.data.selectedTeacher._openid,
        startTime: startDate.getTime(),
        endTime: endDate.getTime(),
        order: {
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(res => {
      if (!res.result || !res.result.result || !res.result.result.data) {
        throw new Error('课程数据格式错误')
      }
      const resultData = res.result.result.data
      resultData.forEach((el, index) => {
        el.classHour = index + 1
        el.startTime = moment(el.startTime).format('YYYY-MM-DD HH:mm:ss')
        el.endTime = moment(el.endTime).format('YYYY-MM-DD HH:mm:ss')
        // 移除课程状态字段及其标题
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
              wx.showToast({
                title: '下载链接已复制到剪贴板',
                icon: 'success',
                duration: 2000
              })

              wx.showModal({
                title: '下载链接已复制到剪贴板',
                content: '你可以将剪贴板中的内容粘贴到浏览器下载。',
                showCancel: false,
                success(modalSuccess) {
                  console.log('用户点击了确定')
                }
              })
            },
            fail(err) {
              wx.showToast({
                title: '复制剪贴板失败',
                icon: 'none'
              })
            }
          })
        }).catch(error => {
          console.error('获取文件链接失败', error)
          wx.hideLoading()
          wx.showToast({
            title: '获取文件链接失败',
            icon: 'none'
          })
        })
      }).catch(error => {
        console.error('导出失败', error)
        wx.hideLoading()
        wx.showToast({
          title: '导出失败',
          icon: 'none'
        })
      })
    }).catch(error => {
      console.error('获取课程数据失败', error)
      wx.hideLoading()
      wx.showToast({
        title: '获取课程数据失败',
        icon: 'none'
      })
    })
  }
})