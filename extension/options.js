const $=id=>document.getElementById(id), LOCAL='http://127.0.0.1:17863';
chrome.storage.local.get('pairingToken').then(data=>$('token').value=data.pairingToken||'');
$('show').onchange=()=>$('token').type=$('show').checked?'text':'password';
$('open').onclick=()=>chrome.tabs.create({url:LOCAL+'/setup'});
$('save').onclick=async()=>{
  const token=$('token').value.trim();
  if(!/^[A-Za-z0-9_-]{32,64}$/.test(token)){$('message').textContent='请复制完整的本地配对码';return;}
  try{
    const response=await fetch(LOCAL+'/jobs/pair-check',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});
    if(response.status===401)throw new Error('配对码不正确，请从本地设置页重新复制');
    if(response.status!==404)throw new Error('服务版本不匹配');
    await chrome.storage.local.set({pairingToken:token});
    $('message').textContent='配对成功。返回网页，点击插件的“翻译当前页”。';
  }catch(err){$('message').textContent=err.message.includes('fetch')||err.name==='TimeoutError'?'本地服务未响应，请先启动服务':err.message;}
};
$('clear').onclick=async()=>{await chrome.storage.local.remove('pairingToken');$('token').value='';$('message').textContent='配对码已清除';};
$('revoke').onclick=async()=>{await chrome.permissions.remove({origins:['http://*/*','https://*/*']});$('message').textContent='跨域图片读取权限已撤回';};
