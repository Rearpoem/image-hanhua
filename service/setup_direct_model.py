"""Download pinned CT2 data files, verify hashes, and keep installation local."""
import hashlib,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
manifest=json.loads((ROOT/'service/direct-model-manifest.json').read_text(encoding='utf-8'))
folder=ROOT/'models/m2m100-ko-zh'
folder.mkdir(parents=True,exist_ok=True)
def valid(path,item):
 if not path.exists() or path.stat().st_size!=item['size']:return False
 digest=hashlib.sha256() if item['algorithm']=='sha256' else hashlib.sha1(f"blob {item['size']}\0".encode())
 with path.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
 return digest.hexdigest()==item['hash']
for item in manifest['files']:
 name=item['name'];path=folder/name
 if valid(path,item):print(f'{name} 已校验',flush=True);continue
 url=f"https://huggingface.co/{manifest['repo']}/resolve/{manifest['revision']}/{name}"
 part=path.with_suffix(path.suffix+'.part')
 print(f'下载 {name}（{item["size"]//1024//1024} MiB）',flush=True)
 with urllib.request.urlopen(url,timeout=90) as response,part.open('wb') as output:
  received=0;next_report=32*1024*1024
  while chunk:=response.read(1024*1024):
   output.write(chunk);received+=len(chunk)
   if received>=next_report:print(f'{name}: {received//1024//1024} MiB',flush=True);next_report+=32*1024*1024
 if not valid(part,item):raise SystemExit(f'{name} 校验失败，未采用')
 part.replace(path)
(folder/'model-info.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('韩语 → 中文直译模型已就绪（M2M100 INT8）',flush=True)
