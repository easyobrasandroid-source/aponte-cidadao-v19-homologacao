/* Aponte Cidadao V19 — dashboard completo em homologacao.
 * Somente leitura: usa exclusivamente DB.chamados carregados do Supabase.
 * Nao altera chamados, SLAs, usuarios, permissoes, estoque ou a V18.
 * Reversao imediata: remover a tag deste arquivo no index.html da branch.
 */
(function () {
  'use strict';
  const dashboardAnterior = window.vDashboard;
  if (typeof dashboardAnterior !== 'function') return;
  // Para comparar ou reverter sem editar codigo: adicionar ?dashboard=legacy na URL.
  if (new URLSearchParams(window.location.search).get('dashboard') === 'legacy') return;

  const esc = value => String(value == null ? '' : value)
    .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtData = new Intl.DateTimeFormat('pt-BR', {
    timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit'
  });
  const fmtMes = new Intl.DateTimeFormat('pt-BR', {
    timeZone:'America/Sao_Paulo', month:'short', year:'numeric'
  });
  const chaveMes = raw => {
    const d = new Date(raw || '');
    if (!Number.isFinite(d.getTime())) return '';
    const p = Object.fromEntries(fmtData.formatToParts(d).map(v => [v.type,v.value]));
    return p.year + '-' + p.month;
  };
  const nomeMes = chave => {
    const d = new Date(chave + '-15T12:00:00Z');
    return Number.isFinite(d.getTime()) ? fmtMes.format(d) : chave;
  };
  const statusSLA = c => typeof window.v19StatusSLA === 'function'
    ? window.v19StatusSLA(c) : {estado:'Não apurável',resultado:null};
  const porcentagem = (ok,total) => total > 0
    ? Math.round(ok * 100 / total) + '% (' + ok + '/' + total + ')'
    : '—';

  function prepararEstilos(){
    if(document.getElementById('v19-dashboard-completo-css')) return;
    const s = document.createElement('style');
    s.id = 'v19-dashboard-completo-css';
    s.textContent =
      '.v19d-kpi-link{display:block;width:100%;text-align:left;font-family:inherit;color:inherit;cursor:pointer}' +
      '.v19d-kpi-link:focus-visible{outline:3px solid var(--brand);outline-offset:2px}' +
      '.v19d-kpi-link:hover .kpi-label{text-decoration:underline}' +
      '.v19d-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(260px,1fr);gap:14px;margin-top:12px}' +
      '.v19d-grid.equal{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.v19d-canvas{height:230px;position:relative;min-width:0}' +
      '.v19d-canvas canvas{max-width:100%}' +
      '.v19d-caption{font-size:11px;color:var(--gray-500);margin:7px 0 10px}' +
      '.v19d-table{width:100%;border-collapse:collapse;font-size:12px}' +
      '.v19d-table th{text-align:left;color:var(--gray-500);font-size:10px;text-transform:uppercase;white-space:nowrap;padding:9px 10px;border-bottom:1px solid var(--gray-200)}' +
      '.v19d-table td{padding:10px;border-bottom:1px solid var(--gray-100);vertical-align:middle}' +
      '.v19d-table td:not(:first-child){white-space:nowrap}' +
      '.v19d-overflow{overflow-x:auto}' +
      '.v19d-alert{border-left:3px solid var(--brand);padding:10px 12px;margin:8px 0;background:var(--gray-50);font-size:12px;border-radius:5px}' +
      '.v19d-muted{font-size:11px;color:var(--gray-500)}' +
      '@media(max-width:970px){.v19d-grid,.v19d-grid.equal{grid-template-columns:minmax(0,1fr)}}' +
      '@media(max-width:680px){.app-shell:has(.v19d-grid) .sidebar{width:52px}.app-shell:has(.v19d-grid) .sb-logo{padding:10px 0;justify-content:center}.app-shell:has(.v19d-grid) .sb-logo>div:last-child,.app-shell:has(.v19d-grid) .sb-user>div:last-child{display:none}.app-shell:has(.v19d-grid) .sb-user{justify-content:center;padding:8px 0}.app-shell:has(.v19d-grid) .sbi{font-size:0;padding:12px 0;justify-content:center}.app-shell:has(.v19d-grid) .sbi .ico{font-size:19px;width:auto}.app-shell:has(.v19d-grid) .sbi .sbadge,.app-shell:has(.v19d-grid) .sb-lbl{display:none}.app-shell:has(.v19d-grid) .sb-footer{padding:8px 0}.app-shell:has(.v19d-grid) .sb-logout{font-size:0;justify-content:center}.app-shell:has(.v19d-grid) .sb-logout:before{content:"⇥";font-size:20px}.app-shell:has(.v19d-grid) .int-main{min-width:0}.app-shell:has(.v19d-grid) .topbar{height:auto;min-height:52px;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:10px 9px}.app-shell:has(.v19d-grid) .topbar-title{font-size:14px}.app-shell:has(.v19d-grid) .topbar-right{width:100%;min-width:0;display:flex;flex-wrap:wrap;gap:5px}.app-shell:has(.v19d-grid) .topbar-right select,.app-shell:has(.v19d-grid) .topbar-right input{min-width:0;max-width:100%;font-size:12px}.app-shell:has(.v19d-grid) .body{padding:8px;min-width:0}.app-shell:has(.v19d-grid) .alerts-bar{font-size:11px;padding:8px 10px;margin-bottom:10px}.app-shell:has(.v19d-grid) .kpi-grid,.app-shell:has(.v19d-grid) .kpi-grid2{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px}.app-shell:has(.v19d-grid) .kpi{padding:12px 9px;min-width:0;min-height:104px}.app-shell:has(.v19d-grid) .kpi-val{font-size:24px}.app-shell:has(.v19d-grid) .kpi-label{font-size:9px}.app-shell:has(.v19d-grid) .kpi-sub{font-size:10px}.app-shell:has(.v19d-grid) .kpi2{min-width:0;padding:10px 8px;font-size:11px;gap:5px;flex-wrap:wrap}.app-shell:has(.v19d-grid) .v19d-grid,.app-shell:has(.v19d-grid) .v19d-grid.equal{grid-template-columns:minmax(0,1fr);gap:8px;margin-top:8px}.app-shell:has(.v19d-grid) .v19d-grid>.card{min-width:0;padding:12px}.app-shell:has(.v19d-grid) .v19d-canvas{height:220px}.app-shell:has(.v19d-grid) .v19d-table{font-size:11px}}';
    document.head.appendChild(s);
    // Em layout compacto os labels continuam disponiveis em title/tecnologia assistiva.
    document.querySelectorAll('#pg-app .sidebar .sbi').forEach(el=>{
      if(!el.title)el.title=el.textContent.trim().replace(/\\s+/g,' ');
    });
    const sair=document.querySelector('#pg-app .sb-logout');
    if(sair&&!sair.title)sair.title='Sair';
  }

  function limparGraficos(){
    const charts = dashboardCompleto._charts || [];
    charts.forEach(ch => {try{ch.destroy();}catch(e){console.warn('[V19 dashboard] destruir grafico',e);}});
    dashboardCompleto._charts = [];
  }

  function montarGrafico(id,config){
    const el = document.getElementById(id);
    if(!el || typeof window.Chart !== 'function') return;
    try {
      const chart = new window.Chart(el,config);
      dashboardCompleto._charts.push(chart);
    } catch(e) {
      console.warn('[V19 dashboard] grafico nao exibido:',id,e);
      const aviso=document.createElement('p');
      aviso.className='v19d-muted';
      aviso.textContent='Gráfico indisponível neste navegador. Os indicadores numéricos permanecem visíveis.';
      el.parentNode.replaceChild(aviso,el);
    }
  }

  function dashboardCompleto(b,t,a,semConsulta=false){
    t.textContent='Dashboard gerencial';
    const userKey = (typeof CU !== 'undefined' && CU && CU.id) || '';
    if(!dashboardCompleto._state || dashboardCompleto._state.user !== userKey){
      dashboardCompleto._state={user:userKey,cidade:'',periodo:'30d',mes:''};
    }
    const st=dashboardCompleto._state;
    const anteriorCidade=document.getElementById('dash-cidade');
    if(anteriorCidade){
      st.cidade=anteriorCidade.value;
      st.periodo=document.getElementById('dash-periodo')?.value || st.periodo;
      st.mes=document.getElementById('dash-mes')?.value || st.mes;
    }
    if(!semConsulta){
      a.innerHTML='';
      b.innerHTML='<div class="tcard" style="padding:2rem">Carregando dados do Supabase…</div>';
      Promise.resolve().then(()=>carregarChamadosDoBanco()).then(ok=>{
        if(t.textContent!=='Dashboard gerencial' || !b.isConnected) return;
        dashboardCompleto._ok=!!ok;
        dashboardCompleto(b,t,a,true);
      }).catch(e=>{
        console.error('[V19 dashboard] carregar:',e);
        dashboardCompleto._ok=false;
        if(b.isConnected && t.textContent==='Dashboard gerencial') dashboardCompleto(b,t,a,true);
      });
      return;
    }
    if(!dashboardCompleto._ok){
      limparGraficos();
      a.innerHTML='';
      b.innerHTML='<div class="tcard" style="padding:2rem;color:var(--red)">Falha ao consultar o Supabase. Nenhum indicador antigo será exibido. <button class="btn btn-ghost" onclick="showView(\'dashboard\')">Tentar novamente</button></div>';
      return;
    }
    prepararEstilos();
    limparGraficos();

    let base = Array.isArray(DB.chamados) ? DB.chamados.slice() : [];
    // O filtro visual complementa o RLS. O Supabase deve continuar autorizando cada consulta.
    if(CU?.perfil==='consorcio') base=base.filter(c=>CU.consorcio_id && c.consorcio_id===CU.consorcio_id);
    if(CU?.perfil==='prefeitura') base=base.filter(c=>CU.cidade_id && c.cidade_id===CU.cidade_id);
    if(CU?.perfil==='empresa') base=base.filter(c=>CU.empresa_id && c.empresa_id===CU.empresa_id);
    if(CU?.perfil==='garantia') base=base.filter(c=>c.status==='Aguardando Garantia LED' || (c.status==='Concluído' && c.garantia_tipo));

    const cidades=[...new Set(base.map(c=>c.cidade).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'pt-BR'));
    if(CU?.perfil==='prefeitura') st.cidade=cidades[0] || '';
    else if(st.cidade && !cidades.includes(st.cidade)) st.cidade='';
    if(st.periodo==='month' && !st.mes) st.mes=chaveMes(new Date().toISOString());
    const recarregar="vDashboard(document.getElementById('main-body'),document.getElementById('topbar-title'),document.getElementById('topbar-actions'),true)";
    a.innerHTML='<span style="font-size:11px;color:var(--gray-500)">'+esc(CU?.org || '')+'</span>' +
      '<select id="dash-cidade" aria-label="Cidade" onchange="'+recarregar+'" '+(CU?.perfil==='prefeitura'?'disabled':'')+'>' +
      '<option value="">Todas as cidades</option>' +
      cidades.map(c=>'<option value="'+esc(c)+'" '+(st.cidade===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select>' +
      '<select id="dash-periodo" aria-label="Período" onchange="'+recarregar+'">' +
      [['30d','Últimos 30 dias'],['all','Todo o histórico'],['90d','Últimos 90 dias'],['month','Escolher mês e ano']]
      .map(([v,n])=>'<option value="'+v+'" '+(st.periodo===v?'selected':'')+'>'+n+'</option>').join('')+'</select>' +
      (st.periodo==='month'?'<input id="dash-mes" type="month" aria-label="Mês e ano" value="'+esc(st.mes)+'" onchange="'+recarregar+'">':'');

    const agora=Date.now();
    const filtrados=base.filter(c=>{
      if(st.cidade && c.cidade!==st.cidade) return false;
      if(st.periodo==='all') return true;
      const abertura=new Date(c.created_at || '').getTime();
      if(!Number.isFinite(abertura)) return false;
      if(st.periodo==='30d') return abertura>=agora-30*86400000;
      if(st.periodo==='90d') return abertura>=agora-90*86400000;
      if(st.periodo==='month') return chaveMes(c.created_at)===st.mes;
      return true;
    });

    const contar=pred=>filtrados.filter(pred).length;
    const total=filtrados.length;
    const concluidos=contar(c=>c.status==='Concluído');
    const andamento=contar(c=>['Em programação','Em execução'].includes(c.status));
    const urbanos=contar(c=>c.area==='Urbana');
    const rurais=contar(c=>c.area==='Rural');
    const garantia=contar(c=>c.status==='Aguardando Garantia LED');
    const slaChamados=filtrados.map(c=>({c,r:statusSLA(c)}));
    const concluidosAvaliaveis=slaChamados.filter(o=>o.c.status==='Concluído' && o.r.resultado!==null);
    const concluidosNoPrazo=concluidosAvaliaveis.filter(o=>o.r.resultado===true).length;
    const atraso=slaChamados.filter(o=>o.c.status!=='Concluído' && o.r.estado==='Em atraso').length;
    const proximos=slaChamados.filter(o=>o.c.status!=='Concluído' && o.r.estado==='Em andamento no prazo'
      && Number.isFinite(o.r.prazo) && Number.isFinite(o.r.tempo) && o.r.prazo-o.r.tempo<=12).length;
    const abertosSemSLA=slaChamados.filter(o=>o.c.status!=='Concluído' && o.r.estado==='Não apurável').length;
    const concluidosNaoAvaliaveis=concluidos-concluidosAvaliaveis.length;
    const parcial=DB.chamados.length>=500;

    const kpi=(label,valor,sub,cor,filtro)=>'<button type="button" class="kpi v19d-kpi-link"'+
      ' onclick="navChamados(&#39;'+filtro+'&#39;,&#39;'+label+'&#39;)"'+
      ' aria-label="Ver '+valor+' chamados: '+label+'">'+
      '<div class="kpi-accent" style="background:'+cor+'"></div>'+
      '<div class="kpi-label">'+label+'</div><div class="kpi-val" style="color:'+cor+'">'+valor+
      '</div><div class="kpi-sub">'+sub+' · Clique para ver</div></button>';
    const agrupar=fn=>{
      const m=new Map();
      filtrados.forEach(c=>{const k=fn(c)||'Não informado';m.set(k,(m.get(k)||0)+1);});
      return [...m].sort((x,y)=>y[1]-x[1] || x[0].localeCompare(y[0],'pt-BR'));
    };
    const status=agrupar(c=>c.status);
    const tipos=agrupar(c=>c.tipo);
    const topTipos=tipos.slice(0,6);
    if(tipos.length>6) topTipos.push(['Outros tipos',tipos.slice(6).reduce((s,x)=>s+x[1],0)]);
    const meses=new Map();
    filtrados.forEach(c=>{
      const mes=chaveMes(c.created_at);
      if(mes){if(!meses.has(mes))meses.set(mes,{abertos:0,concluidos:0});meses.get(mes).abertos++;}
      if(c.status==='Concluído' && c.completed_at){
        const fim=chaveMes(c.completed_at);
        if(fim){if(!meses.has(fim))meses.set(fim,{abertos:0,concluidos:0});meses.get(fim).concluidos++;}
      }
    });
    const mesesOrdenados=[...meses.keys()].sort();

    const municipios=new Map();
    filtrados.forEach(c=>{
      const n=c.cidade||'Não informado';
      if(!municipios.has(n)) municipios.set(n,{nome:n,total:0,concluidos:0,atrasos:0,avaliaveis:0,dentro:0});
      const d=municipios.get(n);d.total++;
      const r=statusSLA(c);
      if(c.status==='Concluído'){d.concluidos++;if(r.resultado!==null){d.avaliaveis++;if(r.resultado===true)d.dentro++;}}
      else if(r.estado==='Em atraso') d.atrasos++;
    });
    const porMunicipio=[...municipios.values()].sort((x,y)=>y.total-x.total || x.nome.localeCompare(y.nome,'pt-BR'));
    const linhas=porMunicipio.map(c=>'<tr><td>'+esc(c.nome)+'</td><td>'+c.total+'</td><td>'+c.concluidos+
      '</td><td>'+c.atrasos+'</td><td>'+porcentagem(c.dentro,c.avaliaveis)+'</td></tr>').join('') ||
      '<tr><td colspan="5">Sem chamados no período selecionado.</td></tr>';
    const alertas=[];
    if(atraso) alertas.push(['var(--red)',atraso+' chamado(s) com SLA vencido']);
    if(proximos) alertas.push(['var(--amber)',proximos+' chamado(s) vencendo em até 12 horas']);
    if(abertosSemSLA) alertas.push(['var(--amber)',abertosSemSLA+' chamado(s) aberto(s) sem SLA apurável']);
    if(concluidosNaoAvaliaveis) alertas.push(['var(--brand)',concluidosNaoAvaliaveis+' concluído(s) fora da base de cálculo do percentual de SLA']);
    const alertasHtml=alertas.length
      ? alertas.map(([cor,tx])=>'<div class="v19d-alert" style="border-left-color:'+cor+'">'+esc(tx)+'</div>').join('')
      : '<p class="v19d-muted">Nenhum alerta apurado para os filtros selecionados.</p>';

    b.innerHTML='<div class="alerts-bar"><strong>ℹ️ Dados do Supabase</strong> · Filtro de período pela data de abertura. '+
      'SLA calculado apenas quando há prazo e datas válidos. '+
      (parcial?'⚠️ Consulta limitada a 500 chamados: números podem estar incompletos.':'')+'</div>'+
      '<div class="kpi-grid">'+
      kpi('Total de chamados',total,'No período selecionado','var(--brand)','all')+
      kpi('Em programação / execução',andamento,'Status atual','#D97706','dash_execucao')+
      kpi('Concluídos',concluidos,'Status atual','var(--green)','Concluído')+
      kpi('Em atraso (SLA)',atraso,'Chamados abertos vencidos','var(--red)','dash_atraso')+'</div>'+
      '<div class="kpi-grid2">'+
      '<div class="kpi2">🏙 Urbanos: <strong>'+urbanos+'</strong></div>'+
      '<div class="kpi2">🌾 Rurais: <strong>'+rurais+'</strong></div>'+
      '<div class="kpi2">⚡ Garantia LED: <strong>'+garantia+'</strong></div>'+
      '<div class="kpi2">🎯 SLA cumprido: <strong>'+porcentagem(concluidosNoPrazo,concluidosAvaliaveis.length)+'</strong></div>'+
      '</div>'+
      '<div class="v19d-grid">'+
      '<div class="card"><div class="card-title">Evolução mensal — dados reais</div>'+
      '<div class="v19d-caption">Aberturas e conclusões dos chamados que passaram pelo filtro de abertura.</div>'+
      '<div class="v19d-canvas"><canvas id="v19d-meses"></canvas></div></div>'+
      '<div class="card"><div class="card-title">Distribuição por status</div>'+
      '<div class="v19d-canvas"><canvas id="v19d-status"></canvas></div></div>'+
      '</div>'+
      '<div class="v19d-grid equal">'+
      '<div class="card"><div class="card-title">Tipos de problema</div>'+
      '<div class="v19d-canvas"><canvas id="v19d-tipos"></canvas></div></div>'+
      '<div class="card"><div class="card-title">Chamados por município</div>'+
      '<div class="v19d-canvas"><canvas id="v19d-cidades"></canvas></div></div>'+
      '</div>'+
      '<div class="v19d-grid">'+
      '<div class="card"><div class="card-title">Desempenho por município</div>'+
      '<p class="v19d-caption">Percentual de SLA considera somente conclusões avaliáveis.</p>'+
      '<div class="v19d-overflow"><table class="v19d-table"><thead><tr>'+
      '<th>Município</th><th>Chamados</th><th>Concluídos</th><th>Atrasados</th><th>SLA cumprido</th>'+
      '</tr></thead><tbody>'+linhas+'</tbody></table></div></div>'+
      '<div class="card"><div class="card-title">Alertas gerenciais reais</div>'+
      '<p class="v19d-caption">Situação no instante desta consulta; sem estimativas de estoque.</p>'+
      alertasHtml+'</div>'+
      '</div>';

    if(!total){
      for(const id of ['v19d-meses','v19d-status','v19d-tipos','v19d-cidades']){
        const c=document.getElementById(id);
        if(c) c.parentElement.innerHTML='<p class="v19d-muted">Sem chamados para os filtros selecionados.</p>';
      }
      return;
    }
    if(typeof window.Chart!=='function'){
      for(const id of ['v19d-meses','v19d-status','v19d-tipos','v19d-cidades']){
        const c=document.getElementById(id);
        if(c)c.parentElement.innerHTML='<p class="v19d-muted">Gráficos indisponíveis; consulte os indicadores e a tabela.</p>';
      }
      return;
    }
    const cores=['#1251A3','#0D7A55','#D97706','#B91C1C','#6D28D9','#64748B','#0891B2'];
    const opcoes={responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{position:'bottom',labels:{boxWidth:11,usePointStyle:true,font:{size:10}}}}};
    montarGrafico('v19d-meses',{type:'line',data:{labels:mesesOrdenados.map(nomeMes),
      datasets:[{label:'Abertos',data:mesesOrdenados.map(m=>meses.get(m).abertos),
        borderColor:cores[0],backgroundColor:'rgba(18,81,163,.09)',fill:true,tension:.25},
        {label:'Concluídos',data:mesesOrdenados.map(m=>meses.get(m).concluidos),
        borderColor:cores[1],backgroundColor:'rgba(13,122,85,.05)',fill:false,tension:.25}]},
      options:{...opcoes,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});
    montarGrafico('v19d-status',{type:'doughnut',data:{labels:status.map(x=>x[0]),
      datasets:[{data:status.map(x=>x[1]),backgroundColor:cores,borderWidth:2,borderColor:'#fff'}]},
      options:{...opcoes,cutout:'60%'}});
    montarGrafico('v19d-tipos',{type:'doughnut',data:{labels:topTipos.map(x=>x[0]),
      datasets:[{data:topTipos.map(x=>x[1]),backgroundColor:cores,borderWidth:2,borderColor:'#fff'}]},
      options:{...opcoes,cutout:'60%'}});
    montarGrafico('v19d-cidades',{type:'bar',data:{labels:porMunicipio.map(x=>x.nome),
      datasets:[{label:'Chamados',data:porMunicipio.map(x=>x.total),backgroundColor:cores[0]},
        {label:'Em atraso',data:porMunicipio.map(x=>x.atrasos),backgroundColor:cores[3]}]},
      options:{...opcoes,indexAxis:'y',scales:{x:{beginAtZero:true,ticks:{precision:0}}}}});
  }
  window.v19DashboardAnterior = dashboardAnterior;
  // Se o novo painel falhar, preservar o painel anterior na propria sessao.
  window.vDashboard = function (b,t,a,semConsulta=false) {
    try { return dashboardCompleto(b,t,a,semConsulta); }
    catch (e) {
      console.error('[V19 dashboard] erro de renderizacao; restaurando painel anterior:',e);
      window.vDashboard=dashboardAnterior;
      return dashboardAnterior(b,t,a,semConsulta);
    }
  };
  console.info('[Aponte V19] Dashboard completo de homologação carregado (somente leitura).');
})();
