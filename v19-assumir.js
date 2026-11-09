/* Aponte Cidadão V19 — chamados disponíveis sem dados pessoais */
(function(){
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
const valid=x=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(x||''));
let busy=false;
const parent=()=>document.getElementById('v19-disponiveis-overlay');
function fechar(){
  parent()?.remove();
  document.body.style.overflow='';
}
window.v19FecharDisponiveis=fechar;
window.v19MostrarDisponiveis=async function(){
  if(CU?.perfil!=='empresa'||!CU?.empresa_id){showToast('Disponível apenas a empresas executoras.','erro');return;}
  if(busy)return;
  busy=true;
  let modal=parent();
  if(!modal){
    modal=document.createElement('div');modal.id='v19-disponiveis-overlay';
    modal.style.cssText='position:fixed;inset:0;background:#111827aa;z-index:20000;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(modal);
  }
  document.body.style.overflow='hidden';
  modal.innerHTML='<section style="background:#fff;border-radius:12px;padding:20px;max-height:88vh;overflow:auto;width:min(860px,95vw)">'+
    '<h3 style="margin:0">Chamados disponíveis para assumir</h3><p>Consultando o Supabase…</p>'+
    '<button class="btn btn-ghost" onclick="v19FecharDisponiveis()">Fechar</button></section>';
  try{
    const rows=await sbFetch('rpc/v19_listar_disponiveis','POST',{p_limite:100});
    if(!Array.isArray(rows))throw new Error('Lista inválida retornada pelo banco.');
    const table=rows.map(c=>'<tr><td>'+esc(c.protocolo)+'</td>'+
      '<td>'+esc(c.cidade)+'</td><td>'+esc(c.bairro||'—')+'</td><td>'+esc(c.tipo)+'</td>'+
      '<td>'+esc(c.qtd)+'</td><td>'+esc(c.status)+'</td>'+
      '<td><button class="btn btn-save" onclick="v19AssumirChamado(\''+esc(c.id)+'\')">Assumir</button></td></tr>').join('');
    if(!parent())return;
    modal.innerHTML='<section style="background:#fff;border-radius:12px;padding:20px;max-height:88vh;overflow:auto;width:min(860px,95vw)">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><h3 style="margin:0">Chamados disponíveis</h3>'+
      '<button class="btn btn-ghost" onclick="v19FecharDisponiveis()">✕ Fechar</button></div>'+
      '<p style="font-size:12px;color:#64748b">Somente chamados sem empresa atribuída nas cidades autorizadas. '+
      'Dados de solicitantes, telefones e outras empresas não são exibidos.</p>'+
      '<div style="overflow:auto"><table style="width:100%"><thead><tr><th>Protocolo</th><th>Cidade</th>'+
      '<th>Bairro</th><th>Problema</th><th>Qtd.</th><th>Status</th><th>Ação</th></tr></thead>'+
      '<tbody>'+(table||'<tr><td colspan="7">Nenhum chamado disponível.</td></tr>')+'</tbody></table></div>'+
      '<p style="font-size:11px;color:#64748b">Listagem limitada a 100 chamados. '+
      'A atribuição é revalidada no servidor no momento do clique.</p></section>';
  }catch(e){
    if(parent())modal.innerHTML='<section style="background:#fff;border-radius:12px;padding:20px;width:min(620px,94vw)">'+
      '<h3>Não foi possível consultar os chamados disponíveis</h3>'+
      '<p style="color:#b91c1c">'+esc(e.message)+'</p>'+
      '<button class="btn btn-ghost" onclick="v19FecharDisponiveis()">Fechar</button></section>';
  }finally{busy=false;}
};
window.v19AssumirChamado=async function(id){
  if(CU?.perfil!=='empresa'||!valid(id)||busy)return;
  if(!confirm('Assumir este chamado para sua empresa?'))return;
  busy=true;
  try{
    const resp=await sbFetch('rpc/v19_assumir_chamado','POST',{p_chamado_id:id});
    const item=Array.isArray(resp)?resp[0]:resp;
    if(item?.ok!==true)throw new Error(item?.erro||'A atribuição não foi confirmada.');
    showToast('✅ Chamado '+esc(item.protocolo)+' atribuído à sua empresa.','ok');
    fechar();
    const ok=await carregarChamadosDoBanco();
    if(!ok)throw new Error('Chamado atribuído. Atualize a página para recarregar a listagem.');
    showView('chamados');
  }catch(e){showToast(esc(e.message),'erro');}
  finally{busy=false;}
};
const originalChamados=window.vChamados;
window.vChamados=function(b,t,a){
  originalChamados(b,t,a);
  if(CU?.perfil==='empresa'){
    const btn=document.createElement('button');
    btn.className='btn btn-save';
    btn.textContent='📥 Disponíveis para assumir';
    btn.addEventListener('click',()=>window.v19MostrarDisponiveis());
    a.appendChild(btn);
  }
};
console.info('[Aponte V19] atribuição atômica de chamados disponível para empresas.');
})();