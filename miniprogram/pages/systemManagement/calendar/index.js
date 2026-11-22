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
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        startTime: date.startOf('month').valueOf(),
        endTime: date.endOf('month').valueOf(),
        teacherOpenid: wx.getStorageSync('userInfo')._openid,
        order: {
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(resp => {
      console.log('课程结果', resp.result.result)
      if (resp.result.result && resp.result.result.data) {
        const days = [...this.data.days];
        resp.result.result.data.forEach(course => {
          const courseDate = moment(new Date(course.startTime));
          const dayIndex = days.findIndex(day => {
            const dayDate = moment(day.date);
            return dayDate.isSame(courseDate, 'date');
          });
          if (dayIndex !== -1) {
            course.startTime = moment(new Date(course.startTime)).format('HH:mm:ss');
            days[dayIndex].courses.push(course);
          }
        });
        this.setData({ days });
      }
    }).catch(err => {
      console.log('err', err)
      wx.showToast({
        title: '获取课程数据失败',
        icon: 'none'
      });
    });
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
    
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        teacherOpenid: wx.getStorageSync('userInfo')._openid,
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
          name: wx.getStorageSync('userInfo').name,
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