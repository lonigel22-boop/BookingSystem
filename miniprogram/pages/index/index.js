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
    todayCourses: [],
    isTeacherMe: false 
  }, 
 
  /** 
   * 生命周期函数--监听页面显示 
   */ 
  onShow: function () { 
    this.getTeachersShops() 
    this.initTodayDate()
    /* ★ 修复「学生登录却显示其他老师的课」：
       旧版在这里立刻 fetchTodayCourses()，而它读的是 wx.getStorageSync('userInfo')._openid
       —— 换账号登录时缓存还是上一位老师的，于是查到并显示那位老师当天的课；
       等身份刷新完又不会重查，旧数据就一直留在版面上。
       现在：进页面先清空 + 递增身份代次，等 getWXContext 拿到「当前微信真 openid」
       并确认身份后，才由 applyIdentity 决定是否查询。 */
    this._identityGen = (this._identityGen || 0) + 1
    this._isTeacherMe = false
    this.setData({
      todayCourses: [], isTeacherMe: false,
      dialogShow: false, dialogMessage: []
    })
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

  /* 获取当天课程数据（只查「当前微信本人」，且只在确认是老师后调用） */
  fetchTodayCourses(openid, gen) {
    const g = (gen === undefined) ? this._identityGen : gen
    if (!this._isTeacherMe || !openid) {
      this.setData({ todayCourses: [] })
      return
    }
    const today = moment()
    const startTime = today.startOf('day').valueOf()
    const endTime = today.endOf('day').valueOf()
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        startTime: startTime,
        endTime: endTime,
        // ★ 用云函数返回的当前微信真 openid，不再读本地缓存
        teacherOpenid: openid,
        order: {
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(resp => {
      // 身份已切换 / 响应乱序回来 → 一律丢弃，绝不覆盖当前版面
      if (g !== this._identityGen || !this._isTeacherMe) return
      const r = resp && resp.result
      // 正常返回 result.result.data；兼容云函数「非老师」分支的 result.data
      const raw = (r && r.result && r.result.data) || (r && r.data) || []
      const courses = (Array.isArray(raw) ? raw : []).map(course => ({
        ...course,
        startTime: moment(new Date(course.startTime)).format('HH:mm'),
        location: `${course.shopName} ${course.room}`,
        studentName: course.name || '未知学生'
      }))
      // 空数组也要 setData：身份切换时把上一次的版面清掉
      this.setData({ todayCourses: courses })
    }).catch(err => {
      console.log('获取今日课程失败（已清空版面）', err)
      if (g !== this._identityGen) return
      // 静默清空：学生 openid 在 teachers 表查不到时云函数会报错，
      // 不该让学生看到「获取课程数据失败」的提示
      this.setData({ todayCourses: [] })
    })
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
      // ★ 当前微信真身份（云函数从上下文拿，前端伪造不了），后续查课只认这个
      this._wxOpenid = resp.result && resp.result.openid
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
        this.applyIdentity(result.openid, re.result[0])
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
          this.applyIdentity(result.openid, (data && data.length) ? data[0] : {})
        }).catch((e) => { 
          wx.hideLoading() 
        }) 
      } 
    }).catch((e) => { 
      wx.hideLoading() 
    }) 
  }, 

  /* ★ 身份确认后统一处理「今日课程」与「上课前 6 小时提醒」。
     openid 来自 getWXContext（微信真身份），user 来自 users 表。
     学生：一个查课请求都不发、直接清空 —— 从根上杜绝看到别人的课。 */
  applyIdentity(openid, user) {
    const oid = openid || (user && user._openid) || ''
    const flag = user && user.isTeacher
    const gen = (this._identityGen = (this._identityGen || 0) + 1)
    if (flag === false) {
      this._isTeacherMe = false
      this.setData({
        isTeacherMe: false, todayCourses: [],
        dialogShow: false, dialogMessage: []
      })
      return
    }
    /* isTeacher 显式为 true；万一旧投影没带该字段，仍走兜底：
       用「当前微信真 openid」查，云函数按 teachers 表校验，
       学生查不到会返回空/报错，前端一律静默清空。 */
    this._isTeacherMe = true
    this.setData({ isTeacherMe: true })
    this.fetchTodayCourses(oid, gen)
    this.getMyCourse(oid, gen)
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
 
  // 上课前 6 小时提醒（同样只对老师本人，且用当前微信真 openid）
  getMyCourse(openid, gen) {
    const g = (gen === undefined) ? this._identityGen : gen
    if (!this._isTeacherMe || !openid) return
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
      if (g !== this._identityGen || !this._isTeacherMe) return
      const r = resp && resp.result
      const raw = (r && r.result && r.result.data) || (r && r.data) || []
      const courseData = (Array.isArray(raw) ? raw : []).slice(0, 3)
      courseData.forEach(res => {
        res.startTime = moment(new Date(res.startTime)).format("MM-DD HH:mm:ss")
        res.studentName = res.name || '未知学生'
      })
      if (courseData.length) {
        this.setData({ dialogShow: true, dialogMessage: courseData })
      } else {
        this.setData({ dialogShow: false, dialogMessage: [] })
      }
    }).catch(err => {
      console.log('获取上课提醒失败', err)
      if (g !== this._identityGen) return
      this.setData({ dialogShow: false, dialogMessage: [] })
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