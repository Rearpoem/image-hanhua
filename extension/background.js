const LOCAL = 'http://127.0.0.1:17863';
const LIMIT = 12 * 1024 * 1024;

async function localRequest(path, options = {}) {
  const { pairingToken } = await chrome.storage.local.get('pairingToken');
  if (!pairingToken) throw new Error('请先在插件设置中填写本地配对码');
  let response;
  try {
    response = await fetch(LOCAL + path, {
      ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairingToken}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new Error('本地服务未响应，请先运行启动脚本（Mac：启动.command，Windows：start.bat）后重试');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `本地服务错误：${response.status}`);
  return data;
}

async function fetchPicture(url) {
  if (typeof url !== 'string' || url.length > LIMIT * 4 / 3 + 1024) throw new Error('图片地址无效');
  if (url.startsWith('data:image/') && url.includes(';base64,')) return url;
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('此图片无法读取，可尝试刷新网页');
  const permission = `${parsed.origin}/*`;
  if (!await chrome.permissions.contains({ origins: [permission] })) {
    throw new Error('图片域名未授权，请从插件面板重新点击“翻译当前页”并允许读取图片');
  }
  const response = await fetch(parsed.href, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`图片下载失败（${response.status}），可能需要登录或有防盗链限制`);
  const mime = response.headers.get('Content-Type')?.split(';')[0];
  if (!mime?.startsWith('image/')) throw new Error('地址返回的内容不是图片');
  if (Number(response.headers.get('Content-Length')) > LIMIT) throw new Error('图片超过 12 MB');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > LIMIT) { await reader.cancel(); throw new Error('图片超过 12 MB'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!['submitPicture','submitContext','jobStatus'].includes(message.type)) return;
  if (!sender.tab || !/^https?:/.test(sender.url || '')) {
    respond({error:'只能处理普通网页中的图片'}); return;
  }
  async function handle() {
    if (message.type === 'jobStatus') {
      if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(message.id)) throw new Error('任务编号无效');
      return localRequest(`/jobs/${message.id}`);
    }
    const payload = message.type === 'submitContext' ? message.payload : {
      image:await fetchPicture(message.url),ocrOnly:message.ocrOnly===true
    };
    return localRequest(message.type === 'submitContext' ? '/ai/jobs' : '/jobs', {
      method:'POST',body:JSON.stringify(payload)
    });
  }
  handle().then(result=>respond({result}),error=>respond({error:error.message}));
  return true;
});

// Keep credentials available only to extension pages and the service worker.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
