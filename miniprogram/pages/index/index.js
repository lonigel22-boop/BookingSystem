const { envList } = require('../../envList.js') 
import Dialog from '@vant/weapp/dialog/dialog' 
import moment from'moment' 
const readCache = require('../../utils/readCache.js') 
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

  /* ★ 一次查课，同时产出「今日课程版面」与「上课前 6 小时提醒」。
     原来这里是两个独立的 getMyCourse 云函数调用（今日全天 + 6~8 小时窗口），
     每进一次首页就多一次云函数调用 + 3 次数据库读。
     现在查询范围取「今天 00:00 ~ max(今天 23:59, 现在+8 小时)」，
     一次拿回全部数据，前端各自过滤 —— 结果完全等价，读取减半。
     仍只认 getWXContext 给的当前微信真 openid（上一轮串号修复不变）。 */
  fetchTodayCourses(openid, gen) {
    const g = (gen === undefined) ? this._identityGen : gen
    if (!this._isTeacherMe || !openid) {
      this.setData({ todayCourses: [], dialogShow: false, dialogMessage: [] })
      return
    }
    const now = Date.now()
    const todayStart = moment().startOf('day').valueOf()
    const todayEnd = moment().endOf('day').valueOf()
    const winStart = now + 6 * 60 * 60 * 1000
    const winEnd = now + 8 * 60 * 60 * 1000
    // 晚上时 6~8 小时窗口会跨到明天，查询上界要覆盖到窗口末端
    const queryEnd = Math.max(todayEnd, winEnd + 60 * 1000)

    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        startTime: todayStart,
        endTime: queryEnd,
        teacherOpenid: openid,
        order: { string: 'startTime', order: 'asc' }
      }
    }).then(resp => {
      // 身份已切换 / 响应乱序回来 → 一律丢弃，绝不覆盖当前版面
      if (g !== this._identityGen || !this._isTeacherMe) return
      const r = resp && resp.result
      const raw = (r && r.result && r.result.data) || (r && r.data) || []
      const list = Array.isArray(raw) ? raw : []

      // ① 今日课程版面：只保留落在今天范围内的（查询可能带出明天凌晨的课）
      const courses = list
        .filter(c => Number(c.startTime) <= todayEnd)
        .map(course => ({
          ...course,
          startTime: moment(new Date(course.startTime)).format('HH:mm'),
          location: `${course.shopName} ${course.room}`,
          studentName: course.name || '未知学生'
        }))

      // ② 上课前 6 小时提醒：从同一份数据里筛窗口，仍是按时间升序取前 3
      const reminder = list
        .filter(c => Number(c.startTime) >= winStart && Number(c.startTime) <= winEnd)
        .slice(0, 3)
        .map(c => ({
          ...c,
          startTime: moment(new Date(c.startTime)).format('MM-DD HH:mm:ss'),
          studentName: c.name || '未知学生'
        }))

      // 空数组也要 setData：身份切换时把上一次的版面/提醒清掉
      this.setData({
        todayCourses: courses,
        dialogShow: reminder.length > 0,
        dialogMessage: reminder
      })
    }).catch(err => {
      console.log('获取今日课程失败（已清空版面）', err)
      if (g !== this._identityGen) return
      // 静默清空：学生 openid 在 teachers 表查不到时云函数会返回空，
      // 不该让学生看到「获取课程数据失败」的提示
      this.setData({ todayCourses: [], dialogShow: false, dialogMessage: [] })
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
    /* ★ 读取优化：身份档案按微信 openid 缓存 60 秒。
       首页与「我的」页共用，同一账号反复切换不再重复读 users 表；
       openid 变化（换账号）自动失效，串号修复不受影响。 */
    const cachedUser = readCache.getIdentity(result.openid)
    if (cachedUser) {
      wx.setStorageSync('userInfo', cachedUser)
      wx.hideLoading()
      this.setData({
        nickName: cachedUser.nickName,
        avatarUrl: cachedUser.avatarUrl,
        name: cachedUser.name,
        userInfo: cachedUser
      })
      this.applyIdentity(result.openid, cachedUser)
      return
    }
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
        readCache.setIdentity(result.openid, re.result[0], 60)
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
          const newUser = (data && data.length) ? data[0] : {}
          readCache.setIdentity(result.openid, newUser, 60)
          this.applyIdentity(result.openid, newUser)
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
    // 一次查课同时产出今日版面与 6 小时提醒（原来这里要发两次）
    this.fetchTodayCourses(oid, gen)
  },
 
  getTeachersShops() {
    /* ★ 读取优化：老师名单是低频变动的字典数据，10 分钟内跨页面复用；
       同时在途请求合并，首页反复 onShow 不会重复读 teachers 集合。 */
    readCache.cachedRead('getTeacheres', { page: 0, pageSize: 10 }, 600)
      .then((resp) => {
        this.setData({ teachers: resp.result || [] })
      })
      .catch((e) => {
        console.log('获取老师名单失败', e)
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