/* KSST 演唱技能树 · 小程序原生版
   - 进度存本机 wx.setStorageSync；分数 / 解锁额度 / 师生归属存云开发
   - 榜单不分师生：老师和学生同榜排名、显示一致，都能改名与上榜
   - 解锁额度：score(当前点亮数) < credits(老师发放总量) 才能点亮；
     撤销 / 清空时 score 变小，额度自动恢复
   - 老师顶端「⚙ 管理技能点」可给自己和名下学生发放 / 收回额度
   - 学生首次进入选择自己的老师（老师跳过），归属统一在隐藏后台改
   - 隐藏后台入口：滑到页面最底部，在底部继续连续竖向滑动 3 次
   部署前请确认 app.js 已 wx.cloud.init({ env: '你的环境ID' }) 且云函数 treeranksystem 已上传。 */

const { BRANCHES, QUIZ } = require('./data.js');

const LS_KEY   = 'ksst_tree_v3';   // 本机进度（网页版同名，口径一致）
const NAME_KEY = 'ksst_lb_name';   // 榜单昵称本机缓存
const CRED_KEY = 'ksst_credits';   // 离线时额度的本机兜底
const FN       = 'treeranksystem'; // 云函数名（与 cloudfunctions/ 下的目录名保持一致）

/* ============================================================
   老师名单：已接进你们约课小程序的真实接口
   ------------------------------------------------------------
   云函数 getTeacheres → 查 teachers 集合，返回数组；
   参数 { name:'', page:0, pageSize:100 }（name 为空=不按名字过滤），
   按 y 升序，和首页 getTeachersShops() / teacherManagement 用的是同一个。
   每项规范成 { id, name }：
     id   = _openid  ★ 必须！约课系统的师生关系键就是老师的 openid
                       （users.tearchreOpenid_course[].teacherOpenid）
     name = name || nickName（teachers 表里是真实姓名，如「邝贤妍」）
   这样学生选老师时存进 ksst_scores.teacherId 的值，
   与「我的学生」页的 teacherOpenid 完全一致，两边能对上。
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
    // isTeacher 只用于「是否显示管理按钮 / 是否跳过选老师 / 能否进后台」，
    // 榜单显示与排名完全不分师生（上一轮成果保留）
    isTeacher: false,
    myCredits: 0, myTeacherId: '', myTeacherName: '',
    creditLeftText: '',

    boardTop: [], boardMeText: '', boardLoading: true, boardErr: '',

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

    // 选老师（学生首次进入）
    teacherPickShow: false, teachers: [], teachersLoading: false, teacherErr: '',

    // 管理技能点 / 隐藏后台
    manageShow: false, manageTab: 'credits', manageLoading: false,
    manageList: [], adminList: [], stepN: 1,
    adminPickShow: false, adminPickUid: '', adminPickName: '',
    // 云端版本探针：2=完整版（额度/管理/归属）；0/1=旧版（只有 sync/board）
    cloudVer: 0, selfBusy: false,
    // 页面版本徽标 + 常驻诊断（打开管理弹层自动跑，不用手点、不用看一闪而过的 toast）
    uiVer: 'v3',
    diagText: '', diagBad: false, lastErr: '',

    toastShow: false, toastMsg: '', toastCol: '#5ee0a0'
  },

  /* ==================== 生命周期 ==================== */
  onLoad: function () {
    this.store = this.loadStore();
    this.qs = null;
    this.qTimer = null;
    this.toastTimer = null;
    this._dScrollTop = 0;
    this._touch = null;
    this._dragDist = 0;
    this._adminSwipes = [];
    this._teachers = [];
    try { this.data.myCredits = Number(wx.getStorageSync(CRED_KEY)) || 0; } catch (e) {}
    this.loadIdentity();
    this.render();
    this.refreshBoard();
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
  },
  onUnload: function () {
    clearTimeout(this.qTimer);
    clearTimeout(this.toastTimer);
  },

  /* ==================== 昵称 / 权限 ====================
     榜单不分师生，只按微信 openid 认人；这里取「榜单上显示的名字」。
     isTeacher 只决定：顶端管理按钮、跳过选老师、能否进隐藏后台；
     榜单显示、排名、改名、上榜对所有人完全一致。 */
  loadIdentity: function () {
    const app = getApp() || {};
    const g   = app.globalData || {};
    let cached = {};
    try { cached = wx.getStorageSync('userInfo') || {}; } catch (e) {}
    // 兼容多种存放位置：globalData.userInfo / 缓存 userInfo / 独立字段
    const u = Object.assign({}, cached, g.userInfo || {}, {
      name:     g.name     || (g.userInfo && g.userInfo.name)     || cached.name     || '',
      nickName: g.nickName || (g.userInfo && g.userInfo.nickName) || cached.nickName || ''
    });
    // 优先读 userInfo 的当前名字：在「我的」页面改名后，onShow 能立刻读到；
    // NAME_KEY 只作兜底（没登录态 / userInfo 里没名字时）
    let myName = u.name || u.nickName || '';
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
     ★ 与约课系统口径一致：myStudent 页传的 teacherOpenid 就是 userInfo._openid，
        users.tearchreOpenid_course[].teacherOpenid 也存这个值。
     学生选老师时存的是名单项的 _openid，两边天然对得上。 */
  myTeacherKey: function () {
    const u = this._identityRaw || {}, list = this._teachers || [];
    const cands = [u._openid, u.openid, u.teacherOpenid, u.teacherId, u.id, u._id]
      .filter(Boolean).map(String);
    for (let i = 0; i < cands.length; i++) {
      if (list.some(function (t) { return t.id === cands[i]; })) return cands[i];
    }
    // 名单里没直接命中时：按名字匹配，或直接用 userInfo._openid
    const hit = list.filter(function (t) { return t.name === this.data.myName; }.bind(this))[0];
    if (hit) return hit.id;
    return u._openid || u.openid || this.data.myName || '';
  },

  /* ==================== 选老师（仅学生，老师跳过） ==================== */
  maybeAskTeacher: function () {
    if (this.data.isTeacher) return;                 // 老师没有这一步
    if (this.data.myTeacherId) return;              // 已绑定
    if (this.data.teacherPickShow) return;          // 已经弹着
    if (this._teacherSkip) return;                  // 本次点了「稍后再选」
    const list = this._teachers || [];
    this.setData({
      teacherPickShow: true, teachers: list,
      teacherErr: list.length ? '' : '未读取到老师名单，请在 index.js 的 fetchTeachers() 接入约课接口'
    });
  },
  openTeacherPicker: function () {
    this.setData({ teacherPickShow: true, teachers: this._teachers || [],
      teacherErr: (this._teachers || []).length ? '' : '未读取到老师名单，请检查约课接口' });
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
      self.setData({
        teacherPickShow: false,
        myTeacherId: j.teacherId || id, myTeacherName: j.teacherName || name
      });
      self.toast('✅ 已选择老师：' + (j.teacherName || name), '#5ee0a0');
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
    // 空归属不覆盖本地已绑定的值，避免 bindTeacher 与 board 的异步竞态
    if (j.teacherId) {
      patch.myTeacherId = j.teacherId;
      patch.myTeacherName = j.teacherName || '';
      /* 约课系统里已绑定老师 / 后台已建档的学生，board 回来时才发现有归属；
         此刻若选老师弹层因为时序先弹了出来，自动收起，别让学生再选一次。 */
      if (this.data.teacherPickShow) { patch.teacherPickShow = false; this._teacherSkip = true; }
    }
    this.setData(patch);
  },

  /* ==================== 管理技能点 / 隐藏后台 ==================== */
  openManage: function (tab) {
    // 既支持 openManage('admin')，也支持直接绑 bindtap（参数是事件对象）
    let t = (tab && typeof tab === 'object')
      ? ((tab.currentTarget && tab.currentTarget.dataset && tab.currentTarget.dataset.tab) || 'credits')
      : (tab || 'credits');
    if (!this.data.isTeacher) { this.toast('仅老师可进入管理', '#ff9fb0'); return; }
    this.setData({ manageShow: true, manageTab: t, manageLoading: true, stepN: 1, lastErr: '' });
    // 打开即自动体检：结果常驻在弹层里，不用再手点「🔍 云端自检」，
    // 也不会像 toast 那样 1.8 秒就消失。一眼分清「页面没更新 / 云函数没更新 / 集合没建」。
    this.runDiag();
    // 主动探一次版本：board 旧版也有，不会报「未知操作」；
    // 但旧版返回里没有 ver，管理弹层就能直接显示「云端仍是旧版」。
    this.callFn({ action: 'board' }).catch(function () {});
    if (t === 'admin') this.loadAdminList(); else this.loadManageList();
  },

  /* 自动体检：把云端版本、环境、集合、本人记录写成一段常驻文本 */
  runDiag: function () {
    const self = this;
    this.setData({ diagText: '正在检查云端…', diagBad: false });
    this.callFn({ action: 'selfCheck' }).then(function (j) {
      const m = j.me;
      const bad = j.ver < 2 || !j.readable || !m;
      self.setData({
        diagBad: bad,
        diagText: [
          '云端 ver=' + j.ver + (j.ver >= 2 ? '（新版 ✅）' : '（旧版 ❌ 需重传云函数）'),
          '集合 ' + j.collection + (j.readable ? ' 可读 · ' + j.count + ' 条' : ' 不可读：' + j.err),
          m ? ('本人：' + m.name + ' · credits=' + m.credits + ' · isTeacher=' + m.isTeacher) : '本人：★ 无记录（sync 没建档）'
        ].join('\n')
      });
    }).catch(function (err) {
      self.setData({ diagBad: true, diagText: '云端自检失败：' + cloudHint(err.message) });
    });
  },

  /* ★ 给自己加/减点：完全不依赖 manageList 有没有返回「我」那一行。
     不带 uid → 云函数按 openid 操作本人。这样即使列表加载失败、
     或云端还没建好老师记录，老师也一定能给自己加点。 */
  onSelfAdjust: function (e) {
    if (this.data.selfBusy) return;
    const sign = Number((e.currentTarget.dataset || {}).sign || 1);
    const n = this.data.stepN || 1;
    const delta = sign * n, self = this;
    this.setData({ selfBusy: true, lastErr: '' });
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
      self.setData({ selfBusy: false, lastErr: '' });
      self.applyCredits({ credits: j.credits });
      self.toast((delta > 0 ? '✅ 给自己发放 ' : '↩ 给自己收回 ') + n + ' 点（当前额度 ' + j.credits + '）',
                 delta > 0 ? '#5ee0a0' : '#ffc98a');
      self.loadManageList();
      self.refreshBoard();
      self.runDiag();
    }).catch(function (err) {
      wx.hideLoading(); clearTimeout(self._selfUnlock);
      const msg = cloudHint(err.message);
      // 错误常驻在弹层里，不再一闪而过；用户可以直接截图这行字
      self.setData({ selfBusy: false, lastErr: '加点失败：' + msg });
      self.toast(msg, '#ff9fb0');
      self.runDiag();
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
  loadAdminList: function () {
    const self = this;
    this.callFn({ action: 'adminList', isTeacher: this.data.isTeacher })
      .then(function (j) { self.setData({ adminList: j.list || [], manageLoading: false }); })
      .catch(function (err) {
        self.setData({ manageLoading: false, adminList: [] });
        self.toast(err.message, '#ff9fb0');
      });
  },
  onStepMinus: function () { this.setData({ stepN: Math.max(1, (this.data.stepN || 1) - 1) }); },
  onStepPlus:  function () { this.setData({ stepN: Math.min(30, (this.data.stepN || 1) + 1) }); },
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
  /* ===== 老师给自己加点（直连，不经过 manageList）=====
     截图里「名下还没有学生」时列表里没有可点的 [＋]，老师就没法给自己加。
     这个入口直接调 manageCredits 且不带 uid，云端按 openid 认本人并自动补建记录，
     所以哪怕 manageList 因为任何原因读不到人，也能一步加上。 */
  quickAddSelf: function () {
    if (!this.data.isTeacher) { this.toast('仅老师可管理技能点', '#ff9fb0'); return; }
    const self = this, n = this.data.stepN || 1;
    wx.showLoading({ title: '发放中', mask: true });
    this.callFn({
      action: 'manageCredits', delta: n,
      name: this.data.myName || '',
      teacherKey: this.myTeacherKey(), isTeacher: true
    }).then(function (j) {
      wx.hideLoading();
      self.applyCredits({ credits: j.credits });
      self.toast('✅ 已给自己加 ' + n + ' 点（当前额度 ' + j.credits + '）', '#5ee0a0');
      self.refreshBoard();
    }).catch(function (err) {
      wx.hideLoading();
      self.toast(cloudHint(err.message), '#ff9fb0');
    });
  },

  /* ===== 云端自检：一点击就把版本和本人记录摊开给你看 =====
     用来彻底区分「前端没覆盖」和「云函数没上传」：
       - 弹「云函数未更新」→ 云端还是旧版，重传 treeranksystem
       - 弹 ver=2 的详情 → 云端是新版，把内容截图给我，我按字段定位 */
  selfCheck: function () {
    const self = this;
    wx.showLoading({ title: '检查中', mask: true });
    this.callFn({ action: 'selfCheck' }).then(function (j) {
      wx.hideLoading();
      const m = j.me;
      const lines = [
        '云端版本 ver=' + j.ver + '（2=新版）',
        '集合 ' + j.collection + '：' + (j.readable ? '可读' : '不可读 ' + j.err),
        '记录数：' + j.count,
        '本人记录：' + (m ? '有' : '★ 无（sync 还没建档）'),
        m ? ('名字 ' + m.name + ' / isTeacher=' + m.isTeacher) : '',
        m ? ('credits=' + m.credits + ' / score=' + m.score) : '',
        m ? ('teacherId=' + (m.teacherId || '(空)')) : '',
        '支持操作：' + (j.actions || []).length + ' 个'
      ].filter(Boolean);
      wx.showModal({
        title: '🔍 云端自检', content: lines.join('\n'),
        showCancel: false, confirmText: '知道了'
      });
    }).catch(function (err) {
      wx.hideLoading();
      wx.showModal({
        title: '云端自检失败', content: cloudHint(err.message),
        showCancel: false, confirmText: '知道了'
      });
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

  /* ---------- 隐藏后台手势：页面最底部连续竖向滑动 3 次 ---------- */
  onAdminTouchStart: function (e) {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    this._adminTouch = { y: t.clientY, x: t.clientX };
  },
  onAdminTouchEnd: function (e) {
    const s = this._adminTouch;
    this._adminTouch = null;
    if (!s || !e.changedTouches || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - s.y, dx = t.clientX - s.x;
    if (Math.abs(dy) < 40 || Math.abs(dx) > Math.abs(dy)) return;  // 上下方向都算，横向不算
    const now = Date.now();
    let arr = this._adminSwipes || [];
    if (arr.length && now - arr[arr.length - 1] > 1500) arr = [];   // 不连续就重新计
    arr.push(now);
    this._adminSwipes = arr;
    if (arr.length >= 3) {
      this._adminSwipes = [];
      this.openManage('admin');
    }
  },
  openAdmin: function () { this.openManage('admin'); },

  /* ==================== 本机存档 ==================== */
  loadStore: function () {
    const s = { lit: {}, picks: {}, major: {}, exams: {}, everLit: {} };
    try {
      const raw = wx.getStorageSync(LS_KEY);
      if (raw) {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        Object.assign(s, p);
        if (!s.major || typeof s.major !== 'object') s.major = {};
        if (!s.everLit || typeof s.everLit !== 'object') s.everLit = {};
        if (!p.everLit) {
          Object.keys(s.lit || {}).forEach(function (k) { if (s.lit[k]) s.everLit[k] = true; });
          this.saveStore(s);
        }
      }
    } catch (e) {}
    return s;
  },
  saveStore: function (s) {
    try { wx.setStorageSync(LS_KEY, s || this.store); } catch (e) {}
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
  light: function (id) {
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
    this.store.picks[id] = false;
    this.store.lit[id] = false;
    this.saveStore(); this.render(); this.syncScore(); this.afterStateChange();
    this.toast('已取消选学', '#8892b0');
  },
  openConfirm: function () { this.setData({ confirmShow: true }); },
  closeConfirm: function () { this.setData({ confirmShow: false }); },
  doReset: function () {
    this.closeConfirm();
    this.store = { lit: {}, picks: {}, major: {}, exams: {}, everLit: {} };
    this.saveStore(); this.render(); this.syncScore();
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
    /* 榜单昵称 = users 表里的 name（你们「我的 → 个人信息」页改的就是它）。
       这里直接跳到真实改名页，单一数据源，避免 tree 页另存一份名字、
       下次 my 页 onShow 从 getUsers 重新拉取时又被覆盖。
       改完返回本页，onShow → loadIdentity → syncScore 会自动把新名字推到榜单。 */
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
  /* 把新昵称写回「我的」页面读取的位置 —— 若你的 my.js 用的是别的 key，改这里即可 */
  syncNameToMyPage: function (v) {
    try {
      const app = getApp() || {};
      if (app.globalData) {
        if (!app.globalData.userInfo) app.globalData.userInfo = {};
        app.globalData.userInfo.name = v;
        app.globalData.name = v;
      }
      let cached = {};
      try { cached = wx.getStorageSync('userInfo') || {}; } catch (e) {}
      cached.name = v;
      wx.setStorageSync('userInfo', cached);
      wx.setStorageSync('name', v);
      wx.setStorageSync('nickName', v);
    } catch (e) {}
  },

  /* ==================== 云端榜单（微信云开发） ==================== */
  /* openid 由云函数从 cloud.getWXContext() 取，前端拿不到也伪造不了 */
  callFn: function (data) {
    if (!wx.cloud) return Promise.reject(new Error('未初始化云开发'));
    const self = this;
    return wx.cloud.callFunction({ name: FN, data: data }).then(function (r) {
      const j = r && r.result;
      // 老版云函数没有 ver 字段；见到 2 就说明云端已是完整版
      if (j && typeof j.ver === 'number' && j.ver > self.data.cloudVer) {
        self.setData({ cloudVer: j.ver });
      }
      if (!j || !j.ok) throw new Error((j && j.msg) || '云端返回异常');
      return j;
    });
  },
  syncScore: function () {
    // 师生一致：谁点亮都按自己的 openid 同步分数，老师和学生同榜排名。
    // 老师即使没设昵称也要建云端记录（否则管理页识别不到老师身份），用兜底名。
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
    this.setData({ boardLoading: true });
    this.callFn({ action: 'board' })
      .then(function (j) { self.renderBoard(j.list || []); })
      .catch(function (e) {
        self.setData({
          boardLoading: false,
          boardErr: '（榜单未连通：' + e.message + '；技能树与本机进度不受影响）',
          boardMeText: '榜单暂时读不到，点「↻ 刷新」重试'
        });
      });
  },
  renderBoard: function (list) {
    // 师生显示完全一致：Top10 横滑卡片 + 「我」的排名条
    const patch = { boardLoading: false, boardErr: '' };
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
    if (me) {
      this.applyCredits({
        credits: Number(me.credits) || 0,
        teacherId: me.teacherId || '',
        teacherName: me.teacherName || ''
      });
    }
    if (!this.data.myName) {
      patch.boardMeText = '还没设置榜单昵称 · 点上方「改名」即可上榜 ✨';
    } else {
      patch.boardMeText = '我：' + this.data.myName + ' · ' +
        (myRank ? '第 ' + myRank + ' 名 · ' + myScore + ' 分' : '暂未上榜') +
        ' · 本机 ' + this.litCount() + '/' + ALL.length + ' 分';
    }
    this.setData(patch);
    // 榜单回来后才确认是否已绑定老师，避免异步竞态
    this.maybeAskTeacher();
  },

  /* ==================== toast ==================== */
  toast: function (msg, col) {
    clearTimeout(this.toastTimer);
    this.setData({ toastShow: true, toastMsg: msg, toastCol: col || '#5ee0a0' });
    const self = this;
    this.toastTimer = setTimeout(function () { self.setData({ toastShow: false }); }, 1800);
  }
});
