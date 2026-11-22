/**
 * 云函数调用助手
 * 封装云函数调用，统一处理加载状态和错误提示
 */

/**
 * 调用云函数
 * @param {String} name - 云函数名称
 * @param {Object} data - 传递给云函数的参数
 * @param {Object} options - 配置选项
 * @param {Boolean} options.showLoading - 是否显示加载提示，默认为true
 * @param {String} options.loadingTitle - 加载提示文字，默认为"加载中"
 * @param {Boolean} options.showError - 是否显示错误提示，默认为true
 * @param {Boolean} options.showSuccess - 是否在成功时显示提示，默认为false
 * @param {String} options.successTitle - 成功提示文字，默认为"操作成功"
 * @returns {Promise} - 返回Promise对象
 */
function callCloudFunction(name, data = {}, options = {}) {
  // 默认配置
  const defaultOptions = {
    showLoading: true,
    loadingTitle: '加载中',
    showError: true,
    showSuccess: false,
    successTitle: '操作成功'
  };

  // 合并配置
  const finalOptions = { ...defaultOptions, ...options };

  // 显示加载提示
  if (finalOptions.showLoading) {
    wx.showLoading({
      title: finalOptions.loadingTitle,
      mask: true
    });
  }

  // 调用云函数
  return wx.cloud.callFunction({
    name: name,
    data: data
  }).then(res => {
    // 隐藏加载提示
    if (finalOptions.showLoading) {
      wx.hideLoading();
    }

    // 显示成功提示
    if (finalOptions.showSuccess) {
      wx.showToast({
        title: finalOptions.successTitle,
        icon: 'success',
        duration: 2000
      });
    }

    return res;
  }).catch(err => {
    // 隐藏加载提示
    if (finalOptions.showLoading) {
      wx.hideLoading();
    }

    // 显示错误提示
    if (finalOptions.showError) {
      wx.showToast({
        title: '操作失败：' + (err.message || '未知错误'),
        icon: 'none',
        duration: 3000
      });
    }

    // 继续抛出错误，让调用者可以进行自定义处理
    throw err;
  });
}

/**
 * 调用云函数并显示确认对话框
 * @param {String} name - 云函数名称
 * @param {Object} data - 传递给云函数的参数
 * @param {Object} confirmOptions - 确认对话框选项
 * @param {String} confirmOptions.title - 对话框标题，默认为"提示"
 * @param {String} confirmOptions.content - 对话框内容，默认为"确定执行此操作？"
 * @param {Object} options - 云函数调用配置，同callCloudFunction的options参数
 * @returns {Promise} - 返回Promise对象，如果用户取消则返回rejected Promise
 */
function callCloudFunctionWithConfirm(name, data = {}, confirmOptions = {}, options = {}) {
  // 默认确认选项
  const defaultConfirmOptions = {
    title: '提示',
    content: '确定执行此操作？'
  };

  // 合并确认选项
  const finalConfirmOptions = { ...defaultConfirmOptions, ...confirmOptions };

  // 返回Promise
  return new Promise((resolve, reject) => {
    wx.showModal({
      title: finalConfirmOptions.title,
      content: finalConfirmOptions.content,
      success(res) {
        if (res.confirm) {
          // 用户点击确定，调用云函数
          callCloudFunction(name, data, options)
            .then(resolve)
            .catch(reject);
        } else {
          // 用户点击取消
          reject(new Error('用户取消操作'));
        }
      },
      fail() {
        // 显示对话框失败
        reject(new Error('显示确认对话框失败'));
      }
    });
  });
}

/**
 * 批量调用同一个云函数处理一组数据
 * @param {String} name - 云函数名称
 * @param {Array} dataArray - 数据数组，每个元素将作为单独的云函数调用参数
 * @param {Object} options - 配置选项
 * @param {Boolean} options.showLoading - 是否显示加载提示，默认为true
 * @param {String} options.loadingTitle - 加载提示文字，默认为"批量处理中"
 * @param {Boolean} options.showError - 是否显示错误提示，默认为true
 * @param {Boolean} options.showSuccess - 是否在成功时显示提示，默认为false
 * @param {String} options.successTitle - 成功提示文字，默认为"批量操作成功"
 * @param {Boolean} options.parallel - 是否并行调用，默认为false（串行调用）
 * @param {Number} options.batchSize - 并行调用时的批次大小，默认为5
 * @param {Function} options.progressCallback - 进度回调函数，参数为(current, total, results)
 * @returns {Promise<Array>} - 返回Promise对象，resolve时返回所有调用结果的数组
 */
