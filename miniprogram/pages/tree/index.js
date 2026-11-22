/* KSST 演唱技能树 · 小程序原生版
   - 进度存本机 wx.setStorageSync（与网页版字段口径一致）
   - 分数按微信 openid 同步到云开发数据库，榜单显示各人自改昵称
   - 榜单不分师生：老师和学生页面完全一致、同榜排名，都能改名与上榜
     （my 页面里的老师专属功能入口仍由 userInfo.isTeacher 控制，与本页无关）
   部署前请确认 app.js 已 wx.cloud.init({ env: '你的环境ID' }) 且云函数 treeranksystem 已上传。 */

const { BRANCHES, QUIZ } = require('./data.js');

const LS_KEY   = 'ksst_tree_v3';   // 本机进度（网页版同名，口径一致）
const NAME_KEY = 'ksst_lb_name';   // 榜单昵称本机缓存
const FN       = 'treeranksystem'; // 云函数名（与 cloudfunctions/ 下的目录名保持一致）

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
    this.loadIdentity();
    this.render();
    this.refreshBoard();
    // 师生一致：已设置昵称就进页面校准一次分数（补上离线期间的变化）
    if (this.data.myName) this.syncScore();
  },
  onShow: function () {
    // 从「我的」页面改名回来后，重新读名字并同步榜单
    const prev = this.data.myName;
    this.loadIdentity();
    if (this.data.myName && this.data.myName !== prev) this.syncScore();
    else this.refreshBoard();
  },
  onUnload: function () {
    clearTimeout(this.qTimer);
    clearTimeout(this.toastTimer);
  },

  /* ==================== 昵称 ====================
     榜单不分师生，只按微信 openid 认人；这里只负责取「榜单上显示的名字」。
     老师 / 学生一样可以改名、一样上榜。my 页面里的老师专属功能仍由
     userInfo.isTeacher 控制，与 tree 页面无关。 */
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
    this.setData({ myName: myName });
  },

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
    this.setData({ nameShow: true, nameInput: this.data.myName || '', nameErr: '' });
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
    return wx.cloud.callFunction({ name: FN, data: data }).then(function (r) {
      const j = r && r.result;
      if (!j || !j.ok) throw new Error((j && j.msg) || '云端返回异常');
      return j;
    });
  },
  syncScore: function () {
    // 师生一致：谁点亮都按自己的 openid 同步分数，老师和学生同榜排名
    if (!this.data.myName) { this.refreshBoard(); return; }
    const self = this;
    this.callFn({ action: 'sync', name: this.data.myName, score: this.litCount(), total: ALL.length })
      .then(function () { return self.refreshBoard(); })
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
    let myRank = 0, myScore = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].me) { myRank = i + 1; myScore = Number(list[i].score) || 0; break; }
    }
    if (!this.data.myName) {
      patch.boardMeText = '还没设置榜单昵称 · 点上方「改名」即可上榜 ✨';
    } else {
      patch.boardMeText = '我：' + this.data.myName + ' · ' +
        (myRank ? '第 ' + myRank + ' 名 · ' + myScore + ' 分' : '暂未上榜') +
        ' · 本机 ' + this.litCount() + '/' + ALL.length + ' 分';
    }
    this.setData(patch);
  },

  /* ==================== toast ==================== */
  toast: function (msg, col) {
    clearTimeout(this.toastTimer);
    this.setData({ toastShow: true, toastMsg: msg, toastCol: col || '#5ee0a0' });
    const self = this;
    this.toastTimer = setTimeout(function () { self.setData({ toastShow: false }); }, 1800);
  }
});
