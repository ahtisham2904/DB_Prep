/* ============================================================
   common.js — shared utilities for SQL Lab
   · SQL syntax highlighter (no deps)
   · copy-to-clipboard
   · StepPlayer: DOM-based step-through engine for query execution
   · table() helper to render data tables with highlight classes
   ============================================================ */

/* ---------- 1. SQL highlighter ---------- */
const SQL_KW = new Set(("select from where group by having order asc desc distinct as on join inner left right full outer "+
 "union intersect minus except all any some in not exists between like is null and or "+
 "insert into values update set delete create table view index trigger before after for each row "+
 "begin end if then else case when count sum avg min max primary key foreign references "+
 "with limit offset cross natural using default check unique constraint add drop alter column "+
 "and or not in exists").split(/\s+/));
const SQL_FN = new Set("count sum avg min max coalesce upper lower round abs length now".split(" "));

function highlightSQL(src){
  let out="", i=0; const n=src.length;
  const esc=c=>c.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  while(i<n){
    const c=src[i];
    if(c==='-'&&src[i+1]==='-'){ let j=i; while(j<n&&src[j]!=='\n')j++; out+=`<span class="tok-com">${esc(src.slice(i,j))}</span>`; i=j; continue; }
    if(c==='/'&&src[i+1]==='*'){ let j=i+2; while(j<n&&!(src[j]==='*'&&src[j+1]==='/'))j++; j=Math.min(j+2,n); out+=`<span class="tok-com">${esc(src.slice(i,j))}</span>`; i=j; continue; }
    if(c==="'"){ let j=i+1; while(j<n&&src[j]!=="'")j++; j=Math.min(j+1,n); out+=`<span class="tok-str">${esc(src.slice(i,j))}</span>`; i=j; continue; }
    if(c==='"'){ let j=i+1; while(j<n&&src[j]!=='"')j++; j=Math.min(j+1,n); out+=`<span class="tok-str">${esc(src.slice(i,j))}</span>`; i=j; continue; }
    if(/[0-9]/.test(c)){ let j=i; while(j<n&&/[0-9.]/.test(src[j]))j++; out+=`<span class="tok-num">${esc(src.slice(i,j))}</span>`; i=j; continue; }
    if(/[A-Za-z_]/.test(c)){ let j=i; while(j<n&&/[A-Za-z0-9_]/.test(src[j]))j++; const w=src.slice(i,j); const lw=w.toLowerCase();
      if(SQL_FN.has(lw)) out+=`<span class="tok-fn">${esc(w)}</span>`;
      else if(SQL_KW.has(lw)) out+=`<span class="tok-key">${esc(w)}</span>`;
      else out+=`<span class="tok-id">${esc(w)}</span>`;
      i=j; continue; }
    if("=<>!+-*/%".includes(c)){ out+=`<span class="tok-op">${esc(c)}</span>`; i++; continue; }
    out+=esc(c); i++;
  }
  return out;
}

function mountCode(){
  document.querySelectorAll("pre code.sql").forEach(code=>{
    if(code.dataset.lit) return;
    const raw=code.textContent; code.dataset.raw=raw; code.innerHTML=highlightSQL(raw); code.dataset.lit="1";
  });
  document.querySelectorAll(".codeblock .copy").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const code=btn.closest(".codeblock").querySelector("code");
      navigator.clipboard.writeText(code.dataset.raw||code.textContent).then(()=>{
        const old=btn.textContent; btn.textContent="✓ copied"; setTimeout(()=>btn.textContent=old,1400);
      });
    });
  });
}

/* ---------- 2. table renderer ----------
   table({caption, cols:['a','b'], rows:[[..],[..]], rowClass:[..], cellClass:{r:{c:'cls'}}, group:[..]})
   rowClass[i]  -> 'keep'|'drop'|'dim'|'focus'|''
   group[i]     -> 1..6  (adds a colored left stripe)
   cellClass    -> map "r-c" -> class (e.g. 'agg','key')
*/
function table(spec){
  const {caption,cols,rows}=spec;
  const rc=spec.rowClass||[], grp=spec.group||[], cc=spec.cellClass||{};
  let h=`<table class="dtbl">`;
  if(caption) h+=`<caption>${caption}</caption>`;
  h+=`<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>`;
  rows.forEach((r,ri)=>{
    const cls=[rc[ri]||'', grp[ri]?('g'+grp[ri]):''].filter(Boolean).join(' ');
    h+=`<tr class="${cls}">`+r.map((v,ci)=>{
      const k=cc[ri+'-'+ci]||''; return `<td class="${k}">${v}</td>`;
    }).join('')+`</tr>`;
  });
  return h+`</tbody></table>`;
}

