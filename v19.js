/* Aponte Cidadão V19 — integração progressiva com Supabase.
   Requer migração sql/v19/03_rpc_estoque_e_permissoes.sql ANTES de liberar estoque.
   Este módulo só é carregado por teste-v19/index.html. */
(function () {
  'use strict';
  const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, x =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const isAdmin = () => !!(CU && ['master','consorcio'].includes(CU.perfil));
  const mayManageTeams = () => !!(CU && ['master','consorcio','empresa'].includes(CU.perfil));
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validUUID = value => uuidRegex.test(String(value || ''));
  function rpcResult(payload) {
    const obj = Array.isArray(payload) ? payload[0] : payload;
    if (!obj || obj.ok !== true) throw new Error(obj?.erro || 'A operação não foi confirmada pelo Supabase.');
    return obj;
  }
  function warn(message) { showToast(escapeHTML(message), 'erro'); }
  function escPath(value) { return encodeURIComponent(String(value || '')); }

  // Não reaproveitar os cadastros demonstrativos ao ficar sem rede.
  window.getMats = function () { return Array.isArray(DB.materiais) ? DB.materiais : []; };
  window.getEquipes = function () { return Array.isArray(DB.equipes) ? DB.equipes : []; };

  // Paginação: evita indicadores e relatórios incompletos acima de 500 chamados.
  window.sbGetChamados = async function () {
    try {
      const collected = [], pageSize = 500, limitMax = 25000;
      for (let offset = 0; offset < limitMax; offset += pageSize) {
        const batch = await sbFetch('chamados?select=*&order=created_at.desc,id.desc&limit=' +
          pageSize + '&offset=' + offset);
        if (!Array.isArray(batch)) throw new Error('Formato inesperado de chamados.');
        collected.push(...batch);
        if (batch.length < pageSize) {
          console.info('[V19] chamados paginados:', collected.length);
          return collected;
        }
      }
      throw new Error('Mais de 25 mil chamados; consulta abortada para evitar relatório parcial.');
    } catch (e) {
      console.error('[V19] Não foi possível carregar todos os chamados:', e);
      warn('Falha ao consultar chamados: ' + e.message);
      return null;
    }
  };

  // Catálogo real: cada linha transporta o consórcio de origem.
  window.sbGetMateriais = async function () {
    try {
      const mats = await sbSelect('materiais','select=*&status=eq.ativo&order=nome.asc');
      const estoques = await sbSelect('estoques','select=*');
      if (!Array.isArray(mats) || !Array.isArray(estoques)) throw new Error('Consulta de materiais ou saldos falhou.');
      const indexed = new Map(estoques.map(e => [e.material_id, e]));
      return mats.map(m => {
        const e = indexed.get(m.id);
        return {id:m.id, _supaId:m.id, consorcio_id:m.consorcio_id,
          n:m.nome, u:m.unidade || 'Un.', preco:Number(m.preco_unitario || 0),
          min:Number(m.estoque_minimo || 0), cont:Number(e?.quantidade_contratada || 0),
          disp:Number(e?.quantidade_disponivel || 0), _estoqueId:e?.id || null};
      });
    } catch (e) {
      console.error('[V19] estoque:', e);
      return null;
    }
  };

  window.sbSaveMaterial = async function (mat) {
    try {
      if (!isAdmin()) throw new Error('Somente Master ou Consórcio pode cadastrar materiais.');
      const id = validUUID(mat?._supaId || mat?.id) ? (mat._supaId || mat.id) : null;
      const sel = document.getElementById('v19-mat-consorcio');
      const cons = sel?.value || mat?.consorcio_id || CU?.consorcio_id || null;
      if (!validUUID(cons)) throw new Error('Selecione um consórcio válido para o material.');
      const r = rpcResult(await sbFetch('rpc/v19_salvar_material','POST',{
        p_material_id:id, p_consorcio_id:cons, p_nome:mat.n,
        p_unidade:mat.u || 'Un.', p_estoque_minimo:Number(mat.min || 0),
        p_preco_unitario:Number(mat.preco || 0),
        p_quantidade_contratada:Number(mat.cont || 0),
        p_quantidade_disponivel:Number(mat.disp || 0)
      }));
      return r.material_id;
    } catch (e) {
      console.error('[V19] salvar material:', e);
      warn(e.message);
      return false;
    }
  };

  window.sbDeleteMaterial = async function (materialId) {
    try {
      if (!isAdmin()) throw new Error('Sem permissão para excluir materiais.');
      rpcResult(await sbFetch('rpc/v19_excluir_material','POST',{p_material_id:materialId}));
      return true;
    } catch (e) { warn(e.message); return false; }
  };

  // Métodos legados não devem mais escrever saldo/itens sem histórico transacional.
  window.sbBaixaEstoque = async function () {
    throw new Error('V19: baixa direta bloqueada; usar RPC transacional.');
  };
  window.sbSaveChamadoMaterial = async function (protocolo, materialId, quantidade) {
    const rows = await sbSelect('chamados',
      'select=id&protocolo=eq.' + escPath(protocolo) + '&limit=1');
    if (!Array.isArray(rows) || !rows[0]?.id) return false;
    const r = rpcResult(await sbFetch('rpc/consumir_material_chamado','POST',{
      p_chamado_id:rows[0].id,p_material_id:materialId,p_quantidade:Number(quantidade)}));
    return !!r.ok;
  };

  // Grava saldo + movimento em UMA operação no banco, sem compare-and-set no navegador.
  window.salvarMovimentacao = async function () {
    const btn = document.querySelector('button[onclick="salvarMovimentacao()"]');
    if (btn?.disabled) return;
    if (!isAdmin()) { warn('Movimentações manuais são restritas a Master e Consórcio.'); return; }
    const matId=document.getElementById('mov-material')?.value;
    const tipo=document.getElementById('mov-tipo')?.value;
    const qtd=Number(document.getElementById('mov-qtd')?.value);
    if(!validUUID(matId) || !['entrada','saida'].includes(tipo) || !Number.isFinite(qtd) || qtd<=0) {
      warn('Escolha um material válido e informe quantidade positiva.'); return;
    }
    if(btn) {btn.disabled=true;btn.textContent='Registrando…';}
    try {
      rpcResult(await sbFetch('rpc/v19_movimentar_estoque','POST',{
        p_material_id:matId,p_tipo:tipo,p_quantidade:qtd,
        p_observacao:(document.getElementById('mov-obs')?.value||'').trim().slice(0,500) || 'Movimentação manual pela interface V19'
      }));
      const materiais=await sbGetMateriais();
      if (!Array.isArray(materiais)) throw new Error('Movimento confirmado; recarregue a tela para obter o saldo.');
      DB.materiais=materiais;
      renderEstoqueGrid();
      fecharModalMov();
      // O grid era atualizado, mas o KPI "saídas no mês" permanecia antigo
      // até F5. Reconsultar o livro de movimentos após a transação confirmada.
      contarMovimentosSaidaMes().then(count=>{
        const kpi=document.getElementById('stk-saidas');
        if(kpi)kpi.textContent=count.toLocaleString('pt-BR');
        window._v19SaidasMes=count;
      }).catch(e=>console.warn('[V19] contador de saídas após movimentação:',e.message));
      showToast('✅ Movimentação confirmada e registrada no histórico.','ok');
    } catch(e) { warn(e.message); }
    finally {if(btn){btn.disabled=false;btn.textContent='✓ Registrar';}}
  };

  // HISTORICO REAL V19: mostrar o livro de movimentos (movimentacoes),
  // e NAO somente itens de consumo ativos (chamado_materiais).
  // Estornos removem o item operacional, mas preservam o ledger.
  window.abrirHistoricoMovimentacao = async function () {
    let ov=document.getElementById('modal-hist-mov');
    if(!ov){
      ov=document.createElement('div');
      ov.id='modal-hist-mov';
      document.body.appendChild(ov);
    }
    ov.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    document.body.style.overflow='hidden';
    ov.innerHTML=`<div style="background:#fff;border-radius:16px;width:min(94vw,750px);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.28)">
      <div style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb">
        <div><div style="font-size:15px;font-weight:800">📋 Histórico real do estoque</div>
          <div style="font-size:11px;color:#64748b">Entradas, saídas, consumos, ajustes e estornos registrados no Supabase V19</div></div>
        <button id="v19-close-history" type="button" style="border:1px solid #e5e7eb;background:#fff;padding:6px 12px;border-radius:8px;cursor:pointer">✕ Fechar</button>
      </div>
      <div id="v19-history-content" style="flex:1;overflow-y:auto;padding:14px 20px;color:#475569">Carregando movimentações...</div>
    </div>`;
    const close=()=>{
      ov.style.display='none';
      document.body.style.overflow='';
    };
    ov.querySelector('#v19-close-history').addEventListener('click',close);
    const target=ov.querySelector('#v19-history-content');
    try {
      const rows=await sbSelect('movimentacoes','select=*&order=created_at.desc&limit=200');
      if(!Array.isArray(rows))
        throw new Error('A consulta às movimentações não foi autorizada ou não respondeu.');
      const matNames=new Map(getMats().map(m=>[m.id,m.n]));
      const chNames=new Map((Array.isArray(DB.chamados)?DB.chamados:[])
        .filter(ch=>ch?.id).map(ch=>[ch.id,ch.protocolo||ch.id]));
      if(!rows.length){
        target.textContent='Nenhuma movimentação registrada para este usuário/consórcio.';
        return;
      }
      const labels={
        entrada:'Entrada',saida:'Saída',consumo:'Consumo em chamado',
        devolucao:'Devolução por ajuste',estorno:'Estorno de consumo'
      };
      target.innerHTML=`<div style="font-size:12px;color:#475569;margin-bottom:10px">Exibindo ${rows.length} movimentação(ões) — até as 200 mais recentes. Os saldos são calculados no banco.</div>`+
        rows.map(m=>{
          const isIn=['entrada','devolucao','estorno'].includes(m.tipo);
          const sign=isIn?'+':'−';
          const amount=Number(m.quantidade);
          const qty=Number.isFinite(amount)?amount.toLocaleString('pt-BR',{maximumFractionDigits:2}):String(m.quantidade??'');
          const dt=m.created_at?new Date(m.created_at).toLocaleString('pt-BR'):'';
          const label=labels[m.tipo]||String(m.tipo||'Movimentação');
          const mat=matNames.get(m.material_id)||m.material_id||'Material';
          const chamado=m.chamado_id?(chNames.get(m.chamado_id)||m.chamado_id):'';
          return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:11px 13px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <div>
                <div style="font-size:13px;font-weight:700">${escapeHTML(mat)}</div>
                <div style="font-size:11px;color:#475569">${escapeHTML(label)} · ${escapeHTML(dt)}</div>
              </div>
              <div style="color:${isIn?'#047857':'#b91c1c'};font-weight:800;white-space:nowrap">${sign}${escapeHTML(qty)}</div>
            </div>
            <div style="font-size:11px;color:#64748b;margin-top:5px">${chamado?'Chamado: '+escapeHTML(chamado)+' · ':''}Responsável: ${escapeHTML(m.usuario_nome||'Sistema')}</div>
            ${m.observacao?'<div style="font-size:11px;color:#64748b;margin-top:4px">Obs.: '+escapeHTML(m.observacao)+'</div>':''}
          </div>`;
        }).join('');
    }catch(e){
      target.textContent='Não foi possível consultar o histórico do banco: '+e.message;
      console.warn('[V19] histórico estoque:',e.message);
    }
  };

  const previousVEstoque = window.vEstoque;
  async function contarMovimentosSaidaMes() {
    // Mês civil de Brasília; contamos MOVIMENTOS, não misturamos
    // quantidade de unidades, metros e quilogramas.
    const pieces=Object.fromEntries(new Intl.DateTimeFormat('pt-BR',
      {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date())
      .map(p=>[p.type,p.value]));
    const first=pieces.year+'-'+pieces.month+'-01';
    let count=0;
    for(let off=0;off<25000;off+=500){
      const rows=await sbFetch('movimentacoes?select=id&tipo=in.(saida,consumo)'+
        '&created_at=gte.'+encodeURIComponent(first+'T00:00:00-03:00')+
        '&order=created_at.desc&limit=500&offset='+off);
      if(!Array.isArray(rows))throw new Error('Histórico de movimentos indisponível.');
      count+=rows.length;
      if(rows.length<500)return count;
    }
    throw new Error('Mais de 25 mil saídas mensais. Evitando contagem parcial.');
  }
  window.vEstoque = function (b,t,a) {
    window._v19SaidasMes=null;
    previousVEstoque(b,t,a);
    contarMovimentosSaidaMes().then(count=>{
      if(t.textContent!=='Controle de estoque'||!document.getElementById('stk-saidas'))return;
      window._v19SaidasMes=count;
      document.getElementById('stk-saidas').textContent=count.toLocaleString('pt-BR');
    }).catch(e=>{console.warn('[V19] movimentos do mês:',e.message);});
    if (!isAdmin()) {
      a.innerHTML='<span style="color:var(--gray-500);font-size:12px">Consulta de estoque. Baixas em chamados autorizados.</span>';
    }
  };
  const previousAbrirMaterial = window.abrirModalMaterial;
  window.abrirModalMaterial = async function (id) {
    if (!isAdmin()) {warn('Sem permissão para cadastrar ou editar materiais.');return;}
    previousAbrirMaterial(id);
    if (CU?.perfil !== 'master') return;
    try {
      const rows=await sbSelect('consorcios','select=id,nome&order=nome.asc');
      const body=document.getElementById('modal-mat-overlay');
      const target=body?.querySelector('.field');
      if (!Array.isArray(rows) || !target) return;
      let select=document.getElementById('v19-mat-consorcio');
      if (!select) {
        const div=document.createElement('div');div.className='field';
        div.innerHTML='<label>Consórcio do material *</label><select id="v19-mat-consorcio"></select>';
        target.parentElement.insertBefore(div,target);select=div.querySelector('select');
      }
      const item=getMats().find(m=>m.id===id);
      select.innerHTML='<option value="">Selecione…</option>' +
        rows.map(r=>'<option value="'+escapeHTML(r.id)+'" '+(item?.consorcio_id===r.id?'selected':'')+'>'+escapeHTML(r.nome)+'</option>').join('');
    } catch(e) {warn('Não foi possível carregar os consórcios: '+e.message);}
  };
  const previousAbrirMov = window.abrirMovimentacao;
  window.abrirMovimentacao = function(id) {
    if (!isAdmin()) {warn('Movimentações manuais são restritas a Master e Consórcio.');return;}
    return previousAbrirMov(id);
  };

  // Equipes deixam de ser gravadas em DB/localStorage; sempre buscar na base real.
  const previousVEquipes=window.vEquipes;
  const previousAbrirEquipe=window.abrirModalEquipe;
  window.vEquipes = async function (b,t,a) {
    t.textContent='Equipes';a.innerHTML='';
    b.innerHTML='<div class="tcard" style="padding:2rem">Consultando equipes do Supabase…</div>';
    if (!mayManageTeams()) {
      b.innerHTML='<div class="tcard" style="padding:2rem">Acesso restrito.</div>'; return;
    }
    try {
      const [rows,empRows]=await Promise.all([
        sbSelect('equipes','select=*&order=nome.asc'),
        sbSelect('empresas','select=*&order=nome.asc')
      ]);
      if (!Array.isArray(rows)||!Array.isArray(empRows)) throw new Error('O banco não retornou equipes ou empresas.');
      if (t.textContent!=='Equipes' || !b.isConnected) return;
      const allowedEmps=CU?.perfil==='empresa'?empRows.filter(e=>e.id===CU.empresa_id):empRows;
      DB.empresas=allowedEmps.map(mapEmpresa);
      const map=new Map(allowedEmps.map(e=>[e.id,e.nome]));
      const permitted=CU?.perfil==='empresa'?rows.filter(e=>e.empresa_id===CU.empresa_id):rows;
      DB.equipes=permitted.map(e=>({
        id:e.id,consorcio_id:e.consorcio_id,empresa_id:e.empresa_id,
        nome:e.nome,empresa:map.get(e.empresa_id)||'—',tecnico:e.tecnico_lider||'',
        membros:e.membros||1,cidades:e.cidades||[],status:e.status||'ativa'
      }));
      previousVEquipes(b,t,a);
      window.excluirEquipe = async function(id) {
        const equipe=getEquipes().find(e=>e.id===id);
        if(!equipe || !confirm('Excluir a equipe "'+equipe.nome+'"?'))return;
        try{
          const resp=await sbFetch('equipes?id=eq.'+escPath(id)+'&select=id','DELETE');
          if (!Array.isArray(resp)||resp.length!==1) throw new Error('Exclusão não confirmada pelo banco.');
          showToast('✅ Equipe excluída no Supabase.','ok');
          await window.vEquipes(b,t,a);
        }catch(e){warn(e.message);}
      };
    }catch(e){
      b.innerHTML='<div class="tcard" style="padding:2rem;color:var(--red)">'+escapeHTML(e.message)+'</div>';
      warn(e.message);
    }
  };

  window.abrirModalEquipe = async function (id) {
    if(!mayManageTeams()){warn('Sem permissão para gerenciar equipes.');return;}
    previousAbrirEquipe(id);
    const overlay=document.getElementById('modal-eq-overlay');
    if (!overlay || overlay.style.display==='none') return;
    try {
      const cities=await sbSelect('cidades','select=id,nome,consorcio_id&order=nome.asc');
      if(!Array.isArray(cities))return;
      const eq=id?getEquipes().find(e=>e.id===id):null;
      const check=document.querySelector('#modal-eq-body input[type=checkbox]');
      const panel=check?.parentElement?.parentElement;
      if(!panel)return;
      const validCities=cities.filter(c=>CU?.perfil==='master'||!CU?.consorcio_id||c.consorcio_id===CU.consorcio_id);
      panel.innerHTML=validCities.map(c=>'<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" value="'+escapeHTML(c.nome)+'" '+(eq?.cidades?.includes(c.nome)?'checked':'')+'> '+escapeHTML(c.nome)+'</label>').join('');
    }catch(e){console.warn('[V19] cidades da equipe:',e.message);}
  };

  window.salvarEquipe = async function () {
    if(!mayManageTeams()){warn('Sem permissão para salvar equipes.');return;}
    const nome=document.getElementById('eq-nome')?.value?.trim();
    const tecnico=document.getElementById('eq-tecnico')?.value?.trim()||'';
    const membros=Number(document.getElementById('eq-membros')?.value);
    const empresaNome=document.getElementById('eq-empresa')?.value;
    const emps=getEmpresas();
    const empresa=CU.perfil==='empresa' ?
      emps.find(e=>e.id===CU.empresa_id) : emps.find(e=>e.nome===empresaNome);
    if (!nome || !empresa || !Number.isInteger(membros) || membros<1 || membros>100) {
      warn('Preencha nome, empresa autorizada e número válido de membros.');return;
    }
    const cons=empresa.consorcio_id||CU.consorcio_id;
    if(!validUUID(cons)) {warn('Consórcio da equipe não identificado.');return;}
    const cidades=[...document.querySelectorAll('#modal-eq-body input[type=checkbox]:checked')].map(e=>e.value);
    const id=typeof _eqEditId==='undefined'?null:_eqEditId;
    const row={nome,consorcio_id:cons,empresa_id:empresa.id,tecnico_lider:tecnico,
      membros,cidades,status:'ativa'};
    const btn=document.querySelector('#modal-eq-overlay button[onclick="salvarEquipe()"]');
    if(btn?.disabled)return;
    if(btn) {btn.disabled=true;btn.textContent='Salvando…';}
    try{
      const payload=id?
        await sbFetch('equipes?id=eq.'+escPath(id)+'&select=id','PATCH',row):
        await sbFetch('equipes?select=id','POST',row);
      if(!Array.isArray(payload)||payload.length!==1) throw new Error('A gravação da equipe não foi confirmada.');
      fecharModalEquipe();
      showToast('✅ Equipe salva no Supabase.','ok');
      const b=document.getElementById('main-body'),t=document.getElementById('topbar-title'),a=document.getElementById('topbar-actions');
      await window.vEquipes(b,t,a);
    }catch(e){warn(e.message);}
    finally {if(btn){btn.disabled=false;btn.textContent='💾 Salvar equipe';}}
  };

  // Nenhum perfil deve receber falso toast de "SLA salvo" via localStorage.
  window.saveSLAConfig = function () {
    warn('Edição de SLA ainda não está conectada ao banco na V19. Nenhuma alteração foi salva.');
  };
  const previousVSLA=window.vSLA;
  window.vSLA = function (b,t,a) {
    previousVSLA(b,t,a);
    a.innerHTML='<span style="color:var(--gray-500);font-size:12px">Configuração de SLA: leitura provisória. Edição desabilitada até sincronização com o banco.</span>';
    b.querySelectorAll('input,select').forEach(el=>el.disabled=true);
  };

  console.info('[Aponte V19] integração de chamados, equipes e estoque carregada.');
})();