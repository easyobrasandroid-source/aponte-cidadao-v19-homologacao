/* Aponte Cidadão V19 — Etapa 641: edição real de dados operacionais por RPC.
   Nenhuma escrita direta em chamados; o banco verifica perfil, escopo, versão,
   recálculo de SLA e histórico. Fluxos de status e garantia não são alterados. */
(function(){
'use strict';
const ESC=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const PAPEIS=['master','consorcio','prefeitura','empresa'];
const CAMPOS={
  bairro:{label:'Bairro',max:150},
  endereco:{label:'Rua / endereço',max:300},
  referencia:{label:'Ponto de referência',max:300},
  area:{label:'Área',tipo:'select',opcoes:['Urbana','Rural']},
  tipo:{label:'Tipo de ocorrência',max:120},
  qtd:{label:'Quantidade de lâmpadas',tipo:'integer',min:1,max:999},
  observacoes:{label:'Observações',tipo:'textarea',max:2500},
  solicitante_nome:{label:'Nome do solicitante',max:200},
  solicitante_tel:{label:'Telefone do solicitante',max:40},
  prioridade:{label:'Prioridade',max:60},
  latitude:{label:'Latitude',tipo:'coord',min:-90,max:90},
  longitude:{label:'Longitude',tipo:'coord',min:-180,max:180}
};
const CAMPOS_POR_PERFIL={
  master:['bairro','endereco','referencia','area','tipo','qtd','observacoes',
    'solicitante_nome','solicitante_tel','prioridade','latitude','longitude'],
  consorcio:['bairro','endereco','referencia','area','tipo','qtd','observacoes',
    'solicitante_nome','solicitante_tel','prioridade','latitude','longitude'],
  prefeitura:['bairro','endereco','referencia','area','tipo','qtd','observacoes',
    'solicitante_nome','solicitante_tel','latitude','longitude'],
  empresa:['observacoes','latitude','longitude']
};
const MODEL={
  bairro:'bairro',endereco:'endereco',referencia:'referencia',area:'area',
  tipo:'tipo',qtd:'qtd',observacoes:'obs',solicitante_nome:'solicitante',
  solicitante_tel:'tel',prioridade:'prioridade',latitude:'lat',longitude:'lng'
};
let busy=false,editandoId=null;

function autorizado(c){
  if(!c||!c._supaId||!CU||!SB_SESSION?.access_token||
     !PAPEIS.includes(CU.perfil))return false;
  if(CU.perfil==='master')return true;
  if(!CU.consorcio_id||CU.consorcio_id!==c.consorcio_id)return false;
  if(CU.perfil==='consorcio')return true;
  if(CU.perfil==='prefeitura')return !!CU.cidade_id&&CU.cidade_id===c.cidade_id;
  if(CU.perfil==='empresa')return !!CU.empresa_id&&CU.empresa_id===c.empresa_id;
  return false;
}
window.v19PodeEditarDados=autorizado;

function domValue(key,value){
  const config=CAMPOS[key],id='dw-e-'+key;
  const val=value==null?'':String(value);
  let input='';
  if(config.tipo==='textarea'){
    input='<textarea id="'+id+'" rows="3" maxlength="'+config.max+'" '+
      'style="width:100%;padding:8px 10px;resize:vertical">'+ESC(val)+'</textarea>';
  }else if(config.tipo==='select'){
    input='<select id="'+id+'" style="width:100%;padding:8px 10px">'+
      config.opcoes.map(opt=>'<option value="'+ESC(opt)+'"'+
        (opt===val?' selected':'')+'>'+ESC(opt)+'</option>').join('')+'</select>';
  }else{
    const isNumber=['integer','coord'].includes(config.tipo);
    input='<input id="'+id+'" style="width:100%;padding:8px 10px"'+
      ' type="'+(isNumber?'number':'text')+'"'+
      (isNumber?' step="'+(config.tipo==='integer'?'1':'any')+
        '" min="'+config.min+'" max="'+config.max+'"':
        ' maxlength="'+config.max+'"')+' value="'+ESC(val)+'">';
  }
  return '<label style="display:block;font-size:12px;font-weight:600;min-width:0">'+
    ESC(config.label)+input+'</label>';
}

window.v19PrepararEdicaoChamado=function(c){
  const box=document.getElementById('dw-edicao-v19');
  const bot=document.getElementById('dw-btn-salvar');
  if(bot){bot.style.display='none';bot.disabled=true;bot.textContent='💾 Salvar';}
  editandoId=null;
  if(!box)return;
  box.replaceChildren();
  if(!autorizado(c))return;
  const btn=document.createElement('button');
  btn.type='button';btn.className='btn btn-ghost';
  btn.textContent='✏️ Editar dados do chamado';
  btn.style.marginTop='12px';
  btn.onclick=window.v19AbrirEdicaoChamado;
  box.appendChild(btn);
};

window.v19AbrirEdicaoChamado=function(){
  const c=CC;
  if(busy||!autorizado(c))return;
  const box=document.getElementById('dw-edicao-v19');
  if(!box)return;
  const fields=CAMPOS_POR_PERFIL[CU.perfil]||[];
  const html=fields.map(key=>domValue(key,c[MODEL[key]])).join('');
  box.innerHTML='<div style="margin-top:12px;border-top:1px solid var(--gray-200);padding-top:12px">'+
    '<div class="card-title">✏️ Corrigir dados do chamado</div>'+
    '<div style="color:var(--gray-500);font-size:11px;margin:8px 0 12px">'+
    'As alterações serão gravadas no banco e registradas no histórico. '+
    'Se bairro ou endereço mudar, a coordenada anterior será removida a menos que você confirme novas coordenadas. '+
    'Mudanças de área ou tipo recalculam o SLA pela regra vigente do consórcio. '+
    'Status, conclusão e garantia usam ações próprias.</div>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">'+
    html+'</div>'+
    '<button type="button" class="btn btn-ghost" onclick="v19CancelarEdicaoChamado()" '+
    'style="margin-top:12px">Cancelar edição</button></div>';
  const bot=document.getElementById('dw-btn-salvar');
  if(bot){bot.style.display='';bot.disabled=false;bot.title='Salvar alterações no Supabase';}
  editandoId=c._supaId;
};
window.v19CancelarEdicaoChamado=function(){
  if(busy)return;
  if(CC)window.v19PrepararEdicaoChamado(CC);
};

function fieldValue(key){
  const el=document.getElementById('dw-e-'+key);
  if(!el)return undefined;
  const cfg=CAMPOS[key];
  if(cfg.tipo==='integer'){
    if(el.value==='')throw new Error('Informe a quantidade de lâmpadas.');
    const n=Number(el.value);
    if(!Number.isInteger(n)||n<cfg.min||n>cfg.max)
      throw new Error('Quantidade deve ser um inteiro de 1 a 999.');
    return n;
  }
  if(cfg.tipo==='coord'){
    if(el.value.trim()==='')return null;
    const n=Number(el.value);
    if(!Number.isFinite(n)||n<cfg.min||n>cfg.max)
      throw new Error('Latitude/longitude fora dos limites válidos.');
    return n;
  }
  const val=el.value.trim();
  if(cfg.max&&val.length>cfg.max)
    throw new Error('Campo '+cfg.label+' ultrapassa o tamanho máximo.');
  if(key==='tipo'&&!val)throw new Error('Tipo de ocorrência é obrigatório.');
  return val||null;
}

// Sempre carregar o histórico real ao abrir a aba, inclusive após alterações.
// Sem fallback para DB.historico local e sem inserir HTML recebido do servidor.
let historicoSeq=0;
window.v19CarregarHistoricoChamado=async function(){
  const c=CC,alvo=document.getElementById('dw-tc-historico');
  if(!alvo||!c?._supaId)return;
  const seq=++historicoSeq;
  alvo.replaceChildren();
  const heading=document.createElement('div');
  heading.className='card-title';heading.textContent='Histórico real do chamado';
  const status=document.createElement('p');
  status.textContent='Consultando registros no Supabase…';
  status.style.cssText='font-size:12px;color:var(--gray-500)';
  alvo.append(heading,status);
  try{
    const rows=await sbSelect('chamado_historico',
      'select=status,mensagem,observacao,usuario_nome,created_at'+
      '&chamado_id=eq.'+encodeURIComponent(c._supaId)+
      '&order=created_at.asc&limit=300');
    if(!Array.isArray(rows))throw new Error('Consulta do histórico indisponível.');
    if(seq!==historicoSeq||CC?._supaId!==c._supaId)return;
    status.remove();
    if(!rows.length){
      const empty=document.createElement('p');
      empty.textContent='Nenhum evento registrado.';
      alvo.appendChild(empty);
      return;
    }
    for(const event of rows){
      const item=document.createElement('div');
      item.style.cssText='border-left:3px solid #1251A3;padding:6px 10px;margin:10px 0;font-size:12px';
      const title=document.createElement('div');
      title.style.fontWeight='700';
      title.textContent=event.mensagem||event.status||'Evento';
      const meta=document.createElement('div');
      meta.style.cssText='font-size:11px;color:var(--gray-500);margin-top:3px';
      const dt=event.created_at?new Date(event.created_at):null;
      meta.textContent=(dt&&!isNaN(dt)?dt.toLocaleString('pt-BR'):'')+
        (event.usuario_nome?' — '+event.usuario_nome:'');
      item.append(title,meta);
      if(event.observacao){
        const note=document.createElement('div');
        note.style.marginTop='4px';note.textContent=event.observacao;
        item.appendChild(note);
      }
      alvo.appendChild(item);
    }
  }catch(e){
    if(seq!==historicoSeq||CC?._supaId!==c._supaId)return;
    status.textContent='Não foi possível consultar o histórico: '+e.message;
    status.style.color='var(--red)';
  }
};

window.v19SalvarEdicaoChamado=async function(){
  const c=CC;
  if(busy||!autorizado(c)||editandoId!==c._supaId)return false;
  const keys=CAMPOS_POR_PERFIL[CU.perfil]||[];
  let changes={};
  try{
    for(const key of keys){
      const valor=fieldValue(key);
      const original=c[MODEL[key]]==null?'':c[MODEL[key]];
      const normalize=x=>x==null?'':String(x).trim();
      if(normalize(valor)!==normalize(original))changes[key]=valor;
    }
    if(('latitude' in changes)||('longitude' in changes)){
      // As coordenadas sempre formam um par consistente.
      const lat=fieldValue('latitude'),lng=fieldValue('longitude');
      if((lat==null)!==(lng==null))
        throw new Error('Informe latitude e longitude juntas, ou deixe ambas vazias.');
      changes.latitude=lat;changes.longitude=lng;
    }
    if(!Object.keys(changes).length){
      showToast('Nenhuma alteração encontrada.','aviso');return true;
    }
    if(!c.updated_at||!c.status)
      throw new Error('Versão original não encontrada. Atualize os chamados.');
  }catch(e){showToast('❌ '+e.message,'erro');return false;}

  const bot=document.getElementById('dw-btn-salvar');
  busy=true;
  if(bot){bot.disabled=true;bot.textContent='Salvando…';}
  try{
    const result=await sbFetch('rpc/v19_editar_dados_chamado','POST',{
      p_chamado_id:c._supaId,p_alteracoes:changes,
      p_atualizado_em:c.updated_at,p_status_esperado:c.status
    });
    if(result?.ok!==true||result.id!==c._supaId||result.protocolo!==c.protocolo||
       !result.updated_at)
      throw new Error('O servidor não confirmou o registro. Verifique antes de reenviar.');
    const carregou=await carregarChamadosDoBanco();
    if(!carregou){
      closeDrawer();showToast('Alteração confirmada pelo servidor; atualize a página para reler os dados.','aviso');
      return true;
    }
    refreshChamadosView();
    const row=DB.chamados.find(item=>item._supaId===c._supaId);
    if(row)abrirDrawer(row.id);else closeDrawer();
    showToast('✅ Dados atualizados no Supabase e registrados no histórico.','ok');
    return true;
  }catch(e){
    console.error('[V19] Edição RPC do chamado:',e);
    const raw=String(e.corpo||'');
    const detail=/VERSAO_DESATUALIZADA_RECARREGUE/.test(raw)?'Outro usuário atualizou o chamado. Recarregue a página antes de tentar novamente.':
      /REGRA_SLA_NAO_ENCONTRADA/.test(raw)?'Regra de SLA não cadastrada para o novo tipo/área. Configure-a primeiro.':
      /CHAMADO_FORA_DO_ESCOPO|CAMPO_NAO_AUTORIZADO/.test(raw)?'Seu perfil não permite esta alteração.':
      e.message;
    showToast('❌ Salvamento não confirmado: '+detail,'erro');
    return false;
  }finally{
    busy=false;
    if(bot){bot.disabled=false;bot.textContent='💾 Salvar';}
  }
};
})();