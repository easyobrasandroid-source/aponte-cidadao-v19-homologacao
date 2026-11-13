/* APONTE CIDADAO V19 — ETAPA 583
 * Botoes DEFINITIVOS Editar quantidade e Estornar consumo.
 * Somente empresa dona do estoque original, sempre validado no backend.
 * Master e Gestor Consorcio: leitura. V18 intocada.
 */
(function () {
  'use strict';
  const uuid=x=>typeof x==='string' &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
  const twoDecimals=n=>Number.isFinite(n) && n>0 &&
    n<=9999999999 && Math.abs(Math.round(n*100)/100-n)<1e-9;
  const qty=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const money=n=>Number(n).toLocaleString('pt-BR',
    {style:'currency',currency:'BRL'});
  const editableStatuses=new Set([
    'Em programação','Em execução','Aguard. material','Aguardando material'
  ]);
  let requestCounter=0;
  let receipt=null;
  function el(tag,parent,text,style) {
    const e=document.createElement(tag);
    if(text!==undefined && text!==null)e.textContent=String(text);
    if(style)e.style.cssText=style;
    if(parent)parent.appendChild(e);
    return e;
  }
  function section(parent,title,body) {
    const card=el('section',parent,null,
      'padding:12px;border:1px solid #e2e8f0;border-radius:10px;' +
      'background:#fff;margin-bottom:10px;');
    el('strong',card,title,'font-size:13px;color:#0f172a;');
    if(body)el('p',card,body,'font-size:12px;color:#64748b;margin:6px 0 0;');
    return card;
  }
  function btn(parent,text,primary) {
    const b=el('button',parent,text,
      'border:1px solid '+(primary?'#0f766e':'#cbd5e1')+';' +
      'background:'+(primary?'#0f766e':'#fff')+';' +
      'color:'+(primary?'#fff':'#334155')+';' +
      'font-weight:600;font-size:12px;border-radius:7px;' +
      'padding:8px 11px;cursor:pointer;');
    b.type='button';
    return b;
  }
  function stillSame(seq,user,call) {
    return seq===requestCounter && SB_SESSION?.user?.id===user &&
      CC?._supaId===call &&
      !!document.getElementById('dw-materiais-lista');
  }
  window.renderMateriaisChamado=async function() {
    const target=document.getElementById('dw-materiais-lista');
    const chamado=CC;
    if(!target || !chamado)return;
    const seq=++requestCounter;
    const user=SB_SESSION?.user?.id;
    const callId=chamado._supaId;
    const consorcio=chamado.consorcio_id;
    const company=CU?.perfil==='empresa'?CU.empresa_id:null;
    const companyConsorcio=CU?.consorcio_id||null;
    const empresa=CU?.perfil==='empresa' && uuid(company) &&
      companyConsorcio===consorcio;
    target.replaceChildren();
    el('p',target,'Carregando materiais consumidos…',
      'font-size:12px;color:#64748b;');
    if(!uuid(callId)||!uuid(consorcio)||!user){
      target.replaceChildren();
      section(target,'Consulta indisponível','Identificação ou sessão inválida.');
      return;
    }
    try {
      const calls=[
        sbSelect('chamado_materiais',
          'select=id,chamado_id,material_id,quantidade,preco_unitario,total,estoque_id'+
          '&chamado_id=eq.'+encodeURIComponent(callId)),
        sbSelect('materiais',
          'select=id,nome&consorcio_id=eq.'+encodeURIComponent(consorcio)),
        sbSelect('chamados',
          'select=id,consorcio_id,empresa_id,status,protocolo'+
          '&id=eq.'+encodeURIComponent(callId)+'&limit=1')
      ];
      if(empresa){
        calls.push(sbFetch('rpc/v19_listar_estoques_por_empresa',
          'POST',{p_consorcio_id:consorcio}));
      }
      const [items,mats,called,stocks]=await Promise.all(calls);
      if(!stillSame(seq,user,callId))return;
      target.replaceChildren();
      if(!Array.isArray(items)||!Array.isArray(mats) ||
        !Array.isArray(called)||called.length!==1 ||
        called[0].id!==callId || called[0].consorcio_id!==consorcio) {
        throw new Error('Não foi possível validar os consumos e o chamado.');
      }
      if(empresa && !Array.isArray(stocks)){
        throw new Error('Não foi possível validar o estoque da empresa.');
      }
      // Qualquer linha inesperada no retorno da RPC invalida as acoes.
      const stocksValid=!empresa||stocks.every(s=>
        s?.empresa_id===company && s?.consorcio_id===consorcio &&
        s?.saldo_legado!==true);
      const stockMap=new Map(
        stocksValid&&empresa
          ? stocks.filter(s=>uuid(s.estoque_id)).map(s=>[s.estoque_id,s])
          : []
      );
      const names=new Map(mats.map(m=>[m.id,m.nome]));
      if(receipt?.call===callId && receipt?.user===user){
        section(target,receipt.title,receipt.details);
      } else receipt=null;
      if(!items.length){
        section(target,'Nenhum material consumido',
          'Os lançamentos deste chamado aparecerão aqui.');
        return;
      }
      if(empresa && !stocksValid){
        section(target,'Permissões não confirmadas',
          'A consulta de saldos retornou outra empresa. Edição e estorno estão indisponíveis.');
      }

      // Controle único para toda a aba: impede dois POSTs concorrentes.
      let sent=false;
      const controlButtons=[];
      function lockButtons(){
        controlButtons.forEach(b=>{b.disabled=true;b.style.opacity='0.55';});
      }
      function sameSession(){
        return stillSame(seq,user,callId) && CU?.perfil==='empresa' &&
          CU?.empresa_id===company && CU?.consorcio_id===consorcio;
      }
      function warnOnAmbiguous(card,error) {
        section(card,'Operação sem confirmação — NÃO REPETIR',
          (error?.message||'Falha desconhecida.')+
          ' Uma falha de rede pode acontecer depois da gravação.'+
          ' Atualize a página e confira o saldo e o chamado antes de tentar novamente.');
      }

      for(const item of items){
        const n=names.get(item.material_id)||'Material';
        const original=Number(item.quantidade);
        const stock=stockMap.get(item.estoque_id);
        const available=Number(stock?.quantidade_disponivel);
        const owner=empresa && stocksValid && uuid(item.id) &&
          uuid(item.estoque_id) && !!stock &&
          stock.empresa_id===company &&
          stock.material_id===item.material_id;
        const eligible=owner && editableStatuses.has(called[0].status) &&
          twoDecimals(original) && Number.isFinite(available) && available>=0;
        const card=section(target,n,
          'Quantidade: '+qty(item.quantidade)+
          ' · Valor: '+money(item.total)+
          ' · Registro vinculado ao estoque de origem');
        if(!eligible)continue;
        const row=el('div',card,null,
          'display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;');
        const edit=btn(row,'Editar quantidade',false);
        const remove=btn(row,'Estornar consumo',false);
        controlButtons.push(edit,remove);
        const panel=el('div',card,null,
          'margin-top:8px;font-size:12px;color:#334155;');
        const canAdd=called[0].empresa_id===company;
        edit.addEventListener('click',()=>{
          if(sent||!sameSession())return;
          panel.replaceChildren();
          const form=el('form',panel,null,
            'display:flex;align-items:end;gap:8px;flex-wrap:wrap;');
          const label=el('label',form,null,
            'display:flex;flex-direction:column;gap:4px;font-size:12px;');
          el('span',label,'Nova quantidade');
          const input=el('input',label,null,
            'border:1px solid #cbd5e1;border-radius:7px;' +
            'padding:8px;width:110px;box-sizing:border-box;');
          input.type='number';input.min='0.01';input.step='0.01';
          input.max=String(canAdd?Math.min(9999999999,original+available):original);
          input.value=String(original);input.required=true;
          const save=btn(form,'Salvar alteração',true);
          save.type='submit';
          controlButtons.push(save);
          const cancel=btn(form,'Cancelar',false);
          cancel.addEventListener('click',()=>panel.replaceChildren());
          controlButtons.push(cancel);
          const status=el('div',panel,null,'margin-top:8px;');
          form.addEventListener('submit',async event=>{
            event.preventDefault();
            if(sent||!sameSession())return;
            status.replaceChildren();
            const novo=Number(input.value);
            const delta=Math.round((novo-original)*100)/100;
            if(input.value===''||!twoDecimals(novo) ||
              delta===0 || (delta>0 && (!canAdd||delta>available))){
              section(status,'Quantidade inválida',
                'Informe um valor positivo, diferente do atual, com até duas casas decimais.'+
                ' Não é permitido consumir além do saldo da empresa.');
              return;
            }
            if(!window.confirm(
              'ALTERAR CONSUMO REAL NA V19?'+
              '\nMaterial: '+n+'\nEmpresa: '+String(stock.empresa_nome||'')+
              '\nQuantidade anterior: '+qty(original)+
              '\nNova quantidade: '+qty(novo)+
              '\nSaldo atual: '+qty(available)+
              '\nSaldo previsto: '+qty(Math.round((available-delta)*100)/100)+
              '\nHistórico e auditoria serão registrados.'
            ))return;
            if(sent||!sameSession())return;
            sent=true;lockButtons();input.disabled=true;
            section(status,'Gravando alteração','Aguardando confirmação do Supabase V19…');
            try {
              const result=await sbFetch(
                'rpc/v19_editar_material_chamado_empresa','POST',{
                  p_item_id:item.id,p_nova_qtd:novo
                });
              const saldo=Number(result?.novo_saldo);
              const total=Number(result?.novo_total);
              if(result?.ok!==true || result.item_id!==item.id ||
                result.estoque_id!==item.estoque_id ||
                result.empresa_id!==company ||
                Number(result.quantidade_anterior)!==original ||
                Number(result.quantidade_nova)!==novo ||
                !Number.isFinite(saldo)||saldo<0||
                !Number.isFinite(total)||total<0){
                throw new Error('Resposta inconsistente. Confira o banco antes de repetir.');
              }
              if(!sameSession())return;
              receipt={call:callId,user,title:'Consumo atualizado com sucesso',
                details:n+' · Quantidade '+qty(original)+' → '+qty(novo)+
                  ' · Saldo confirmado: '+qty(saldo)+
                  ' · Valor atualizado: '+money(total)};
              await window.renderMateriaisChamado();
            }catch(e){
              if(!sameSession())return;
              status.replaceChildren();
              warnOnAmbiguous(status,e);
            }
          });
          input.focus();
        });
        remove.addEventListener('click',async()=>{
          if(sent||!sameSession())return;
          panel.replaceChildren();
          if(!window.confirm(
            'ESTORNAR CONSUMO REAL NA V19?'+
            '\nMaterial: '+n+
            '\nQuantidade a devolver: '+qty(original)+
            '\nEmpresa de origem: '+String(stock.empresa_nome||'')+
            '\nSaldo atual: '+qty(available)+
            '\nSaldo previsto: '+qty(Math.round((available+original)*100)/100)+
            '\nO item será removido do chamado, com histórico e auditoria.'
          ))return;
          if(sent||!sameSession())return;
          sent=true;lockButtons();
          section(panel,'Estornando consumo','Aguardando confirmação do Supabase V19…');
          try {
            const result=await sbFetch(
              'rpc/v19_remover_material_chamado_empresa','POST',{
                p_item_id:item.id
              });
            const saldo=Number(result?.novo_saldo);
            if(result?.ok!==true || result.item_id!==item.id ||
              result.estoque_id!==item.estoque_id ||
              result.empresa_id!==company ||
              Number(result.quantidade_estornada)!==original ||
              !Number.isFinite(saldo)||saldo<original){
              throw new Error('Resposta inconsistente. Confira o banco antes de repetir.');
            }
            if(!sameSession())return;
            receipt={call:callId,user,title:'Consumo estornado com sucesso',
              details:n+' · Devolvido: '+qty(original)+
                ' · Novo saldo confirmado: '+qty(saldo)};
            await window.renderMateriaisChamado();
          }catch(e){
            if(!sameSession())return;
            panel.replaceChildren();
            warnOnAmbiguous(panel,e);
          }
        });
      }
      if(!empresa){
        section(target,'Somente consulta',
          'A edição e o estorno são exclusivos da empresa proprietária do estoque.');
      } else if(!editableStatuses.has(called[0].status)){
        section(target,'Chamado fora do status de ajuste',
          'Não é possível alterar materiais neste status.');
      }
    }catch(e){
      if(!stillSame(seq,user,callId))return;
      target.replaceChildren();
      section(target,'Falha ao consultar materiais',
        e?.message||'Erro de comunicação. Tente novamente.');
    }
  };
})();
