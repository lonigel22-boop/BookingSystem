import moment from 'moment'
import { callCloudFunction, callCloudFunctionWithConfirm } from '../../../utils/cloudHelper'
/* 只读调用走会话内共享缓存；写操作成功后统一失效，列表仍实时。 */
const readCache = require('../../../utils/readCache.js')

/* 结课状态存本机：课程挂在 users.tearchreOpenid_course[].course[] 里，
   没有独立集合可写，走缓存最稳，不改任何云端数据。换设备不同步。 */
const FINISH_KEY = 'ksst_myclass_finished_courses'
/* ★ 额外存一份 [学生名, 课程名]，给「课时导出」的结课分页用。
   原 key 是 users._id + '_' + course._id，导出数据里却是 _openid + courseId，
   两套 ID 对不上时按 key 反查会落空。只写本机，不动云端、不动现有结课状态。 */
const FINISH_NAMES_KEY = 'ksst_myclass_finished_names'

/* v10：预约 / 修改课时流程全部收进本页三层弹窗，不再 navigateTo 到
   appointmentCourseHandle / courseEdit。两个旧页面保留注册，不影响其它入口。
   云函数 addMyCourse / editMyCourse / deleteMyCourse / getMyCourse / getUsers
   / getShop / getUserSequence / updateUserSequence 的调用参数逐项沿用原版。 */

