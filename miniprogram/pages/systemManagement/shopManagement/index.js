Page({

  /**
   * 页面的初始数据
   */
  data: {
    shopList: [],
    obj: {},
    time: '',
    address: '',
    phone: '', 
    room: '',
    showAdd: false,
    addShopText: '',
    activeName: '1',
    editOverlay: false
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
    this.getShops()
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
  getShops() {
    wx.showLoading({
      title: '加载中'
    })
    wx.cloud.callFunction({
      name: 'getShop'
    }).then((resp) => {
      console.log('门店', resp)
      this.setData({
        shopList: resp.result.data
      })
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  shopEdit(e) {
    const item = e.currentTarget.dataset.item
    const valueIndex = this.data.shopList.findIndex(res => {
      return res._id === item._id
    })
    this.setData({
      obj: item,
      time: item.time,
      address: item.address,
      phone: item.phone,
      room: item.room,
      value: item.value ? item.value : valueIndex,
      editOverlay: true
    })
  },
  saveShop() {
    wx.showLoading({
      title: '加载中'
    })
    const temData = this.data.obj
    temData.time = this.data.time
    temData.address = this.data.address
    temData.phone = this.data.phone
    temData.room = this.data.room
    temData.value = this.data.value
    wx.cloud.callFunction({
      name: 'editShop',
      data: temData
    }).then((resp) => {
      console.log('门店', resp)
      this.setData({
        editOverlay: false,
      })
      this.getShops()
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  deleteShop(e) {
    const item = e.currentTarget.dataset.item
    const _this = this
    wx.showModal({
      title: '提示',
      content: '确定删除' + item.text + '?',
      success (res) {
        if (res.confirm) {
          console.log('用户点击确定')
          wx.cloud.callFunction({
            name: 'deleteShop',
            data:  {_id: item._id}
          }).then((resp) => {
            console.log('门店', resp)
            _this.getShops()
            wx.hideLoading()
          }).catch((e) => {
            wx.hideLoading()
          })
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  },
  addShop() {
    this.setData({
      showAdd: true
    })
  },
  onClose() {
    this.setData({
      showAdd: false
    })
  },
  confirm() {
    const addShopText = this.data.addShopText
    wx.cloud.callFunction({
      name: 'addShop',
      data: {text: addShopText}
    }).then((resp) => {
      console.log('结果', resp)
      this.getShops()
      wx.hideLoading()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  onChange(event) {
    this.setData({
      activeName: event.detail,
    });
  },
  hideEditOverlay() {
    this.setData({
      editOverlay: false,
    })
  }
})