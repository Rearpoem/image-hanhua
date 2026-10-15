(() => {
  if (globalThis.LocalImageTranslator) return;

  function create({ translate, translateBatch, checkProgress, resetProgress }) {
    let active = false, visible = true, pumping = false, generation = 0, panelHidden = false;
    const entries = new Map(), cache = new Map();
    let frame = 0, scanTimer = 0, ai = false, serial = 0, notice = "", live = null, begun = 0, checkMessage = "", monitorTimer = 0;
    const host = document.createElement('div');
    host.setAttribute('data-local-image-translator', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#18223b}
      *{box-sizing:border-box}.layer{position:absolute;overflow:hidden;pointer-events:none}
      .box{position:absolute;background:#fff;color:#151e31;display:flex;align-items:center;justify-content:center;text-align:center;padding:1px 3px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-weight:550;line-height:1.14;overflow:hidden;border-radius:2px;white-space:normal;word-break:break-word;pointer-events:none}
      .panel{position:absolute;right:20px;bottom:20px;max-width:min(430px,calc(100vw - 24px));border:1px solid #ccd6e6;background:#f5f8ff;border-radius:14px;box-shadow:0 5px 22px #23396222;padding:13px 15px;pointer-events:auto;font-size:13px;line-height:1.55}
      [hidden]{display:none!important}.restore{position:absolute;right:20px;bottom:20px;width:42px;height:42px;border-radius:50%;background:#f5f8ff;box-shadow:0 3px 12px #23396222;pointer-events:auto;font-weight:750;font-size:17px}.heading{font-weight:750;color:#234d9b;font-size:14px}.status{margin:5px 0;color:#334562}.error{color:#a23737;font-size:12px;max-height:68px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
      .monitor{margin-top:7px;padding-top:7px;border-top:1px solid #ccd6e6;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}progress{width:100%;height:8px;accent-color:#2458a4}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}button{font:inherit;border:1px solid #bccbe2;background:white;color:#234d9b;border-radius:7px;padding:5px 9px;cursor:pointer}button:focus-visible{outline:3px solid #6495e5;outline-offset:2px}button:hover{background:#e6edfc}
    </style><button class="restore" hidden aria-label="展开图片翻译面板" aria-controls="translation-panel" aria-expanded="false" title="展开翻译面板">译</button><div id="translation-panel" class="panel" role="region" aria-label="图片汉化工具栏"><div class="heading">图片汉化 · 本地</div><div class="status" role="status" aria-live="polite"></div><progress class="overall" max="100" value="0" aria-label="整体处理进度"></progress><div class="monitor" aria-live="off"></div><div class="error"></div><div class="actions"><button class="check">检查当前进度</button><button class="toggle">显示原图</button><button class="retry">重试未完成部分</button><button class="hide">隐藏面板</button><button class="close">停止并移除</button></div></div>`;
    const status = shadow.querySelector('.status'), error = shadow.querySelector('.error');
    const toggle = shadow.querySelector('.toggle');
    const panel = shadow.querySelector('.panel'), restore = shadow.querySelector('.restore');
    function setPanelHidden(hidden) {
      panelHidden=hidden; panel.hidden=hidden; restore.hidden=!hidden;
      restore.setAttribute('aria-expanded',String(!hidden));
    }
    shadow.querySelector('.hide').onclick=()=>{setPanelHidden(true);restore.focus();};
    restore.onclick=()=>{setPanelHidden(false);shadow.querySelector('.hide').focus();};
    shadow.querySelector('.check').onclick = async () => {
      const button=shadow.querySelector('.check'); button.disabled=true;
      try {
        const result=checkProgress ? await checkProgress() : {idle:true};
        checkMessage=result.idle ? '检查完成：当前没有在途任务' : '检查完成：本地任务可查询，连接正常';
      } catch(err) { checkMessage='检查失败：'+(err.message || '无法连接'); }
      finally { button.disabled=false; updateStatus(); }
    };
    toggle.onclick = () => { visible = !visible; toggle.textContent = visible ? '显示原图' : '显示中文'; scheduleLayout(); };
    shadow.querySelector('.retry').onclick = () => retry();
    shadow.querySelector('.close').onclick = () => stop();

    function updateStatus() {
      const all = [...entries.values()];
      const completed = all.filter(e => e.state === 'done');
      const failed = all.filter(e => e.state === 'failed');
      const partial = all.filter(e => e.state === 'partial');
      const skipped = all.filter(e => e.state === 'skipped');
      const waiting = all.filter(e => ['pending','running','recognized'].includes(e.state)).length;
      status.textContent = `已处理 ${completed.length} 张${partial.length ? ` · 部分完成 ${partial.length} 张` : ''} · 待处理 ${waiting} 张 · 失败 ${failed.length} 张${skipped.length ? ` · 跳过 ${skipped.length} 张` : ''}`;
      if (completed.length && completed.every(e => !e.result.boxes.length) && !waiting) status.textContent += ' · 未发现可识别的英文或韩文';
      if (!all.length) status.textContent = '当前未发现图片，滚动或加载新图片后会继续检查';
      const recognized=all.filter(e=>e.result).length;
      const totalBoxes=all.reduce((n,e)=>n+(e.result?.boxes.length || 0),0);
      const visibleBoxes=all.reduce((n,e)=>n+(e.result?.boxes.filter(b=>b.translation).length || 0),0);
      const inFlight=all.some(e=>['pending','running','recognized'].includes(e.state));
      const remote=live?.type==='submitContext' && live.state!=='done' && live.state!=='failed' ? live.progress : null;
      const settled=completed.length+failed.length+partial.length+skipped.length;
      const pct=all.length ? (ai ? (inFlight ? 50*recognized/all.length + (totalBoxes ? 50*(visibleBoxes+(remote?.completedBlocks || 0)+(remote?.failedBlocks || 0))/totalBoxes : 0) : 100) : 100*settled/all.length) : 0;
      shadow.querySelector('.overall').value=Math.min(100,Math.round(pct));
      let stage=!active ? '已停止' : !inFlight ? (failed.length || partial.length ? '本轮结束，有未完成部分' : '本轮结束，等待新图片') : remote ? remote.phase : ai ? '识别图片 / 准备上下文' : '本机识别与翻译';
      const elapsed=begun ? Math.floor((Date.now()-begun)/1000) : 0;
      let detail=`整体处理：${Math.min(100,Math.round(pct))}% · 已用时 ${Math.floor(elapsed/60)}分${elapsed%60}秒\n当前阶段：${stage}\n已识别 ${recognized}/${all.length} 张 · 已显示中文 ${visibleBoxes}/${totalBoxes} 框`;
      if (remote) detail+=`\nAI 批次 ${remote.batch || 0}/${remote.batches || '?'} · 本轮成功 ${remote.completedBlocks || 0} 框 · 异常 ${remote.failedBlocks || 0} 框`;
      if (inFlight && live) {
        detail+=`\n任务编号：${live.id}\n最近连接：${Math.floor((Date.now()-live.lastContact)/1000)} 秒前`;
        const unchanged=live.updatedAt ? Math.floor(Date.now()/1000-live.updatedAt) : 0;
        if (unchanged>=100) detail+=`\n阶段 ${unchanged} 秒未变化；可检查连接，不代表任务已失败`;
      }
      if (checkMessage) detail+='\n'+checkMessage;
      shadow.querySelector('.monitor').textContent=detail;
      error.textContent = notice + (notice ? '\n' : '') + [...new Set(failed.concat(partial).map(e => e.error).concat(skipped.map(e => e.error)))].slice(0,3).join('\n');
    }

    function fit(node, width, height, sourceHeight) {
      let size = Math.min(32, Math.max(8, sourceHeight * 0.85));
      node.style.fontSize = `${size}px`;
      while (size > 8 && (node.scrollHeight > height + 1 || node.scrollWidth > width + 1)) {
        size -= 1;
        node.style.fontSize = `${size}px`;
      }
    }

    function imageArea(img, result) {
      const r = img.getBoundingClientRect(), css = getComputedStyle(img);
      const sx = r.width / (img.offsetWidth || r.width), sy = r.height / (img.offsetHeight || r.height);
      const leftInset = (parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)) * sx;
      const topInset = (parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop)) * sy;
      const cw = r.width - leftInset - (parseFloat(css.borderRightWidth) + parseFloat(css.paddingRight)) * sx;
      const ch = r.height - topInset - (parseFloat(css.borderBottomWidth) + parseFloat(css.paddingBottom)) * sy;
      let w = cw, h = ch;
      const fit = css.objectFit;
      if (fit !== 'fill') {
        const nw = img.naturalWidth || result.width, nh = img.naturalHeight || result.height;
        let scale = fit === 'cover' ? Math.max(cw / nw, ch / nh) : Math.min(cw / nw, ch / nh);
        if (fit === 'none') scale = 1;
        if (fit === 'scale-down') scale = Math.min(1, scale);
        w = nw * scale; h = nh * scale;
      }
      const pos = css.objectPosition.split(/\s+/);
      function position(value, space) {
        if (value === 'left' || value === 'top') return 0;
        if (value === 'right' || value === 'bottom') return space;
        if (value === 'center') return space / 2;
        return value?.endsWith('%') ? space * parseFloat(value) / 100 : parseFloat(value) || 0;
      }
      let clip = { left:r.left+leftInset, top:r.top+topInset, right:r.left+leftInset+cw, bottom:r.top+topInset+ch };
      let ancestor = img.parentElement;
      while (ancestor && ancestor !== document.body) {
        const ac = getComputedStyle(ancestor), ar = ancestor.getBoundingClientRect();
        if (/(hidden|clip|scroll|auto)/.test(ac.overflowX)) { clip.left = Math.max(clip.left, ar.left); clip.right = Math.min(clip.right, ar.right); }
        if (/(hidden|clip|scroll|auto)/.test(ac.overflowY)) { clip.top = Math.max(clip.top, ar.top); clip.bottom = Math.min(clip.bottom, ar.bottom); }
        ancestor = ancestor.parentElement;
      }
      return { r, clip, x:r.left+leftInset+position(pos[0],cw-w), y:r.top+topInset+position(pos[1] || '50%',ch-h), w, h,
        hidden: css.visibility === 'hidden' || css.display === 'none' || Number(css.opacity) === 0 };
    }

    function layout() {
      frame = 0;
      for (const [img, e] of entries) {
        if (!img.isConnected) { e.layer?.remove(); sizes.unobserve(img); entries.delete(img); continue; }
        if (!e.layer) continue;
        const a = imageArea(img, e.result), c = a.clip;
        if (!visible || !active || a.hidden || c.right <= 0 || c.left >= innerWidth || c.bottom <= 0 || c.top >= innerHeight || c.right <= c.left || c.bottom <= c.top) {
          e.layer.style.display = 'none'; continue;
        }
        e.layer.style.cssText = `display:block;left:${c.left}px;top:${c.top}px;width:${c.right-c.left}px;height:${c.bottom-c.top}px;`;
        e.result.boxes.forEach((b, i) => {
          const node = e.layer.children[i];
          const pad = Math.min(4, Math.max(1,b.height*a.h*0.08));
          const w = b.width*a.w+pad*2, h = b.height*a.h+pad*2;
          node.style.left = `${a.x-c.left+b.x*a.w-pad}px`;
          node.style.top = `${a.y-c.top+b.y*a.h-pad}px`;
          node.style.width = `${w}px`; node.style.height = `${h}px`;
          fit(node, w, h, b.line_height*a.h);
        });
      }
    }
    function scheduleLayout() { if (!frame) frame = requestAnimationFrame(layout); }

    function render(e) {
      e.layer?.remove();
      const layer = document.createElement('div'); layer.className = 'layer';
      for (const box of e.result.boxes) {
        const node = document.createElement('div'); node.className = 'box';
        node.textContent = box.translation || '';
        if (!box.translation) node.style.display='none';
        node.setAttribute('aria-label', `${box.original} → ${box.translation}`);
        layer.append(node);
      }
      shadow.append(layer); e.layer = layer; scheduleLayout();
    }

    async function pictureData(img) {
      // Canvas works with same-origin, data, and some blob images. CDN images
      // fall back to extension fetching, without sending credentials.
      try {
        if (img.naturalWidth * img.naturalHeight > 24_000_000) throw new Error('oversized');
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth*scale); canvas.height = Math.round(img.naturalHeight*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        return canvas.toDataURL('image/png');
      } catch { return img.currentSrc || img.src; }
    }

    async function pump() {
      if (pumping || !active) return;
      pumping = true;
      try {
        while (active) {
          const pending = [...entries.entries()].filter(([img,e]) => img.isConnected && e.state === 'pending');
          // Visible pictures go first; already loaded off-screen pictures follow.
          pending.sort(([a],[b]) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
          if (!pending.length) {
            const group = [...entries.values()].filter(e => e.state === 'recognized');
            if (!ai || !group.length) break;
            const round = generation;
            try {
              const blocks = group.flatMap(e => e.result.boxes.flatMap((b,i) => b.translation ? [] : [{id:`${e.id}:${i}`,text:b.original}]));
              const previous = [...entries.values()].filter(e => e.result).flatMap(e => e.result.boxes.map(b => `${b.original}${b.translation ? ' → '+b.translation : ''}`)).join('\n');
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let text = '', node;
              while ((node = walker.nextNode()) && text.length < 60001) {
                const parent = node.parentElement;
                if (!parent || parent.closest('script,style,noscript,input,textarea,[contenteditable],[data-private],[data-local-image-translator]') || !parent.getClientRects().length) continue;
                text += node.textContent.trim() + '\n';
              }
              const result = blocks.length ? await translateBatch({blocks,context:{title:document.title,text:text.slice(0,60000),truncated:text.length>60000,previous}}) : {translations:[]};
              if (!active || generation !== round) continue;
              const translated = new Map(result.translations.map(b => [b.id,b.text]));
              const failures = new Map((result.failures || []).map(b => [b.id,b.error]));
              notice = result.notice || '';
              for (const e of group) {
                if (![...entries.values()].includes(e)) continue;
                e.result = {...e.result,boxes:e.result.boxes.map((b,i) => ({...b,translation:b.translation || translated.get(`${e.id}:${i}`) || ''}))};
                const missing = e.result.boxes.filter(b => !b.translation);
                e.state = missing.length ? (missing.length === e.result.boxes.length ? 'failed' : 'partial') : 'done';
                e.error = missing.length ? [...new Set(e.result.boxes.flatMap((b,i) => b.translation ? [] : [failures.get(`${e.id}:${i}`) || '文字框未翻译']))].slice(0,2).join('\n') : '';
                render(e);
              }
            } catch (err) {
              if (round !== generation) continue;
              for (const e of group) { e.state='failed'; e.error=err.message || 'AI 翻译失败'; }
            }
            updateStatus(); continue;
          }
          const [img,e] = pending[0], round = generation;
          e.state = 'running'; updateStatus();
          try {
            let result = cache.get(e.url);
            if (!result) {
              result = await translate(await pictureData(img), {ocrOnly:ai});
              cache.set(e.url,result);
              if (cache.size > 64) cache.delete(cache.keys().next().value);
            }
            if (!active || round !== generation || entries.get(img) !== e) continue;
            e.result = result; e.state = ai ? 'recognized' : 'done'; if (!ai) render(e);
          } catch (err) {
            if (round !== generation || entries.get(img) !== e) continue;
            e.state = 'failed'; e.error = err.message || '图片翻译失败';
          }
          updateStatus();
        }
      } finally { pumping = false; if (active && [...entries.values()].some(e => e.state === 'pending')) pump(); }
    }

    const sizes = new ResizeObserver(scheduleLayout);
    function scan() {
      if (!active) return;
      for (const img of document.images) {
        if (!img.complete || !img.naturalWidth || img.naturalWidth < 60 || img.naturalHeight < 28) continue;
        const url = img.currentSrc || img.src;
        if (entries.get(img)?.url === url) continue;
        const previous = entries.get(img); previous?.layer?.remove();
        const css = getComputedStyle(img);
        const transform = css.transform;
        const rotated = transform.startsWith('matrix(') && transform.slice(7,-1).split(',').some((v,i) => (i === 1 || i === 2) && Math.abs(Number(v)) > 0.001);
        const e = { id:++serial, url, state: rotated ? 'skipped' : 'pending', error: rotated ? '旋转或倾斜的图片暂不覆盖，避免中文错位' : '' };
        entries.set(img,e); sizes.observe(img);
      }
      scheduleLayout(); updateStatus(); pump();
    }
    function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 200); }
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => !host.contains(m.target))) scheduleScan();
    });
    function start(options = {}) {
      const nextAI = options.ai === true;
      if (active && nextAI !== ai) stop();
      ai=nextAI; notice='';
      shadow.querySelector('.heading').textContent = ai ? '图片汉化 · AI 上下文' : '图片汉化 · 本地';
      if (active) { scan(); return; }
      setPanelHidden(false);
      active = true; visible = true; begun=Date.now(); live=null; checkMessage=''; clearInterval(monitorTimer); monitorTimer=setInterval(updateStatus,1000); generation++; toggle.textContent = '显示原图';
      document.documentElement.append(host);
      observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','sizes','style','class']});
      document.addEventListener('load',scheduleScan,true);
      window.addEventListener('scroll',scheduleLayout,true);
      window.addEventListener('resize',scheduleScan);
      scan();
    }
    function stop() {
      active = false; resetProgress?.(); clearInterval(monitorTimer); live=null; generation++; observer.disconnect(); sizes.disconnect();
      clearTimeout(scanTimer); cancelAnimationFrame(frame); frame=0;
      document.removeEventListener('load',scheduleScan,true);
      window.removeEventListener('scroll',scheduleLayout,true);
      window.removeEventListener('resize',scheduleScan);
      host.remove(); for (const e of entries.values()) e.layer?.remove(); entries.clear(); cache.clear();
    }
    function retry() {
      for (const e of entries.values()) if (['failed','partial'].includes(e.state)) { e.state=ai && e.result ? 'recognized' : 'pending'; e.error=''; }
      updateStatus(); pump();
    }
    return { start, stop, retry, progress: info => { if (active) { live=info; updateStatus(); } }, toggle: () => toggle.click(), status: () => ({ active, visible, panelHidden, total:entries.size }) };
  }
  globalThis.LocalImageTranslator = { create };
})();
