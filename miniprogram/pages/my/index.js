//获取应用实例
const app = getApp()
Page({

    /**
     * 页面的初始数据
     */
    data: {
      userInfo: {},
      avatarUrl: '',
      nickName: ''
    },

    /**
     * 生命周期函数--监听页面加载
     */
    onLoad(options) {
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
      const _this = this
      // 检查登录态是否过期
      wx.checkSession({
        success: function(res) {
          console.log('登录有效', res)
          app.globalData.hasLogin = true
          _this.getWXContext()
        },
        fail: function() {
          console.log('登录过期')
          app.globalData.hasLogin = false
          _this.getWXContext()
        }
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
      //  wx.getSetting 先查询一下用户是否授权了
      wx.getSetting({
        withSubscriptions: true,
        success: function(res) {
          if(res.authSetting['scope.userInfo']) {
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
              scope: 'scope.userInfo',
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
          _this.setData({
            nickName: re.result[0].nickName,
            avatarUrl: re.result[0].avatarUrl,
            name: re.result[0].name,
            userInfo: re.result[0]
          })
          wx.hideLoading()
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
            introduce: '',
          }
          wx.cloud.callFunction({
            name: 'addUsers',
            data: data
          }).then((re) => {
            console.log('添加用户结果', re)
            const data = re.result.data
            wx.setStorageSync('userInfo', data && data.length ? data[0] : {})
            _this.setData({
              nickName: data && data.length ? data[0].nickName : '',
              avatarUrl: data && data.length ? data[0].avatarUrl : '',
              name: data && data.length ? data[0].name : '',
              userInfo: data && data.length ? data[0] : {}
            })
            wx.hideLoading()
          }).catch((e) => {
            wx.hideLoading()
          })
        }
      }).catch((e) => {
        wx.hideLoading()
      })
    },
    getchooseAvatar(e){
      console.log('修改头像', e, e.detail.avatarUrl);
      const that = this
      wx.uploadFile({
        url: api.StorageUpload,
        filePath: e.detail.avatarUrl,
        name: 'file',
        success: function(res) {
          var _res = JSON.parse(res.data);
          if (_res.code.toString() === '200') {
            that.setData({
              avatarUrl: _res.data.url,
            })
          }
        },
        fail: function(e) {
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
        }, "POST").then(function(res) {
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

    },
    myInfo() {
      wx.navigateTo({
        url: '/packageA/myUserInfo/index',
        events: {
          // 为指定事件添加一个监听器，获取被打开页面传送到当前页面的数据
        },
        success: function(res) {
        }
      })
    }
})