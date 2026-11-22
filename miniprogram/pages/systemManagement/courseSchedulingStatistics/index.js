import * as echarts from '../../../components/echarts-for-weixin-master/ec-canvas/echarts'
import moment from 'moment'
Page({

  /**
   * 页面的初始数据
   */
  data: {
    shopValue: 0,
    shopList: [],
    date: moment(new Date()).format("YYYY-MM-DD"),
    // date: moment(new Date("2024-03-31")).format("YYYY-MM-DD"),
    showPicker: false,
    canvasShow: true,
    ec: {  
      // onInit: this.initChart
    }
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
    this.getShop()
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
  getShop() {
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
      this.initChart()
    }).catch((e) => {
      wx.hideLoading()
    })
  },
  dropdownChange(e) {
    this.setData({
      shopValue: e.detail
    })
  },
  dropdownOpen() {
    this.setData({
      canvasShow: false
    })
  },
  dropdownClose() {
    this.setData({
      canvasShow: true
    })
    this.initChart()
  },
  pickerDisplay() {
    this.setData({
      showPicker: true,
      canvasShow: false
    })
  },
  closePopup() {
    this.setData({
      showPicker: false,
      canvasShow: true
    })
    this.initChart()
  },
  currentTime(e) {
    console.log('e', e)
    this.setData({
      date: e.detail.currentTime,
      showPicker: false,
        canvasShow: true
    })
    this.initChart()
  },
  initChart() {
    wx.showLoading({
      title: '加载中'
    })
    const _this = this
    wx.cloud.callFunction({
      name: 'getMyCourse',
      data: {
        shopId: _this.data.shopList[_this.data.shopValue]._id,
        startTime: new Date(_this.data.date).getTime(),
        endTime: new Date(_this.data.date).getTime() + 24 * 60 * 60 * 1000,
        order: {
          string: 'startTime',
          order: 'asc'
        }
      }
    }).then(resp => {
      console.log('房间结果', resp.result.result)
      ecComponentFun(resp.result.result)
      wx.hideLoading()
    }).catch(err => {
      console.log('err', err)
      wx.hideLoading()
    })

    const ecComponentFun = (data) => {
      const ecComponent = this.selectComponent('#mychart-statistics')
      ecComponent.init((canvas, width, height) => {
        const chart = echarts.init(canvas, null, {
          width: width,
          height: height
        })
        canvas.setChart(chart)

          
        // const dataList = [
        //   { room: '房间1', time: '8', teacherName: '教师1' },
        //   { room: '房间1', time: '9', teacherName: '教师1' },
        //   { room: '房间2', time: '8', teacherName: '教师2' },
        //   { room: '房间3', time: '8', teacherName: '教师3' }
        // ]
        const dataList = data.data
        const rgb = [
          ['rgba(241, 196, 15, 0.5)', 'rgb(255, 224, 130)', 'rgb(230, 201, 100)'],  
          ['rgba(112, 173, 71, 0.8)', 'rgb(140, 200, 100)', 'rgb(115, 170, 75)'],  
          ['rgba(220, 57, 68, 0.7)', 'rgb(255, 100, 110)', 'rgb(230, 70, 80)'],  
          ['rgba(76, 175, 80, 0.6)', 'rgb(100, 200, 100)', 'rgb(80, 180, 85)'],  
          ['rgba(231, 76, 60, 0.9)', 'rgb(255, 110, 100)', 'rgb(240, 85, 75)'],  
          ['rgba(41, 128, 185, 0.5)', 'rgb(100, 160, 220)', 'rgb(60, 140, 200)'],  
          ['rgba(205, 133, 63, 0.7)', 'rgb(230, 160, 100)', 'rgb(210, 145, 80)'],  
          ['rgba(153, 63, 0, 0.6)', 'rgb(180, 80, 20)', 'rgb(165, 70, 10)'],  
          ['rgba(54, 162, 235, 0.8)', 'rgb(100, 180, 255)', 'rgb(70, 165, 240)'],  
          ['rgba(106, 90, 205, 0.5)', 'rgb(130, 120, 220)', 'rgb(115, 105, 200)'],  
          ['rgba(255, 140, 0, 0.7)', 'rgb(255, 160, 50)', 'rgb(240, 150, 30)'],  
          ['rgba(154, 205, 50, 0.9)', 'rgb(180, 220, 100)', 'rgb(165, 210, 75)'],  
          ['rgba(140, 140, 140, 0.6)', 'rgb(160, 160, 160)', 'rgb(150, 150, 150)'],  
          ['rgba(230, 126, 34, 0.5)', 'rgb(255, 150, 80)', 'rgb(240, 140, 60)'],  
          ['rgba(123, 20, 230, 0.8)', 'rgb(140, 50, 250)', 'rgb(130, 40, 235)'],  
          ['rgba(0, 139, 139, 0.7)', 'rgb(50, 160, 160)', 'rgb(30, 150, 150)'],  
          ['rgba(210, 105, 30, 0.6)', 'rgb(230, 130, 60)', 'rgb(215, 120, 50)'],  
          ['rgba(173, 255, 47, 0.9)', 'rgb(200, 255, 100)', 'rgb(185, 250, 75)']
        ]
        // const uniqueRooms = [...new Set(dataList.map(item => item.room))]
        const roomsString = this.data.shopList[this.data.shopValue].room
        const uniqueRooms = roomsString ? roomsString.split(',') : []
        // 构建每个老师的数据  
        const seriesData = uniqueRooms.map((room, index) => {
          const valueData = dataList.map(res => {
            if (res.room === room) {
              const startTimeHours = moment(new Date(res.startTime)).format("HH").toString()
              const endTimeSecond = moment(new Date(res.startTime)).format("mm").toString()
              const startTime = moment(new Date(res.startTime)).format("HH:mm")
              const EndTime = moment(new Date(res.endTime)).format("HH:mm")
              return [
                index,
                startTimeHours + endTimeSecond,
                res.teacherName ? ('教师：' + res.teacherName) : '' ,
                res.name ? ('学生：' + res.name) : '' ,
                room,
                startTime,
                EndTime
              ]
            } else {
              return []
            }
          })
          return {
            name: room,  
            type: 'scatter',
            data: valueData,
            symbolSize: function (data) {
              return 20
            },

            itemStyle: {
              shadowBlur: 8,
              shadowColor: 'rgba(63, 111, 112, 0.3)',
              shadowOffsetY: 2,
              color: new echarts.graphic.RadialGradient(0.4, 0.3, 1, [
                { offset: 0, color: rgb[index][1] },
                { offset: 1, color: rgb[index][2] }
              ]),
              borderRadius: 4
            }
          }  
        })

        console.log('seriesData', seriesData)

        var option = {
          tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(40, 40, 40, 0.9)',
            borderColor: '#3f6f70',
            textStyle: {
              color: '#f0f0f0',
              fontSize: 14
            },
            axisPointer: {
              type: 'shadow',
              shadowStyle: {
                color: 'rgba(63, 111, 112, 0.2)'
              }
            },
            position: ['10%', '50%'],
            formatter: function(params, ticket, callback){
              let content = `{title|${params[0].seriesName}}`
              params.forEach(res => {
                content +=  `\n{time|➤} {time|${res.data[5]}~${res.data[6]}} {teacher|${res.data[2]}} {student|${res.data[3]}}`
              })
              return content
            }
          },
          grid: {
            left: '3%',
            right: '3%',
            bottom: '3%',
            containLabel: true
          },
          legend: {
            textStyle: {
              color: '#a0a0a0',
              fontSize: 12
            },
            icon: 'circle',
            itemWidth: 10,
            itemHeight: 10,
            itemGap: 12,
            data: uniqueRooms
          },  
          xAxis: {  
            type: 'value',
            interval: 1,
            scale: true,
            interval: uniqueRooms.length,
            axisTick: false,
            axisLabel: {
              formatter: function (value) {
                return uniqueRooms[value]
              }
            },
            splitLine: {
              show: false
            }
          },  
          yAxis: {
            axisTick: false,
            interval: 200,
            min: 600,
            max: 2400,
            splitLine: {
              show: true
            },
            axisLabel: {
              formatter: function (value) {
                const hours = Math.floor(value / 100);
                const minutes = value % 100;
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
              }
            }
          },
          series: seriesData
        }
        chart.setOption(option)
        return chart
      })
    }
  }
})