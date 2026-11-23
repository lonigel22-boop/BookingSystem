/* KSST 演唱技能树 · 小程序原生版
   本轮：去掉页面上全部排查 / 诊断 / 版本显示（纯前端改动，云端不用动）
     - 顶部不再显示标记
     - 管理弹层不再显示云端横幅、体检结果框、失败常驻红字
     - 列表底部不再有排查入口，手动排查弹窗一并移除
     - 移除自动体检函数、云端版本探针及相关数据字段
     失败仍走 toast；榜单未连通仍显示原错误行；业务功能一行没动。
   历史成果：选老师无限循环修复、昵称显示、透明后台入口、后台名单同准入规则、
     名字搜索、进度上云（分数由点亮数推导）、额度 0 起 / 上限为课程数。
   ⚠ 只覆盖 3 个页面文件并清缓存重编译即可，不需要动云函数、不需要动集合。 */

const { BRANCHES, QUIZ } = require('./data.js');

const LS_KEY   = 'ksst_tree_v3';   // ★ 仅作「秒开渲染 + 离线兜底」缓存，主存储在云端 ksst_progress
const NAME_KEY = 'ksst_lb_name';   // 榜单昵称本机缓存
const CRED_KEY = 'ksst_credits';   // 离线时额度的本机兜底
const PICK_KEY = 'ksst_teacher_picked'; // ★ 本人「已选过老师」快照（按 myWho() 身份键区分）
const FN       = 'treeranksystem'; // 云函数名（与 cloudfunctions/ 下的目录名保持一致）

/* ============================================================
   老师名单：已接进你们约课小程序的真实接口
   ------------------------------------------------------------
   云函数 getTeacheres → 查 teachers 集合，返回数组；
   参数 { name:'', page:0, pageSize:100 }（name 为空=不按名字过滤），
   按 y 升序，和首页 getTeachersShops() / teacherManagement 用的是同一个。
   每项规范成 { id, name }：
     id   = _openid  ★ 必须！老师身份的唯一键就是微信 openid
     name = name || nickName（teachers 表里是真实姓名，如「邝贤妍」）
   学生选老师时把这一项的 _openid 存进 ksst_scores.teacherId；
   老师管理列表按 teacherId 认领「自己选了他的学生」。
   ★ 不再用 users.tearchreOpenid_course：那是老师自建的学生档案，
     不是学生微信登录后自己注册/自己选老师的那份名单。
   兜底顺序：云函数失败 → globalData.teachers / 缓存 → 空数组
   ============================================================ */
const TEACHER_FN  = 'getTeacheres';
const TEACHER_URL = '';

function normalizeTeachers(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && (raw.list || raw.data || raw.result || raw.teachers)) || [];
  const out = [], seen = {};
  arr.forEach(function (it) {
    if (!it || typeof it !== 'object') return;
    const name = String(it.name || it.nickName || it.realName || it.teacherName || '').trim();
    if (!name) return;
    // ★ _openid 优先，_id 只是文档 id，不能当师生关系键
    const id = String(it._openid || it.openid || it.teacherOpenid || it.id || it.teacherId || it._id || name).trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: name });
  });
  return out;
}

/* 把「未知操作」这类云端错误翻译成能直接照做的提示。
   旧版 treeranksystem 只有 sync / board，manageList 等新 action 会返回「未知操作」。 */
function cloudHint(msg) {
  const m = String(msg || '云端返回异常');
  if (m.indexOf('未知操作') >= 0 || m.indexOf('is not defined') >= 0) {
    return '云函数未更新：请在微信开发者工具右键 cloudfunctions/treeranksystem → 上传并部署（云端安装依赖），然后重进页面';
  }
  if (m.indexOf('Db or Table not exist') >= 0 || m.indexOf('ksst_scores') >= 0) {
    return '缺少集合：云开发控制台 → 数据库 → 新建集合 ksst_scores';
  }
  return m;
}

