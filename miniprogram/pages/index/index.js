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
    isTeacherMe: false,
    swiperHeight: 240
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
    this._lastCourseKey = ''
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
        order: { string: 'startTime', order: 'asc' },
        /* 首页版面只读课程自身字段 → 跳过 users join，少一次集合读、响应更小。
           不缓存：这里的时间窗含 Date.now()，缓存 key 浮动且可能让 6~8h 提醒延迟。 */
        noLookup: true
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
    const onOk = (resp) => {
      const result = (resp && resp.result) || {}
      // ★ 当前微信真身份（云函数从上下文拿，前端伪造不了），后续查课只认这个
      this._wxOpenid = result.openid
      this.setData({ getWXContext: result })
      this.resolveIdentity(result)
    }
    /* 会话级共享：一次小程序运行内 openid 不变，首页/我的/课程三页共用一次调用。 */
    readCache.cachedRead('getWXContext', {}, 600).then(onOk).catch(() => {
      /* ★ 缓存层/网络偶发失败时直连重试一次 —— 原版这里只 hideLoading，
         于是「刚进小程序那一次」直接不查课，正是「有时候不显示」的高发路径。 */
      wx.cloud.callFunction({ name: 'getWXContext' }).then(onOk).catch(() => {
        wx.hideLoading()
        this.setData({ todayCourses: [], isTeacherMe: false, dialogShow: false, dialogMessage: [] })
      })
    })
  },

  /* ★★ 修「进首页课程安排不显示，进预约课程再退回才显示」★★
     原版把查课挂在 wx.getSetting → wx.authorize → wx.login → wx.getUserInfo
     → getUsers → applyIdentity 这条长链路末端。任一环节失败或不回调
     （新版基础库 wx.authorize('scope.userInfo') 常直接不弹窗、getSetting/login 偶发 fail、
      getUsers 网络抖动且 catch 里没兜底），applyIdentity 就永远不执行 → 今天约了课也不显示；
      退回首页触发 onShow 重跑一遍才碰巧成功，于是表现为「有时候」。

     现在：拿到当前微信真 openid 后立刻查课，授权链路只用于「云端查无此人需建档」，
     且每条失败分支都有兜底。串号防护不变 —— 查课仍只认 getWXContext 的 openid，
     本机缓存快速路径还要严格校验 cached._openid === openid。 */
  resolveIdentity(result) {
    const openid = result && result.openid
    if (!openid) { wx.hideLoading(); return }
    const gen = this._identityGen

    // ① 本机缓存快速路径：立刻先出一版课表，不等授权、不等云端
    let cached = null
    try { cached = wx.getStorageSync('userInfo') } catch (e) {}
    const cachedOk = !!(cached && cached._openid === openid)
    if (cachedOk) {
      this._paintUser(cached)
      this.applyIdentity(openid, cached, gen)
    }

    // ② 云端最新档案：直连（不走 60 秒 identity 缓存，保证刚改过的资料能读到）
    wx.cloud.callFunction({
      name: 'getUsers',
      data: { page: 0, pageSize: 1, _openid: openid }
    }).then((re) => {
      wx.hideLoading()
      if (gen !== this._identityGen) return
      const rows = (re && re.result) || []
      if (Array.isArray(rows) && rows.length) {
        const user = rows[0]
        try { wx.setStorageSync('userInfo', user) } catch (e) {}
        readCache.setIdentity(openid, user, 60)
        this._paintUser(user)
        this.applyIdentity(openid, user, gen)
      } else {
        // ③ 云端无档案（新用户）：才走微信授权建档，失败也不影响查课
        this.createUserFromWx(result, gen)
      }
    }).catch(() => {
      wx.hideLoading()
      if (gen !== this._identityGen) return
      // 云端失败时保留快速路径已渲染的课；缓存无效则静默清空，不弹错误提示
      if (!cachedOk) {
        this.setData({ todayCourses: [], isTeacherMe: false, dialogShow: false, dialogMessage: [] })
      }
    })
  },

  _paintUser(user) {
    this.setData({
      nickName: user.nickName || '',
      avatarUrl: user.avatarUrl || '',
      name: user.name || '',
      userInfo: user || {}
    })
  },

  /* 新用户建档：原来的授权链路，但每个 fail 都兜底，不再阻塞查课 */
  createUserFromWx(result, gen) {
    const done = (el) => {
      const info = (el && el.userInfo) || {}
      const data = {
        _appid: result.appid,
        _openid: result.openid,
        nickName: info.nickName || '',
        gender: info.gender || 0,
        avatarUrl: info.avatarUrl || '',
        cloudID: el && el.cloudID,
        isTeacher: false,
        name: '',
        fileID: '',
        position: '',
        introduce: ''
      }
      wx.cloud.callFunction({ name: 'addUsers', data: data }).then((re) => {
        wx.hideLoading()
        if (gen !== this._identityGen) return
        const d = re && re.result && re.result.data
        const newUser = (d && d.length) ? d[0] : data
        try { wx.setStorageSync('userInfo', newUser) } catch (e) {}
        readCache.setIdentity(result.openid, newUser, 60)
        this._paintUser(newUser)
        this.applyIdentity(result.openid, newUser, gen)
      }).catch(() => {
        wx.hideLoading()
        if (gen !== this._identityGen) return
        this.applyIdentity(result.openid, { isTeacher: false, _openid: result.openid }, gen)
      })
    }
    const fallback = () => {
      wx.hideLoading()
      if (gen !== this._identityGen) return
      // 建档失败：新用户本来没课，静默清空即可
      this.setData({ todayCourses: [], isTeacherMe: false, dialogShow: false, dialogMessage: [] })
    }
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const afterLogin = () => wx.getUserInfo({
          lang: 'zh_CN', desc: '获取用户信息',
          success: done, fail: fallback
        })
        if (res.authSetting['scope.userInfo']) {
          wx.login({ success: afterLogin, fail: fallback })
        } else {
          wx.authorize({
            scope: 'scope.userInfo',
            success: () => wx.login({ success: afterLogin, fail: fallback }),
            fail: fallback
          })
        }
      },
      fail: fallback
    })
  },

  /* ★ 身份确认后统一处理「今日课程」与「上课前 6 小时提醒」。
     openid 来自 getWXContext（微信真身份），user 来自 users 表。
     学生：一个查课请求都不发、直接清空 —— 从根上杜绝看到别人的课。 */
  /* ★ 身份确认后统一处理「今日课程」与「上课前 6 小时提醒」。
     openid 来自 getWXContext（微信真身份）；学生一个查课请求都不发。
     gen 用 onShow 的代次，整轮 onShow 内不再自增，避免快速路径的响应被判成旧代次丢掉。 */
  applyIdentity(openid, user, gen) {
    const g = (gen === undefined) ? this._identityGen : gen
    const oid = openid || (user && user._openid) || ''
    const flag = user && user.isTeacher
    if (g !== this._identityGen) return
    if (flag === false) {
      this._isTeacherMe = false
      this.setData({
        isTeacherMe: false, todayCourses: [],
        dialogShow: false, dialogMessage: []
      })
      return
    }
    /* isTeacher 显式为 true；旧投影漏字段时仍按当前微信真 openid 查，
       学生查不到会返回空/报错，前端一律静默清空。 */
    this._isTeacherMe = true
    this.setData({ isTeacherMe: true })
    /* 同一轮 onShow 里「本机缓存快速路径」和「云端最新档案」会各调一次，
       用 key 去重只发一次 getMyCourse，不增加流量；onShow 开头重置 key，
       所以从预约课程页退回时仍重新查、课表是新的。身份 flag 变化也会重查。 */
    const key = oid + '|' + moment().format('YYYYMMDD') + '|' + (flag === true ? 'T' : 'T?')
    if (this._lastCourseKey === key) return
    this._lastCourseKey = key
    this.fetchTodayCourses(oid, g)
  },

  getTeachersShops() {
    /* ★ 读取优化：老师名单是低频变动的字典数据，10 分钟内跨页面复用；
       同时在途请求合并，首页反复 onShow 不会重复读 teachers 集合。 */
    readCache.cachedRead('getTeacheres', { page: 0, pageSize: 10 }, 600)
      .then((resp) => {
        const teachers = resp.result || []
        /* ★ 跑马灯：介绍不再截断到 3 行，swiper 高度必须跟着内容变，
           否则多出来的文字会被默认 150px 高度裁掉。
           先按字数给一个安全估算值，渲染后再用 SelectorQuery 量真实高度校准。 */
        let est = 150
        ;(teachers || []).forEach(t => {
          const chars = String(t.introduce || '').length + 3
          const lines = 2 + Math.ceil(chars / 16)
          est = Math.max(est, lines * 24 + 40)
        })
        this.setData({ teachers, swiperHeight: Math.min(Math.max(est, 150), 1200) }, () => {
          this.measureSwiper()
        })
      })
      .catch((e) => {
        console.log('获取老师名单失败', e)
      })
  },

  /* 量出所有跑马灯文字区的真实高度，取最大值设给 swiper（单位 px）。
     swiper-item 的 overflow 不影响子节点 boundingClientRect 的自身布局高度，
     所以即使当前估算偏小也能测到完整内容高度。 */
  measureSwiper() {
    const q = wx.createSelectorQuery().in(this)
    q.selectAll('.container-swiper-item-text').boundingClientRect()
    q.exec((rects) => {
      const arr = (rects && rects[0]) || []
      let h = 0
      arr.forEach(r => { if (r && r.height > h) h = r.height })
      if (h > 0) {
        // 头像 200rpx≈100px，取两者较大 + 上下 padding
        const px = Math.ceil(Math.max(h + 30, 130))
        if (Math.abs(px - this.data.swiperHeight) > 6) this.setData({ swiperHeight: px })
      }
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