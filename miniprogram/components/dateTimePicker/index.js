import moment from 'moment'
Component({
  /**
   * 组件的属性列表
   */
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(newVal, oldVal, changePath) {
        this.setData({
          showPicker: newVal
        })
      }
    },
    minDate: {
      type: Number,
      value: '',
      observer(newVal, oldVal, changePath) {
        this.setData({
          minDate: newVal
        })
      }
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    showPicker: false,
    currentDate: new Date().toLocaleDateString(),
    currentTime: new Date().getTime()
  },

  /**
   * 组件的方法列表
   */
  methods: {
    pickerInput(event) {
      this.setData({
        currentTime: event.detail
      })
    },
    popupClose() {
      this.setData({
        showPicker: false
      })
      this.triggerEvent('closePopup', {  })
    },
    popupConfirm() {
      this.setData({
        showPicker: false
      })
      const formatDate = moment(new Date(this.data.currentTime)).format("YYYY-MM-DD")
      this.triggerEvent('currentTime', { currentTime: formatDate })
    },
  }
})