/* ---------- 3. StepPlayer (DOM) ---------- */
class StepPlayer{
  constructor(opts){
    this.mount=opts.mount; this.narrEl=opts.narration; this.controls=opts.controls;
    this.render=opts.render; this.onIndex=opts.onIndex||(()=>{});
    this.steps=[]; this.idx=0; this.playing=false; this.speed=1; this._t=null; this.frameMs=1600;
    this._buildControls();
  }
  _buildControls(){
    this.controls.innerHTML=`
      <button class="play" data-a="play">▶ Play</button>
      <button data-a="step">⤼ Step</button>
      <button data-a="back">⟲ Back</button>
      <button data-a="reset">⏮ Reset</button>
      <span class="sp">Speed <input type="range" min="0.5" max="2.2" step="0.1" value="1"></span>`;
    this.controls.querySelector('[data-a=play]').onclick=()=>this.toggle();
    this.controls.querySelector('[data-a=step]').onclick=()=>this.next();
    this.controls.querySelector('[data-a=back]').onclick=()=>this.prev();
    this.controls.querySelector('[data-a=reset]').onclick=()=>this.reset();
    this.controls.querySelector('input').oninput=e=>this.speed=+e.target.value;
  }
  load(steps){ this.steps=steps; this.idx=0; this.playing=false; this._stop(); this._renderNarr(); this.draw(); this._sync(); }
  _renderNarr(){ if(!this.narrEl)return; this.narrEl.innerHTML=this.steps.map((s,k)=>
    `<div class="step" data-k="${k}"><span class="si">${String(k+1).padStart(2,'0')}</span><span>${s.note||''}</span></div>`).join(''); }
  _sync(){
    if(this.narrEl){ this.narrEl.querySelectorAll('.step').forEach(el=>{ const k=+el.dataset.k;
      el.classList.toggle('on',k===this.idx); el.classList.toggle('done',k<this.idx); });
      const cur=this.narrEl.querySelector('.step.on'); if(cur)cur.scrollIntoView({block:'nearest',behavior:'smooth'}); }
    const atStart=this.idx<=0, atEnd=this.idx>=this.steps.length-1;
    this.controls.querySelector('[data-a=back]').disabled=atStart;
    this.controls.querySelector('[data-a=play]').innerHTML=this.playing?'⏸ Pause':(atEnd?'↻ Replay':'▶ Play');
    this.onIndex(this.idx,this.steps[this.idx]);
  }
  draw(){ if(this.steps[this.idx]) this.mount.innerHTML=this.render(this.steps[this.idx],this.idx); }
  next(){ if(this.idx<this.steps.length-1){this.idx++; this.draw();} this._sync(); }
  prev(){ if(this.idx>0){this.idx--; this.draw();} this.playing=false; this._stop(); this._sync(); }
  reset(){ this.idx=0; this.playing=false; this._stop(); this.draw(); this._sync(); }
  toggle(){ if(this.idx>=this.steps.length-1&&!this.playing) this.idx=0;
    this.playing=!this.playing; if(this.playing)this._loop(); else this._stop(); this.draw(); this._sync(); }
  _loop(){ this._stop(); this._t=setTimeout(()=>{
    if(!this.playing)return;
    if(this.idx<this.steps.length-1){ this.idx++; this.draw(); this._sync(); this._loop(); }
    else { this.playing=false; this._sync(); }
  }, this.frameMs/this.speed); }
  _stop(){ if(this._t){clearTimeout(this._t); this._t=null;} }
}

document.addEventListener("DOMContentLoaded", mountCode);