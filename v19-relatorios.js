/* Aponte Cidadão V19 — relatórios com dados filtrados e métricas verificáveis */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const fmtData=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const money=v=>'R$ '+num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  // A estrutura legado armazena prazos em horas. Exibir em dias corridos,
  // preservando a comparação exata em milissegundos/horas.
  const dias=h=>h===null||h===undefined||h===''||!Number.isFinite(Number(h))?
    'Não informado':Number((Number(h)/24).toFixed(2));
  const statusSLA=window.v19StatusSLA || (c=>{
    const prazo=Number(c._slaHoras);
    if(c._slaHoras==null || !Number.isFinite(prazo) || prazo<=0 || !c.created_at)
      return {estado:'Não apurável',resultado:null,tempo:null};
    if(c.sla_pausado)
      return {estado:'Pausado (sem histórico de pausa)',resultado:null,tempo:null};
    if(c.status==='Concluído' && !c.completed_at)
      return {estado:'Concluído sem data (não apurável)',resultado:null,tempo:null};
    const start=new Date(c.created_at).getTime(),end=c.completed_at?
      new Date(c.completed_at).getTime():Date.now();
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)
      return {estado:'Data inválida',resultado:null,tempo:null};
    const hours=(end-start)/36e5,finished=c.status==='Concluído',ok=hours<=prazo;
    return {estado:finished?(ok?'Concluído no prazo':'Concluído fora do prazo'):
      (ok?'Em andamento no prazo':'Em atraso'),
      // Cumprimento só é medido quando existe uma data de conclusão verificável.
      resultado:finished?ok:null,tempo:hours,prazo,
      vencido:!ok};
  });
  window.v19StatusSLA=statusSLA;
  let movimientos = [];
  let movementsPartial=false;
  async function carregarMovimentos(){
    const total=[];
    for(let off=0;off<25000;off+=500){
      const rows=await sbFetch('movimentacoes?select=*&order=created_at.desc,id.desc&limit=500&offset='+off);
      if(!Array.isArray(rows))throw new Error('Não foi possível consultar o histórico de movimentações.');
      total.push(...rows);
      if(rows.length<500)return total;
    }
    throw new Error('Histórico muito grande. Exportação interrompida para evitar relatório incompleto.');
  }
  function materiaisComMovimento(items){
    return items.map(m=>{
      const movs=movimientos.filter(x=>x.material_id===m.id);
      const consumido=movs.filter(x=>['saida','consumo'].includes(x.tipo)).reduce((a,v)=>a+num(v.quantidade),0);
      const estornado=movs.filter(x=>['devolucao','estorno'].includes(x.tipo)).reduce((a,v)=>a+num(v.quantidade),0);
      return {...m,consumoRegistrado:consumido-estornado,historicoCompleto:!movementsPartial&&movs.length>0};
    });
  }
  function source(tipo){
    if(tipo==='estoque'){
      if(!Array.isArray(_exportMats))throw new Error('Clique em Buscar para aplicar os filtros de estoque.');
      return materiaisComMovimento(_exportMats);
    }
    if(!Array.isArray(_exportChamados))throw new Error('Clique em Buscar para aplicar os filtros de chamados.');
    return _exportChamados.slice();
  }
  function colunas(tipo,dados){
    if(tipo==='estoque')return dados.map(m=>({
      'Material':m.n,'Unidade':m.u,'Contratado':num(m.cont),
      'Disponível':num(m.disp),'Estoque mínimo':num(m.min),
      'Preço unitário':num(m.preco),'Saídas líquidas registradas':m.consumoRegistrado,
      'Histórico':m.historicoCompleto?'Movimentos existentes':'Possivelmente incompleto; não inferir consumo de contratado - disponível'
    }));
    if(tipo==='sla')return dados.map(c=>{
      const a=statusSLA(c);
      return {'Protocolo':c.protocolo,'Cidade':c.cidade,'Problema':c.tipo,
        'Empresa':c.empresa,'Status':c.status,'Aberto em':fmtData(c.created_at),
        'Concluído em':fmtData(c.completed_at),
        'Prazo registrado (dias corridos)':dias(c._slaHoras),
        'Tempo observado (dias corridos)':a.tempo==null?'Não apurável':Number((a.tempo/24).toFixed(2)),
        'Resultado estimado':a.estado};
    });
    return dados.map(c=>({
      'Protocolo':c.protocolo,'Cidade':c.cidade,'Bairro':c.bairro,
      'Endereço':c.endereco,'Tipo':c.tipo,'Status':c.status,'Empresa':c.empresa,
      'Data abertura':fmtData(c.created_at),'Data conclusão':fmtData(c.completed_at),
      'Área':c.area,'Origem':c.origem,'Prazo registrado (dias corridos)':dias(c._slaHoras),
      'Situação SLA (dias corridos)':statusSLA(c).estado
    }));
  }
  const label={chamados:'Chamados',estoque:'Estoque',sla:'SLA'};
  function validarTipo(tipo){if(!label[tipo])throw new Error('Tipo de relatório inválido.');}

  window.gerarExcel=function(tipo){
    try {
      validarTipo(tipo);
      if(typeof XLSX==='undefined')throw new Error('Biblioteca Excel não carregada.');
      const dados=source(tipo);
      if(!dados.length)throw new Error('Nenhum registro para os filtros selecionados.');
      const wb=XLSX.utils.book_new();
      const rows=colunas(tipo,dados);
      const ws=XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb,ws,label[tipo]);
      if(tipo==='sla'){
        const avaliados=dados.map(statusSLA).filter(a=>a.resultado!==null);
        const noPrazo=avaliados.filter(a=>a.resultado===true).length;
        const resumo=[{'Indicador':'Chamados filtrados','Valor':dados.length},
          {'Indicador':'Com prazo e datas suficientes','Valor':avaliados.length},
          {'Indicador':'Dentro do prazo estimado (dias corridos)','Valor':noPrazo},
          {'Indicador':'Fora do prazo estimado (dias corridos)','Valor':avaliados.length-noPrazo},
          {'Indicador':'Não apuráveis / pausados','Valor':dados.length-avaliados.length},
          {'Indicador':'Cumprimento estimado entre apuráveis','Valor':
            avaliados.length?(100*noPrazo/avaliados.length).toFixed(1)+'%':'Não apurável'},
          {'Indicador':'Nota','Valor':'Estimativa por dias corridos (1 dia = 24 horas); sábados, domingos e feriados são contados. Pausas sem histórico de duração tornam o SLA não apurável.'}];
        const wr=XLSX.utils.json_to_sheet(resumo);
        XLSX.utils.book_append_sheet(wb,wr,'Metodologia');
      }
      XLSX.writeFile(wb,'Aponte_V19_'+label[tipo]+'_'+new Date().toISOString().slice(0,10)+'.xlsx');
      showToast('✅ Excel gerado com '+dados.length+' registros filtrados.','ok');
    }catch(e){showToast(esc(e.message),'erro');}
  };

  window.gerarPDF=function(tipo){
    try{
      validarTipo(tipo);
      const dados=source(tipo);
      if(!dados.length)throw new Error('Nenhum registro para os filtros selecionados.');
      const columns=colunas(tipo,dados);
      const headers=Object.keys(columns[0]);
      const table='<table><thead><tr>'+headers.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+
        columns.map(x=>'<tr>'+headers.map(k=>'<td>'+esc(x[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
      let note='';
      if(tipo==='sla')note='<p>Metodologia: estimativa em dias corridos (1 dia = 24 horas), incluindo fins de semana e feriados, a partir da abertura e conclusão. '+
        'Registros sem prazo, com dados inválidos ou SLA pausado são não apuráveis; '+
        'não substitui a validação dos prazos previstos no contrato.</p>';
      if(tipo==='estoque')note='<p>O relatório apresenta saldo atual e saídas líquidas registradas. '+
        'Não pressupõe que contratado menos disponível seja consumo. Movimentos anteriores '+
        'ao registro de histórico podem estar ausentes.</p>';
      const win=window.open('','_blank');
      if(!win)throw new Error('O navegador bloqueou a janela de PDF; permita pop-ups e tente novamente.');
      const doc='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Aponte V19 '+esc(label[tipo])+
        '</title><style>body{font:12px Arial;margin:24px;color:#1f2937}h1{color:#1251a3}'+
        'table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:5px;text-align:left}'+
        'th{background:#1251a3;color:#fff}tr:nth-child(even){background:#f3f4f6}'+
        '@page{size:A4 landscape;margin:10mm}p{font-size:11px}</style></head><body>'+
        '<h1>Aponte Cidadão V19 · '+esc(label[tipo])+'</h1>'+
        '<p>Gerado em '+esc(new Date().toLocaleString('pt-BR'))+' · '+dados.length+
        ' registros filtrados · Perfil: '+esc(CU?.perfil||'')+'</p>'+note+table+
        '<p>Use Ctrl+P para imprimir ou salvar como PDF.</p></body></html>';
      win.document.open();win.document.write(doc);win.document.close();win.focus();
    }catch(e){showToast(esc(e.message),'erro');}
  };

  const originalRelatorios=window.vRelatorios;
  window.vRelatorios=async function (b,t,a){
    t.textContent='Relatórios';a.innerHTML='';
    b.innerHTML='<div class="tcard" style="padding:2rem">Atualizando chamados, estoque e movimentações do Supabase…</div>';
    try {
      const [ok,mats,movs]=await Promise.all([
        carregarChamadosDoBanco(),sbGetMateriais(),carregarMovimentos()]);
      if(!ok||!Array.isArray(mats))throw new Error('Dados do banco não confirmados; relatório cancelado.');
      if(t.textContent!=='Relatórios'||!b.isConnected)return;
      movimientos=movs;movementsPartial=false;DB.materiais=mats;
      originalRelatorios(b,t,a);
      const buscarAntes=window._rfBuscar;
      window._rfBuscar=function(){
        buscarAntes();
        const data=Array.isArray(_exportChamados)?_exportChamados:[];
        const count=data.map(statusSLA);
        const overdue=count.filter(x=>x.estado==='Em atraso'||x.estado==='Concluído fora do prazo').length;
        const anal=count.filter(x=>x.resultado!==null);
        const sla=document.getElementById('rf-preview');
        if(sla){
          sla.insertAdjacentHTML('beforeend',
            '<p style="font-size:11px;color:var(--gray-600);margin-top:8px">'+
            'Prazo estimado por dias corridos: '+overdue+' fora do prazo; '+
            (count.length-anal.length)+' não apurável(is) / pausado(s). '+
            'O percentual de conclusão exibido acima não é taxa de SLA.</p>');
        }
      };
      window._rfBuscar();
    }catch(e){
      b.innerHTML='<div class="tcard" style="padding:2rem;color:var(--red)">'+esc(e.message)+'</div>';
      showToast(esc(e.message),'erro');
    }
  };
  // Backend V19 registra histórico de status. Impede duplicação de linhas
  // ao enviar novamente o array de eventos da sessão.
  window.sbSaveHistorico=async function(){return true;};
  console.info('[Aponte V19] relatórios filtrados e histórico automático.');
})();