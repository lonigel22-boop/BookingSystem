const readCache = require('../../utils/readCache.js')

Page({

    /**
     * 页面的初始数据
     */
    data: {
      userInfo: {},
      avatarUrl: '',
      nickName: '',
      name: '',
      position: '',
      introduce: '',
      fileID: ''
    },

    /**
     * 生命周期函数--监听页面加载
     */
    onLoad(options) {
      /* ★ ① 先读本机缓存秒开渲染，不再出现「每次都是空表单」。 */
      let cached = {}
      try { cached = wx.getStorageSync('userInfo') || {} } catch (e) {}
      this._paint(cached)

      /* ★ ② 再拉云端完整档案覆盖。getUsers 的投影原本漏了
         fileID / position / introduce，首页把那份残缺结果写进 userInfo 缓存后，
         本页读到的永远是空，于是每次都要重填、还因 fileID 为空被迫重传头像。
         云函数已补投影；这里主动拉一次，即使首页曾用旧投影覆盖过也能拿回真实内容。 */
      const openid = cached._openid
      if (!openid) return
      wx.cloud.callFunction({
        name: 'getUsers',
        data: { page: 0, pageSize: 1, _openid: openid }
      }).then(re => {
        const rows = (re && re.result) || []
        if (!Array.isArray(rows) || !rows.length) return
        const user = Object.assign({}, cached, rows[0])
        this._paint(user)
        try { wx.setStorageSync('userInfo', user) } catch (e) {}
        readCache.setIdentity(openid, user, 60)
      }).catch(() => {})
    },

    _paint(u) {
      this.setData({
        nickName: u.nickName || '',
        avatarUrl: u.avatarUrl || '',
        name: u.name || '',
        position: u.position || '',
        introduce: u.introduce || '',
        fileID: u.fileID || '',
        userInfo: u || {}
      })
    },

    /**
     * 生命周期函数--监听页面初次渲染完成
     */
    onReady() {

    },

    /**
     * 生命周期函数--监听页面显示
     */
    onShow() {
    },
    
    getchooseAvatar(e){
      console.log('修改头像', e, e.detail.avatarUrl)
      wx.showLoading({
        title: '加载中',
        mask: true
      })

      wx.getFileSystemManager().readFile({
        filePath: e.detail.avatarUrl, //选择图片返回的相对路径
        encoding: 'base64', //编码格式
        success: (_res) => {
          console.log('base64转化成功',_res);
          wx.cloud.callFunction({
            name: 'uploadFile',
            data: {
              fileContent: _res.data
            }
          }).then((resp) => {
            console.log('图片上传成功', resp)
            // 小程序客户端代码
            const fileID = resp.result.fileID
            wx.cloud.callFunction({
              name: 'getFileUrl',
              data: { fileId: fileID }, // 你的图片文件ID
              success: res => {
                console.log('获取到的图片', res) // 打印获取到的图片URL
                const file = res.result.file.fileList
                const fileData = file && file.length ?  file[0].tempFileURL + "?time=" + new Date().getTime() : ''
                this.setData({
                  avatarUrl: fileData,
                  fileID: fileID,
                  'userInfo.avatarUrl': fileData
                })
                wx.hideLoading()
              },
              fail: err => {
                console.error('调用云函数失败', err)
                wx.hideLoading()
              }
            })

          }).catch((err) => {
            console.log('图片上传失败', err)
              wx.showToast({
                icon: 'none',
                title: '图片过大，请重新选择',
              })
            wx.hideLoading()
          })
        },
        fail:(_err) =>{
          console.log('base64转化失败',_err)
        }
      })
    },

    formSubmit(e) {
      let userInfo = wx.getStorageSync('userInfo');
      console.log('form表单提交', e)
      /* ★ 已有头像即可保存，不再因为旧投影导致 fileID 为空就强制重传头像。 */
      if (!this.data.avatarUrl) {
        wx.showToast({
          icon: 'none',
          title: '请先上传头像',
        })
        return
      }
      wx.showLoading({
        title: '加载中'
      })
      this.setData({
        nickName: e.detail.value.nickname,
        name: e.detail.value.name,
        position: e.detail.value.position,
        introduce: e.detail.value.introduce,
      })
      wx.cloud.callFunction({
        name: 'editUsers',
        data: {
          nickName: this.data.nickName,
          avatarUrl: this.data.avatarUrl,
          fileID: this.data.fileID,
          _openid: userInfo._openid,
          name: this.data.name,
          position: this.data.position,
          introduce: this.data.introduce,
        },
        success: res => {
          console.log('保存结果', res)
          wx.hideLoading()
          wx.showToast({
            title: '保存成功',
            icon: 'success',
            duration: 2000
          })

          /* ★ 只合并业务字段，避免把整个 this.data（含 userInfo 自身）嵌套进去；
             同时刷新首页用的 60 秒身份缓存，否则退回首页 onShow 会用旧档案
             把刚保存的资料覆盖回去，下次进来又是空表单。 */
          const merged = Object.assign({}, userInfo, {
            nickName: this.data.nickName,
            avatarUrl: this.data.avatarUrl,
            fileID: this.data.fileID,
            name: this.data.name,
            position: this.data.position,
            introduce: this.data.introduce
          })
          wx.setStorageSync('userInfo', merged)
          readCache.setIdentity(userInfo._openid, merged, 60)
          wx.cloud.callFunction({
            name: 'updateTearcher',
            data: merged
          }).then(resp => {
            console.log('updateTearcher', resp)
          }).catch(err => {
            console.log('updateTearcher', err)
          })
        },
        fail: err => {
          console.error('保存失败', err)
          wx.hideLoading()
        }
      })
    },

    /**
     * 生命周期函数--监听页面隐藏
     */
    onHide() {

    },

    /**
     * 生命周期函数--监听页面卸载
     */
    onUnload() {

    },

    /**
     * 页面相关事件处理函数--监听用户下拉动作
     */
    onPullDownRefresh() {

    },

    /**
     * 页面上拉触底事件的处理函数
     */
    onReachBottom() {

    },

    /**
     * 用户点击右上角分享
     */
    onShareAppMessage() {

    }
})