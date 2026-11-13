/* APONTE CIDADAO V19 — ETAPA 570
 * Preparacao da tela de consumo por chamado, SOMENTE LEITURA.
 * Nenhum consumo/edicao/estorno ativo: RPCs ainda revogadas no banco.
 * Empresas so veem materiais do proprio estoque; Master/Consorcio consultam
 * o historico do chamado SEM botoes de escrita.
 * O estado do chamado e sua empresa sao confirmados no Supabase antes
 * da listagem. V18 de producao permanece intacta.
 */
(function () {
  'use strict';
  const uuid=v=>typeof v==='string' &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  const dec=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const money=v=>Number(v||0).toLocaleString('pt-BR',
    {style:'currency',currency:'BRL'});
  const readStatuses=new Set([
    'Em programação','Em execução','Aguard. material','Aguardando material'
  ]);
  let renderId=0;
  let modalId=0;

  function node(tag,parent,content,style) {
    const el=document.createElement(tag);
    if(content!==undefined && content!==null)el.textContent=String(content);
    if(style)el.style.cssText=style;
    if(parent)parent.appendChild(el);
    return el;
  }
  function message(text) {
    if(typeof showToast==='function')showToast(text,'aviso');
  }
  function canPreview(ch) {
    return !!SB_SESSION?.user?.id &&
      CU?.perfil==='empresa' &&
      uuid(CU?.consorcio_id) && uuid(CU?.empresa_id) &&
      ch?.consorcio_id===CU.consorcio_id &&
      ch?.empresa_id===CU.empresa_id &&
      uuid(ch?._supaId);
  }
  function activeSession(user,company,callId) {
    return SB_SESSION?.user?.id===user &&
      CU?.perfil==='empresa' && CU?.empresa_id===company &&
      CC?._supaId===callId;
  }
  function addMessage(parent,heading,text) {
    const wrap=node('section',parent,null,
      'border:1px solid #e2e8f0;border-radius:10px;' +
      'padding:12px;margin-top:12px;background:#fff;');
    node('strong',wrap,heading,'font-size:13px;color:#0f172a;');
    if(text)node('p',wrap,text,
      'font-size:12px;color:#64748b;margin:6px 0 0;');
    return wrap;
  }
  function closeModal() {
    const modal=document.getElementById('v19-consumo-preview');
    if(modal)modal.remove();
    document.body.style.overflow='';
  }
  window.v19FecharPreviewConsumo=closeModal;

  window.adicionarMaterialChamado=async function() {
    const ch=CC;
    if(!canPreview(ch)) {
      message('Somente a empresa responsável pode consultar materiais para este chamado.');
      return;
    }
    const session=SB_SESSION.user.id;
    const company=CU.empresa_id;
    const consortium=CU.consorcio_id;
    const callId=ch._supaId;
    const request=++modalId;
    closeModal();
    const shade=node('div',document.body,null,
      'position:fixed;inset:0;background:rgba(15,23,42,.60);' +
      'z-index:10000;display:flex;justify-content:center;align-items:center;' +
      'padding:16px;box-sizing:border-box;');
    shade.id='v19-consumo-preview';
    const card=node('div',shade,null,
      'background:#fff;border-radius:14px;max-width:650px;width:100%;' +
      'max-height:88vh;overflow:auto;padding:18px;box-sizing:border-box;');
    const header=node('div',card,null,
      'display:flex;justify-content:space-between;align-items:center;gap:12px;');
    node('strong',header,'Materiais da minha empresa · Chamado',
      'font-size:16px;color:#0f172a;');
    const close=node('button',header,'Fechar',
      'border:1px solid #cbd5e1;background:white;border-radius:8px;' +
      'padding:8px 12px;cursor:pointer;');
    close.type='button';close.addEventListener('click',closeModal);
    shade.addEventListener('click',e=>{if(e.target===shade)closeModal();});
    addMessage(card,'Somente consulta — etapa 570',
      'Consumo, edições e estornos ainda estão bloqueados no Supabase.' +
      ' Nenhuma quantidade será alterada nesta etapa.');
    const results=node('div',card,'Consultando saldo empresarial…',
      'font-size:12px;color:#64748b;margin-top:12px;');
    document.body.style.overflow='hidden';
    try {
      const [called,stocks]=await Promise.all([
        sbSelect('chamados','select=id,consorcio_id,empresa_id,status,protocolo'+
          '&id=eq.'+encodeURIComponent(callId)+'&limit=1'),
        sbFetch('rpc/v19_listar_estoques_por_empresa',
          'POST',{p_consorcio_id:consortium})
      ]);
      if(request!==modalId || !activeSession(session,company,callId) ||
         !document.getElementById('v19-consumo-preview'))return;
      if(!Array.isArray(called)||called.length!==1 ||
        called[0].empresa_id!==company ||
        called[0].consorcio_id!==consortium) {
        throw new Error('O chamado não está atribuído à sua empresa.');
      }
      const status=String(called[0].status||'');
      if(!Array.isArray(stocks))throw new Error('Consulta de estoque indisponível.');
      // Defesa adicional: falha fechada se a RPC devolver saldos de terceiros.
      if(stocks.some(r=>r?.empresa_id!==company ||
          r?.consorcio_id!==consortium || r?.saldo_legado===true)) {
        throw new Error('Consulta retornou estoque de outra empresa.');
      }
      results.replaceChildren();
      addMessage(results,'Chamado '+(called[0].protocolo||''),
        readStatuses.has(status)
          ? 'Status '+status+' · escolha do material será habilitada após homologação das RPCs.'
          : 'Status '+status+' · consumo não é permitido neste estado.');
      const list=stocks.filter(r=>r.estoque_id && uuid(r.estoque_id));
      if(!list.length){
        addMessage(results,'Nenhum material cadastrado',
          'Cadastre materiais na tela Estoque da própria empresa.');
        return;
      }
      list.sort((a,b)=>String(a.material_nome).localeCompare(String(b.material_nome),'pt-BR'))
        .forEach(r=>{
          const available=Number(r.quantidade_disponivel);
          const pane=addMessage(results,String(r.material_nome||'Material'),
            'Disponível: '+dec(r.quantidade_disponivel)+' '+(r.unidade||'')+
            ' · Contratado: '+dec(r.quantidade_contratada)+
            ' · Preço unitário: '+money(r.preco_unitario));
          node('small',pane,
            Number.isFinite(available)&&available>0
              ? 'Disponível para consumo quando a funcionalidade for liberada'
              : 'Sem saldo disponível para consumo',
            'display:block;margin-top:6px;color:#64748b;');
        });
    } catch(e) {
      if(request!==modalId || !activeSession(session,company,callId) ||
         !document.getElementById('v19-consumo-preview'))return;
      results.replaceChildren();
      addMessage(results,'Não foi possível consultar materiais',
        e?.message||'Erro de conexão. Tente novamente.');
    }
  };

  window.renderMateriaisChamado=async function() {
    const target=document.getElementById('dw-materiais-lista');
    if(!target||!CC)return;
    const current=++renderId;
    const user=SB_SESSION?.user?.id;
    const called=CC;
    target.replaceChildren();
    node('p',target,'Carregando consumo registrado…',
      'font-size:12px;color:#64748b;');
    if(!uuid(called._supaId)||!user) {
      target.replaceChildren();
      addMessage(target,'Dados indisponíveis',
        'Identificação do chamado ou sessão indisponível.');
      return;
    }
    try {
      const [items,mats]=await Promise.all([
        sbSelect('chamado_materiais','select=id,material_id,quantidade,preco_unitario,total,estoque_id'+
          '&chamado_id=eq.'+encodeURIComponent(called._supaId)),
        sbSelect('materiais','select=id,nome&consorcio_id=eq.'+encodeURIComponent(called.consorcio_id))
      ]);
      if(current!==renderId || SB_SESSION?.user?.id!==user ||
         CC?._supaId!==called._supaId || !document.getElementById('dw-materiais-lista'))return;
      target.replaceChildren();
      if(!Array.isArray(items)||!Array.isArray(mats))throw new Error('Leitura negada pelo Supabase.');
      if(!items.length){
        addMessage(target,'Nenhum material consumido',null);
        return;
      }
      const names=new Map(mats.map(m=>[m.id,m.nome]));
      items.forEach(item=>{
        addMessage(target,names.get(item.material_id)||'Material',
          'Quantidade: '+dec(item.quantidade)+' · Valor: '+money(item.total)+
          ' · Registro vinculado ao estoque de origem');
      });
      addMessage(target,'Edição e estorno indisponíveis',
        'As alterações serão liberadas somente para a empresa de origem após homologação.');
    } catch(e) {
      if(current!==renderId)return;
      target.replaceChildren();
      addMessage(target,'Não foi possível carregar os consumos',
        e?.message||'Erro de conexão.');
    }
  };

  // Desativar todas as rotas legadas de edicao/estorno/confirmacao:
  // nunca permitir gravar pelas RPCs antigas ainda referenciadas no HTML.
  window.editarMaterialChamado=()=>message('Edição em homologação na V19. Nada foi alterado.');
  window.removerMaterialChamado=()=>message('Estorno em homologação na V19. Nada foi alterado.');
  window.confirmarMatChamado=()=>message('Consumo em homologação na V19. Nada foi alterado.');
  window.abrirModalMaterialChamado=()=>message('Utilize a consulta empresarial da etapa 570.');
})();
