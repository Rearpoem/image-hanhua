(() => {
  if (globalThis.LocalTranslationJobs) return;
  function create(request, onProgress = () => {}) {
    let current = null;
    function publish(task, state) {
      if (current !== task) return;
      task.state=state; task.lastContact=Date.now();
      onProgress({id:task.id,type:task.type,started:task.started,lastContact:task.lastContact,state:state.state,progress:state.progress || {},updatedAt:state.updatedAt});
    }
    async function checkProgress() {
      if (!current) return {idle:true};
      const task=current;
      const state=await request({type:"jobStatus",id:task.id});
      publish(task,state);
      return {idle:false};
    }
    async function run(type, payload) {
      // Never retry submission automatically: a lost reply may still have queued a paid job.
      const job = await request({type,...payload});
      if (!job || typeof job.id !== 'string') throw new Error('任务提交未确认，请检查连接后手动重试；原任务可能仍在处理');
      const task={id:job.id,type,started:Date.now()};
      current=task; publish(task,{state:"pending",progress:{phase:"已提交，等待本地服务"}});
      try {
      const deadline = Date.now() + 75 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve,800));
        let state;
        for (let attempt=0;attempt<3;attempt++) {
          try { state=await request({type:'jobStatus',id:job.id}); break; }
          catch(err) {
            if (attempt===2) throw err;
            await new Promise(resolve=>setTimeout(resolve,1000));
          }
        }
        publish(task,state);
        if (state.state === 'done') return state.result;
        if (state.state === 'failed') throw new Error(state.error || '翻译失败');
      }
      throw new Error('任务等待超过 75 分钟，本地任务可能仍在处理，请检查服务');
      } finally { if (current === task) current=null; }
    }
    return {
      checkProgress, resetProgress:()=>{current=null;},
      translate:(url,options)=>run('submitPicture',{url,ocrOnly:options.ocrOnly===true}),
      translateBatch:payload=>run('submitContext',{payload})
    };
  }
  globalThis.LocalTranslationJobs={create};
})();
