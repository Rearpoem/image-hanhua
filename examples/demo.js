const token=document.querySelector('meta[name=local-token]').content;
async function request(path,options={}){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
const transport=LocalTranslationJobs.create(async message=>{
  if(message.type==='jobStatus')return request(`/jobs/${message.id}`);
  const path=message.type==='submitContext'?'/ai/jobs':'/jobs';
  let image=message.url;
  if(message.type==='submitPicture' && !image.startsWith('data:')){
    const response=await fetch(image);if(!response.ok)throw new Error('图片读取失败');
    const blob=await response.blob();
    image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  }
  const payload=message.type==='submitContext'?message.payload:{image,ocrOnly:message.ocrOnly};
  return request(path,{method:'POST',body:JSON.stringify(payload)});
},info=>tool.progress(info));
const tool=LocalImageTranslator.create(transport);
document.getElementById('start').onclick=()=>{const ai=document.getElementById('mode').value==='ai';tool.start({ai});document.getElementById('feedback').textContent=ai?'正在识别图片，随后提交网页上下文。':'正在本机处理图片。';};
document.getElementById('toggle').onclick=()=>tool.toggle();
document.getElementById('stop').onclick=()=>{tool.stop();document.getElementById('feedback').textContent='已停止，原图已恢复。';};
document.getElementById('resize').onclick=()=>document.getElementById('fit-image').classList.toggle('small');
document.getElementById('swap').onclick=()=>{const img=document.getElementById('fit-image');img.src=img.src.endsWith('/blank.png')?'/sample.png':'/blank.png';};
document.getElementById('add').onclick=()=>{const img=document.createElement('img');img.src='/korean.png';img.alt='动态加载的韩文图片';document.getElementById('added').append(img);};
document.getElementById('error').onclick=()=>{const img=document.createElement('img');img.src='/large.png';img.alt='超过像素限制的图片';document.getElementById('added').append(img);};
