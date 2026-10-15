const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name=local-token]').content;
async function request(options={}){
  const response=await fetch('/config',{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}});
  const data=await response.json();if(!response.ok)throw new Error(data.error || '配置读取失败');return data;
}
function display(data){
  $('endpoint').value=data.endpoint;$('model').value=data.model;$('style').value=data.style;$('limit').value=data.contextLimit;$('json').checked=data.jsonMode;
  $('key').value='';$('clear').checked=false;
  $('key').placeholder=data.hasKey?'已设置；留空保留原密钥':'未设置；无需密钥的接口可留空';
  $('key-state').textContent=data.hasKey?'密钥已保存，页面不会回显。':'尚未保存密钥。';
}
request().then(display).catch(err=>$('status').textContent=err.message);
$('config').onsubmit=async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try{
    const data=await request({method:'POST',body:JSON.stringify({endpoint:$('endpoint').value,model:$('model').value,apiKey:$('key').value,clearKey:$('clear').checked,style:$('style').value,contextLimit:Number($('limit').value),jsonMode:$('json').checked})});
    display(data);$('status').textContent='配置已保存，未调用 API。请选择 AI 上下文模式开始翻译。';
  }catch(err){$('status').textContent=err.message;}finally{button.disabled=false;}
};
