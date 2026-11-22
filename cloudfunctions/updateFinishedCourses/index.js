const cloud = require('wx-server-sdk'); 
cloud.init(); 
const db = cloud.database(); 
const _ = db.command;

exports.main = async (event, context) => { 
  try { 
    // 直接更新文档，无需先获取它们
    const result = await db.collection('myCourses')
      .where({
        endTime: _.lte(new Date().getTime()),
        finished: _.neq(true) // 只更新尚未完成的文档
      })
      .update({
        data: {
          finished: true
        }
      });
    
    return { 
      code: 200, 
      msg: '更新成功', 
      updatedCount: result.stats.updated 
    }; 
  } catch (err) { 
    console.error(err); 
    return { code: 500, msg: '更新失败' }; 
  } 
};