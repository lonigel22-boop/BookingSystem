/**
 * 云函数调用助手使用示例
 * 本文件展示了如何使用cloudHelper.js中的各种函数
 */

const { 
  callCloudFunction, 
  callCloudFunctionWithConfirm,
  callCloudFunctionBatch,
  callCloudFunctionSequence
} = require('./cloudHelper');

/**
 * 基本云函数调用示例
 */
function basicExample() {
  // 简单调用
  callCloudFunction('getUsers', { type: 'student' })
    .then(res => {
      console.log('获取学生列表成功:', res.result);
    })
    .catch(err => {
      console.error('获取学生列表失败:', err);
    });

  // 自定义加载提示
  callCloudFunction('getCourse', { courseId: 'abc123' }, {
    loadingTitle: '获取课程信息中',
    showSuccess: true,
    successTitle: '获取成功'
  }).then(res => {
    console.log('课程信息:', res.result);
  });

  // 不显示加载提示和错误提示（适用于后台静默操作）
  callCloudFunction('updateUserStatus', { userId: 'user123', status: 'active' }, {
    showLoading: false,
    showError: false
  }).then(res => {
    console.log('状态更新成功');
  });
}

/**
 * 带确认对话框的云函数调用示例
 */
function confirmExample() {
  // 删除操作确认
  callCloudFunctionWithConfirm(
    'deleteCourse',
    { courseId: 'course123' },
    {
      title: '删除确认',
      content: '确定要删除此课程吗？此操作不可撤销。'
    },
    {
      loadingTitle: '删除中',
      showSuccess: true,
      successTitle: '删除成功'
    }
  ).then(res => {
    console.log('课程已删除');
  }).catch(err => {
    // 用户取消或操作失败
    console.log('删除操作取消或失败:', err);
  });
}

/**
 * 批量调用云函数示例
 */
function batchExample() {
  // 准备批量处理的数据
  const studentsToUpdate = [
    { studentId: 'stu001', status: 'active' },
    { studentId: 'stu002', status: 'inactive' },
    { studentId: 'stu003', status: 'graduated' }
  ];

  // 串行批量处理（默认）
  callCloudFunctionBatch('updateStudentStatus', studentsToUpdate, {
    loadingTitle: '更新学生状态中',
    showSuccess: true,
    successTitle: '批量更新成功',
    progressCallback: (current, total, results) => {
      console.log(`处理进度: ${current}/${total}`);
    }
  }).then(results => {
    console.log('所有学生状态已更新:', results);
  });

  // 并行批量处理（每次最多处理5个请求）
  callCloudFunctionBatch('sendNotification', studentsToUpdate, {
    loadingTitle: '发送通知中',
    parallel: true,
    batchSize: 5,
    progressCallback: (current, total, results) => {
      console.log(`发送进度: ${current}/${total}`);
    }
  }).then(results => {
    // 检查是否有失败的通知
    const failures = results.filter(r => r.error);
    if (failures.length > 0) {
      console.warn(`${failures.length}条通知发送失败`);
    }
  });
}

/**
 * 顺序调用多个云函数示例
 */
function sequenceExample() {
  // 定义一系列需要顺序执行的云函数调用
  const functionCalls = [
    {
      name: 'checkUserPermission',
      data: { userId: 'user123', permission: 'edit_course' }
    },
    {
      name: 'getCourseDetails',
      data: { courseId: 'course123' }
    },
    {
      name: 'updateCourseContent',
      data: { courseId: 'course123', content: '新的课程内容' },
      options: {
        showSuccess: true,
        successTitle: '课程内容已更新'
      }
    }
  ];

  // 顺序调用这些云函数
  callCloudFunctionSequence(functionCalls, {
    loadingTitle: '更新课程中',
    continueOnError: false, // 如果任何一步失败，就停止后续操作
    progressCallback: (current, total, results) => {
      console.log(`操作进度: ${current}/${total}`);
      
      // 可以根据前面步骤的结果调整后续步骤
      if (current === 2) { // 第二步完成后
        const courseDetails = results[1].result;
        console.log('获取到课程详情:', courseDetails);
      }
    }
  }).then(results => {
    console.log('所有操作完成:', results);
  }).catch(err => {
    console.error('操作序列中断:', err);
  });
}

/**
 * 实际业务场景示例：批量结课
 */
function batchFinishCoursesExample(courseIds) {
  // 准备要结课的课程数据
  const coursesToFinish = courseIds.map(id => ({
    _id: id,
    finished: true
  }));

  // 显示确认对话框
  wx.showModal({
    title: '批量结课',
    content: `确定要将选中的${courseIds.length}门课程标记为已结课吗？`,
    success(res) {
      if (res.confirm) {
        // 用户确认后，批量调用结课云函数
        callCloudFunctionBatch('editMyCourse', coursesToFinish, {
          loadingTitle: '批量结课中',
          showSuccess: true,
          successTitle: '批量结课成功',
          parallel: true,
          batchSize: 10,
          progressCallback: (current, total) => {
            // 可以更新UI显示进度
            const progress = Math.floor((current / total) * 100);
            console.log(`结课进度: ${progress}%`);
          }
        }).then(results => {
          // 处理结果
          const successCount = results.filter(r => !r.error).length;
          const failCount = results.filter(r => r.error).length;
          
          console.log(`结课完成: 成功${successCount}门，失败${failCount}门`);
          
          // 这里可以刷新页面数据
          // this.getMycourse();
        });
      }
    }
  });
}

/**
 * 实际业务场景示例：学生注册流程
 */
function studentRegistrationExample(studentData) {
  // 定义注册流程的步骤
  const registrationSteps = [
    {
      name: 'addUsers',
      data: {
        ...studentData,
        type: 'student'
      }
    },
    {
      name: 'addStudentsCourse',
      data: {
        openid: '', // 将在第一步完成后填充
        courseIds: studentData.selectedCourses
      }
    },
    {
      name: 'sendWelcomeNotification',
      data: {
        studentId: '', // 将在第一步完成后填充
        templateId: 'welcome_template'
      }
    }
  ];

  // 执行注册流程
  callCloudFunctionSequence(registrationSteps, {
    loadingTitle: '注册处理中',
    continueOnError: false,
    progressCallback: (current, total, results) => {
      // 第一步完成后，获取学生openid并更新后续步骤的参数
      if (current === 1) {
        const studentInfo = results[0].result;
        
        // 更新第二步和第三步的参数
        registrationSteps[1].data.openid = studentInfo._openid;
        registrationSteps[2].data.studentId = studentInfo._id;
      }
    }
  }).then(results => {
    console.log('学生注册完成:', results);
    wx.showToast({
      title: '注册成功',
      icon: 'success'
    });
  }).catch(err => {
    console.error('注册过程中断:', err);
  });
}

module.exports = {
  basicExample,
  confirmExample,
  batchExample,
  sequenceExample,
  batchFinishCoursesExample,
  studentRegistrationExample
};