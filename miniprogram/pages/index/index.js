const { envList } = require('../../envList.js') 
import Dialog from '@vant/weapp/dialog/dialog' 
import moment from'moment' 
//获取应用实例 
const app = getApp() 
 
Page({ 
  data: { 
    envList, 
    teachers: [], 
    getWXContext: {}, 
    shopValue: 0, 
    // 去掉门店列表相关数据定义 
    dialogShow: false, 
    dialogMessage: [], 
    userInfo: {}, 
    avatarUrl: '', 
    nickName: '',
    currentDate: '',
    todayCourses: [] 
  }, 
 
  /** 
   * 生命周期函数--监听页面显示 
   */ 
  onShow: function () { 
    this.getTeachersShops() 
    this.initTodayDate()
    this.fetchTodayCourses()
    const _this = this 
    // 检查登录态是否过期 
    wx.checkSession({ 
      success: function (res) { 
        console.log('登录有效', res) 
        app.globalData.hasLogin = true 
        _this.getWXContext() 
      }, 
      fail: function () { 
        console.log('登录过期') 
        app.globalData.hasLogin = false 
        _this.getWXContext() 
      } 
    }) 
  }, 
 
  // 初始化当前日期
  initTodayDate() {
    this.setData({
      currentDate: moment().format('YYYY年MM月DD日')
    });
  },

  // 获取当天课程数据
  fetchTodayCourses() {
    const today = moment();
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        startTime: today.startOf('day').valueOf(),
        endTime: today.endOf('day').valueOf(),
        teacherOpenid: wx.getStorageSync('userInfo')._openid,
        order: {
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(resp => {
      if (resp.result.result && resp.result.result.data) {
        const courses = resp.result.result.data.map(course => ({
          ...course,
          startTime: moment(new Date(course.startTime)).format('HH:mm'),
          location: `${course.shopName} ${course.room}`,
          studentName: course.name || '未知学生'
        }));
        this.setData({ todayCourses: courses });
      }
    }).catch(err => {
      console.log('err', err)
      wx.showToast({
        title: '获取课程数据失败',
        icon: 'none'
      });
    });
  },

  getWXContext() { 
    wx.showLoading({ 
      title: '加载中', 
      mask: true 
    }) 
    wx.cloud.callFunction({ 
      name: 'getWXContext' 
    }).then((resp) => { 
      console.log('云函数getWXContext', resp.result) 
      this.getUserInfo(resp.result) 
      this.setData({ 
        getWXContext: resp.result 
      }) 
    }).catch((e) => { 
      wx.hideLoading() 
    }) 
  }, 
 
  getUserInfo(result) { 
    const _this = this 
    //  wx.getSetting先查询一下用户是否授权了 
    wx.getSetting({ 
      withSubscriptions: true, 
      success: function (res) { 
        if (res.authSetting['scope.userInfo']) { 
          // 已授权，可以获取用户信息 
          wx.login({ 
            success: item => { 
              wx.getUserInfo({ 
                lang: 'zh_CN', 
                desc: '获取用户信息', 
                success: el => { 
                  console.log('已授权，可以获取用户信息', el) 
                  _this.getAndAddUser(result, el) 
                } 
              }) 
            } 
          }) 
        } else { 
          // 发起授权 
          wx.authorize({ 
            scope:'scope.userInfo', 
            success: res => { 
              // 用户已经同意小程序获取用户信息 
              wx.login({ 
                success: item => { 
                  wx.getUserInfo({ 
                    lang: 'zh_CN', 
                    desc: '获取用户信息', 
                    success: el => { 
                      console.log('授权已同意可以获取用户信息', el) 
                      _this.getAndAddUser(result, el) 
                    } 
                  }) 
                } 
              }) 
            } 
          }) 
        } 
      } 
    }) 
  }, 
 
  getAndAddUser(result, el) { 
    const _this = this 
    wx.cloud.callFunction({ 
      name: 'getUsers', 
      data: { 
        page: 0, 
        pageSize: 100, 
        _openid: result.openid 
      } 
    }).then((re) => { 
      console.log('查询用户结果', re) 
      if (re.result && re.result.length) { 
        wx.setStorageSync('userInfo', re.result[0]) 
        wx.hideLoading() 
        this.setData({ 
          nickName: re.result[0].nickName, 
          avatarUrl: re.result[0].avatarUrl, 
          name: re.result[0].name, 
          userInfo: re.result[0] 
        }) 
      } else { 
        const data = { 
          _appid: result.appid, 
          _openid: result.openid, 
          nickName: el.userInfo.nickName, 
          gender: el.userInfo.gender, 
          avatarUrl: el.userInfo.avatarUrl, 
          cloudID: el.cloudID, 
          isTeacher: false, 
          name: '', 
          fileID: '', 
          position: '', 
          introduce: '' 
        } 
        wx.cloud.callFunction({ 
          name: 'addUsers', 
          data: data 
        }).then((re) => { 
          console.log('添加用户结果', re) 
          const data = re.result.data 
          wx.setStorageSync('userInfo', data && data.length? data[0] : {}) 
          wx.hideLoading() 
          this.setData({ 
            nickName: data && data.length? data[0].nickName : '', 
            avatarUrl: data && data.length? data[0].avatarUrl : '', 
            name: data && data.length? data[0].name : '', 
            userInfo: data && data.length? data[0] : {} 
          }) 
        }).catch((e) => { 
          wx.hideLoading() 
        }) 
      } 
      this.getMyCourse(result.openid) 
    }).catch((e) => { 
      wx.hideLoading() 
    }) 
  }, 
 
  getTeachersShops() { 
    wx.cloud.callFunction({ 
      name: 'getTeacheres', 
      data: { 
        page: 0, 
        pageSize: 10 
      } 
    }).then((resp) => { 
      console.log('教师', resp) 
      this.setData({ 
        teachers: resp.result 
      }) 
    }).catch((e) => { 
    }) 
 
  }, 
 
  // 去掉dropdownChange相关代码 
 
  // 拨打电话 
  //makePhoneCall(e) { 
  //  console.log(e) 
  //  wx.makePhoneCall({ 
  //    phoneNumber: e.currentTarget.dataset.item, 
  //    success: (res) => {}, 
  //    fail: (res) => {}, 
  //   complete: (res) => {} 
  //  }) 
  //}, 
 
  toAddUser() { 
    wx.navigateTo({ 
      url: "/pages/users/users" 
    }) 
  }, 
 
  // 上课钱6小时通知提醒 
  getMyCourse(openid) { 
    wx.cloud.callFunction({ 
      name: 'getMyCourse', 
      data: { 
        startTime: new Date().getTime() + 6 * 60 * 60 * 1000, 
        endTime: new Date().getTime() + 8 * 60 * 60 * 1000, 
        teacherOpenid: openid, 
        order: { 
          string:'startTime', 
          order: 'asc' 
        } 
      } 
    }).then(resp => { 
      console.log('课程结果', resp.result.result) 
      const courseData = resp.result.result.data.slice(0, 3) 
      courseData.forEach(res => { 
        res.startTime = moment(new Date(res.startTime)).format("MM-DD HH:mm:ss")
        // 从myCourse集合中获取学生姓名
        res.studentName = res.name || '未知学生'
      }) 
      if (courseData && courseData.length) { 
        this.setData({ 
          dialogShow: true, 
          dialogMessage: courseData 
        }) 
      } 
    }).catch(err => { 
      console.log('err', err) 
    }) 
  }, 
 
  getchooseAvatar(e) { 
    console.log('修改头像', e, e.detail.avatarUrl); 
    const that = this 
    wx.uploadFile({ 
      url: api.StorageUpload, 
      filePath: e.detail.avatarUrl, 
      name: 'file', 
      success: function (res) { 
        var _res = JSON.parse(res.data); 
        if (_res.code.toString() === '200') { 
          that.setData({ 
            avatarUrl: _res.data.url, 
          }) 
        } 
      }, 
      fail: function (e) { 
        wx.showModal({ 
          title: '错误', 
          content: '头像上传失败', 
          showCancel: false 
        }) 
      }, 
    }) 
  }, 
 
  formSubmit(e) { 
    console.log('form表单提交', e) 
    this.setData({ 
      nickName: e.detail.value.nickname 
    }) 
    const that = this 
    util.request(api.update, { 
      avatar: this.data.avatarUrl, 
      nickname: this.data.nickName 
    }, "POST").then(function (res) { 
      if (res.code.toString() === '200') { 
        util.showErrorToast('修改成功'); 
        let userInfo = wx.getStorageSync('userInfo'); 
        userInfo.nickname = that.data.nickName 
        userInfo.avatarUrl = that.data.avatarUrl 
        wx.setStorageSync('userInfo', userInfo); 
        wx.navigateBack() 
      } else { 
        util.showErrorToast(res.msg); 
      } 
    }) 
  }, 
 
  myInfo() { 
    wx.navigateTo({ 
      url: '/packageA/myUserInfo/index', 
      events: {}, 
      success: function (res) {} 
    }) 
  } 
})