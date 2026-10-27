// ===== Скорость сдачи (оценка коэффициента за срок сдачи WB) =====
// Срок = закрытие поставки (wb_supplies.closed_at) − создание заказа (wb_orders.order_created_at).
// Пороги и ставки — редактируемые настройки (оценка, не официальные данные WB).
let speedState = { mp:'wb', days:7, rows:null, loading:false };
const SPEED_DEFAULTS = { t1:13, r1:-5, t2:42, r2:-3.5, t3:48, s1:0.30, s1to:54, s2:0.35, s2to:60, s3:0.45 };
function speedCfg(){
  let c = {};
  try{ c = JSON.parse(localStorage.getItem('sklad42_speed_cfg')||'{}'); }catch(e){}
  return Object.assign({}, SPEED_DEFAULTS, c);
}
function speedSaveCfg(){
  const c = {};
  Object.keys(SPEED_DEFAULTS).forEach(k=>{
    const el = document.getElementById('spd_'+k);
    const v = el ? parseFloat(String(el.value).replace(',','.')) : NaN;
    c[k] = isNaN(v) ? SPEED_DEFAULTS[k] : v;
  });
  try{ localStorage.setItem('sklad42_speed_cfg', JSON.stringify(c)); }catch(e){}
  renderSpeed(); toast('Настройки сохранены');
}
function speedResetCfg(){
  try{ localStorage.removeItem('sklad42_speed_cfg'); }catch(e){}
  renderSpeed();
}
// п.п. к комиссии для одного заказа (отрицательное — скидка)
function speedCoef(h, c){
  if(h < c.t1) return c.r1;
  if(h < c.t2) return c.r2;
  if(h < c.t3) return 0;
  const a = Math.min(h, c.s1to) - c.t3;
  const b = Math.max(0, Math.min(h, c.s2to) - c.s1to);
  const d = Math.max(0, h - c.s2to);
  return Math.max(0,a)*c.s1 + b*c.s2 + d*c.s3;
}
function setSpeedMp(mp){ speedState.mp = mp; renderSpeed(); }
function setSpeedDays(d){ speedState.days = d; speedState.rows = null; loadSpeed(); }
async function loadSpeed(){
  if(speedState.loading) return;
  speedState.loading = true;
  const body = document.getElementById('speedBody');
  if(body) body.innerHTML = '<div class="panel empty">Загрузка…</div>';
  try{
    const since = new Date(Date.now() - speedState.days*86400000).toISOString();
    const orders = [];
    for(let from=0;;from+=1000){
      const { data, error } = await sb.from('wb_orders')
        .select('order_id,client_name,order_created_at,wb_supply_id,supplier_status')
        .eq('supplier_status','complete').gte('order_created_at', since)
        .order('order_created_at',{ascending:false}).range(from, from+999);
      if(error) throw error;
      orders.push(...data);
      if(data.length<1000) break;
    }
    const ids = [...new Set(orders.map(o=>o.wb_supply_id).filter(Boolean))];
    const closed = {};
    for(let i=0;i<ids.length;i+=150){
      const { data, error } = await sb.from('wb_supplies').select('id,closed_at').in('id', ids.slice(i,i+150));
      if(error) throw error;
      data.forEach(s=>{ if(s.closed_at) closed[s.id] = s.closed_at; });
    }
    let skipped = 0;
    const rows = [];
    orders.forEach(o=>{
      const ca = closed[o.wb_supply_id];
      if(!ca || !o.order_created_at){ skipped++; return; }
      const h = (new Date(ca) - new Date(o.order_created_at))/3600000;
      if(h < 0 || h > 24*30){ skipped++; return; }
      rows.push({ id:o.order_id, client:o.client_name||'—', supply:o.wb_supply_id, h, created:o.order_created_at });
    });
    speedState.rows = rows; speedState.skipped = skipped;
  }catch(e){
    speedState.rows = null;
    if(body) body.innerHTML = '<div class="panel empty">Ошибка загрузки: '+escapeHtml(e.message||String(e))+'</div>';
    speedState.loading = false; return;
  }
  speedState.loading = false;
  renderSpeed();
}
function speedFmt(n, d){ return (n>0?'+':'')+n.toFixed(d==null?2:d).replace('.',','); }
function speedAgg(rows, c){
  const n = rows.length;
  if(!n) return null;
  let sumH=0, sumC=0, disc=0, sur=0;
  rows.forEach(r=>{ sumH+=r.h; const k=speedCoef(r.h,c); sumC+=k; if(k<0) disc++; else if(k>0) sur++; });
  return { n, avgH:sumH/n, coef:sumC/n, disc:disc/n*100, sur:sur/n*100 };
}
function renderSpeed(){
  const body = document.getElementById('speedBody');
  if(!body) return;
  const mp = speedState.mp, days = speedState.days;
  const tabBtn = (k,l)=>`<button class="btn ${mp===k?'btn-accent':'btn-ghost'}" onclick="setSpeedMp('${k}')">${l}</button>`;
  const perBtn = d=>`<button class="btn ${days===d?'btn-accent':'btn-ghost'}" onclick="setSpeedDays(${d})">${d} дн</button>`;
  let html = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${tabBtn('wb','Wildberries')}${tabBtn('ozon','Ozon')}<span style="flex:1"></span>${[1,7,30,60,90].map(perBtn).join('')}</div>`;
  if(mp==='ozon'){
    html += `<div class="panel empty">Для Ozon в системе не хранится время фактической передачи отправления (только дата создания и срок отгрузки), поэтому посчитать срок сдачи нельзя. Нужно добавить синхронизацию статуса «передано в доставку» — скажите, если нужно.</div>`;
    body.innerHTML = html; return;
  }
  if(!speedState.rows){ body.innerHTML = html+'<div class="panel empty">Загрузка…</div>'; if(!speedState.loading) loadSpeed(); return; }
  const c = speedCfg();
  const rows = speedState.rows;
  const t = speedAgg(rows, c);
  if(!t){ html += '<div class="panel empty">Нет заказов с известным сроком сдачи за период</div>'; }
  else {
    const card = (label, val, sub, col)=>`<div class="panel" style="padding:18px"><div class="eyebrow" style="margin-bottom:8px">${label}</div><div style="font-size:30px;font-weight:700;color:${col||'var(--ink)'}">${val}</div><div style="font-size:12px;color:var(--ink-faint);margin-top:4px">${sub||''}</div></div>`;
    const coefCol = t.coef<0 ? 'var(--ok, #1a8f4c)' : (t.coef>0 ? 'var(--warn, #c0392b)' : 'var(--ink)');
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:16px">
      ${card('Коэффициент за срок (оценка)', speedFmt(t.coef)+' п.п.', 'к комиссии', coefCol)}
      ${card('Средний срок сдачи', t.avgH.toFixed(1).replace('.',',')+' ч', 'создание заказа → закрытие поставки')}
      ${card('Заказы «в скидке»', t.disc.toFixed(1).replace('.',',')+'%', Math.round(t.disc*t.n/100)+' из '+t.n)}
      ${card('Заказы «в надбавке»', t.sur.toFixed(1).replace('.',',')+'%', Math.round(t.sur*t.n/100)+' из '+t.n)}
    </div>`;
    // по клиентам
    const by = {};
    rows.forEach(r=>{ (by[r.client] = by[r.client]||[]).push(r); });
    const cl = Object.keys(by).map(k=>({k, a:speedAgg(by[k],c)})).sort((x,y)=>y.a.n-x.a.n);
    html += `<div class="panel" style="padding:18px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:10px">По клиентам</div>
      <div style="overflow-x:auto"><table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr style="text-align:left;color:var(--ink-faint)"><th style="padding:6px 8px">Клиент</th><th>Заказов</th><th>Ср. срок, ч</th><th>Коэфф., п.п.</th><th>В скидке</th><th>В надбавке</th></tr>
      ${cl.map(x=>`<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px">${escapeHtml(x.k)}</td><td class="mono">${x.a.n}</td><td class="mono">${x.a.avgH.toFixed(1)}</td><td class="mono">${speedFmt(x.a.coef)}</td><td class="mono">${x.a.disc.toFixed(1)}%</td><td class="mono">${x.a.sur.toFixed(1)}%</td></tr>`).join('')}
      </table></div></div>`;
    // самые медленные
    const slow = rows.slice().sort((a,b)=>b.h-a.h).slice(0,15);
    html += `<div class="panel" style="padding:18px;margin-bottom:16px"><div class="eyebrow" style="margin-bottom:10px">Самые долгие заказы</div>
      ${slow.map(r=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px"><span>${escapeHtml(String(r.id))} · ${escapeHtml(r.client)} · ${escapeHtml(String(r.supply||''))}</span><span class="mono" style="font-weight:600">${r.h.toFixed(1)} ч · ${speedFmt(speedCoef(r.h,c))} п.п.</span></div>`).join('')}</div>`;
  }
  if(speedState.skipped) html += `<div style="font-size:12px;color:var(--ink-faint);margin-bottom:12px">Не учтено заказов без времени закрытия поставки: ${speedState.skipped}.</div>`;
  const inp = (k,l)=>`<label style="font-size:12px;display:flex;flex-direction:column;gap:3px">${l}<input class="search" id="spd_${k}" value="${c[k]}" style="width:100px"></label>`;
  html += `<div class="panel" style="padding:18px"><div class="eyebrow" style="margin-bottom:6px">Пороги и ставки (редактируемые)</div>
    <div style="font-size:12px;color:var(--ink-faint);margin-bottom:10px">Оценка по открытым данным, не официальный расчёт WB. Значение в личном кабинете WB может отличаться. Настройки хранятся в этом браузере.</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      ${inp('t1','Порог 1, ч (меньше)')}${inp('r1','Скидка 1, п.п.')}${inp('t2','Порог 2, ч (меньше)')}${inp('r2','Скидка 2, п.п.')}${inp('t3','Порог надбавки, ч')}
      ${inp('s1','Надбавка до п.4, п.п./ч')}${inp('s1to','Граница 1, ч')}${inp('s2','Надбавка 2, п.п./ч')}${inp('s2to','Граница 2, ч')}${inp('s3','Надбавка 3, п.п./ч')}
    </div>
    <button class="btn btn-accent" onclick="speedSaveCfg()">Сохранить</button>
    <button class="btn btn-ghost" onclick="speedResetCfg()">Сбросить</button></div>`;
  body.innerHTML = html;
}

function setDashView(v){
  const sp = v==='speed';
  const g = id=>document.getElementById(id);
  g('dashboardBody').style.display = sp ? 'none' : '';
  g('speedBody').style.display = sp ? '' : 'none';
  g('dashControls').style.display = sp ? 'none' : 'flex';
  g('dashViewMain').className = 'btn ' + (sp ? 'btn-ghost' : 'btn-accent');
  g('dashViewSpeed').className = 'btn ' + (sp ? 'btn-accent' : 'btn-ghost');
  if(sp) renderSpeed();
}