Page({
  data: {
    // ===== 主页面 =====
    userInfo: {},
    userName: '',
    userList: [],
    userListResult: [],
    page: 0,
    pageSize: 100,
    hasMore: true,
    sortMode: 'pinyin',       // pinyin | join
    finishedCourses: {},      // 结课标记缓存

    // ===== 三层弹窗 =====
    showL1: false,
    showL2: false,
    showL3: false,
    l1Student: null,
    l1StudentId: '',
    l1Courses: [],            // 展示用课程列表（结课置底，带 _srcIndex）
    l2Course: null,
    l2CourseIndex: -1,
    l3Mode: 'add',           // add | edit
    l3Title: '预约课程',

    // ===== 备注 =====
    showNoteDialog: false,
    noteContent: '',
    lessonTitle: '',
    noteCourse: null,

    // ===== 表单（预约 / 修改共用）=====
    startTime: '',           // 展示字符串
    startTimeTs: 0,          // 真正提交的时间戳
    teacher: '',
    studentName: '',
    studentOpenid: '',
    courseTitle: '',
    courseId: '',
    shop: '',
    shopId: '',
    currentShop: {},
    room: '',
    editId: '',

    // ===== 内联子选择面板 =====
    subPanel: '',            // '' | time | shop | room
    currentDate: new Date().getTime(),
    /* ★ 未来最多 1 年、全天 00:00–24:00 可约。
       原来写的是 add(30,'days') 后接 hours(22)：hours() 是 moment 的【setter】，
       把上限钉死在「30 天后那天的 22:00」，于是 22 点之后、以及一个月以后都选不了。
       现在 endOf('day') = 一年后那天的 23:59:59，配合组件默认 maxHour=23 / maxMinute=59，
       整天都能选。过去 5 年仍保留（补录历史课用）。 */
    minDate: moment(new Date()).subtract(5, 'years').startOf('day').valueOf(),
    maxDate: moment(new Date()).add(1, 'year').endOf('day').valueOf(),
    formatter(type, value) {
      /* 年份列不再拼「年」：原来 4 位数字 + 1 个汉字会被列宽挤成 "202..." */
      if (type === 'year') return String(value)
      if (type === 'month') return `${value}月`
      if (type === 'day') return `${value}日`
      if (type === 'hour') return `${value}时`
      if (type === 'minute') return `${value}分`
      return value
    },
    /* ★ 分钟只保留 5 的倍数。vant 的 getOriginColumns 会对每一列调用
       filter(type, values)，values 是 padZero 后的字符串数组（'00'…'59'）。
       只拦 minute 列，其余列原样返回，年月日小时完全不受影响。 */
    minuteFilter(type, options) {
      if (type === 'minute') {
        return (options || []).filter(o => Number(o) % 5 === 0)
      }
      return options
    },
    shopList: [],
    roomList: [],
    searchShopName: '',
    checkShop: '',
    checkRoom: ''
  },

  // 阻断遮罩/弹层上的 touchmove 冒泡，避免滑到主页面
  noop() {},

  onLoad() {
    try {
      this.setData({ finishedCourses: wx.getStorageSync(FINISH_KEY) || {} })
    } catch (e) {}
  },

  onShow() {
    this.setData({ userInfo: wx.getStorageSync('userInfo') || {} })
    this.getResertUsers()
  },

  /* ★ 把老版本结课标记（只有 users._id + course._id 的 key）翻译成名字清单。
     导出页读的 myCourses 用的是 _openid + courseId，与 users._id 常对不上，
     所以必须在本页（有学生档案）完成翻译；导出页只认名字，不再按 ID 反查。
     每次用户列表加载完成后重建一次：fin 是唯一权威（长按/取消都写它），
     覆盖式重建还能自动清掉「取消结课后名字清单里的残留」。
     纯本机读写，不发云函数、不动数据库。 */
  _rebuildFinishNames() {
    try {
      const fin = wx.getStorageSync(FINISH_KEY) || {}
      const list = this.data.userList || []
      if (!list.length) return   // 列表没加载好时不要覆盖，避免误清
      const names = [], seen = {}
      list.forEach(s => {
        const sname = s.name || s.nickName || ''
        const courses = (s.course && s.course.course) || []
        courses.forEach(c => {
          const key = String(s._id || '') + '_' + String(c._id || '')
          const cname = c.title || c.courseName || c.name || ''
          if (!fin[key] || !sname || !cname) return
          const nk = sname + '|' + cname
          if (seen[nk]) return
          seen[nk] = 1
          names.push([sname, cname])
        })
      })
      wx.setStorageSync(FINISH_NAMES_KEY, names)
    } catch (e) {}
  },

  // ───────────────────────── 主页面数据 ─────────────────────────
  getResertUsers() {
    /* 快速连点搜索 或 onShow 撞车时，用代次丢掉旧响应，避免列表叠加 */
    this._usersSeq = (this._usersSeq || 0) + 1
    const seq = this._usersSeq
    this.setData({ userList: [], userListResult: [], page: 0, hasMore: true })
    this.getUsers(seq)
  },

  loadMoreUsers() {
    this.getUsers()
  },

  async toggleTop(e) {
    const item = e.currentTarget.dataset.id
      ? (this.data.userListResult || []).filter(u => u._id === e.currentTarget.dataset.id)[0]
      : e.currentTarget.dataset.item
    if (!item) return
    const { userInfo } = this.data
    try {
      const newIsTop = !item.isTop
      const res = await wx.cloud.callFunction({
        name: 'updateUserSequence',
        data: {
          userId: item._id,
          sequence: newIsTop ? 0 : 1,
          teacherOpenid: userInfo._openid
        }
      })
      if (res.result.success) {
        const userList = this.data.userList.map(user => user._id === item._id
          ? { ...user, isTop: newIsTop, sequence: newIsTop ? 0 : 1 }
          : user)
        this.setData({ userList, userListResult: this.applySort(userList) })
        wx.showToast({ title: newIsTop ? '已置顶' : '已取消置顶', icon: 'none' })
      } else {
        wx.showToast({ title: '更新排序失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: '更新排序失败', icon: 'none' })
    }
  },

  _finishKey(sid, cid) {
    return String(sid || '') + '_' + String(cid || '')
  },

  /* 两种排序都保留「置顶优先」；其余按所选规则 */
  applySort(list) {
    const arr = [...(list || [])]
    if (this.data.sortMode === 'join') {
      return arr.sort((a, b) => {
        if (a.isTop !== b.isTop) return b.isTop - a.isTop
        const ai = Number(a._joinIndex), bi = Number(b._joinIndex)
        if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi
        return 0
      })
    }
    return this.sortUsers(arr)
  },

  setSortMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.sortMode) return
    this.setData({ sortMode: mode })
    this.setData({ userListResult: this.applySort(this.data.userListResult) })
    if (this.data.showL1) {
      this.setData({ l1Courses: this.buildL1Courses(this.data.l1Student) })
    }
  },

  /* 展示用课程列表：结课的置底（组内保持原顺序），带 _srcIndex 便于回写同步 */
  buildL1Courses(s, finOverride) {
    const fin = finOverride || this.data.finishedCourses || {}
    const sid = (s && s._id) || ''
    const arr = (((s && s.course && s.course.course) || [])).map((c, i) => ({
      ...c,
      _srcIndex: i,
      finished: !!fin[this._finishKey(sid, c._id)],
      currentCourse: c.currentCourse || []
    }))
    return arr.sort((a, b) => Number(!!a.finished) - Number(!!b.finished))
  },

  /* 长按课程：结课 / 取消结课。置底 + 变淡由 l1Courses 与 .finished 样式实现 */
  toggleCourseFinished(e) {
    const i = Number(e.currentTarget.dataset.index)
    const c = (this.data.l1Courses || [])[i]
    if (!c || !c._id) return
    const key = this._finishKey(this.data.l1StudentId, c._id)
    const fin = { ...(this.data.finishedCourses || {}) }
    const now = !fin[key]
    if (now) fin[key] = 1
    else delete fin[key]
    try { wx.setStorageSync(FINISH_KEY, fin) } catch (err) {}
    /* ★ 同步维护名字清单（结课加、取消结课删），与 fin 同一事务里写，不新增云调用 */
    try {
      const s = this.data.l1Student || {}
      const sname = s.name || s.nickName || ''
      const cname = c.title || c.courseName || c.name || ''
      let names = wx.getStorageSync(FINISH_NAMES_KEY) || []
      if (!Array.isArray(names)) names = []
      names = names.filter(x => !(Array.isArray(x) && x[0] === sname && x[1] === cname))
      if (now && sname && cname) names.push([sname, cname])
      wx.setStorageSync(FINISH_NAMES_KEY, names)
    } catch (err) {}
    this.setData({
      finishedCourses: fin,
      l1Courses: this.buildL1Courses(this.data.l1Student, fin)
    })
    if (this.data.showL2 && this.data.l2Course && this.data.l2Course._srcIndex === c._srcIndex) {
      const hit = this.data.l1Courses.filter(x => x._srcIndex === c._srcIndex)[0]
      if (hit) this.setData({ l2Course: hit })
    }
    wx.showToast({ title: now ? '已结课，置底显示' : '已取消结课', icon: 'none' })
  },

  sortUsers(users) {
    return [...users].sort((a, b) => {
      if (a.isTop !== b.isTop) return b.isTop - a.isTop
      if (a.sequence !== b.sequence) return a.sequence - b.sequence
      const nameA = a.name || a.nickName || ''
      const nameB = b.name || b.nickName || ''
      const cmp = nameA.localeCompare(nameB, 'zh-Hans-CN', { sensitivity: 'accent', usage: 'sort' })
      if (cmp === 0) return String(a._openid || '').localeCompare(String(b._openid || ''))
      return cmp
    })
  },

  /* v17 容错：三个进页面云调用彻底解耦。
     原来 Promise.all 里任意一个 reject → 整个 catch → 弹「操作失败 / 获取用户列表失败」，
     而 cloudHelper 自己还会再弹一次「操作失败：cloud.callFunction:fail ...」。
     现在：sequence 只是「置顶顺序」的可选增强，getMyCourse 只是「课节明细」，
     任何一个失败都不影响学生列表主数据，也不弹错误 toast。
     ★ 详细错误打到 console（真机调试/云函数日志能看到），方便定位云端问题。 */
  _safeCloud(name, data) {
    return wx.cloud.callFunction({ name: name, data: data || {} })
      .then(res => res && res.result)
      .catch(err => {
        console.error('[myClass] 云函数失败', name, '参数=', data,
          'err=', err && (err.message || err.errMsg || err))
        return null
      })
  },

  async getUsers(seq) {
    if (!this.data.hasMore) return
    if (seq !== undefined && seq !== this._usersSeq) return
    if (this._loadingList) return
    this._loadingList = true

    wx.showLoading({ title: '加载学员数据中', mask: true })
    const params = {
      name: this.data.userName || '',
      teacherOpenid: this.data.userInfo._openid,
      page: this.data.page,
      pageSize: this.data.pageSize
    }
    /* 注意：showError:false —— 不再由 cloudHelper 弹「操作失败：cloud.callFunction:fail」 */
    const usersP = callCloudFunction('getUsers', params,
      { loadingTitle: '加载学员数据中', showError: false }).catch(err => {
      console.error('[myClass] getUsers 调用失败', '参数=', params,
        'err=', err && (err.message || err.errMsg || err))
      return null
    })
    const seqP = this._safeCloud('getUserSequence',
      { teacherOpenid: this.data.userInfo._openid })

    let usersRes, sequenceRes
    try {
      ;[usersRes, sequenceRes] = await Promise.all([usersP, seqP])
    } finally {
      this._loadingList = false
      wx.hideLoading()
    }

    if (seq !== undefined && seq !== this._usersSeq) return

    /* getUsers 失败 → 空数组兜底，页面显示「还没有学生」而不是报错弹窗 */
    const raw = (usersRes && Array.isArray(usersRes.result)) ? usersRes.result
      : (Array.isArray(usersRes) ? usersRes : [])
    if (!usersRes) this.setData({ hasMore: false })

    const seqData = (sequenceRes && Array.isArray(sequenceRes.data)) ? sequenceRes.data : []
    const withSeq = raw.map((user, idx) => {
      const hit = seqData.find(item => item.userId === user._id)
      return {
        ...user,
        isTop: hit ? hit.sequence === 0 : false,
        sequence: hit ? hit.sequence : 1,
        _joinIndex: this.data.page * this.data.pageSize + idx
      }
    })

    const tempResult = this.sortUsers(withSeq)
    tempResult.forEach(res => {
      const arr = (res.tearchreOpenid_course || [])
      const hit = arr.filter(el => el.teacherOpenid === this.data.userInfo._openid)
      res.course = hit.length ? hit[0] : (res.course || { course: [] })
      if (!res.course.course) res.course.course = []
    })

    this.setData({
      userList: this.data.userList.concat(tempResult),
      page: this.data.page + 1,
      /* ★ 先让列表马上可见；课节明细随后再补，getMyCourse 挂了也不空屏 */
      userListResult: this.applySort(this.data.userList.concat(tempResult))
    })
    if (raw.length < this.data.pageSize) this.setData({ hasMore: false })
    this._rebuildFinishNames()
    this.getMycourse()
  },

  getMycourse() {
    /* ★★ 修复「首页能看到课、点开学生却 0 节课」★★
       原来 getMycourse 有两个致命假设：
         ① 全量 + startTime 升序：云端 .limit(1000) 与 900KB 体积闸门都【保留最前 N 条】，
            即最老的课；刚约的新课排在最后，数据量一大就被丢掉。首页只查「今天」所以正常。
         ② 关联只认 (x.courseId === el._id && res._openid === x._openid) 一条严格等式。
            老师代建的学生档案 _openid 是前端 Math.random().toString(36) 生成的伪 ID
            （图36 里的 "0.5fl2wodmlo5" 就是），链路里只要有一次不一致，整门课归零。
       现在四层一起修（云端仍是已上传的优化版，不用再重传）：
         · order 改 desc → 最新的课排最前，1000 上限 / 体积截断都优先保住新课
         · noLookup:true → 跳过 users join，响应大幅变小，避开 900KB 截断
         · 匹配改为「课程维度 × 学生维度」多重回退，严格匹配优先、失败才按姓名兜底
         · 拿到后本地按 startTime 升序重排，课节显示顺序与原来一致
       写课后 afterWrite() 会 invalidate('getMyCourse')，列表仍实时。 */
    return readCache.cachedRead('getMyCourse', {
      teacherOpenid: this.data.userInfo._openid,
      order: { string: 'startTime', order: 'desc' },
      noLookup: true
    }, 45).then(resp => {
      const cloudRet = (resp && resp.result) || {}
      const raw = ((cloudRet.result || {}).data) || []
      const data = Array.isArray(raw) ? raw : []
      if (cloudRet._capped) {
        console.warn('[myClass] getMyCourse 响应被体积闸门裁剪：拿到',
          data.length, '/', cloudRet._total, '条；已按最新优先保住新课节')
      }

      const str = (v) => (v === null || v === undefined) ? '' : String(v)
      const resultData = (this.data.userList || []).map(res => {
        const courses = (res.course && res.course.course) || []
        const resOpenid = str(res._openid)
        const resId = str(res._id)
        const studentNames = [res.name, res.nickName].filter(Boolean).map(str)

        courses.forEach(el => {
          // 课程维度：courseId / _id 相等；旧数据没有 courseId 时用课程名
          const courseIds = [el._id, el.courseId].filter(Boolean).map(str)
          const courseNames = [el.title, el.courseName, el.name].filter(Boolean).map(str)

          const courseOf = (x) => {
            const ids = [x.courseId, x.course_id].filter(Boolean).map(str)
            if (ids.some(k => courseIds.indexOf(k) >= 0)) return true
            // 没有 id 可比时退回课程名（老数据字段名不统一）
            if (ids.length === 0) {
              const names = [x.courseName, x.courseTitle].filter(Boolean).map(str)
              return names.some(n => courseNames.indexOf(n) >= 0)
            }
            return false
          }
          const strictOf = (x) => {
            const xos = [x._openid, x.studentOpenid].filter(Boolean).map(str)
            if (resOpenid && xos.indexOf(resOpenid) >= 0) return true
            if (resId && str(x.studentId) === resId) return true
            return false
          }
          const nameOf = (x) => {
            const xn = str(x.name)
            return !!xn && studentNames.indexOf(xn) >= 0
          }

          // 严格匹配优先；只有一条都没匹配上，才按同老师下的姓名兜底
          const strict = data.filter(x => courseOf(x) && strictOf(x))
          const list = (strict.length ? strict : data.filter(x => courseOf(x) && nameOf(x)))
            .slice()
            .sort((a, b) => Number(a.startTime) - Number(b.startTime))

          list.forEach(elp => {
            /* 库里 duration / endTime 一律毫秒；优先用服务端重算过的 endTime */
            const startTs = Number(elp.startTime)
            const endTs = Number(elp.endTime) > startTs
              ? Number(elp.endTime)
              : startTs + (Number(elp.duration) > 0 ? Number(elp.duration) : 30 * 60 * 1000)
            elp.startTimeFormat = moment(new Date(startTs)).format('YYYY/MM/DD HH:mm')
            elp.endTimeFormat = moment(new Date(endTs)).format('YYYY/MM/DD HH:mm')
          })
          el.currentCourse = list
        })
        return res
      })
      this.setData({ userListResult: this.applySort(resultData) })
      this.syncOpenedLayers()
    }).catch(err => {
      /* v17：课程明细拉不到，学生列表照样显示（课节为空而已），不弹错、不空屏 */
      console.error('[myClass] getMyCourse 调用失败',
        'teacherOpenid=', this.data.userInfo._openid,
        'err=', err && (err.message || err.errMsg || err))
      const fallback = this.applySort(this.data.userList || [])
      this.setData({ userListResult: fallback })
      this.syncOpenedLayers()
    })
  },

  // 写操作后弹窗已关；若因其它原因仍开着，同步到最新数据，避免显示旧课节
  syncOpenedLayers() {
    const d = this.data
    if (!d.showL1 && !d.showL2) return
    const s = (d.userListResult || []).filter(u => u._id === d.l1StudentId)[0]
    if (!s) return
    const courses = this.buildL1Courses(s)
    const patch = { l1Student: s, l1Courses: courses }
    if (d.showL2 && d.l2Course) {
      const hit = courses.filter(x => x._srcIndex === d.l2Course._srcIndex)[0]
      if (hit) patch.l2Course = hit
    }
    this.setData(patch)
  },

  // ───────────────────────── 三层弹窗 ─────────────────────────
  openL1(e) {
    const id = e.currentTarget.dataset.id
    const s = (this.data.userListResult || []).filter(u => u._id === id)[0]
    if (!s) return
    this.setData({
      l1Student: s, l1StudentId: id,
      l1Courses: this.buildL1Courses(s),
      showL1: true, showL2: false, showL3: false, subPanel: ''
    })
  },

  openL2(e) {
    const i = Number(e.currentTarget.dataset.index)
    const c = (this.data.l1Courses || [])[i]
    if (!c) return
    this.setData({
      l2Course: c, l2CourseIndex: c._srcIndex,
      showL2: true, showL3: false, subPanel: ''
    })
  },

  closeAll() {
    this.setData({
      showL1: false, showL2: false, showL3: false,
      subPanel: '', showNoteDialog: false
    })
  },

  // 点遮罩：逐层返回
  onMaskTap() {
    if (this.data.showL3) { this.setData({ showL3: false, subPanel: '' }); return }
    if (this.data.showL2) { this.setData({ showL2: false }); return }
    this.closeAll()
  },

  // 「‹ 返回 / 取消」：先收子面板，再逐层退
  backOne() {
    if (this.data.subPanel) { this.setData({ subPanel: '' }); return }
    if (this.data.showL3) { this.setData({ showL3: false, subPanel: '' }); return }
    if (this.data.showL2) { this.setData({ showL2: false }); return }
    this.closeAll()
  },

  // 写操作成功：一次性关掉所有弹窗，回到主页面
  afterWrite() {
    /* ★ 写后失效：约课 / 改课 / 删课 / 备注成功后清掉课节与门店缓存，
       紧接着的 getMycourse() / getShops() 会重新读云端，列表不会显示旧数据。 */
    readCache.invalidate('getMyCourse')
    readCache.invalidate('getShop')
    this.closeAll()
    this.getMycourse()
  },

  // ───────────────────────── L3：预约 ─────────────────────────
  openL3Add() {
    const s = this.data.l1Student
    const c = this.data.l2Course
    if (!s || !c) return
    const lessons = c.currentCourse || []
    // 上次上课：优先本课程的最后一次，否则取该学生所有课节的最后一次
    const all = []
    ;((s.course && s.course.course) || []).forEach(x => (x.currentCourse || []).forEach(y => all.push(y)))
    const pool = lessons.length ? lessons : all
    const last = pool.length
      ? [...pool].sort((a, b) => Number(b.startTime) - Number(a.startTime))[0]
      : null
    const rawBase = last ? Number(last.startTime) + 7 * 24 * 60 * 60 * 1000 : Date.now()
    /* 默认 +7 天也要落在「一年内」，否则 picker 会被 clamp、显示与提交值不一致 */
    const baseTs = Math.min(rawBase, this.data.maxDate)
    this._pickerTs = baseTs
    const u = wx.getStorageSync('userInfo') || {}

    this.setData({
      l3Mode: 'add', l3Title: '预约课程',
      showL3: true, subPanel: '',
      teacher: u.name || u.nickName || '',
      studentName: s.name || s.nickName || '',
      studentOpenid: s._openid || '',
      studentId: s._id || '',
      courseTitle: c.title || '',
      courseId: c._id || '',
      startTime: last ? moment(new Date(baseTs)).format('YYYY/MM/DD HH:mm') : '',
      startTimeTs: last ? baseTs : 0,
      currentDate: baseTs,
      shop: last && last.shopName ? last.shopName : '',
      shopId: last && last.shopId ? last.shopId : '',
      checkShop: last && last.shopId ? last.shopId : '',
      currentShop: last && last.shopId ? { _id: last.shopId, text: last.shopName || '' } : {},
      room: last && last.room ? last.room : '',
      checkRoom: last && last.room ? last.room : '',
      editId: '', searchShopName: ''
    })
    this.getShops()
  },

  // ───────────────────────── L3：修改 ─────────────────────────
  openL3Edit(e) {
    const c = e.currentTarget.dataset.data
    if (!c || !c._id) return
    const startTs = Number(c.startTime)
    /* 时长不再由本页自定义：不读、不显示、不提交。
       editMyCourse 云函数会用库里 cur.duration 原值，并据此重算 endTime。 */
    const s = this.data.l1Student || {}
    this.setData({
      l3Mode: 'edit', l3Title: '修改课时',
      showL3: true, subPanel: '',
      editId: c._id,
      startTime: startTs > 0 ? moment(new Date(startTs)).format('YYYY/MM/DD HH:mm') : '',
      startTimeTs: startTs > 0 ? startTs : 0,
      currentDate: startTs > 0 ? startTs : Date.now(),
      studentName: s.name || s.nickName || '',
      courseTitle: this.data.l2Course.title || '',
      shop: c.shopName || '',
      shopId: c.shopId || '',
      checkShop: c.shopId || '',
      currentShop: { _id: c.shopId || '', text: c.shopName || '' },
      room: c.room || '',
      checkRoom: c.room || '',
      searchShopName: ''
    })
    this.getShops()
  },

  // ───────────────────────── 内联子面板 ─────────────────────────
  /* 把任意分钟归一到最近的 5 分钟（:58 → 次日 :00，setMinutes 自动进位） */
  _toFiveMin(n) {
    const num = Number(n)
    if (!Number.isFinite(num) || num <= 0) return Date.now()
    const t = new Date(num)
    t.setSeconds(0, 0)
    t.setMinutes(Math.round(t.getMinutes() / 5) * 5, 0, 0)
    return t.getTime()
  },
  openSub(e) {
    const panel = e.currentTarget.dataset.panel
    if (panel === 'time') {
      /* ★ 只给 picker 一个「可显示的」初值（5 的倍数，避免历史 :07 课
         在过滤后的分钟列里找不到索引）。这里【不改 startTimeTs】：
         用户没确认/没保存之前，表单里的时间保持原样，滚轮期间零写入。 */
      const raw = this.data.startTimeTs || this.data.currentDate || Date.now()
      const shown = this._toFiveMin(raw)
      this._pickerTs = shown
      this.setData({ subPanel: 'time', currentDate: shown })
      return
    }
    this.setData({ subPanel: panel })
  },
  closeSub() {
    this.setData({ subPanel: '' })
  },

  /* ★★ v2：彻底取消「滚轮一动就写入」★★
     不再绑定实时输入事件、不再有实时写入方法。滚轮滚动期间前端不执行任何 setData、
     不写 startTimeTs、不写库，只有 vant 组件自己在更新列 —— 不会炸。
     取值只发生在两个「明确动作」：点「✓ 用这个时间」、或点底部「保存」。
     取法：selectComponent 拿 picker 实例，读它 data.innerValue（组件 onConfirm
     用的就是同一个值，等价于官方 confirm）。拿不到就用打开面板时锁定的兜底值。 */
  _currentPickerTs() {
    try {
      const inst = this.selectComponent && this.selectComponent('#dtPicker')
      const v = inst && inst.data && Number(inst.data.innerValue)
      if (Number.isFinite(v) && v > 0) return v
    } catch (err) {}
    return this._pickerTs || this.data.currentDate || this.data.startTimeTs
  },
  /* 把当前选中的时间正式提交到表单并收起子面板（唯一一次写入） */
  _applyTime(ts) {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return false
    /* 兜底量化：无论值从哪来，落到库里的分钟一定是 5 的倍数 */
    const startTs = this._toFiveMin(n)
    this._pickerTs = startTs
    this.setData({
      startTime: moment(new Date(startTs)).format('YYYY/MM/DD HH:mm'),
      startTimeTs: startTs,
      currentDate: startTs,
      subPanel: ''
    })
    return true
  },
  /* vant 自带工具栏已隐藏，但保留 confirm 绑定以兼容旧基础库 */
  dateConfirm(e) {
    if (!this._applyTime(e && e.detail)) {
      wx.showToast({ title: '时间选择无效', icon: 'none' })
    }
  },
  /* 子面板头部的醒目「✓ 用这个时间」 */
  dateConfirmCurrent() {
    if (!this._applyTime(this._currentPickerTs())) {
      wx.showToast({ title: '时间选择无效', icon: 'none' })
    }
  },
  dateCancel() {
    this.setData({ subPanel: '' })
  },

  getShops() {
    // 静默加载，避免与 getUsers / getMycourse 的 loading 互相顶掉
    return readCache.cachedRead('getShop', { name: this.data.searchShopName }, 300).then(resp => {
      const list = (resp && resp.result && resp.result.data) || []
      this.setData({ shopList: list })
      this.applyShopSelection(list)
    }).catch(() => {})
  },
  applyShopSelection(list) {
    const hit = (list || []).filter(res => res._id === this.data.checkShop)
    if (hit.length) {
      this.setData({
        roomList: hit[0].room ? hit[0].room.split(',') : [],
        currentShop: hit[0]
      })
    }
  },
  searchShop() {
    this.setData({ shopList: [] })
    this.getShops()
  },
  checkShopChange(event) {
    this.setData({ checkShop: event.detail })
    const hit = (this.data.shopList || []).filter(res => res._id === this.data.checkShop)
    if (hit.length) this.setData({ roomList: hit[0].room ? hit[0].room.split(',') : [] })
  },
  saveShop() {
    const hit = (this.data.shopList || []).filter(res => res._id === this.data.checkShop)
    this.setData({
      shop: hit.length ? hit[0].text : '',
      shopId: hit.length ? hit[0]._id : '',
      currentShop: hit.length ? hit[0] : {},
      showShop: false,
      room: '',
      subPanel: ''
    })
  },
  checkRoomChange(event) {
    this.setData({ checkRoom: event.detail })
  },
  saveRoom() {
    this.setData({ room: this.data.checkRoom, subPanel: '' })
  },

  // ───────────────────────── 保存 ─────────────────────────
  onSave() {
    if (this._saving) return
    /* ★ 时间子面板还开着就直接点「保存修改 / 保存预约」：
       这时【只读取一次】picker 当前值再提交，不要求先点「✓ 用这个时间」。
       面板已经收起（用户点过 ✓ 或收起）则沿用表单里已有的 startTimeTs，
       不会偷偷改动没碰过时间的课（例如历史 :07 的课只改房间）。 */
    if (this.data.subPanel === 'time') {
      this._applyTime(this._currentPickerTs())
    }
    if (this.data.l3Mode === 'edit') this.saveEdit()
    else this.saveAppointment()
  },

  saveAppointment() {
    const d = this.data
    if (!d.startTimeTs || !d.shop || !d.room) {
      wx.showModal({
        title: '提示',
        content: !d.startTimeTs ? '请选择时间' : !d.shop ? '请选择门店' : '请选择房间',
        showCancel: false
      })
      return
    }
    const startTs = Number(d.startTimeTs)
    if (!Number.isFinite(startTs) || startTs <= 0) {
      wx.showModal({ title: '提示', content: '上课时间无效，请重新选择', showCancel: false })
      return
    }
    if (startTs > d.maxDate) {
      wx.showModal({ title: '提示', content: '最多可预约一年内的课程', showCancel: false })
      return
    }
    const u = wx.getStorageSync('userInfo') || {}
    this._saving = true
    wx.showLoading({ title: '加载中' })
    /* endTime / duration 由 addMyCourse 按 course.minute 统一重算，前端不传 */
    wx.cloud.callFunction({
      name: 'addMyCourse',
      data: {
        startTime: startTs,
        teacherName: u.name || u.nickName,
        teacherOpenid: u._openid,
        shopName: d.currentShop.text,
        shopId: d.currentShop._id,
        courseId: d.courseId,
        courseName: d.courseTitle,
        _openid: d.studentOpenid,
        studentId: d.studentId || '',
        name: d.studentName,
        room: d.room,
        finished: startTs < Date.now()
      }
    }).then(resp => {
      wx.hideLoading()
      this._saving = false
      const r = resp.result || {}
      if (r.code !== 200) {
        wx.showModal({ title: '提示', content: r.msg || '预约失败', showCancel: false })
      } else {
        wx.showToast({ title: '保存成功', icon: 'success', duration: 1500 })
        this.afterWrite()
      }
    }).catch(() => {
      wx.hideLoading()
      this._saving = false
      wx.showModal({ title: '提示', content: '预约失败', showCancel: false })
    })
  },

  saveEdit() {
    const d = this.data
    if (!d.startTimeTs || !d.shop || !d.room) {
      wx.showModal({
        title: '提示',
        content: !d.startTimeTs ? '请选择时间'
          : !d.shop ? '请选择门店' : '请选择房间',
        showCancel: false
      })
      return
    }
    if (Number(d.startTimeTs) > d.maxDate) {
      wx.showModal({ title: '提示', content: '最多可预约一年内的课程', showCancel: false })
      return
    }
    this._saving = true
    wx.showLoading({ title: '加载中' })
    /* 时长不再由前端传：云函数回退 cur.duration（该节课原值），
       仍按 startTime + duration 统一重算 endTime，库里数据保持自洽。
       备注功能一直走这条路径（不传 duration），久经验证。 */
    wx.cloud.callFunction({
      name: 'editMyCourse',
      data: {
        _id: d.editId,
        startTime: Number(d.startTimeTs),
        shopName: d.currentShop.text,
        shopId: d.currentShop._id,
        room: d.room
      }
    }).then(resp => {
      wx.hideLoading()
      this._saving = false
      const r = (resp && resp.result) || {}
      if (r.code !== 200) {
        wx.showModal({ title: '提示', content: r.msg || '修改失败', showCancel: false })
      } else {
        wx.showToast({ title: '修改成功', icon: 'success', duration: 1500 })
        this.afterWrite()
      }
    }).catch(() => {
      wx.hideLoading()
      this._saving = false
      wx.showModal({ title: '提示', content: '修改失败', showCancel: false })
    })
  },

  // ───────────────────────── 取消课节 / 备注 ─────────────────────────
  deleteMyCourse(e) {
    const c = e.currentTarget.dataset.data
    if (!c || !c._id) return
    callCloudFunctionWithConfirm(
      'deleteMyCourse',
      { _id: c._id },
      { title: '提示', content: '确定取消？' },
      { loadingTitle: '处理中', showSuccess: true, successTitle: '取消成功' }
    ).then(() => this.afterWrite()).catch(() => {})
  },

  showNoteDialog(e) {
    const c = e.currentTarget.dataset.data
    if (!c) return
    this.setData({
      showNoteDialog: true,
      noteCourse: c,
      noteContent: c.note || '',
      lessonTitle: c.lessonTitle || ''
    })
  },
  closeNoteDialog() {
    this.setData({ showNoteDialog: false, noteContent: '', lessonTitle: '', noteCourse: null })
  },
  saveNote() {
    const c = this.data.noteCourse
    if (!c) return
    wx.showLoading({ title: '保存中' })
    wx.cloud.callFunction({
      name: 'editMyCourse',
      data: { _id: c._id, note: this.data.noteContent, lessonTitle: this.data.lessonTitle }
    }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success', duration: 1000 })
      this.closeNoteDialog()
      this.afterWrite()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none', duration: 1000 })
    })
  }
})
