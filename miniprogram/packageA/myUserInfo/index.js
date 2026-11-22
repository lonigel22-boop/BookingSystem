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
		let userInfo = wx.getStorageSync('userInfo')
		this.setData({
			nickName: userInfo.nickName,
      avatarUrl: userInfo.avatarUrl,
      name: userInfo.name,
      position: userInfo.position,
      introduce: userInfo.introduce,
      fileID: userInfo.fileID,
      userInfo: userInfo
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
      if (!this.data.fileID) {
        wx.showToast({
          icon: 'error',
          title: '请上传头像',
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

          userInfo = {...userInfo, ...this.data}
          wx.setStorageSync('userInfo', userInfo)
          wx.cloud.callFunction({
            name: 'updateTearcher',
            data: userInfo
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