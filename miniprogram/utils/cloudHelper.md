# 云函数调用助手 (cloudHelper)

云函数调用助手是一个用于简化微信小程序云函数调用的工具库。它提供了统一的接口来处理加载状态、错误提示和用户确认等常见操作，使代码更加简洁、可维护。

## 功能特点

- 统一的加载状态管理
- 统一的错误处理
- 用户确认对话框集成
- 批量调用支持（串行/并行）
- 顺序调用多个云函数
- 进度回调支持

## 基本用法

### 1. 导入模块

```javascript
const { 
  callCloudFunction, 
  callCloudFunctionWithConfirm,
  callCloudFunctionBatch,
  callCloudFunctionSequence
} = require('../../utils/cloudHelper');
```

### 2. 基本云函数调用

```javascript
// 基本调用
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
```

### 3. 带确认对话框的云函数调用

```javascript
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
```

### 4. 批量调用云函数

```javascript
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

// 并行批量处理
callCloudFunctionBatch('sendNotification', studentsToUpdate, {
  loadingTitle: '发送通知中',
  parallel: true,
  batchSize: 5
}).then(results => {
  console.log('通知发送完成:', results);
});
```

### 5. 顺序调用多个云函数

```javascript
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
  }
}).then(results => {
  console.log('所有操作完成:', results);
}).catch(err => {
  console.error('操作序列中断:', err);
});
```

## API 参考

### callCloudFunction(name, data, options)

调用单个云函数。

**参数：**

- `name` (String): 云函数名称
- `data` (Object): 传递给云函数的参数
- `options` (Object): 配置选项
  - `showLoading` (Boolean): 是否显示加载提示，默认为true
  - `loadingTitle` (String): 加载提示文字，默认为"加载中"
  - `showError` (Boolean): 是否显示错误提示，默认为true
  - `showSuccess` (Boolean): 是否在成功时显示提示，默认为false
  - `successTitle` (String): 成功提示文字，默认为"操作成功"

**返回值：**

- Promise对象，resolve时返回云函数调用结果

### callCloudFunctionWithConfirm(name, data, confirmOptions, options)

调用云函数并显示确认对话框。

**参数：**

- `name` (String): 云函数名称
- `data` (Object): 传递给云函数的参数
- `confirmOptions` (Object): 确认对话框选项
  - `title` (String): 对话框标题，默认为"提示"
  - `content` (String): 对话框内容，默认为"确定执行此操作？"
- `options` (Object): 云函数调用配置，同callCloudFunction的options参数

**返回值：**

- Promise对象，如果用户取消则返回rejected Promise

### callCloudFunctionBatch(name, dataArray, options)

对一组数据批量调用同一个云函数。

**参数：**

- `name` (String): 云函数名称
- `dataArray` (Array): 数据数组，每个元素将作为单独的云函数调用参数
- `options` (Object): 配置选项
  - `showLoading` (Boolean): 是否显示加载提示，默认为true
  - `loadingTitle` (String): 加载提示文字，默认为"批量处理中"
  - `showError` (Boolean): 是否显示错误提示，默认为true
  - `showSuccess` (Boolean): 是否在成功时显示提示，默认为false
  - `successTitle` (String): 成功提示文字，默认为"批量操作成功"
  - `parallel` (Boolean): 是否并行调用，默认为false（串行调用）
  - `batchSize` (Number): 并行调用时的批次大小，默认为5
  - `progressCallback` (Function): 进度回调函数，参数为(current, total, results)

**返回值：**

- Promise对象，resolve时返回所有调用结果的数组

### callCloudFunctionSequence(functionCalls, globalOptions)

按顺序调用一系列云函数。

**参数：**

- `functionCalls` (Array): 云函数调用配置数组，每个元素为 {name, data, options} 对象
- `globalOptions` (Object): 全局配置选项
  - `showLoading` (Boolean): 是否显示加载提示，默认为true
  - `loadingTitle` (String): 加载提示文字，默认为"处理中"
  - `showError` (Boolean): 是否显示错误提示，默认为true
  - `continueOnError` (Boolean): 某个调用失败时是否继续后续调用，默认为false
  - `progressCallback` (Function): 进度回调函数，参数为(current, total, results)

**返回值：**

- Promise对象，resolve时返回所有调用结果的数组

## 最佳实践

1. **使用适当的错误处理**：总是在catch块中处理可能的错误，即使cloudHelper已经显示了错误提示。

2. **避免嵌套调用**：使用callCloudFunctionSequence代替嵌套的云函数调用，使代码更清晰。

3. **合理使用并行处理**：对于互不依赖的批量操作，使用parallel=true可以提高效率，但注意控制batchSize避免并发请求过多。

4. **利用进度回调**：对于耗时较长的批量操作，使用progressCallback更新UI，提供更好的用户体验。

5. **确认危险操作**：对于删除、修改等危险操作，始终使用callCloudFunctionWithConfirm让用户确认。

## 示例代码

更多详细示例请参考 `cloudHelperExample.js` 文件。