function rgba(hex, a) {
  let h = String(hex || '#8b9cff').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
const RATIO_RE = /^气\s*(\d+)\s*:\s*声\s*(\d+)$/;
function ratioInfo(ratio) {
  const m = RATIO_RE.exec(String(ratio == null ? '' : ratio).trim());
  if (!m) return { hasRatio: false, ratioA: 0, ratioB: 0, ratioText: ratio || '' };
  const a = +m[1], b = +m[2], t = a + b;
  const pa = Math.round(a / t * 100);
  return { hasRatio: true, ratioA: pa, ratioB: 100 - pa, ratioText: '气 ' + a + ' · 声 ' + b + ' · 共 ' + t };
}
function labelOf(m) {
  return ({ opera: '歌剧咏叹调', sob: '呜咽哭腔', scream: '喊唱嘶吼' })[m] || m;
}

const ALL = [];
BRANCHES.forEach(function (b) { b.nodes.forEach(function (n) { ALL.push(n); }); });

Page({
  data: {
    myName: '',
    // isTeacher 只用于「是否显示管理按钮 / 能否进后台」，
    // ★ 不再跳过选老师：老师也要选自己的老师才能上榜
    // 榜单显示与排名完全不分师生（上一轮成果保留）
    isTeacher: false,
    myCredits: 0, myTeacherId: '', myTeacherName: '',
    // ★ 上榜资格：本人是否在「选择你的老师」里主动点选过（老师也要）
    teacherPicked: false,
    // ★ 云端归属判定是否已回来。没回来前绝不弹选老师弹层，
    //   避免「选过老师的人每次进页面先闪一下弹层、云端回来再收起」。
    teacherChecked: false,
    creditLeftText: '',

    boardTop: [], boardMeText: '', boardLoading: true, boardErr: '',

    // ★ 云端进度同步状态（不在页面直接展示，但拉回明细前要锁住改动、
    //   离线时 onShow 要靠 progressOffline 判断是否需要补推，逻辑必须保留）
    progressReady: false,
    progressSyncText: '',
    progressOffline: false,

    statTotal: 0, statLit: 0, statExam: '0/3', prog: 0,
    filter: 'all',
    filters: [
      { k: 'all',   t: '🌳 整棵树' },
      { k: 'root',  t: '🌱 根系' },
      { k: 'basic', t: '🌿 初级' },
      { k: 'color', t: '🎨 中级' },
      { k: 'pro',   t: '👑 高级' },
      { k: 'ultra', t: '💎 隐藏' }
    ],
    visibleBranches: [],

    detailShow: false, detailDragging: false, detailDragStyle: '', detailScrollTop: 0, d: null,

    quizShow: false, quizTag: '', quizTitle: '', quizLabel: '', quizStem: '',
    quizOpts: [], quizFeedback: '', quizFeedbackType: '', quizPending: false, quizLocked: false,
    quizCol: '#5ee0a0', quizColA12: 'rgba(94,224,160,.12)', quizColA40: 'rgba(94,224,160,.4)',

    nameShow: false, nameInput: '', nameErr: '',
    confirmShow: false,

    // 选老师（★ 师生都要，上榜的必要条件；老师名单里会补一项「自己」）
    teacherPickShow: false, teachers: [], teachersLoading: false, teacherErr: '',

    // 管理技能点 / 管理后台
    manageShow: false, manageTab: 'credits', manageLoading: false,
    manageList: [], adminList: [], stepN: 1,
    // ★ 后台名字搜索：adminList 是过滤后展示用，原始全量存在 this._adminRaw
    adminSearch: '', adminTotal: 0, adminMatched: 0,
    // ★ 技能额度上限 = 课程数量之和（技能树节点总数，当前 30）
    courseTotal: ALL.length,
    adminPickShow: false, adminPickUid: '', adminPickName: '',
    selfBusy: false,

    toastShow: false, toastMsg: '', toastCol: '#5ee0a0'
  },

  /* ==================== 生命周期 ==================== */
  onLoad: function () {
    // 本机缓存只用于「秒开渲染」，真正的数据源是下面的 pullCloudProgress()
    this.store = this.loadStore();
    this._cloudRev = 0;
    this._progressReady = false;
    this._pushTimer = null;
    this.qs = null;
    this.qTimer = null;
    this.toastTimer = null;
    this._dScrollTop = 0;
    this._touch = null;
    this._dragDist = 0;
    this._teachers = [];
    try { this.data.myCredits = Number(wx.getStorageSync(CRED_KEY)) || 0; } catch (e) {}
    this.loadIdentity();
    // ★ 先按本机快照把「已选过老师」恢复出来，页面第一帧就是正确状态，
    //   不会先显示「选择老师」再等云端改回来（换账号由 openid 校验挡掉）。
    this.restorePickedCache();
    this.render();
    this.refreshBoard();
    // ★ 拉云端进度：拉回之前禁止改动（避免本机旧数据覆盖云端），
    //   云端无记录时把本机明细上传一次做迁移（老用户分数不丢）。
    this.pullCloudProgress();
    // 师生一致：分数同步只做一次，且等老师名单就绪后再做，
    // 这样老师写进云端的归属 key 是名单里的稳定 id，而不是兜底昵称。
    // （避免两次云函数并发 add 出重复记录）
    const self = this;
    this.fetchTeachers().then(function (list) {
      self._teachers = list;
      self.setData({ teachers: list });
      self.syncScore();
      self.maybeAskTeacher();
    });
  },
  onShow: function () {
    // 从「我的」页面改名回来后，重新读名字并同步榜单
    const prev = this.data.myName;
    this.loadIdentity();
    if (this.data.myName && this.data.myName !== prev) this.syncScore();
    else this.refreshBoard();
    if (this._teachers && this._teachers.length) this.maybeAskTeacher();
    // 从后台切回来 / 离线恢复：有未推送的改动就先补推再拉，避免被云端旧快照盖掉
    if (this._progressReady) {
      if (this._pushTimer || this.data.progressOffline) this.onCloudBarTap();
      else this.pullCloudProgress(true);
    }
  },
  onHide: function () { this.flushProgressPush(); },
  onUnload: function () {
    clearTimeout(this.qTimer);
    clearTimeout(this.toastTimer);
    this.flushProgressPush();
  },

  /* ==================== 昵称 / 权限 ====================
     榜单不分师生，只按微信 openid 认人；这里取「榜单上显示的名字」。
     isTeacher 只决定：顶端管理按钮、页面底部透明后台热区、能否进管理后台；
     榜单显示、排名、改名、上榜对所有人完全一致。 */
  loadIdentity: function () {
    const app = getApp() || {};
    const g   = app.globalData || {};
    let cached = {};
    try { cached = wx.getStorageSync('userInfo') || {}; } catch (e) {}
    // 有些页面把昵称单独存在 nickName / name 键里，一并纳入兜底
    let soloNick = '';
    try { soloNick = wx.getStorageSync('nickName') || ''; } catch (e) {}
    // 兼容多种存放位置：globalData.userInfo / 缓存 userInfo / 独立字段
    const u = Object.assign({}, cached, g.userInfo || {}, {
      name:     g.name     || (g.userInfo && g.userInfo.name)     || cached.name     || '',
      nickName: g.nickName || (g.userInfo && g.userInfo.nickName) || cached.nickName || soloNick || ''
    });
    /* ★ 榜单显示的是「昵称」(users.nickName)，不是「姓名」(users.name)。
       之前写成 u.name || u.nickName，所以一直显示真实姓名（罗宇轩），
       现在改成昵称优先。昵称没设时才退回姓名，再退回旧的本机缓存。
       云端 sync 每次都用这个值无条件覆盖 ksst_scores.name，所以榜单、
       「我」的排名条、管理列表里的名字会一起变成昵称。 */
    const nick = String(u.nickName || '').trim();
    const real = String(u.name || '').trim();
    let myName = nick || real || '';
    // 云端 sync 要求 2–16 字；昵称太短就退回姓名，避免 sync 被拦、名字推不上去
    if (nick && (nick.length < 2 || nick.length > 16)) myName = real || nick;
    if (!myName) { try { myName = wx.getStorageSync(NAME_KEY) || ''; } catch (e) {} }
    const isTeacher = !!(u.isTeacher || (g.userInfo && g.userInfo.isTeacher) || cached.isTeacher ||
                         u.role === 'teacher' || u.userType === 'teacher');
    this.setData({ myName: myName, isTeacher: isTeacher });
    this._identityRaw = u;
  },

  /* ==================== 老师名单（已接真实接口 getTeacheres） ====================
     真实调用（与首页 index.js 的 getTeachersShops 一致）：
       wx.cloud.callFunction({ name:'getTeacheres', data:{ name:'', page:0, pageSize:100 })
       → 返回 resp.result = teachers 集合的数组
     getTeacheres 内部用 new RegExp(name,'i') 过滤，name 传 '' 即「不按名字过滤」。
     云函数失败时退回 globalData.teachers / 缓存，再不行返回空数组（不阻塞页面）。 */
  fetchTeachers: function () {
    if (TEACHER_FN && wx.cloud) {
      return wx.cloud.callFunction({
        name: TEACHER_FN,
        data: { name: '', page: 0, pageSize: 100 }
      }).then(function (r) {
        const list = normalizeTeachers(r && r.result);
        return list.length ? list : localTeachers();
      }).catch(function () { return localTeachers(); });
    }
    if (TEACHER_URL) {
      return new Promise(function (resolve) {
        wx.request({
          url: TEACHER_URL, method: 'GET',
          success: function (r) { resolve(normalizeTeachers(r && r.data)); },
          fail: function () { resolve(localTeachers()); }
        });
      });
    }
    return Promise.resolve(localTeachers());

    function localTeachers() {
      const app = getApp() || {}, g = app.globalData || {};
      let raw = g.teachers || g.teacherList || null;
      if (!raw) {
        try { raw = wx.getStorageSync('teachers') || wx.getStorageSync('teacherList') || null; } catch (e) {}
      }
      return normalizeTeachers(raw);
    }
  },
  /* 老师认领学生用的 key = 自己的微信 openid（userInfo._openid）。
     学生选老师时存的是名单项的 _openid，两边天然对得上。
     ★ 罗宇轩的 key 同时作为「所有老师用户」的默认归属 key。 */
  myTeacherKey: function () {
    const u = this._identityRaw || {}, list = this._teachers || [];
    const cands = [u._openid, u.openid, u.teacherOpenid, u.teacherId, u.id, u._id]
      .filter(Boolean).map(String);
    for (let i = 0; i < cands.length; i++) {
      if (list.some(function (t) { return t.id === cands[i]; })) return cands[i];
    }
    /* ★ teachers 名单里存的是「姓名」，而 myName 现在是「昵称」。
       名字匹配必须用 _identityRaw.name（真实姓名），不能用 myName，
       否则老师按名字认领会失配；openid 命中时本来就不走这里。 */
    const matchNames = [String(u.name || '').trim(), String(this.data.myName || '').trim()]
      .filter(Boolean);
    const hit = list.filter(function (t) { return matchNames.indexOf(String(t.name || '')) >= 0; })[0];
    if (hit) return hit.id;
    return u._openid || u.openid || this.data.myName || '';
  },

  /* ==================== 选老师（★ 师生都要，上榜必要条件） ====================
     v6：老师不再跳过。名单里保证有「自己」这一项——罗宇轩（总管理员）
     在 teachers 表里查不到时也能选自己，否则会永远卡在「没选老师」上不了榜。 */
  teacherPickList: function () {
    const base = (this._teachers || []).slice();
    if (!this.data.isTeacher) return base;
    const key = this.myTeacherKey();
    if (!key || base.some(function (t) { return t.id === key; })) return base;
    return [{ id: key, name: (this.data.myName || '我') + '（自己）' }].concat(base);
  },
  /* ==================== ★ 已选老师快照（消除「每次进入闪一下弹层」） ====================
     云端是权威，但云端请求要几百毫秒；在这段空窗期，页面不能靠默认值 false
     去猜「还没选过老师」。所以：
       ① 本机按 openid 存一份「本人已选过」的快照，进页面第一帧就恢复成已选态
       ② teacherChecked 闸门：云端 board 判定回来之前，maybeAskTeacher 一律不弹
     两条一起上，选过老师的人永远不会再看到弹层；真正没选过的人照常弹。 */
  myOpenid: function () {
    const u = this._identityRaw || {};
    const g = (getApp() || {}).globalData || {};
    const gi = g.userInfo || {};
    return String(u._openid || u.openid || gi._openid || gi.openid || '');
  },
  /* ★ 约课小程序前端 userInfo 不一定带 _openid（它由云函数持有）。
     旧版 openid 为空就直接不认缓存，新号选完老师下次进页面又靠云端判定，
     遇上旧口径就会再弹。改用「身份键」：openid 优先，取不到用昵称+姓名。 */
  myWho: function () {
    const o = this.myOpenid();
    if (o) return o;
    const u = this._identityRaw || {};
    const n = String(u.nickName || u.name || this.data.myName || '').trim();
    return n ? 'name:' + n : '';
  },
  restorePickedCache: function () {
    const who = this.myWho();
    if (!who) return;
    try {
      const c = wx.getStorageSync(PICK_KEY);
      const key = c && (c.who || c.openid || '');   // 兼容 v9~v11 旧格式
      if (c && key === who && c.id) {
        this.setData({
          teacherPicked: true,
          myTeacherId: c.id,
          myTeacherName: c.name || ''
        });
      }
    } catch (e) {}
  },
  savePickedCache: function (id, name) {
    if (!id) return;
    try {
      wx.setStorageSync(PICK_KEY, {
        who: this.myWho(), openid: this.myOpenid(),
        id: String(id), name: name || ''
      });
    } catch (e) {}
  },
  clearPickedCache: function () {
    try { wx.removeStorageSync(PICK_KEY); } catch (e) {}
  },
  maybeAskTeacher: function () {
    // ★ 会话锁：bindTeacher 已成功返回过，「本人已选过老师」这件事
    //   本次会话就是事实，任何在途的旧 board / sync 响应都不能再把弹层拉起来。
    //   这是「选完又重新弹出」的直接止住点。
    if (this._pickConfirmed) return;
    // ★ 闸门：云端归属判定还没回来，绝不弹（这正是「先弹一下再收起」的根因）
    if (!this.data.teacherChecked) return;
    // 已本人点选过 → 不弹。teacherChecked 已保证这是云端权威结果，
    // 所以单看 teacherPicked 即可，不再额外要求 myTeacherId 非空（避免边缘误弹）。
    if (this.data.teacherPicked) return;
    if (this.data.teacherPickShow) return;          // 已经弹着
    if (this._teacherSkip) return;                  // 本次点了「稍后再选」
    const list = this.teacherPickList();
    this.setData({
      teacherPickShow: true, teachers: list,
      teacherErr: list.length ? '' : '未读取到老师名单，请在 index.js 的 fetchTeachers() 接入约课接口'
    });
  },
  openTeacherPicker: function () {
    // ★ 选完老师后本人不能再改（师生都一样），只能由老师在隐藏管理后台调整。
    //   没选过的人仍可首次选取，这是上榜的必要条件。
    if (this.data.teacherPicked && this.data.myTeacherId) {
      this.toast('已选定老师，如需更改请由老师在管理后台调整', '#ffd24a');
      return;
    }
    const list = this.teacherPickList();
    this.setData({ teacherPickShow: true, teachers: list,
      teacherErr: list.length ? '' : '未读取到老师名单，请检查约课接口' });
  },
  closeTeacherPicker: function () {
    this._teacherSkip = true;   // 本次会话不再反复弹，下次进页面再提醒
    this.setData({ teacherPickShow: false });
  },
  pickTeacher: function (e) {
    const id = String(e.currentTarget.dataset.id || '');
    const name = String(e.currentTarget.dataset.name || '');
    if (!id) return;
    const self = this;
    this.callFn({
      action: 'bindTeacher', teacherId: id, teacherName: name,
      name: this.data.myName || '微信用户', isTeacher: this.data.isTeacher
    }).then(function (j) {
      // ★ 云函数已确认写入 teacherPicked=true，先锁死本次会话
      self._pickConfirmed = true;
      self._teacherSkip = false;
      self.setData({
        teacherPickShow: false,
        teacherPicked: true,
        myTeacherId: j.teacherId || id, myTeacherName: j.teacherName || name
      });
      self.savePickedCache(j.teacherId || id, j.teacherName || name);
      self.toast('✅ 已选择老师：' + (j.teacherName || name) + ' · 已获得上榜资格', '#5ee0a0');
      return self.refreshBoard();
    }).catch(function (err) {
      self.setData({ teacherErr: err.message });
    });
  },

  /* ==================== 解锁额度 ==================== */
  applyCredits: function (j) {
    if (!j) return;
    const credits = Number(j.credits);
    const patch = {};
    if (Number.isFinite(credits)) {
      patch.myCredits = credits;
      patch.creditLeftText = '已发 ' + credits + ' 点 · 还可解锁 ' +
        Math.max(0, credits - this.litCount()) + ' 节';
      try { wx.setStorageSync(CRED_KEY, credits); } catch (e) {}
    }
    /* ★ 只有「本人主动点选过」才算已绑定。
       teacherId 非空也可能是系统默认归属 / 后台代改，那些仍要弹选老师。 */
    const picked = j.teacherPicked === true ||
                   (j.teacherPicked === undefined && !!j.teacherId); // 兼容旧云端
    if (picked && j.teacherId) {
      patch.teacherPicked = true;
      patch.myTeacherId = j.teacherId;
      patch.myTeacherName = j.teacherName || '';
      /* ★ 不再需要「先弹再收起」的补救：teacherChecked 闸门 + 本机快照
         保证选过的人根本不会弹。这里只兜底「用户手动开着弹层时云端确认已选」。 */
      if (this.data.teacherPickShow) patch.teacherPickShow = false;
    } else if (j.teacherPicked === false) {
      /* ★ 绝不因为一次 sync 响应把「已选过老师」打回 false。
         这个字段初始值本来就是 false，而晚到的旧响应 / 并发建档的旧快照
         会误报 false，正是「选完又弹」的帮凶之一。真被后台撤销了，
         下次进页面由 board 的最新结果处理。 */
      // 不覆盖 myTeacherId：可能只是后台代改的归属，仍显示在「我的老师」里
      if (j.teacherId) {
        patch.myTeacherId = j.teacherId;
        patch.myTeacherName = j.teacherName || '';
      }
    }
    this.setData(patch);
  },

  /* ==================== 管理技能点 / 管理后台 ==================== */
  openManage: function (tab) {
    // 既支持 openManage('admin')，也支持直接绑 bindtap（参数是事件对象）
    let t = (tab && typeof tab === 'object')
      ? ((tab.currentTarget && tab.currentTarget.dataset && tab.currentTarget.dataset.tab) || 'credits')
      : (tab || 'credits');
    if (!this.data.isTeacher) { this.toast('仅老师可进入管理', '#ff9fb0'); return; }
    this.setData({ manageShow: true, manageTab: t, manageLoading: true, stepN: 1 });
    if (t === 'admin') this.loadAdminList(); else this.loadManageList();
  },

  /* ★ 给自己加/减点：完全不依赖 manageList 有没有返回「我」那一行。
     不带 uid → 云函数按 openid 操作本人。这样即使列表加载失败、
     或云端还没建好老师记录，老师也一定能给自己加点。 */
  onSelfAdjust: function (e) {
    if (this.data.selfBusy) return;
    const sign = Number((e.currentTarget.dataset || {}).sign || 1);
    const n = this.data.stepN || 1;
    const delta = sign * n, self = this;
    this.setData({ selfBusy: true });
    wx.showLoading({ title: '处理中', mask: true });
    // 万一请求既不成功也不失败（弱网/超时），8 秒后强制解锁，避免按钮永久点不动
    clearTimeout(this._selfUnlock);
    this._selfUnlock = setTimeout(function () {
      if (self.data.selfBusy) { wx.hideLoading(); self.setData({ selfBusy: false }); }
    }, 8000);
    this.callFn({
      action: 'manageCredits', delta: delta,
      isTeacher: true, teacherKey: this.myTeacherKey(), name: this.data.myName
      // 故意不带 uid：按 openid 操作本人
    }).then(function (j) {
      wx.hideLoading(); clearTimeout(self._selfUnlock);
      self.setData({ selfBusy: false });
      self.applyCredits({ credits: j.credits });
      self.toast((delta > 0 ? '✅ 给自己发放 ' : '↩ 给自己收回 ') + n + ' 点（当前额度 ' + j.credits + '）',
                 delta > 0 ? '#5ee0a0' : '#ffc98a');
      self.loadManageList();
      self.refreshBoard();
    }).catch(function (err) {
      wx.hideLoading(); clearTimeout(self._selfUnlock);
      self.setData({ selfBusy: false });
      self.toast(cloudHint(err.message), '#ff9fb0');
    });
  },
  closeManage: function () {
    this.setData({ manageShow: false, adminPickShow: false });
  },
  switchManageTab: function (e) {
    const t = e.currentTarget.dataset.tab;
    if (!t || t === this.data.manageTab) return;
    this.setData({ manageTab: t, manageLoading: true });
    if (t === 'admin') this.loadAdminList(); else this.loadManageList();
  },
  loadManageList: function () {
    const self = this;
    this.callFn({ action: 'manageList', teacherKey: this.myTeacherKey(),
                  isTeacher: this.data.isTeacher, myName: this.data.myName })
      .then(function (j) {
        const list = (j.list || []).map(function (x) {
          return Object.assign({}, x, {
            left: Math.max(0, (Number(x.credits) || 0) - (Number(x.score) || 0))
          });
        });
        /* ★ 「我」必须在列表里，老师才能给自己 +/- 加点。
           云端正常会返回自己；万一老师记录还没建好，前端补一行占位，
           uid 用 '__me__'，加点时不传 uid，由云函数认 openid 操作本人。 */
        if (!list.some(function (x) { return x.me; })) {
          list.unshift({
            uid: '__me__', name: self.data.myName || '我',
            score: self.litCount(), credits: Number(self.data.myCredits) || 0,
            left: Math.max(0, (Number(self.data.myCredits) || 0) - self.litCount()),
            isTeacher: true, me: true
          });
        }
        self.setData({ manageList: list, manageLoading: false });
      })
      .catch(function (err) {
        // 即使云端没连通，也保留「我」这一行，老师不会面对一个空列表
        self.setData({
          manageLoading: false,
          manageList: [{
            uid: '__me__', name: self.data.myName || '我',
            score: self.litCount(), credits: Number(self.data.myCredits) || 0,
            left: Math.max(0, (Number(self.data.myCredits) || 0) - self.litCount()),
            isTeacher: true, me: true
          }]
        });
        self.toast(cloudHint(err.message), '#ff9fb0');
      });
  },
  /* ★ 后台名单：云端只返回「符合上榜条件」的人（与榜单同规则）。
     搜索在前端即时做，不每次输入都请求云端：一次拉全量存 _adminRaw，
     之后按名字 / 老师名模糊过滤，输入即出结果、离线也能搜。 */
  loadAdminList: function () {
    const self = this;
    this.callFn({ action: 'adminList', isTeacher: this.data.isTeacher })
      .then(function (j) {
        self._adminRaw = j.list || [];
        self.setData({ manageLoading: false });
        self.applyAdminSearch();
      })
      .catch(function (err) {
        self._adminRaw = [];
        self.setData({ manageLoading: false, adminList: [], adminTotal: 0, adminMatched: 0 });
        self.toast(err.message, '#ff9fb0');
      });
  },
  applyAdminSearch: function (kw) {
    const raw = this._adminRaw || [];
    const q = String(kw === undefined ? (this.data.adminSearch || '') : kw)
      .trim().toLowerCase();
    const list = q ? raw.filter(function (p) {
      return String(p.name || '').toLowerCase().indexOf(q) >= 0 ||
             String(p.teacherName || '').toLowerCase().indexOf(q) >= 0;
    }) : raw.slice();
    this.setData({ adminList: list, adminTotal: raw.length, adminMatched: list.length });
  },
  onAdminSearch: function (e) {
    const v = String((e.detail && e.detail.value) || '');
    this.setData({ adminSearch: v });
    this.applyAdminSearch(v);
  },
  clearAdminSearch: function () {
    this.setData({ adminSearch: '' });
    this.applyAdminSearch('');
  },
  onStepMinus: function () { this.setData({ stepN: Math.max(1, (this.data.stepN || 1) - 1) }); },
  onStepPlus:  function () {
    const cap = this.data.courseTotal || ALL.length;   // 上限 = 课程数量之和
    this.setData({ stepN: Math.min(cap, (this.data.stepN || 1) + 1) });
  },
  /* 每行 [−] / [＋]：按顶部 stepper 设定的 N 收回 / 发放 */
  onCreditAdjust: function (e) {
    const uid = String(e.currentTarget.dataset.uid || '');
    const sign = Number(e.currentTarget.dataset.sign || 1);
    const n = this.data.stepN || 1;
    if (!uid) return;
    const self = this, delta = sign * n;
    wx.showLoading({ title: '处理中', mask: true });
    // '__me__' 是前端补的占位行，不带 uid，云函数按 openid 操作本人（给自己加点）
    const payload = { action: 'manageCredits', delta: delta,
                      teacherKey: this.myTeacherKey(), isTeacher: this.data.isTeacher };
    if (uid !== '__me__') payload.uid = uid;
    this.callFn(payload)
      .then(function (j) {
        wx.hideLoading();
        self.applyCredits({ credits: j.credits });   // 给自己加点后立刻更新顶部额度
        self.toast((delta > 0 ? '✅ 已发放 ' : '↩ 已收回 ') + n + ' 点（当前额度 ' + j.credits + '）',
                   delta > 0 ? '#5ee0a0' : '#ffc98a');
        self.loadManageList();
        self.refreshBoard();
      })
      .catch(function (err) { wx.hideLoading(); self.toast(cloudHint(err.message), '#ff9fb0'); });
  },
  /* ★ 管理后台：给「所有人」加减技能点（不受归属限制）。
     云端 manageCredits(admin=true) 仍会校验有效微信用户档案与课程数上限。 */
  onAdminCreditAdjust: function (e) {
    if (!this.data.isTeacher) { this.toast('仅老师可进入管理后台', '#ff9fb0'); return; }
    const uid = String(e.currentTarget.dataset.uid || '');
    const sign = Number(e.currentTarget.dataset.sign || 1);
    const n = this.data.stepN || 1;
    if (!uid) return;
    const self = this, delta = sign * n;
    wx.showLoading({ title: '处理中', mask: true });
    this.callFn({
      action: 'manageCredits', admin: true, delta: delta, uid: uid,
      name: this.data.myName || '',
      teacherKey: this.myTeacherKey(), isTeacher: true
    }).then(function (j) {
      wx.hideLoading();
      // 就地刷新这一行（原始全量 + 当前过滤结果都改），不整表重载、不跳滚动、
      // 也不会因为正在搜索而把改动丢掉
      const raw = self._adminRaw || [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i].uid === uid) {
          raw[i].credits = j.credits;
          raw[i].score = j.score;
          raw[i].left = Math.max(0, Number(j.credits) - Number(j.score));
          raw[i].virtual = false;
          break;
        }
      }
      self.applyAdminSearch();
      self.toast((delta > 0 ? '✅ 已发放 ' : '↩ 已收回 ') + n + ' 点（当前额度 ' + j.credits + '）',
                 delta > 0 ? '#5ee0a0' : '#ffc98a');
      if (j.me) self.applyCredits({ credits: j.credits });   // 若操作的是自己
    }).catch(function (err) {
      wx.hideLoading(); self.toast(cloudHint(err.message), '#ff9fb0');
    });
  },

  /* 后台：统一改归属 */
  openAdminPick: function (e) {
    this.setData({
      adminPickShow: true,
      adminPickUid: String(e.currentTarget.dataset.uid || ''),
      adminPickName: String(e.currentTarget.dataset.name || ''),
      teachers: this._teachers || []
    });
  },
  closeAdminPick: function () { this.setData({ adminPickShow: false }); },
  pickAdminTeacher: function (e) {
    this.doSetTeacher(String(e.currentTarget.dataset.id || ''), String(e.currentTarget.dataset.name || ''));
  },
  clearAdminTeacher: function () { this.doSetTeacher('', ''); },
  doSetTeacher: function (tid, tname) {
    const self = this, uid = this.data.adminPickUid;
    if (!uid) return;
    this.callFn({ action: 'adminSetTeacher', uid: uid, teacherId: tid, teacherName: tname,
                  isTeacher: this.data.isTeacher })
      .then(function () {
        self.setData({ adminPickShow: false });
        self.toast(tid ? '✅ 归属已改为「' + tname + '」' : '已移出归属', '#5ee0a0');
        self.loadAdminList();
      })
      .catch(function (err) { self.toast(err.message, '#ff9fb0'); });
  },

  /* ---------- 管理后台入口 ----------
     ★ 页面最下方是不可见但可点的透明热区（wx:if="{{isTeacher}}"）。
       学生连热区都不渲染；这里再做一层身份判断，云端 adminList / adminSetTeacher
       也会二次校验 isTeacher，三层都不会被学生绕过。 */
  openAdmin: function () {
    if (!this.data.isTeacher) { this.toast('仅老师可进入管理后台', '#ff9fb0'); return; }
    this.openManage('admin');
  },

  /* ==================== ★ 课程点亮进度：云端为主，本机仅缓存 ====================
     云集合 ksst_progress：一个 openid 一条完整明细。
     本机 LS_KEY 只负责「秒开渲染」和「断网时继续用」，不再是数据源。
     流程：
       onLoad → loadStore(本机缓存) 立刻渲染 → pullCloudProgress() 拉云端
         ├ 云端有记录 → 覆盖本机、re-render，_cloudRev = 版本号
         └ 云端无记录 → 把本机明细上传一次（老用户迁移，分数不丢）
       每次点亮/撤销/清空 → saveStore() 写本机缓存 + pushCloudProgress() 防抖上云
       另一台设备先改过 → 云端返回 conflict + 最新进度 → 覆盖本机并提示
     断网 → 标记「待同步」，联网后 onShow / 下次操作自动补推。 */
  emptyStore: function () {
    return { lit: {}, picks: {}, major: {}, exams: {}, everLit: {} };
  },
  normalizeStore: function (p) {
    const s = this.emptyStore(), keys = ['lit', 'picks', 'major', 'exams', 'everLit'];
    if (!p || typeof p !== 'object') return s;
    keys.forEach(function (k) {
      const v = p[k];
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (id) { if (v[id]) s[k][String(id)] = true; });
    });
    Object.keys(s.lit).forEach(function (id) { s.everLit[id] = true; });
    return s;
  },
  cloneStore: function () {
    const s = this.emptyStore(), src = this.store || {}, keys = ['lit', 'picks', 'major', 'exams', 'everLit'];
    keys.forEach(function (k) {
      const v = src[k] || {};
      Object.keys(v).forEach(function (id) { if (v[id]) s[k][id] = true; });
    });
    return s;
  },
  loadStore: function () {
    const s = this.emptyStore();
    try {
      const raw = wx.getStorageSync(LS_KEY);
      if (raw) {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const n = this.normalizeStore(p);
        keys_copy(s, n);
      }
    } catch (e) {}
    return s;

    function keys_copy(dst, src) {
      ['lit', 'picks', 'major', 'exams', 'everLit'].forEach(function (k) { dst[k] = src[k]; });
    }
  },
  /* 写本机缓存（离线可用）+ 推云端。
     ★ _progressReady 为 false 时只写缓存、不推云端：防止 onLoad 阶段的
       本机旧数据把云端较新的进度覆盖掉。 */
  saveStore: function (s) {
    const store = s || this.store;
    try { wx.setStorageSync(LS_KEY, store); } catch (e) {}
    // 正好在拉云端时用户又点了一下：拉回后不要用旧快照覆盖这次改动
    if (this._pulling) this._dirtyDuringPull = true;
    if (this._progressReady === true) this.pushCloudProgress();
  },
  pullCloudProgress: function (silent) {
    const self = this;
    this._pulling = true;
    this._dirtyDuringPull = false;
    if (!silent) {
      // 首次进入：拉回前锁住改动，避免本机旧数据覆盖云端
      this.setData({ progressReady: false, progressSyncText: '☁ 正在读取云端进度…' });
      this._progressReady = false;
    }
    const finish = function () { self._pulling = false; };
    this.callFn({ action: 'loadProgress' }).then(function (j) {
      if (j.exists && j.progress) {
        if (self._dirtyDuringPull) {
          // 拉取期间用户又点亮/撤销了：不能用云端旧快照盖掉，改为把本地推上去
          finish();
          self._cloudRev = Number(j.rev) || 0;
          self._progressReady = true;
          self.setData({ progressReady: true });
          self.pushCloudProgress(true);
          return;
        }
        // 云端为准：覆盖本机缓存，换手机 / 重装小程序进度完整回来
        self.store = self.normalizeStore(j.progress);
        try { wx.setStorageSync(LS_KEY, self.store); } catch (e) {}
        self._cloudRev = Number(j.rev) || 0;
        self._progressReady = true;
        self.setData({
          progressReady: true, progressOffline: false,
          progressSyncText: '☁ 进度已存云端 · 换设备不丢失'
        });
        finish();
        self.render();
        self.syncScore();
        self.refreshBoard();
      } else {
        // 第一次进新版：把本机明细上传一次做迁移，老用户分数不丢
        finish();
        self._cloudRev = 0;
        self._progressReady = true;
        self.setData({ progressReady: true });
        self.pushCloudProgress(true);
      }
    }).catch(function (err) {
      // 断网 / 集合没建：本机缓存继续可用，改动排队，联网后自动补推
      finish();
      const msg = String((err && err.message) || '');
      const noColl = msg.indexOf('Db or Table not exist') >= 0 ||
                     msg.indexOf('collection not exists') >= 0 ||
                     msg.indexOf('ksst_progress') >= 0 ||
                     msg.indexOf('未知操作') >= 0;   // 云函数还是旧版
      self._progressReady = true;
      self.setData({
        progressReady: true, progressOffline: true,
        progressSyncText: noColl
          ? '⚠ 云端未就绪：请新建集合 ksst_progress 并重传 v10 云函数（本机进度仍可用）'
          : '⚠ 离线：进度暂存本机，联网后自动同步'
      });
    });
  },
  pushCloudProgress: function (immediate) {
    const self = this;
    const doPush = function () {
      self._pushTimer = null;
      if (!self._progressReady) return;
      const payload = {
        action: 'saveProgress',
        progress: self.cloneStore(),
        total: ALL.length,
        baseRev: Number(self._cloudRev) || 0,
        name: self.data.myName || '',
        isTeacher: self.data.isTeacher
      };
      self.callFn(payload).then(function (j) {
        self._cloudRev = Number(j.rev) || 0;
        self.setData({
          progressOffline: false,
          progressSyncText: '☁ 进度已存云端 · 换设备不丢失'
        });
        if (j.score !== undefined) self.refreshBoard();
      }).catch(function (err) {
        const c = err && err.cloud;
        if (c && c.conflict && c.progress) {
          // 另一台设备先改过：以云端最新为准，不互相覆盖
          self.store = self.normalizeStore(c.progress);
          try { wx.setStorageSync(LS_KEY, self.store); } catch (e) {}
          self._cloudRev = Number(c.rev) || 0;
          self.setData({
            progressOffline: false,
            progressSyncText: '☁ 已同步另一台设备的最新进度'
          });
          self.render(); self.syncScore(); self.refreshBoard();
          self.toast('已同步另一台设备的进度', '#8fb6ff');
        } else {
          const msg = String((err && err.message) || '');
          const noColl = msg.indexOf('Db or Table not exist') >= 0 ||
                         msg.indexOf('ksst_progress') >= 0 ||
                         msg.indexOf('未知操作') >= 0;
          self.setData({
            progressOffline: true,
            progressSyncText: noColl
              ? '⚠ 云端未就绪：请新建集合 ksst_progress 并重传 v10 云函数'
              : '⚠ 待同步：进度已存本机，联网后自动上传'
          });
        }
      });
    };
    if (this._pushTimer) { clearTimeout(this._pushTimer); this._pushTimer = null; }
    if (immediate) doPush();
    else this._pushTimer = setTimeout(doPush, 220);
  },
  flushProgressPush: function () {
    if (this._pushTimer) {
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
      if (this._progressReady) this.pushCloudProgress(true);
    }
  },
  /* 点状态条手动重拉：先把本机待同步的改动推上去，再拉云端，
     避免离线时的点亮被云端旧记录覆盖 */
  onCloudBarTap: function () {
    const pending = !!this._pushTimer;
    if (pending) this.flushProgressPush();
    const self = this;
    setTimeout(function () { self.pullCloudProgress(); }, pending ? 450 : 0);
  },
  isLit:  function (id) { return !!this.store.lit[id]; },
  litCount: function () {
    const lit = this.store.lit;
    return Object.keys(lit).filter(function (k) { return lit[k]; }).length;
  },
  pickCount: function () {
    const p = this.store.picks;
    return Object.keys(p).filter(function (k) { return p[k]; }).length;
  },
  majorCount: function () {
    const m = this.store.major;
    return Object.keys(m).filter(function (k) { return m[k]; }).length;
  },
  byId: function (id) {
    for (let i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i];
    return null;
  },

  /* ==================== 解锁判定（复刻网页版） ==================== */
  canUnlockK2: function () { return this.pickCount() >= 3; },
  canUnlockK3: function () { return this.majorCount() >= 1; },
  depsDone: function (id) {
    if (id === 'k2exam') return this.canUnlockK2();
    if (id === 'k3exam') return this.canUnlockK3();
    const n = this.byId(id);
    if (!n || !n.pre) return true;
    for (let i = 0; i < n.pre.length; i++) {
      const p = n.pre[i];
      if (p === 'major_chosen') { if (this.majorCount() < 1) return false; continue; }
      if (!this.isLit(p)) return false;
    }
    return true;
  },
  childrenOf: function (id) {
    if (!id) return [];
    const out = [], self = this;
    ALL.forEach(function (n) {
      if (!n || n.id === id || !n.pre || !n.pre.length) return;
      if (n.pre.indexOf(id) >= 0 && self.isLit(n.id)) out.push(n);
    });
    return out;
  },
  canUndo: function (id) {
    return !!id && this.isLit(id) && this.childrenOf(id).length === 0;
  },
  status: function (id) {
    if (!this.byId(id)) return 'locked';
    if (this.isLit(id)) return 'lit';
    if (!this.depsDone(id)) return 'locked';
    return 'ready';
  },
  lockHint: function (n) {
    const self = this;
    if (this.isLit(n.id)) return '';
    if (n.id === 'k2exam' && !this.canUnlockK2())
      return '🔒 已选 ' + this.pickCount() + '/3 种风格，选满 3 种选学唱法即可解锁中级考核';
    if (n.id === 'k3exam' && !this.canUnlockK3())
      return '🔒 先在高级专攻里选定一条线（已选 ' + this.majorCount() + '/1 种）';
    if (n.pre && n.pre.indexOf('major_chosen') >= 0)
      return '🔒 先在三选一专攻里选定一条线';
    if (n.pick && this.pickCount() >= 3)
      return '✅ 已选 ' + this.pickCount() + '/3 种（基本要求 3 种，多学也可）';
    if (n.major && this.majorCount() >= 1)
      return '✅ 已选 ' + this.majorCount() + '/1 种（基本要求 1 种，多学也可）';
    if (n.pre && n.pre.length) {
      const names = [];
      n.pre.forEach(function (p) {
        const x = self.byId(p);
        if (x && !self.isLit(p)) names.push(x.n);
      });
      return names.length ? ('🔒 先点亮：' + names.join('、')) : '';
    }
    return '';
  },

  /* ==================== 渲染 ==================== */
  prepNode: function (n) {
    const st = this.status(n.id), col = n.col, self = this;
    let cls = 'node';
    if (st === 'locked') cls += ' st-locked';
    if (st === 'ready')  cls += ' st-ready';
    if (st === 'lit')    cls += ' glow';
    if (n.ultra) cls += ' ultra';
    if (n.boss)  cls += ' boss';

    let badge = '', badgeType = '';
    if (n.boss)        { badge = '🏆 考核'; badgeType = 'boss'; }
    else if (n.ultra)  { badge = '💎 隐藏'; badgeType = 'ultra'; }
    else if (n.major)  { badge = '★ 专攻 ' + this.majorCount() + '/1 种'; badgeType = 'major'; }
    else if (n.pick)   { badge = '★ 选学 ' + this.pickCount() + '/3'; badgeType = 'pick'; }

    let btn;
    if (st === 'lit') {
      if (this.canUndo(n.id)) btn = { text: '✓ 已点亮', act: 'undo', cls: 'done', style: '' };
      else btn = { text: '🔒 有 ' + this.childrenOf(n.id).length + ' 门后置课程，先撤销它们', act: '', cls: 'off', style: '' };
    } else if (st === 'ready') {
      btn = { text: '点亮技能点', act: 'light', cls: 'on', style: 'background:' + col };
    } else {
      btn = { text: '未解锁', act: '', cls: 'off', style: '' };
    }

    let nodeStyle = '';
    if (st === 'lit') nodeStyle = 'border-color:' + col;
    else if (st === 'ready') nodeStyle = 'border-color:' + rgba(col, .45);

    const ri = ratioInfo(n.ratio);
    return {
      id: n.id, n: n.n, one: n.one, reg: n.reg, col: col, cls: cls, nodeStyle: nodeStyle,
      badge: badge, badgeType: badgeType, lock: this.lockHint(n),
      hasRatio: ri.hasRatio, ratioA: ri.ratioA, ratioB: ri.ratioB, ratioText: ri.ratioText,
      btnText: btn.text, btnAct: btn.act, btnCls: btn.cls, btnStyle: btn.style
    };
  },
  render: function () {
    const self = this, filter = this.data.filter;
    const branches = BRANCHES.filter(function (b) {
      return filter === 'all' || filter === b.id;
    }).map(function (b) {
      const nodes = b.nodes.map(function (n) { return self.prepNode(n); });
      const lit = b.nodes.filter(function (n) { return self.isLit(n.id); }).length;
      const c = b.nodes[0].col;
      return {
        id: b.id, icon: b.icon, t: b.t, sub: b.sub, nodes: nodes,
        lit: lit, total: b.nodes.length, pct: Math.round(lit / b.nodes.length * 100),
        c: c, cA16: rgba(c, .16), cA35: rgba(c, .35)
      };
    });
    const ln = this.litCount();
    const exam = ['k1exam', 'k2exam', 'k3exam'].filter(function (k) { return self.isLit(k); }).length;
    this.setData({
      visibleBranches: branches,
      statTotal: ALL.length, statLit: ln, statExam: exam + '/3',
      prog: Math.round(ln / ALL.length * 100)
    });
  },

  /* ==================== 顶部交互 ==================== */
  onFilter: function (e) {
    this.setData({ filter: e.currentTarget.dataset.k }, this.render.bind(this));
  },
  onCardTap: function (e) {
    this.openDetail(e.currentTarget.dataset.id);
  },
  onNodeAct: function (e) {
    const act = e.currentTarget.dataset.act, id = e.currentTarget.dataset.id;
    if (!act) return;
    if (act === 'light') this.light(id);
    else if (act === 'undo') this.undo(id);
  },
  noop: function () {},

  /* ==================== 详情浮层 ==================== */
  openDetail: function (id) {
    const n = this.byId(id); if (!n) return;
    const st = this.status(id), col = n.col, ri = ratioInfo(n.ratio);
    let btn, extra = null;
    if (st === 'lit') {
      if (this.canUndo(id)) {
        btn = { text: '撤销点亮', act: 'undo', cls: 'sec', style: '' };
        if (n.pick) extra = { text: '取消选学', act: 'unpick' };
      } else {
        btn = { text: '🔒 有 ' + this.childrenOf(id).length + ' 门后置课程，需先撤销', act: '', cls: 'off', style: '' };
      }
    } else if (st === 'ready') {
      btn = { text: n.boss ? '🏆 确认通关考核' : '点亮这个技能点', act: 'light', cls: '', style: 'background:' + col };
    } else {
      btn = { text: this.lockHint(n) || '先解锁前置', act: '', cls: 'off', style: '' };
    }
    const d = {
      id: id, n: n.n, one: n.one, doe: n.doe, unlock: n.unlock, reg: n.reg,
      icon: n.ultra ? '💎' : n.boss ? '🏆' : n.major ? '👑' : '🎵',
      col: col, colA18: rgba(col, .18), colA35: rgba(col, .35),
      hasRatio: ri.hasRatio, ratioA: ri.ratioA, ratioB: ri.ratioB, ratioText: ri.ratioText,
      ana: n.ana || [], lock: this.lockHint(n),
      btnText: btn.text, btnAct: btn.act, btnCls: btn.cls, btnStyle: btn.style,
      extraBtn: extra
    };
    this._dScrollTop = 0;
    this.setData({
      d: d, detailShow: true, detailDragging: false, detailDragStyle: '',
      // 0 / 0.01 交替，确保 scroll-view 真的回到顶部
      detailScrollTop: this.data.detailScrollTop === 0 ? 0.01 : 0
    });
  },
  closeDetail: function () {
    this.setData({ detailShow: false, detailDragging: false, detailDragStyle: '' });
  },
  onDetailAct: function (e) {
    const act = e.currentTarget.dataset.act, id = this.data.d && this.data.d.id;
    if (!act || !id) return;
    if (act === 'light') this.light(id);
    else if (act === 'undo') this.undo(id);
    else if (act === 'unpick') this.unpick(id);
  },
  onDetailScroll: function (e) { this._dScrollTop = e.detail.scrollTop || 0; },

  /* ---------- 往下滑退出详情（内容滚到顶后才接管） ---------- */
  onDTouchStart: function (e) {
    if (!this.data.detailShow || !e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    this._touch = { y: t.clientY, x: t.clientX, time: Date.now(), active: false, rejected: false, baseY: t.clientY };
    this._dragDist = 0;
  },
  onDTouchMove: function (e) {
    const s = this._touch;
    if (!s || s.rejected || !this.data.detailShow || !e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const dy = t.clientY - s.y, dx = t.clientX - s.x;
    if (!s.active) {
      if (Math.abs(dy) < 5 && Math.abs(dx) < 5) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { s.rejected = true; return; }
      if (this._dScrollTop > 0) return;   // 内容还没滚到顶，先让它正常滚
      s.active = true;
      s.baseY = t.clientY;
      this.setData({ detailDragging: true });
    }
    const dist = Math.max(0, t.clientY - s.baseY);
    if (Math.abs(dist - this._dragDist) < 2) return;
    this._dragDist = dist;
    this.setData({ detailDragStyle: 'transform:translateY(' + dist + 'px)' });
  },
  onDTouchEnd: function () {
    const s = this._touch;
    this._touch = null;
    if (!s || !s.active) return;
    const dist = this._dragDist;
    const speed = dist / Math.max(1, Date.now() - s.time);
    const shouldClose = dist > 100 || (dist >= 40 && speed > 0.4);
    this._dragDist = 0;
    // 先恢复过渡，再清内联 transform：关闭时滑出、回弹时平滑归位
    this.setData({ detailDragging: false, detailDragStyle: '' });
    if (shouldClose) this.closeDetail();
  },

  /* ==================== 点亮 / 撤销 / 清空 ==================== */
  /* 云端进度还没拉回来时禁止改动：否则本机旧数据会把云端较新的进度覆盖掉 */
  guardProgress: function () {
    if (this.data.progressReady && this._progressReady) return true;
    this.toast('☁ 正在读取云端进度，稍候再操作', '#ffd24a');
    return false;
  },
  light: function (id) {
    if (!this.guardProgress()) return;
    if (this.status(id) !== 'ready') return;
    // 解锁额度：score(当前点亮数) 必须 < credits(老师发放总量)
    // 撤销 / 清空后 score 变小，额度自动恢复，不用额外退还
    if (this.litCount() >= (Number(this.data.myCredits) || 0)) {
      this.toast('🔒 解锁额度不足，请找老师发放技能点', '#ff9fb0');
      return;
    }
    // 曾点亮过（撤销后重学）→ 免答题直接点亮；只有「清空进度」会抹掉记录
    if (this.store.everLit[id]) { this.doLight(id, true); return; }
    const q = QUIZ[id];
    if (q && !q.pending && q.levels && q.levels.length) { this.openQuiz(id); return; }
    this.doLight(id, false);
    if (q && q.pending) this.toast('📝 该课程暂无正式题库，已直接激活', '#c9a5ff');
  },
  doLight: function (id, free) {
    const n = this.byId(id);
    if (this.status(id) !== 'ready' && !this.store.lit[id]) return;
    if (n.pick) {
      if (this.store.picks[id]) return;
      if (this.pickCount() >= 3) this.toast('基本要求 3 种，多学也可，继续冲 ✨', '#ffb454');
      this.store.picks[id] = true;
    }
    if (n.major) {
      this.store.major[n.major] = true;
      this.toast('已选择「' + labelOf(n.major) + '」专攻（' + this.majorCount() + '/1 种）', '#ff5d7a');
    }
    this.store.lit[id] = true;
    this.store.everLit[id] = true;
    if (n.boss) this.store.exams[id] = true;
    this.saveStore();
    this.render();
    this.syncScore();
    this.afterStateChange();
    this.toast(free ? '📖 已通过考核，直接点亮「' + n.n + '」' : '✨ 点亮「' + n.n + '」', n.col);
    if (n.boss) this.toast('🏆 「' + n.n + '」通关！进入下一阶段', '#ffd24a');
    if (id === 'k3exam') this.toast('💎 「高级考核 · 毕业演出」通关！', '#ffd24a');
  },
  afterStateChange: function () {
    // 小程序里详情是浮层：状态变更后一律收起，绝不自动弹出下一个课程
    this.closeDetail();
  },
  undo: function (id) {
    if (!this.guardProgress()) return;
    const n = this.byId(id);
    this.store.lit[id] = false;
    if (n.boss) this.store.exams[id] = false;
    if (id === 'k3exam') {
      BRANCHES[BRANCHES.length - 1].nodes.forEach((u) => { this.store.lit[u.id] = false; });
    }
    if (n.major) {
      BRANCHES[3].nodes.forEach((x) => {
        if (x.major === n.major || x.id === 'p_elective') this.store.lit[x.id] = false;
      });
      this.store.major[n.major] = false;
    }
    if (n.pick) this.store.picks[id] = false;
    this.saveStore(); this.render(); this.syncScore(); this.afterStateChange();
    this.toast('已撤销「' + n.n + '」', '#8892b0');
  },
  unpick: function (id) {
    if (!this.guardProgress()) return;
    this.store.picks[id] = false;
    this.store.lit[id] = false;
    this.saveStore(); this.render(); this.syncScore(); this.afterStateChange();
    this.toast('已取消选学', '#8892b0');
  },
  openConfirm: function () { this.setData({ confirmShow: true }); },
  closeConfirm: function () { this.setData({ confirmShow: false }); },
  doReset: function () {
    if (!this.guardProgress()) return;
    this.closeConfirm();
    this.store = this.emptyStore();
    this.saveStore(); this.render(); this.syncScore();
    // 清空是破坏性操作，不等防抖，立刻写云端
    this.flushProgressPush();
    this.closeDetail();
    this.setData({ d: null });
    this.toast('进度已清空，重新出发 🌱', '#8892b0');
  },

  /* ==================== 三关答题 ==================== */
  clearQuizTimers: function () { clearTimeout(this.qTimer); this.qTimer = null; },
  openQuiz: function (id) {
    const n = this.byId(id), col = n.col;
    this.qs = { id: id, level: 0, correct: 0, locked: false, done: false, pending: false };
    this.setData({
      quizShow: true, quizCol: col, quizColA12: rgba(col, .12), quizColA40: rgba(col, .4),
      quizPending: false, quizFeedback: '', quizLocked: false
    });
    this.renderLevel(0, n);
  },
  renderLevel: function (level, n) {
    const id = this.qs.id, q = QUIZ[id];
    n = n || this.byId(id);
    const lv = q.levels[level];
    this.qs.level = level;
    this.qs.correct = lv.ans;
    this.qs.locked = false;
    const opts = lv.opts.map(function (text, i) {
      return { k: i, key: 'ABCD'[i], text: text, cls: '' };
    });
    this.setData({
      quizTag: '知识问答 · ' + n.n + '（' + (level + 1) + '/' + q.levels.length + '）',
      quizTitle: n.n,
      quizLabel: '【' + lv.label + '】',
      quizStem: lv.q,
      quizOpts: opts, quizFeedback: '', quizFeedbackType: '',
      quizPending: false, quizLocked: false
    });
  },
  onOptTap: function (e) {
    const s = this.qs;
    if (!s || s.locked || s.done) return;
    const idx = +e.currentTarget.dataset.idx;
    const self = this;

    // pending 节点：点任意一项直接点亮
    if (s.pending) {
      s.locked = true;
      this.setData({ quizFeedback: '📝 暂无正式题库，已直接激活', quizFeedbackType: 'ok' });
      this.clearQuizTimers();
      this.qTimer = setTimeout(function () { self.finishQuiz(); }, 500);
      return;
    }

    const q = QUIZ[s.id], lv = q.levels[s.level], isLast = s.level === q.levels.length - 1;
    const opts = this.data.quizOpts.slice();
    s.locked = true;

    if (idx === s.correct) {
      opts[idx].cls = 'right';
      const msg = isLast ? '✅ 第三关正确！三关全部答对，正在点亮…'
                         : '✅ 第 ' + (s.level + 1) + ' 关正确，进入下一关';
      this.setData({ quizOpts: opts, quizFeedback: msg, quizFeedbackType: 'ok', quizLocked: true });
      this.clearQuizTimers();
      this.qTimer = setTimeout(function () {
        if (isLast) self.finishQuiz();
        else self.renderLevel(s.level + 1, null);
      }, isLast ? 950 : 800);
    } else {
      opts[idx].cls = 'wrong';
      opts[s.correct].cls = 'right';
      const msg = '❌ 回答错误，正确答案是 ' + 'ABCD'[s.correct] + '．' +
                  lv.opts[s.correct] + '，5 秒后可重新作答';
      this.setData({ quizOpts: opts, quizFeedback: msg, quizFeedbackType: 'no', quizLocked: true });
      this.clearQuizTimers();
      this.qTimer = setTimeout(function () {
        const clean = self.data.quizOpts.map(function (o) { return Object.assign({}, o, { cls: '' }); });
        self.setData({ quizOpts: clean, quizFeedback: '', quizLocked: false });
        if (self.qs) self.qs.locked = false;
      }, 5000);
    }
  },
  finishQuiz: function () {
    const id = this.qs && this.qs.id;
    if (!id) return;
    if (this.qs) this.qs.done = true;
    this.clearQuizTimers();
    this.closeQuiz();
    this.doLight(id, false);
  },
  closeQuiz: function () {
    this.clearQuizTimers();
    this.qs = null;
    this.setData({ quizShow: false, quizFeedback: '', quizLocked: false });
  },

  /* ==================== 改名 ==================== */
  openName: function () {
    /* ★ 榜单昵称 = users 表里的 nickName（「我的 → 个人信息」页的「昵称」栏，
       不是「姓名」栏）。这里直接跳到真实改名页，单一数据源，
       避免 tree 页另存一份名字、下次 my 页 onShow 重新拉取时又被覆盖。
       改完返回本页，onShow → loadIdentity → syncScore 会自动把新昵称推到榜单。 */
    wx.navigateTo({ url: '/packageA/myUserInfo/index' });
  },
  closeName: function () { this.setData({ nameShow: false }); },
  onNameInput: function (e) { this.setData({ nameInput: e.detail.value, nameErr: '' }); },
  saveName: function () {
    const v = String(this.data.nameInput || '').trim();
    if (v.length < 2 || v.length > 16) { this.setData({ nameErr: '昵称需 2–16 个字' }); return; }
    try { wx.setStorageSync(NAME_KEY, v); } catch (e) {}
    this.syncNameToMyPage(v);
    this.setData({ nameShow: false, myName: v, nameErr: '' });
    this.toast('✅ 榜单昵称已更新', '#ffd24a');
    this.syncScore();   // 立刻把新名字推到云端，榜单名字跟着变
  },
  /* ★ 把新昵称写回「我的」页面读取的位置。
     昵称是权威字段（nickName），姓名 name 保持不动，避免把真实姓名覆盖掉。
     若你的 my.js 用的是别的 key，改这里即可。 */
  syncNameToMyPage: function (v) {
    try {
      const app = getApp() || {};
      if (app.globalData) {
        if (!app.globalData.userInfo) app.globalData.userInfo = {};
        app.globalData.userInfo.nickName = v;
        app.globalData.nickName = v;
      }
      let cached = {};
      try { cached = wx.getStorageSync('userInfo') || {}; } catch (e) {}
      cached.nickName = v;
      wx.setStorageSync('userInfo', cached);
      wx.setStorageSync('nickName', v);
    } catch (e) {}
  },

  /* ==================== 云端榜单（微信云开发） ==================== */
  /* openid 由云函数从 cloud.getWXContext() 取，前端拿不到也伪造不了 */
  callFn: function (data) {
    if (!wx.cloud) return Promise.reject(new Error('未初始化云开发'));
    return wx.cloud.callFunction({ name: FN, data: data }).then(function (r) {
      const j = r && r.result;
      if (!j || !j.ok) {
        const er = new Error((j && j.msg) || '云端返回异常');
        er.cloud = j;          // 进度冲突时要用云端返回的最新 progress
        throw er;
      }
      return j;
    });
  },
  syncScore: function () {
    // 师生一致：谁点亮都按自己的 openid 同步昵称 / 身份。
    // ★ score 由云端 ksst_progress 推导，这里传的值只是兜底，
    //   云函数只要看到有进度记录就会用 litCount 覆盖，不会采信前端分数。
    const name = this.data.myName || (this.data.isTeacher ? '微信用户' : '');
    if (!name) { this.refreshBoard(); return; }
    const self = this;
    const payload = {
      action: 'sync', name: name,
      score: this.litCount(), total: ALL.length,
      isTeacher: this.data.isTeacher
    };
    // 老师把自己的归属 key 写进云端，manageList 靠它认领名下学生；
    // 学生不传，避免覆盖已经选好的老师
    if (this.data.isTeacher) payload.teacherKey = this.myTeacherKey();
    this.callFn(payload)
      .then(function (j) { self.applyCredits(j); return self.refreshBoard(); })
      .catch(function () { /* 离线静默，下次操作或刷新自动补上 */ });
  },
  refreshBoard: function () {
    const self = this;
    /* ★ 给每次榜单请求编号。onLoad / onShow / 点选成功 / 改名 / 点亮
       都会触发 board，弱网下响应会乱序；旧响应（发请求时还没选老师，
       结果里 mePicked=false）若晚到，会把刚确认的状态打回去并重新弹窗。
       只有最新一次响应能改归属状态、能决定是否弹窗。 */
    const seq = (this._boardSeq = (this._boardSeq || 0) + 1);
    this.setData({ boardLoading: true });
    this.callFn({ action: 'board' })
      .then(function (j) { self.renderBoard(j || {}, seq !== self._boardSeq); })
      .catch(function (e) {
        if (seq !== self._boardSeq) return;   // 旧请求失败不覆盖新状态
        self.setData({
          boardLoading: false,
          // ★ 断网也要解锁闸门，否则没选老师的人永远等不到提示；
          //   已选过的人靠本机快照 teacherPicked=true，仍然不会弹。
          teacherChecked: true,
          boardErr: '（榜单未连通：' + e.message + '；技能树与本机进度不受影响）',
          boardMeText: '榜单暂时读不到，点「↻ 刷新」重试'
        });
        self.maybeAskTeacher();
      });
  },
  renderBoard: function (j, stale) {
    // 师生显示完全一致：Top10 横滑卡片 + 「我」的排名条
    const list = j.list || [];
    const patch = { boardLoading: false, boardErr: '' };
    const mePicked = !!j.mePicked;
    /* ★ - 本次会话已确认点选 → 永远 true
       - 旧响应(stale) → 保持当前值不动，绝不覆盖
       - 其余 → 以云端最新结果为准
       这样「选完老师」这个事实不会被任何迟到的旧响应抹掉。 */
    if (this._pickConfirmed) patch.teacherPicked = true;
    else if (!stale) patch.teacherPicked = mePicked;
    // ★ 云端归属判定已回来，解锁选老师弹层的闸门
    patch.teacherChecked = true;
    // 准入规则不再在榜单上摊开说明（页面保持干净）；云端仍按两条条件过滤
    patch.boardTop = list.slice(0, 10).map(function (x, i) {
      return {
        k: i, rank: i + 1, medal: i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '',
        name: x.name, score: Number(x.score) || 0, me: !!x.me
      };
    });
    let myRank = 0, myScore = 0, me = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].me) { myRank = i + 1; myScore = Number(list[i].score) || 0; me = list[i]; break; }
    }
    // 榜单里带上自己的解锁额度与归属，供点亮判定 / 选老师 / 管理页使用
    if (me && !stale) {
      this.applyCredits({
        credits: Number(me.credits) || 0,
        teacherId: me.teacherId || '',
        teacherName: me.teacherName || '',
        teacherPicked: true
      });
    }
    // ★ 以云端为权威校正本机快照，但只在「最新一次响应」上做：
    //   旧响应不能清掉刚写入的快照，否则下次进页面又会误判成没选过。
    if (!stale) {
      if (mePicked && me) this.savePickedCache(me.teacherId, me.teacherName);
      else if (!mePicked && !this._pickConfirmed) this.clearPickedCache();
    }
    const pickedNow = this._pickConfirmed || mePicked ||
                      (stale && this.data.teacherPicked);
    if (!pickedNow) {
      patch.boardMeText = '我：' + (this.data.myName || '未设置昵称') +
        ' · 还没选老师，未进入榜单';
    } else if (!this.data.myName) {
      patch.boardMeText = '还没设置榜单昵称 · 点上方「改名」即可上榜 ✨';
    } else {
      patch.boardMeText = '我：' + this.data.myName + ' · ' +
        (myRank ? '第 ' + myRank + ' 名 · ' + myScore + ' 分' : '暂未上榜');
    }
    this.setData(patch);
    // 只有最新一次榜单响应才决定是否弹窗，旧响应一律不碰
    if (!stale) this.maybeAskTeacher();
  },

  /* ==================== toast ==================== */
  toast: function (msg, col) {
    clearTimeout(this.toastTimer);
    this.setData({ toastShow: true, toastMsg: msg, toastCol: col || '#5ee0a0' });
    const self = this;
    this.toastTimer = setTimeout(function () { self.setData({ toastShow: false }); }, 1800);
  }
});
