Page({
  data: {
    // 现有数据保持不变
  },
  onLoad: function(options) {
    // 现有逻辑保持不变
  },
  updateFinishedStatus: function() {
    wx.cloud.callFunction({
      name: 'updateFinishedCourses',
      success: res => {
        wx.showToast({
          title: '标记完成成功',
          icon: 'success'
        });
        // 刷新列表
        this.onLoad();
      },
      fail: err => {
        wx.showToast({
          title: '标记失败',
          icon: 'none'
        });
        console.error(err);
      }
    });
  },
  // 其他现有方法保持不变
});