const db = wx.cloud.database()

Page({
  data: {
    certificates: [],
    isEditing: false,
    currentId: '',
    formData: {
      name: '',
      gender: '男',
      certificateNumber: '',
      idNumber: ''
    }
  },

  onLoad() {
    this.loadCertificates()
  },

  // 加载证书列表
  loadCertificates() {
    wx.showLoading({
      title: '加载中'
    })

    db.collection('Certificate').get().then(res => {
      this.setData({
        certificates: res.data
      })
      wx.hideLoading()
    }).catch(err => {
      console.error('加载证书失败：', err)
      wx.hideLoading()
      wx.showToast({
        title: '加载失败',
        icon: 'error'
      })
    })
  },

  // 表单输入处理函数
  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value
    })
  },

  onGenderChange(e) {
    this.setData({
      'formData.gender': e.detail.value
    })
  },

  onCertificateNumberInput(e) {
    this.setData({
      'formData.certificateNumber': e.detail.value
    })
  },

  onIdNumberInput(e) {
    this.setData({
      'formData.idNumber': e.detail.value
    })
  },

  // 编辑证书
  editCertificate(e) {
    const id = e.currentTarget.dataset.id
    const certificate = this.data.certificates.find(item => item._id === id)
    
    this.setData({
      isEditing: true,
      currentId: id,
      formData: {
        name: certificate.name,
        gender: certificate.gender,
        certificateNumber: certificate.certificateNumber,
        idNumber: certificate.idNumber
      }
    })
  },

  // 删除证书
  deleteCertificate(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个证书吗？',
      success: res => {
        if (res.confirm) {
          wx.showLoading({
            title: '删除中'
          })

          db.collection('Certificate').doc(id).remove()
            .then(() => {
              wx.hideLoading()
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              })
              this.loadCertificates()
            })
            .catch(err => {
              console.error('删除证书失败：', err)
              wx.hideLoading()
              wx.showToast({
                title: '删除失败',
                icon: 'error'
              })
            })
        }
      }
    })
  },

  // 提交表单
  submitForm() {
    const { name, gender, certificateNumber, idNumber } = this.data.formData

    if (!name || !certificateNumber || !idNumber) {
      wx.showToast({
        title: '请填写完整信息',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: this.data.isEditing ? '保存中' : '添加中'
    })

    const operation = this.data.isEditing
      ? db.collection('Certificate').doc(this.data.currentId).update({
          data: this.data.formData
        })
      : db.collection('Certificate').add({
          data: this.data.formData
        })

    operation.then(() => {
      wx.hideLoading()
      wx.showToast({
        title: this.data.isEditing ? '修改成功' : '添加成功',
        icon: 'success'
      })
      
      // 重置表单和状态
      this.setData({
        isEditing: false,
        currentId: '',
        formData: {
          name: '',
          gender: '男',
          certificateNumber: '',
          idNumber: ''
        }
      })
      
      // 重新加载证书列表
      this.loadCertificates()
    }).catch(err => {
      console.error('保存证书失败：', err)
      wx.hideLoading()
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      })
    })
  }
})