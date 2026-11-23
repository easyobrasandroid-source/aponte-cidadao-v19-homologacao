/* Aponte Iluminação V19 — relatórios com dados filtrados e métricas verificáveis */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const fmtData=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
  // Datas de planilha devem ser células do tipo data, não texto pt-BR.
  // Usar o horário de Brasília independentemente do fuso do navegador.
  function dataExcel(valor){
    if(!valor)return null;
    const d=new Date(valor);
    if(!Number.isFinite(d.getTime()))return null;
    const partes=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
      timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric',day:'numeric',
      hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'
    }).formatToParts(d).map(x=>[x.type,x.value]));
    return new Date(
      Number(partes.year), Number(partes.month)-1, Number(partes.day),
      Number(partes.hour), Number(partes.minute), Number(partes.second)
    );
  }
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
  // Etapa 594: o estoque e as movimentações vêm da MESMA RPC segregada.
  // Nunca indexar por material_id ou inferir consumos de contratado-disponível.
  const uuid=x=>typeof x==='string'&&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
  function mapearEstoquesEmpresariais(rows){
    if(!Array.isArray(rows))
      throw new Error('Relatório de estoque não retornou uma lista válida.');
    const perfil=CU?.perfil,consorcio=CU?.consorcio_id,
      empresa=CU?.empresa_id;
    if(!['master','consorcio','empresa'].includes(perfil) ||
      (perfil==='consorcio'&&!uuid(consorcio)) ||
      (perfil==='empresa'&&(!uuid(consorcio)||!uuid(empresa))))
      throw new Error('Perfil ou vínculo empresarial inválido para relatórios.');
    const vistos=new Set();
    return rows.map(r=>{
      if(!r || !uuid(r.estoque_id) || !uuid(r.material_id) ||
        !uuid(r.empresa_id) || !uuid(r.consorcio_id) ||
        !String(r.empresa_nome||'').trim() ||
        !String(r.material_nome||'').trim() ||
        vistos.has(r.estoque_id) ||
        (perfil==='consorcio'&&r.consorcio_id!==consorcio) ||
        (perfil==='empresa'&&(r.consorcio_id!==consorcio||
          r.empresa_id!==empresa)))
        throw new Error('Dados de estoque inesperados ou fora do vínculo do usuário.');
      vistos.add(r.estoque_id);
      const nums=[
        r.quantidade_contratada,r.quantidade_disponivel,
        r.estoque_minimo,r.preco_unitario,r.movimentos_identificados,
        r.saidas_identificadas,r.devolucoes_identificadas,
        r.saidas_liquidas_identificadas
      ];
      if(nums.some(v=>v===null||v===undefined||
        !Number.isFinite(Number(v))) ||
        nums.slice(0,7).some(v=>Number(v)<0) ||
        Math.abs(Number(r.saidas_identificadas)-
          Number(r.devolucoes_identificadas)-
          Number(r.saidas_liquidas_identificadas))>1e-8)
        throw new Error('Saldo ou histórico empresarial com valores inválidos.');
      return {
        id:r.estoque_id,_supaId:r.estoque_id,_estoqueId:r.estoque_id,
        material_id:r.material_id,consorcio_id:r.consorcio_id,
        empresa_id:r.empresa_id,empresa_nome:r.empresa_nome,
        n:r.material_nome,u:r.unidade||'Un.',
        cont:num(r.quantidade_contratada),
        disp:num(r.quantidade_disponivel),
        min:num(r.estoque_minimo),preco:num(r.preco_unitario),
        movimentosIdentificados:num(r.movimentos_identificados),
        saidasIdentificadas:num(r.saidas_identificadas),
        devolucoesIdentificadas:num(r.devolucoes_identificadas),
        consumoRegistrado:num(r.saidas_liquidas_identificadas)
      };
    });
  }
  // Um chamado em Concluído é atendimento final; em Aguardando Garantia LED é parcial.
  // Um caso nunca aparece em ambas as classes. Não equivale a contagem de viagens.
  function situacaoAtendimento(c){
    if(!uuid(c?.empresa_id))return 'Sem empresa responsável';
    if(c.status==='Concluído')return 'Concluído';
    if(c.status==='Aguardando Garantia LED')return 'Parcial — Garantia LED';
    return 'Não computado';
  }
  function resumoAtendimentos(dados){
    const grupos=new Map(),vistos=new Set();
    let concluidos=0,parciais=0,semEmpresa=0;
    for(const c of dados){
      const id=c._supaId||c.protocolo;
      if(!id||vistos.has(id))throw new Error('Chamado duplicado ou sem identificação no relatório.');
      vistos.add(id);
      if(!['Concluído','Aguardando Garantia LED'].includes(c.status))continue;
      if(!uuid(c.empresa_id)){semEmpresa++;continue;}
      const parcial=c.status==='Aguardando Garantia LED';
      if(parcial)parciais++;else concluidos++;
      let g=grupos.get(c.empresa_id);
      if(!g){
        g={empresa_id:c.empresa_id,consorcio_id:c.consorcio_id||null,
          empresa:c.empresa||'Empresa sem nome',concluidos:0,parciais:0,total:0};
        grupos.set(c.empresa_id,g);
      }
      // A mesma empresa não pode pertencer a dois consórcios no mesmo relatório.
      if(g.consorcio_id!==c.consorcio_id)
        throw new Error('Vínculo de consórcio divergente em chamados da mesma empresa.');
      g.total++;
      if(parcial)g.parciais++;else g.concluidos++;
    }
    return {total:concluidos+parciais,concluidos,parciais,semEmpresa,
      grupos:[...grupos.values()].sort((a,b)=>a.empresa.localeCompare(b.empresa,'pt-BR')||
        a.empresa_id.localeCompare(b.empresa_id))};
  }
  window.v19ResumoAtendimentos=resumoAtendimentos;
  function tabelaAtendimentos(dados){
    const r=resumoAtendimentos(dados);
    const consorcios=Array.isArray(window.v19RelatoriosConsorcios)?
      window.v19RelatoriosConsorcios:[];
    const nomeCons=id=>consorcios.find(c=>c.id===id)?.nome||id||'Não informado';
    let linhas=r.grupos.map(g=>
      '<tr><td>'+esc(g.empresa)+'</td><td>'+esc(nomeCons(g.consorcio_id))+
      '</td><td>'+g.concluidos+'</td><td>'+g.parciais+
      '</td><td><strong>'+g.total+'</strong></td></tr>').join('');
    if(!linhas)linhas='<tr><td colspan="5">Nenhum atendimento computável para os filtros selecionados.</td></tr>';
    return '<table><thead><tr><th>Empresa</th><th>Consórcio</th><th>Concluídos</th>'+
      '<th>Parciais (Garantia LED)</th><th>Total de chamados atendidos</th></tr></thead><tbody>'+
      linhas+'<tr style="background:#f1f5f9">'+
      '<td colspan="2" style="text-align:left;font-weight:700;border-top:2px solid #94a3b8">Total filtrado</td>'+
      '<td style="text-align:left;font-weight:700;border-top:2px solid #94a3b8">'+r.concluidos+'</td>'+
      '<td style="text-align:left;font-weight:700;border-top:2px solid #94a3b8">'+r.parciais+'</td>'+
      '<td style="text-align:left;font-weight:700;border-top:2px solid #94a3b8">'+r.total+'</td>'+
      '</tr></tbody></table>';
  }
  function avisoAtendimentos(dados){
    const r=resumoAtendimentos(dados);
    return 'Total de chamados atendidos: '+r.total+' = '+r.concluidos+
      ' concluídos + '+r.parciais+' parciais (Aguardando Garantia LED). '+
      (r.semEmpresa? r.semEmpresa+' chamados atendidos sem empresa vinculada, não atribuídos. ':'')+
      'Um chamado conta no máximo uma vez pelo status atual. '+
      'Contagem exclusivamente por número de chamado, sem multiplicar por visitas. Período filtrado pela data de abertura do chamado.';
  }
  function source(tipo){
    if(tipo==='estoque'){
      if(!Array.isArray(_exportMats))throw new Error('Clique em Buscar para aplicar os filtros de estoque.');
      return _exportMats.map(m=>({...m}));
    }
    if(!Array.isArray(_exportChamados))throw new Error('Clique em Buscar para aplicar os filtros de chamados.');
    return _exportChamados.slice();
  }
  function colunas(tipo,dados,paraExcel=false){
    if(tipo==='estoque')return dados.map(m=>({
      'Empresa':m.empresa_nome,'Material':m.n,'Unidade':m.u,
      'Contratado':num(m.cont),'Disponível':num(m.disp),
      'Estoque mínimo':num(m.min),'Preço unitário':num(m.preco),
      'Saídas identificadas':num(m.saidasIdentificadas),
      'Devoluções identificadas':num(m.devolucoesIdentificadas),
      'Saídas líquidas identificadas':num(m.consumoRegistrado),
      'Movimentações vinculadas':num(m.movimentosIdentificados),
      ...(paraExcel?{'ID do estoque':m._estoqueId}:{})
    }));
    if(tipo==='sla')return dados.map(c=>{
      const a=statusSLA(c);
      return {'Protocolo':c.protocolo,'Cidade':c.cidade,'Problema':c.tipo,
        'Endereço':c.endereco,'Número':window.v19NumeroEndereco?.(c.endereco)||'',
        'Empresa':c.empresa,'Status':c.status,
        'Atendimento da empresa':situacaoAtendimento(c),
        'Aberto em':paraExcel?dataExcel(c.created_at):fmtData(c.created_at),
        'Concluído em':paraExcel?dataExcel(c.completed_at):fmtData(c.completed_at),
        'Prazo registrado (dias corridos)':dias(c._slaHoras),
        'Tempo observado (dias corridos)':a.tempo==null?'Não apurável':Number((a.tempo/24).toFixed(4)),
        'Tempo observado (horas)':a.tempo==null?'Não apurável':Number(a.tempo.toFixed(2)),
        'Resultado estimado':a.estado};
    });
    return dados.map(c=>({
      'Protocolo':c.protocolo,'Cidade':c.cidade,'Bairro':c.bairro,
      'Endereço':c.endereco,'Número':window.v19NumeroEndereco?.(c.endereco)||'',
      'Tipo':c.tipo,'Status':c.status,'Empresa':c.empresa,
      'Atendimento da empresa':situacaoAtendimento(c),
      ...(paraExcel?{'ID da empresa':c.empresa_id||'','ID do consórcio':c.consorcio_id||''}:{}),
      'Data abertura':paraExcel?dataExcel(c.created_at):fmtData(c.created_at),
      'Data conclusão':paraExcel?dataExcel(c.completed_at):fmtData(c.completed_at),
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
      const rows=colunas(tipo,dados,true);
      const ws=XLSX.utils.json_to_sheet(rows,{cellDates:true});
      const headers=Object.keys(rows[0]);
      // Habilitar filtros nativos e definir larguras legíveis; não modificar
      // os dados de origem nem aplicar correções silenciosas em registros.
      ws['!autofilter']={ref:ws['!ref']};
      const larguras={
        'Protocolo':43,'Cidade':24,'Bairro':34,'Endereço':38,'Número':15,'Tipo':41,
        'Status':19,'Empresa':35,'Atendimento da empresa':28,
        'ID da empresa':40,'ID do consórcio':40,
        'Data abertura':23,'Data conclusão':23,
        'Aberto em':23,'Concluído em':23,'Área':12,'Origem':18,
        'Prazo registrado (dias corridos)':36,
        'Situação SLA (dias corridos)':37,
        'Resultado estimado':36,'Tempo observado (dias corridos)':37,
        'Tempo observado (horas)':28,
        'Material':34,'Unidade':15,'Contratado':17,'Disponível':17,
        'Estoque mínimo':19,'Preço unitário':19,
        'Saídas identificadas':23,'Devoluções identificadas':26,
        'Saídas líquidas identificadas':30,
        'Movimentações vinculadas':26,'ID do estoque':40
      };
      ws['!cols']=headers.map(h=>({wch:larguras[h]||24}));
      for(const nome of ['Data abertura','Data conclusão','Aberto em','Concluído em']){
        const col=headers.indexOf(nome);
        if(col<0)continue;
        for(let linha=1;linha<=rows.length;linha++){
          const endereco=XLSX.utils.encode_cell({r:linha,c:col});
          const celula=ws[endereco];
          if(celula?.t==='d')celula.z='dd/mm/yyyy hh:mm:ss';
        }
      }
      XLSX.utils.book_append_sheet(wb,ws,label[tipo]);
      if(tipo==='chamados'){
        const r=resumoAtendimentos(dados);
        const consorcios=Array.isArray(window.v19RelatoriosConsorcios)?
          window.v19RelatoriosConsorcios:[];
        const linhas=r.grupos.map(g=>({
          'Empresa':g.empresa,
          'Consórcio':consorcios.find(c=>c.id===g.consorcio_id)?.nome||g.consorcio_id||'',
          'ID da empresa':g.empresa_id,'Concluídos':g.concluidos,
          'Parciais (Garantia LED)':g.parciais,'Total de chamados atendidos':g.total
        }));
        linhas.push({'Empresa':'TOTAL FILTRADO','Consórcio':'','ID da empresa':'',
          'Concluídos':r.concluidos,'Parciais (Garantia LED)':r.parciais,
          'Total de chamados atendidos':r.total});
        linhas.push({'Empresa':'METODOLOGIA',
          'Consórcio':'Um chamado por status atual; não equivale a viagens. Filtro de período pela abertura.'});
        if(r.semEmpresa)linhas.push({'Empresa':'SEM EMPRESA VINCULADA',
          'Consórcio':r.semEmpresa+' chamados atendidos sem atribuição; não entram na contagem empresarial.'});
        const resumoWs=XLSX.utils.json_to_sheet(linhas);
        resumoWs['!cols']=[{wch:36},{wch:55},{wch:40},{wch:15},{wch:25},{wch:20}];
        XLSX.utils.book_append_sheet(wb,resumoWs,'Atendimentos por empresa');
      }
      if(tipo==='sla'){
        // Só conclusões com prazo e datas suficientes entram na taxa de SLA.
        // Chamados abertos (inclusive vencidos) não são conclusões não apuráveis.
        const concluidos=dados.filter(c=>c.status==='Concluído');
        const abertos=dados.filter(c=>c.status!=='Concluído');
        const avaliados=concluidos.map(statusSLA).filter(a=>a.resultado!==null);
        const noPrazo=avaliados.filter(a=>a.resultado===true).length;
        const abertosComEstado=abertos.map(statusSLA);
        const abertosVencidos=abertosComEstado.filter(a=>a.estado==='Em atraso').length;
        const abertosNoPrazo=abertosComEstado.filter(a=>a.estado==='Em andamento no prazo').length;
        const abertosSemResultado=abertos.length-abertosVencidos-abertosNoPrazo;
        const resumo=[
          {'Indicador':'Chamados filtrados','Valor':dados.length},
          {'Indicador':'Concluídos','Valor':concluidos.length},
          {'Indicador':'Concluídos com SLA avaliável','Valor':avaliados.length},
          {'Indicador':'Concluídos dentro do prazo','Valor':noPrazo},
          {'Indicador':'Concluídos fora do prazo','Valor':avaliados.length-noPrazo},
          {'Indicador':'Concluídos sem SLA avaliável','Valor':concluidos.length-avaliados.length},
          {'Indicador':'Chamados ainda não concluídos','Valor':abertos.length},
          {'Indicador':'Não concluídos em atraso','Valor':abertosVencidos},
          {'Indicador':'Não concluídos dentro do prazo','Valor':abertosNoPrazo},
          {'Indicador':'Não concluídos com SLA não apurável','Valor':abertosSemResultado},
          {'Indicador':'Cumprimento de SLA entre conclusões avaliáveis','Valor':
            avaliados.length?(100*noPrazo/avaliados.length).toFixed(1)+'% ('+noPrazo+'/'+avaliados.length+')':'Não apurável (0 conclusões avaliáveis)'},
          {'Indicador':'Nota','Valor':'Estimativa por dias corridos (1 dia = 24 horas). Taxa calculada somente entre conclusões avaliáveis, nunca entre todos os chamados. Valores de tempo em horas e dias são arredondados apenas para exibição. Pausas sem histórico verificável impedem avaliar o SLA.'}
        ];
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
      let note='',conteudo=table;
      if(tipo==='chamados'){
        // A tabela de 13 colunas quebrava nomes, protocolos e endereços.
        // Fichas em A4 preservam todos os campos da planilha e evitam cortes.
        const abertos=dados.filter(c=>c.status!=='Concluído');
        const concluidos=dados.filter(c=>c.status==='Concluído');
        const vencidos=abertos.filter(c=>statusSLA(c).estado==='Em atraso').length;
        note='<div class="sla-summary"><b>Resumo dos filtros:</b> '+
          dados.length+(dados.length===1?' chamado; ':' chamados; ')+
          abertos.length+(abertos.length===1?' não concluído (':' não concluídos (')+
          vencidos+(vencidos===1?' vencido pelo SLA); ':' vencidos pelo SLA); ')+concluidos.length+
          (concluidos.length===1?' concluído.':' concluídos.')+
          ' Prazos em dias corridos; registros sem prazo não têm SLA apurável.</div>'+
          '<div class="sla-summary"><b>Atendimentos por empresa:</b> '+
          esc(avisoAtendimentos(dados))+'</div>'+tabelaAtendimentos(dados);
        const campo=(rotulo,valor)=>'<div class="sla-field"><b>'+esc(rotulo)+'</b><span>'+
          esc(valor===null||valor===undefined||valor===''?'—':valor)+'</span></div>';
        conteudo='<div class="sla-cards">'+dados.map(c=>{
          const situacao=statusSLA(c).estado;
          return '<section class="sla-card"><div class="sla-card-head">'+
            '<strong>'+esc(c.protocolo)+'</strong><span>'+esc(c.status)+'</span></div>'+
            '<div class="sla-grid">'+
            campo('Cidade',c.cidade)+campo('Bairro',c.bairro)+
            campo('Endereço',c.endereco)+campo('Número',window.v19NumeroEndereco?.(c.endereco)||'—')+
             campo('Tipo de chamado',c.tipo)+
            campo('Empresa responsável',c.empresa)+
            campo('Atendimento da empresa',situacaoAtendimento(c))+campo('Área',c.area)+
            campo('Origem',c.origem)+campo('Prazo (dias corridos)',dias(c._slaHoras))+
            campo('Data de abertura',fmtData(c.created_at))+
            campo('Data de conclusão',fmtData(c.completed_at))+
            campo('Situação do SLA',situacao)+
            '</div></section>';
        }).join('')+'</div>';
      }
      if(tipo==='sla'){
        // A tabela de 11 colunas ficava ilegível no A4. Exibir cada chamado
        // em uma ficha com todos os campos e sem quebra no meio da ficha.
        const concluidos=dados.filter(c=>c.status==='Concluído');
        const avaliaveis=concluidos.filter(c=>statusSLA(c).resultado!==null);
        const dentroPrazo=avaliaveis.filter(c=>statusSLA(c).resultado===true).length;
        const abertos=dados.filter(c=>c.status!=='Concluído');
        const vencidos=abertos.filter(c=>statusSLA(c).estado==='Em atraso').length;
        const percentual=avaliaveis.length?(100*dentroPrazo/avaliaveis.length).toFixed(1)+'% ('+dentroPrazo+'/'+avaliaveis.length+')':'Não apurável (0 avaliáveis)';
        note='<p>Metodologia: dias corridos (1 dia = 24 horas), incluindo finais de semana e feriados. '+
          'O SLA de conclusão só é avaliável quando existem prazo e datas suficientes. '+
          'Os prazos contratuais devem ser conferidos em separado.</p>'+
          '<div class="sla-summary"><b>Resumo dos filtros:</b> '+
          dados.length+(dados.length===1?' chamado; ':' chamados; ')+
          abertos.length+(abertos.length===1?' não concluído (':' não concluídos (')+
          vencidos+(vencidos===1?' vencido); ':' vencidos); ')+
          concluidos.length+(concluidos.length===1?' concluído (':' concluídos (')+
          (concluidos.length-avaliaveis.length)+
          (concluidos.length-avaliaveis.length===1?' sem SLA avaliável); ':' sem SLA avaliável); ')+
          'cumprimento entre conclusões avaliáveis: <b>'+percentual+'</b>.</div>';
        const campo=(rotulo,valor)=>'<div class="sla-field"><b>'+esc(rotulo)+'</b><span>'+
          esc(valor===null||valor===undefined||valor===''?'—':valor)+'</span></div>';
        conteudo='<div class="sla-cards">'+dados.map(c=>{
          const a=statusSLA(c);
          const duracao=a.tempo===null?'Não apurável':
            Number(a.tempo.toFixed(2))+' h / '+Number((a.tempo/24).toFixed(4))+' dias';
          return '<section class="sla-card"><div class="sla-card-head">'+
            '<strong>'+esc(c.protocolo)+'</strong><span>'+esc(c.status)+'</span></div>'+
            '<div class="sla-grid">'+
            campo('Cidade',c.cidade)+campo('Empresa responsável',c.empresa)+
            campo('Problema',c.tipo)+campo('Resultado estimado',a.estado)+
            campo('Aberto em',fmtData(c.created_at))+campo('Concluído em',fmtData(c.completed_at))+
            campo('Prazo (dias corridos)',dias(c._slaHoras))+
            campo('Tempo observado',duracao)+
            '</div></section>';
        }).join('')+'</div>';
      }
      if(tipo==='estoque')note='<p>Uma linha por estoque empresarial, com saldos separados por empresa. '+
        'Saídas e devoluções incluem somente movimentações associadas ao estoque de origem '+
        '(empresa_id e estoque_id identificados). Movimentos legados sem vínculo não entram '+
        'nesses indicadores. Contratado menos disponível não representa consumo comprovado.</p>';
      const win=window.open('','_blank');
      if(!win)throw new Error('O navegador bloqueou a janela de PDF; permita pop-ups e tente novamente.');
      const doc='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Aponte V19 '+esc(label[tipo])+
        '</title><style>body{font:12px Arial;margin:24px;color:#1f2937}h1{color:#1251a3}'+
        'table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:5px;text-align:left}'+
        'th{background:#e7eef9;color:#173b66;font-weight:700;vertical-align:top}tr:nth-child(even){background:#f3f4f6}'+
        'thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}'+
        '@page{size:A4 landscape;margin:10mm}p{font-size:11px}'+
        '.sla-summary{background:#edf3fc;border:1px solid #cbd7e9;padding:9px 12px;'+
        'border-radius:6px;margin-bottom:12px;font-size:11px;line-height:1.45}'+
        '.sla-card{border:1px solid #cbd5e1;border-radius:6px;padding:8px 11px;margin-bottom:9px;'+
        'break-inside:avoid;page-break-inside:avoid}'+
        '.sla-card-head{display:flex;justify-content:space-between;gap:15px;'+
        'border-bottom:1px solid #dce5f0;padding-bottom:5px;margin-bottom:7px;'+
        'color:#153d75;font-size:11px;overflow-wrap:anywhere}'+
        '.sla-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 15px}'+
        '.sla-field{min-width:0;font-size:11px;overflow-wrap:anywhere}'+
        '.sla-field b{display:block;color:#54657e;font-size:9px;margin-bottom:2px}'+
        '@media print{th{color:#173b66!important;background:#e7eef9!important}'+
        'thead,tbody{print-color-adjust:exact;-webkit-print-color-adjust:exact}'+
        '.print-hint{display:none}}</style></head><body>'+
        '<h1>Aponte Iluminação V19 · '+esc(label[tipo])+'</h1>'+
        '<p>Gerado em '+esc(new Date().toLocaleString('pt-BR'))+' · '+dados.length+
        (dados.length===1?' registro filtrado · Perfil: ':' registros filtrados · Perfil: ')+
        esc(CU?.perfil||'')+'</p>'+note+conteudo+
        '<p class="print-hint">Use Ctrl+P para imprimir ou salvar como PDF.</p></body></html>';
      win.document.open();win.document.write(doc);win.document.close();win.focus();
    }catch(e){showToast(esc(e.message),'erro');}
  };

  // O usuário nunca exporta estoque de uma sessão ou consulta anterior.
  // Os campos de empresa/estoque são preservados sem agrupamento global.
  const originalRelatorios=window.vRelatorios;
  window.vRelatorios=async function (b,t,a){
    // Nao reutilizar filtros ou exportacoes obtidas em outro login/consulta.
    _exportMats=null;_exportChamados=null;
    t.textContent='Relatórios';a.innerHTML='';
    b.innerHTML='<div class="tcard" style="padding:2rem">Atualizando chamados e posições de estoque empresariais do Supabase…</div>';
    const sessao=SB_SESSION?.user?.id;
    const perfil=CU?.perfil,consorcio=CU?.consorcio_id,
      empresa=CU?.empresa_id;
    // A RPC de estoque autoriza somente Master, Consórcio e Empresa.
    // Prefeitura e Garantia podem consultar chamados (sob RLS), mas nunca
    // requisitar ou exportar posições empresariais de estoque.
    const podeConsultarEstoque=['master','consorcio','empresa'].includes(perfil);
    const soChamados=['prefeitura','garantia'].includes(perfil);
    try {
      if(!podeConsultarEstoque&&!soChamados)
        throw new Error('Perfil não autorizado para relatórios.');
      if(soChamados&&(!uuid(consorcio)||
          (perfil==='prefeitura'&&!uuid(CU?.cidade_id))))
        throw new Error('Vínculo do usuário inválido para relatórios.');
      // Chamados seguem estritamente o RLS do Supabase: Prefeitura vê seu
      // município; Garantia vê apenas as ocorrências que o banco autorizar.
      // Carrega todas as páginas autorizadas (RLS). A tabela de empresas
      // complementa os nomes/UUIDs sem atribuir atendimentos a terceiros.
      const [ok,saldos,consorciosLista,empresasLista]=await Promise.all([
        carregarChamadosDoBanco(true),
        podeConsultarEstoque
          ? sbFetch('rpc/v19_relatorio_estoque_empresarial')
          : Promise.resolve([]),
        perfil==='master'?sbSelect('consorcios','select=id,nome&order=nome.asc'):Promise.resolve([]),
        ['master','consorcio','empresa'].includes(perfil)
          ? sbSelect('empresas','select=id,nome,consorcio_id&order=nome.asc').catch(()=>[])
          : Promise.resolve([])
      ]);
      if(!ok)throw new Error('Chamados do banco não confirmados; relatório cancelado.');
      if(t.textContent!=='Relatórios'||!b.isConnected||
         SB_SESSION?.user?.id!==sessao||
         CU?.perfil!==perfil||CU?.consorcio_id!==consorcio||
         CU?.empresa_id!==empresa)return;
      const mats=podeConsultarEstoque?mapearEstoquesEmpresariais(saldos):[];
      window.v19RelatoriosConsorcios=Array.isArray(consorciosLista)?consorciosLista:[];
      window.v19RelatoriosEmpresas=Array.isArray(empresasLista)?empresasLista:[];
      DB.materiais=mats;
      originalRelatorios(b,t,a);
      if(!podeConsultarEstoque){
        // Ocultar controles de estoque em perfis que consultam apenas
        // chamados. Não mostrar o painel de estoque com zero fictício.
        document.getElementById('rf-matStatus')?.closest('.field')?.remove();
        const empresaLabel=document.getElementById('rf-empresa')
          ?.closest('.field')?.querySelector('label');
        if(empresaLabel)empresaLabel.textContent='Empresa (chamados)';
        const cardEstoque=document.getElementById('btn-pdf-estoque')?.closest('.card');
        if(cardEstoque){
          const grupo=cardEstoque.parentElement;
          cardEstoque.remove();
          if(grupo)grupo.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
        }
      }
      const buscarAntes=window._rfBuscar;
      window._rfBuscar=function(){
        buscarAntes();
        if(!podeConsultarEstoque){
          _exportMats=[];
          const grid=document.getElementById('rf-preview')?.firstElementChild;
          if(grid&&grid.children.length===4){
            grid.lastElementChild.remove();
            grid.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
          }
        }
        const data=Array.isArray(_exportChamados)?_exportChamados:[];
        const relatorio=document.getElementById('rf-preview');
        if(relatorio){
          const r=resumoAtendimentos(data);
          const cartao=document.createElement('div');
          cartao.style.cssText='margin-top:14px;border-top:1px solid var(--gray-200);padding-top:12px';
          const total=document.createElement('div');
          total.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px';
          const kpi=(titulo,valor,cor)=>{
            const el=document.createElement('div');el.style.cssText='padding:10px;border:1px solid var(--gray-200);border-radius:8px;text-align:center';
            const num=document.createElement('strong');num.style.cssText='display:block;font-size:23px;color:'+cor;num.textContent=String(valor);
            const lab=document.createElement('span');lab.style.cssText='display:block;font-size:11px';lab.textContent=titulo;
            el.append(num,lab);return el;
          };
          total.append(kpi('Total de chamados atendidos',r.total,'var(--brand)'),
            kpi('Concluídos',r.concluidos,'var(--green)'),
            kpi('Parciais / Garantia LED',r.parciais,'#b45309'));
          const titulo=document.createElement('h4');
          titulo.textContent='Atendimentos por empresa — mesmos filtros acima';
          titulo.style.cssText='font-size:13px;margin:12px 0';
          const tabela=document.createElement('div');
          tabela.style.cssText='overflow-x:auto;font-size:12px';
          tabela.innerHTML=tabelaAtendimentos(data);
          const nota=document.createElement('p');nota.style.cssText='font-size:11px;color:var(--gray-600);margin-top:8px';
          nota.textContent=avisoAtendimentos(data);
          cartao.append(total,titulo,tabela,nota);
          relatorio.appendChild(cartao);
        }
        // "Resultado" do SLA só é avaliável após a conclusão. Chamados
        // abertos (mesmo vencidos) NÃO são "conclusões não apuráveis".
        const naoConcluidos=data.filter(c=>c.status!=='Concluído');
        const concluidos=data.filter(c=>c.status==='Concluído');
        const abertosVencidos=naoConcluidos.filter(c=>statusSLA(c).estado==='Em atraso').length;
        const concluidosAvaliaveis=concluidos.filter(c=>statusSLA(c).resultado!==null).length;
        const concluidosNaoApuraveis=concluidos.length-concluidosAvaliaveis;
        const sla=document.getElementById('rf-preview');
        if(sla){
          const resumoSLA=document.createElement('p');
          resumoSLA.style.cssText='font-size:11px;color:var(--gray-600);margin-top:8px';
          resumoSLA.textContent='SLA em dias corridos: '+abertosVencidos+
            ' chamados não concluídos vencidos; '+naoConcluidos.length+
            ' ainda não concluídos; '+concluidosAvaliaveis+' de '+concluidos.length+
            ' conclusões avaliáveis; '+concluidosNaoApuraveis+
            ' conclusões sem dados suficientes para avaliar o SLA. '+
            'O percentual de concluídos acima não é a taxa de cumprimento do SLA.';
          sla.appendChild(resumoSLA);
        }
      };
      window._rfBuscar();
    }catch(e){
      if(t.textContent!=='Relatórios'||!b.isConnected||
         SB_SESSION?.user?.id!==sessao||
         CU?.perfil!==perfil||CU?.consorcio_id!==consorcio||
         CU?.empresa_id!==empresa)return;
      b.innerHTML='<div class="tcard" style="padding:2rem;color:var(--red)">'+esc(e.message)+'</div>';
      showToast(esc(e.message),'erro');
    }
  };
  // Backend V19 registra histórico de status. Impede duplicação de linhas
  // ao enviar novamente o array de eventos da sessão.
  window.sbSaveHistorico=async function(){return true;};
  console.info('[Aponte V19] relatórios filtrados e histórico automático.');
})();