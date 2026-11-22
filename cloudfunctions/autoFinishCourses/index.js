const cloud = require('wx-server-sdk'); 
cloud.init(); 
const db = cloud.database(); 
const _ = db.command;

exports.main = async (event, context) => { 
  try { 
    // 计算昨天的开始和结束时间戳
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); // 今天0点
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000; // 昨天0点
    const yesterdayEnd = todayStart - 1; // 昨天23:59:59:999
    
    console.log('Yesterday range:', new Date(yesterdayStart), 'to', new Date(yesterdayEnd));
    
    // 更新昨天结束的课程
    const result = await db.collection('myCourses')
      .where({
        endTime: _.gte(yesterdayStart).and(_.lte(yesterdayEnd)),
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