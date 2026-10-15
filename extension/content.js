(() => {
  if (globalThis.__localImageTranslation) return;
  async function request(message) {
    let response;
    try { response=await chrome.runtime.sendMessage(message); }
    catch { throw new Error('插件连接已断开。若刚重新加载插件，请刷新此网页后再开始翻译'); }
    if (!response) throw new Error('插件后台未响应，请重新加载插件并刷新网页；已提交的任务可能仍在处理');
    if (response.error) throw new Error(response.error);
    return response.result;
  }
  const tool = LocalImageTranslator.create(LocalTranslationJobs.create(request,info=>tool.progress(info)));
  globalThis.__localImageTranslation = tool;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'start') tool.start({ai:message.mode === 'ai'});
    if (message.type === 'stop') tool.stop();
    if (message.type === 'toggle') tool.toggle();
    if (['start','stop','toggle','status'].includes(message.type)) respond(tool.status());
  });
})();
