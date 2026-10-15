const $ = id => document.getElementById(id);
const LOCAL = 'http://127.0.0.1:17863';
async function check() {
  try {
    const { pairingToken } = await chrome.storage.local.get('pairingToken');
    const response = await fetch(LOCAL+'/health',{signal:AbortSignal.timeout(2500)});
    const data = await response.json();
    if (!response.ok || !data.ready) throw new Error();
    $('service').textContent = pairingToken ? '本地服务已就绪 · 英韩自动识别 → 简体中文' : '本地服务已就绪，请先填写配对码';
    $('dot').className = 'dot '+(pairingToken?'ready':'error');
  } catch {
    $('service').textContent = '本地服务未启动，请运行启动脚本（Mac：启动.command，Windows：start.bat）'; $('dot').className='dot error';
  }
  $('cdn').checked = await chrome.permissions.contains({origins:['http://*/*','https://*/*']});
}
async function command(type) {
  $('message').textContent='';
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('请在普通网页使用。Edge 设置页、扩展页和 PDF 阅读器不支持。');
  if (type === 'start') {
    const { pairingToken } = await chrome.storage.local.get('pairingToken');
    if (!pairingToken) throw new Error('请先打开“配对设置”，填写本地配对码');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['engine.js','jobs.js','content.js']});
  }
  try { await chrome.tabs.sendMessage(tab.id,{type,mode:$('mode').value}); }
  catch { throw new Error('当前页面尚未开启翻译，或网页已刷新，请先点击“翻译当前页”'); }
}
$('start').onclick = async () => {
  $('start').disabled=true;
  try {
    // Request permissions directly inside the user's click handler.
    if ($('cdn').checked && !await chrome.permissions.request({origins:['http://*/*','https://*/*']})) {
      throw new Error('未授予跨域图片读取权限。取消勾选后仍可处理能直接读取的图片。');
    }
    await command('start'); window.close();
  } catch(err) { $('message').textContent=err.message; }
  finally { $('start').disabled=false; }
};
for (const type of ['toggle','stop']) $(type).onclick=()=>command(type).catch(err=>$('message').textContent=err.message);
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('local').onclick=()=>chrome.tabs.create({url:LOCAL+'/setup'});
check();

$('ai-settings').onclick=()=>chrome.tabs.create({url:LOCAL+'/ai-settings'});
chrome.storage.local.get('translateMode').then(data=>$('mode').value=data.translateMode || 'local');
$('mode').onchange=()=>chrome.storage.local.set({translateMode:$('mode').value});
