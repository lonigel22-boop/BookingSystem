const app = getApp();
const moment = require('moment');

Page({
  data: {
    currentDate: '',
    currentDateTimestamp: Date.now(),
    minDate: new Date('2021-02-21').getTime(),
    maxDate: new Date('2099-12-31').getTime(),
    showDatePicker: false,
    showDayDetail: false,
    days: [],
    selectedDate: '',
    selectedDayCourses: []
  },

  onLoad() {
    this.setData({
      currentDate: moment().format('YYYY年MM月')
    });
    this.generateCalendarDays(moment());
    this.fetchMonthCourses(moment());
  },

  // 生成日历数据
  generateCalendarDays(date) {
    const startOfMonth = date.startOf('month');
    const endOfMonth = date.endOf('month');
    
    let days = [];
    
    // 只添加当月日期
    for (let i = 1; i <= endOfMonth.date(); i++) {
      const currentDate = moment(startOfMonth).date(i);
      const dayOfWeek = currentDate.day(); // 获取星期几（0-6，0表示周日）
      days.push({
        date: currentDate.format('YYYY-MM-DD'),
        day: i,
        isCurrentMonth: true,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6, // 添加周末标识
        courses: []
      });
    }
    
    this.setData({ days });
  },

  // 获取月度课程数据
  async fetchMonthCourses(date) {
    /* ★ 查询范围与「导出课时」对齐：月初 00:00 ~ 下月 1 日 00:00。
       用 clone 计算，避免原来 startOf/endOf 就地改写 date。 */
    const start = moment(date).startOf('month')
    const end = moment(start).add(1, 'month').startOf('month')
    const openid = wx.getStorageSync('userInfo')._openid
    const key = start.valueOf() + '|' + openid

    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        startTime: start.valueOf(),
        endTime: end.valueOf(),
        teacherOpenid: openid,
        order: { string: 'startTime', order: 'asc' }
      }
    }).then(resp => {
      console.log('课程结果', resp.result.result)
      const raw = (resp.result && resp.result.result && resp.result.result.data) || []
      /* ★ 读取优化：下面的循环会把 startTime 改写成 HH:mm:ss 再塞进日历，
         所以先深拷贝一份原始数据。用户点「导出」时直接复用，
         不再发第二次完全相同的全月 getMyCourse 请求。 */
      this._rawMonthKey = key
      this._rawMonth = JSON.parse(JSON.stringify(raw))

      if (raw.length) {
        const days = [...this.data.days]
        raw.forEach(course => {
          const courseDate = moment(new Date(course.startTime))
          const dayIndex = days.findIndex(day => moment(day.date).isSame(courseDate, 'date'))
          if (dayIndex !== -1) {
            course.startTime = moment(new Date(course.startTime)).format('HH:mm:ss')
            days[dayIndex].courses.push(course)
          }
        })
        this.setData({ days })
      }
    }).catch(err => {
      console.log('err', err)
      wx.showToast({ title: '获取课程数据失败', icon: 'none' })
    })
  },

  // 显示日期选择器
  showDatePicker() {
    this.setData({ showDatePicker: true });
  },

  // 关闭日期选择器
  onCloseDatePicker() {
    this.setData({ showDatePicker: false });
  },

  // 确认日期选择
  onDateConfirm(event) {
    const date = moment(event.detail);
    this.setData({
      currentDate: date.format('YYYY年MM月'),
      currentDateTimestamp: event.detail,
      showDatePicker: false
    });
    this.generateCalendarDays(date);
    this.fetchMonthCourses(date);
  },

  // 显示日期详情
  showDayDetail(event) {
    const { date } = event.currentTarget.dataset;
    const selectedMoment = moment(date);
    const day = this.data.days.find(d => {
      const dayMoment = moment(d.date);
      return dayMoment.isSame(selectedMoment, 'date');
    });
    if (day) {
      const formattedCourses = day.courses.map(course => {
        const startTime = course.startTime.includes(':') 
          ? course.startTime.substring(0, 5)
          : moment(new Date(course.startTime)).format('HH:mm');
        
        return {
          ...course,
          startTime: startTime,
          title: course.lessonTitle || course.courseName || course.title,
          location: course.shopName + (course.room ? ' ' + course.room : ''),
          studentName: course.name || '未知学生'
        };
      });

      this.setData({
        selectedDate: selectedMoment.format('YYYY年MM月DD日'),
        selectedDayCourses: formattedCourses.sort((a, b) => a.startTime.localeCompare(b.startTime)),
        showDayDetail: true
      });
    }
  },

  // 关闭日期详情
  onCloseDayDetail() {
    this.setData({ showDayDetail: false });
  },


  /* ★ 生成「本月结课课程」分页数据（两列：结课学生名称 / 结课课程名称）。
     判据① 该【课程】已结课 —— 只认 myClass 长按结课的课程级标记：
        (a) ksst_myclass_finished_courses：key = users._id + '_' + course._id
        (b) ksst_myclass_finished_names：[学生名, 课程名] 名字清单（绕过两套 ID 不一致）
     ⚠️ 绝不读 myCourses.finished —— 那是「单节课已上完」，由 autoFinishCourses
        按 endTime<=now 自动打给每一节上过的课，不是结课。上一轮误用它导致
        所有本月上过课的学生都被统计进来。
     判据② 该课程最后一节课落在导出月份（与当月明细按名字取交集实现）。
     必须在格式化 / delete finished 之前调用（startTime 还是数值时间戳）。
     不额外发云函数、不额外读库。 */
  buildFinishedRows(rawCourses, year, month) {
    let fin = {}
    try { fin = wx.getStorageSync('ksst_myclass_finished_courses') || {} } catch (e) { fin = {} }
    let namePairs = []
    try {
      const v = wx.getStorageSync('ksst_myclass_finished_names')
      if (Array.isArray(v)) namePairs = v
    } catch (e) {}
    if (!Object.keys(fin).length && !namePairs.length) return []

    const mStart = new Date(year, month - 1, 1).getTime()
    const mEnd = new Date(year, month, 1).getTime()
    // 当月明细里真实出现的 (学生名, 课程名) → 该组最后一节时间戳
    // 判据②：只有这个集合里的课程才有资格输出，天然排除「当月没上过课」的残留标记
    const monthLast = {}
    ;(rawCourses || []).forEach(c => {
      const t = Number(c.startTime)
      if (!(t >= mStart && t < mEnd)) return
      const k = String(c.name || '') + '|' + String(c.courseName || c.title || '')
      if (!monthLast[k] || t > monthLast[k]) monthLast[k] = t
    })

    const out = [], seen = {}
    const push = (a, b) => {
      const k = a + '|' + b
      if (!a || !b || seen[k] || !monthLast[k]) return
      seen[k] = 1
      out.push([a, b])
    }
    // 来源 (a)：本机 key 标记（命中当月明细里的课程才输出）
    ;(rawCourses || []).forEach(c => {
      const cid = c.courseId || c.course_id || ''
      const sid = c.studentId || c._openid || ''
      const oid = c._openid || ''
      const cname = c.courseName || c.title || ''
      const cand = [sid + '_' + cid, oid + '_' + cid, sid + '_' + cname, oid + '_' + cname]
      if (!cand.some(k => k && k !== '_' && fin[k])) return
      push(String(c.name || ''), String(cname))
    })
    // 来源 (b)：名字清单（myClass 每次长按/取消都维护，旧标记由 _rebuildFinishNames 迁移）
    namePairs.forEach(p => {
      if (Array.isArray(p)) push(String(p[0] || ''), String(p[1] || ''))
    })
    return out
  },


  // 导出课时
  exportClassHours() {
    if (!this.data.currentDate) {
      wx.showToast({
        title: '请选择日期',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: '导出中',
      mask: true
    })

    const [yearPart, monthPart] = this.data.currentDate.split('年');
    const year = yearPart;
    const month = monthPart.split('月')[0];
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    
    /* ★ 导出复用「本月已查过」的原始课程；条件不一致才回退查库。
       原来「看日历」和「导出」各查一次全月，重复读一整轮。 */
    const openid = wx.getStorageSync('userInfo')._openid
    const cacheKey = startDate.getTime() + '|' + openid
    const monthRaw = (this._rawMonthKey === cacheKey && this._rawMonth)
      ? JSON.parse(JSON.stringify(this._rawMonth))
      : null

    const loadTask = monthRaw
      ? Promise.resolve(monthRaw)
      : wx.cloud.callFunction({
          name: 'getMyCourse',
          data: {
            teacherOpenid: openid,
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
          return res.result.result.data
        })

    loadTask.then(resultData => {
      /* ★ 先用原始数值时间戳 + 课程级结课标记算「本月结课课程」，再格式化 / 删 finished */
      const finishedRows = this.buildFinishedRows(resultData, parseInt(year), parseInt(month))
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
          year: parseInt(year),
          name: wx.getStorageSync('userInfo').name,
          finishedCourses: finishedRows
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
});