const { envList } = require('../../envList.js')
import Dialog from '@vant/weapp/dialog/dialog'
import moment from 'moment'
//获取应用实例
const app = getApp()

Page({
  data: {
    envList,
    teachers: [],
    getWXContext: {},
    shopValue: 0,
    shopList: [
      { text: '番禺校区', value: 0 },
      { text: '天河校区', value: 1 }
    ], // 门店列表
    dialogShow: false,
    dialogMessage: []
  },
   /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {
    this.getTeachersShops()
  },
  onLoad(options) {
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
          wx.hideLoading()
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
    // wx.showLoading({
    //   title: '加载中'
    // })
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
      // wx.hideLoading()
    }).catch((e) => {
      // wx.hideLoading()
    })

    wx.cloud.callFunction({
      name: 'getShop'
    }).then((resp) => {
      console.log('门店', resp)
      this.setData({
        shopList: resp.result.data
      })
      // wx.hideLoading()
    }).catch((e) => {
      // wx.hideLoading()
    })
  },
  dropdownChange(e) {
    this.setData({
      shopValue: e.detail
    })
  },
  // 拨打电话
  makePhoneCall(e) {
    console.log(e)
    wx.makePhoneCall({
      phoneNumber: e.currentTarget.dataset.item,
      success: (res) => {},
      fail: (res) => {},
      complete: (res) => {},
    })
  },
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
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(resp => {
      console.log('课程结果', resp.result.result)
      const courseData = resp.result.result.data.slice(0, 3)
      courseData.forEach(res => {
        res.startTime = moment(new Date(res.startTime)).format("MM-DD HH:mm:ss")
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
  }
})