function callCloudFunctionBatch(name, dataArray = [], options = {}) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    return Promise.resolve([]);
  }

  // 默认配置
  const defaultOptions = {
    showLoading: true,
    loadingTitle: '批量处理中',
    showError: true,
    showSuccess: false,
    successTitle: '批量操作成功',
    parallel: false,
    batchSize: 5,
    progressCallback: null
  };

  // 合并配置
  const finalOptions = { ...defaultOptions, ...options };

  // 显示加载提示
  if (finalOptions.showLoading) {
    wx.showLoading({
      title: finalOptions.loadingTitle,
      mask: true
    });
  }

  let promise;
  const total = dataArray.length;
  const results = [];

  // 根据parallel选项决定使用并行还是串行处理
  if (finalOptions.parallel) {
    // 并行处理，但分批次进行以避免同时发起过多请求
    promise = new Promise(async (resolve, reject) => {
      try {
        const batches = [];
        for (let i = 0; i < dataArray.length; i += finalOptions.batchSize) {
          batches.push(dataArray.slice(i, i + finalOptions.batchSize));
        }

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const batchPromises = batch.map(data => 
            wx.cloud.callFunction({
              name: name,
              data: data
            }).catch(err => {
              // 记录错误但不中断整个批处理
              console.error(`批量调用云函数 ${name} 出错:`, err);
              return { error: err };
            })
          );

          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);

          // 调用进度回调
          if (typeof finalOptions.progressCallback === 'function') {
            const current = Math.min((i + 1) * finalOptions.batchSize, total);
            finalOptions.progressCallback(current, total, results);
          }
        }

        resolve(results);
      } catch (err) {
        reject(err);
      }
    });
  } else {
    // 串行处理
    promise = dataArray.reduce(async (previousPromise, data, index) => {
      const previousResults = await previousPromise;
      
      try {
        const result = await wx.cloud.callFunction({
          name: name,
          data: data
        });
        
        previousResults.push(result);
        
        // 调用进度回调
        if (typeof finalOptions.progressCallback === 'function') {
          finalOptions.progressCallback(index + 1, total, previousResults);
        }
        
        return previousResults;
      } catch (err) {
        console.error(`批量调用云函数 ${name} 出错:`, err);
        previousResults.push({ error: err });
        return previousResults;
      }
    }, Promise.resolve([]));
  }

  return promise.then(results => {
    // 隐藏加载提示
    if (finalOptions.showLoading) {
      wx.hideLoading();
    }

    // 显示成功提示
    if (finalOptions.showSuccess) {
      wx.showToast({
        title: finalOptions.successTitle,
        icon: 'success',
        duration: 2000
      });
    }

    return results;
  }).catch(err => {
    // 隐藏加载提示
    if (finalOptions.showLoading) {
      wx.hideLoading();
    }

    // 显示错误提示
    if (finalOptions.showError) {
      wx.showToast({
        title: '批量操作失败：' + (err.message || '未知错误'),
        icon: 'none',
        duration: 3000
      });
    }

    // 继续抛出错误，让调用者可以进行自定义处理
    throw err;
  });
}

/**
 * 按顺序调用一系列云函数
 * @param {Array} functionCalls - 云函数调用配置数组，每个元素为 {name, data, options} 对象
 * @param {Object} globalOptions - 全局配置选项，会与每个调用的options合并
 * @param {Boolean} globalOptions.showLoading - 是否显示加载提示，默认为true
 * @param {String} globalOptions.loadingTitle - 加载提示文字，默认为"处理中"
 * @param {Boolean} globalOptions.showError - 是否显示错误提示，默认为true
 * @param {Boolean} globalOptions.continueOnError - 某个调用失败时是否继续后续调用，默认为false
 * @param {Function} globalOptions.progressCallback - 进度回调函数，参数为(current, total, results)
 * @returns {Promise<Array>} - 返回Promise对象，resolve时返回所有调用结果的数组
 */
function callCloudFunctionSequence(functionCalls = [], globalOptions = {}) {
  if (!Array.isArray(functionCalls) || functionCalls.length === 0) {
    return Promise.resolve([]);
  }

  // 默认全局配置
  const defaultGlobalOptions = {
    showLoading: true,
    loadingTitle: '处理中',
    showError: true,
    continueOnError: false,
    progressCallback: null
  };

  // 合并全局配置
  const finalGlobalOptions = { ...defaultGlobalOptions, ...globalOptions };

  // 显示加载提示
  if (finalGlobalOptions.showLoading) {
    wx.showLoading({
      title: finalGlobalOptions.loadingTitle,
      mask: true
    });
  }

  const total = functionCalls.length;
  const results = [];

  // 串行调用所有云函数
  return functionCalls.reduce(async (previousPromise, functionCall, index) => {
    try {
      await previousPromise;
      
      // 提取函数调用参数
      const { name, data = {}, options = {} } = functionCall;
      
      // 合并选项，但不显示每个函数调用的loading和错误提示，由sequence统一处理
      const callOptions = {
        ...options,
        showLoading: false,
        showError: false
      };
      
      // 调用云函数
      const result = await callCloudFunction(name, data, callOptions);
      results.push(result);
      
      // 调用进度回调
      if (typeof finalGlobalOptions.progressCallback === 'function') {
        finalGlobalOptions.progressCallback(index + 1, total, results);
      }
      
      return results;
    } catch (err) {
      console.error(`顺序调用云函数出错:`, err);
      results.push({ error: err });
      
      // 根据continueOnError决定是否继续
      if (!finalGlobalOptions.continueOnError) {
        throw err;
      }
      
      return results;
    }
  }, Promise.resolve())
    .then(results => {
      // 隐藏加载提示
      if (finalGlobalOptions.showLoading) {
        wx.hideLoading();
      }
      
      return results;
    })
    .catch(err => {
      // 隐藏加载提示
      if (finalGlobalOptions.showLoading) {
        wx.hideLoading();
      }
      
      // 显示错误提示
      if (finalGlobalOptions.showError) {
        wx.showToast({
          title: '操作失败：' + (err.message || '未知错误'),
          icon: 'none',
          duration: 3000
        });
      }
      
      // 继续抛出错误，让调用者可以进行自定义处理
      throw err;
    });
}

module.exports = {
  callCloudFunction,
  callCloudFunctionWithConfirm,
  callCloudFunctionBatch,
  callCloudFunctionSequence
};