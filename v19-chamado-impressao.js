/* V19 ETAPA 647 — impressão A4 de um chamado. Apenas leitura. */
(function () {
'use strict';
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val = v => v == null || String(v).trim()==='' ? 'Não informado' : String(v).trim();
const dataBR = v => {if(!v)return '—'; const d=new Date(v); return Number.isFinite(d.getTime())?d.toLocaleString('pt-BR'):'Data não informada';};
const campo = (nome,valor) => '<div class="campo"><div class="rotulo">'+esc(nome)+'</div><div class="valor">'+esc(val(valor))+'</div></div>';
const css = [
'@page{size:A4 portrait;margin:14mm}',
'*{box-sizing:border-box}html{background:#eef2f6}body{margin:0;font:11px/1.5 Arial,Helvetica,sans-serif;color:#203247}',
'.pagina{width:210mm;min-height:297mm;padding:17mm;background:#fff;margin:15px auto;box-shadow:0 3px 24px #20324730}',
'.topo{display:flex;justify-content:space-between;align-items:start;border-bottom:3px solid #1251a3;padding-bottom:12px;margin-bottom:15px}',
'.marca{font-size:21px;font-weight:800;letter-spacing:-.4px;color:#1251a3}.secundario{font-size:10px;color:#72849a}',
'.direita{text-align:right}.cabecalho{padding:14px;border:1px solid #bed1ea;background:#f0f6ff;border-radius:7px}',
'.protocolo{font:bold 13px/1.5 Consolas,monospace;color:#1251a3;overflow-wrap:anywhere}',
'h1{font-size:19px;margin:9px 0;color:#1a2d47}h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#1251a3;border-bottom:1px solid #ccd8e5;padding-bottom:5px;margin:0 0 9px}',
'.tags{margin-top:7px}.tag{display:inline-block;background:#e7edf5;border:1px solid #d0dce8;border-radius:4px;padding:3px 8px;font-weight:700;margin-right:6px}',
'section{margin:17px 0;break-inside:avoid-page}.grade{display:grid;grid-template-columns:1fr 1fr;gap:11px 16px}.tripla{grid-template-columns:repeat(3,1fr)}',
'.campo{min-width:0;overflow-wrap:anywhere}.rotulo{font-size:9px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#718197;margin-bottom:2px}.valor{font-size:11px;font-weight:600;white-space:pre-wrap}',
'.observacao{background:#f5f7fa;border-radius:5px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}',
'.evento{border-left:3px solid #1251a3;padding:2px 0 9px 10px;margin:0 0 9px 2px;break-inside:avoid}.eventoTitulo{font-weight:700}.eventoMeta{color:#728197;font-size:9px}.eventoNota{white-space:pre-wrap;overflow-wrap:anywhere}',
'.assinar{display:flex;gap:18px;margin:38px 0 18px}.linha{flex:1;text-align:center;border-top:1px solid #9dabbd;padding-top:8px;font-size:10px;color:#718197}',
'.rodape{border-top:1px solid #d3dde8;margin-top:17px;padding-top:9px;font-size:9px;color:#72849a}',
'.ferramentas{display:flex;justify-content:center;gap:12px;margin:16px}.ferramentas button{background:#1251a3;border:0;border-radius:5px;color:#fff;padding:11px 20px;font-weight:700;cursor:pointer}.ferramentas .fechar{background:#e9eef4;color:#203247}',
'@media print{html{background:#fff}.pagina{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.ferramentas{display:none!important}.cabecalho,.tag{print-color-adjust:exact;-webkit-print-color-adjust:exact}}',
'@media(max-width:700px){.pagina{width:auto;min-height:0;margin:0;padding:18px}.tripla{grid-template-columns:1fr 1fr}}'
].join('');
function historicoHTML(rows,fail){
 if(fail)return '<p class="secundario">O histórico não pôde ser consultado para esta impressão. Veja os registros no sistema.</p>';
 if(!rows.length)return '<p class="secundario">Nenhum registro encontrado.</p>';
 return rows.map(e=>'<div class="evento"><div class="eventoTitulo">'+esc(val(e.mensagem||e.status||'Evento'))+'</div><div class="eventoMeta">'+esc(dataBR(e.created_at))+' — '+esc(val(e.usuario_nome||'Sistema'))+'</div>'+(e.observacao?'<div class="eventoNota">'+esc(e.observacao)+'</div>':'')+'</div>').join('');
}
function construir(c,rows,fail){
 let slaEstado='Não apurável';try{slaEstado=window.v19StatusSLA?.(c)?.estado||slaEstado}catch(_){ }
 const horas=c._slaHoras??c.sla_horas??c.sla;
 const prazo=horas!=null&&Number.isFinite(Number(horas))?Number(horas).toLocaleString('pt-BR')+' horas':'Não apurável';
 const validCoord=c.lat!=null&&c.lng!=null&&Number.isFinite(Number(c.lat))&&Number.isFinite(Number(c.lng))&&Math.abs(Number(c.lat))<=90&&Math.abs(Number(c.lng))<=180;
 const coord=validCoord?Number(c.lat).toFixed(6)+', '+Number(c.lng).toFixed(6):'Não informadas';
 const p=val(c.protocolo);
 return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chamado '+esc(p)+' — Aponte Iluminação</title><style>'+css+'</style></head><body>'+
 '<main class="pagina"><header class="topo"><div><div class="marca">Aponte Iluminação</div><div class="secundario">Gestão de iluminação pública</div></div><div class="direita"><b>FICHA DE ATENDIMENTO</b><div class="secundario">Emitida em '+esc(dataBR(new Date().toISOString()))+'</div></div></header>'+
 '<div class="cabecalho"><div class="rotulo">Protocolo</div><div class="protocolo">'+esc(p)+'</div><h1>'+esc(val(c.tipo))+'</h1><div class="tags"><span class="tag">Status: '+esc(val(c.status))+'</span><span class="tag">Área: '+esc(val(c.area))+'</span><span class="tag">Origem: '+esc(val(c.origem))+'</span></div></div>'+
 '<section><h2>Dados da ocorrência</h2><div class="grade tripla">'+campo('Tipo',c.tipo)+campo('Quantidade de lâmpadas',c.qtd)+campo('Prioridade',c.prioridade)+'</div></section>'+
 '<section><h2>Localização</h2><div class="grade">'+campo('Município',c.cidade)+campo('Bairro',c.bairro)+campo('Endereço',c.endereco)+campo('Referência',c.referencia)+campo('Coordenadas',coord)+campo('Fonte da localização',c.loc_src)+'</div></section>'+
 '<section><h2>Atendimento e prazos</h2><div class="grade">'+campo('Empresa executora',c.empresa)+campo('Situação do SLA',slaEstado)+campo('Prazo registrado',prazo)+campo('Abertura',dataBR(c.created_at))+campo('Conclusão',c.completed_at?dataBR(c.completed_at):'Pendente')+campo('Última atualização',dataBR(c.updated_at))+'</div></section>'+
 '<section><h2>Solicitante</h2><div class="grade">'+campo('Nome',c.solicitante)+campo('Telefone',c.tel)+'</div></section>'+
 '<section><h2>Observações</h2><div class="observacao">'+esc(val(c.obs))+'</div></section>'+
 ((c.garantia_tipo||c.garantia_obs)?'<section><h2>Garantia</h2><div class="grade">'+campo('Tipo',c.garantia_tipo)+campo('Observação',c.garantia_obs)+campo('Data',dataBR(c.garantia_dt))+'</div></section>':'')+
 '<section><h2>Histórico do chamado</h2>'+historicoHTML(rows,fail)+'</section>'+
 '<div class="assinar"><div class="linha">Responsável pelo atendimento</div><div class="linha">Data / conferência</div></div>'+
 '<footer class="rodape">Gerado pelo Aponte Iluminação V19. Fotos e materiais devem ser consultados no cadastro do chamado. Os dados pessoais destinam-se ao atendimento da solicitação.</footer></main>'+
 '<div class="ferramentas"><button type="button" onclick="window.print()">Imprimir / Salvar como PDF</button><button type="button" class="fechar" onclick="window.close()">Fechar prévia</button></div></body></html>';
}
function escrever(janela,conteudo){if(janela.closed)return;janela.document.open();janela.document.write(conteudo);janela.document.close();janela.focus();}
window.v19ImprimirChamado=async function(){
 const c=CC;
 if(!c||!c._supaId){showToast('Selecione um chamado para imprimir.','erro');return;}
 const janela=window.open('','_blank','width=980,height=800');
 if(!janela){showToast('Permita pop-ups deste site para imprimir.','erro');return;}
 escrever(janela,'<!doctype html><html lang="pt-BR"><meta charset="UTF-8"><title>Preparando impressão</title><body style="font:15px Arial;padding:35px;color:#1251a3">Preparando ficha do chamado e histórico...</body></html>');
 let eventos=[],erroHistorico=false;
 try{
   const consulta='select=status,mensagem,observacao,usuario_nome,created_at&chamado_id=eq.'+encodeURIComponent(c._supaId)+'&order=created_at.asc&limit=150';
   const resultado=await Promise.race([sbSelect('chamado_historico',consulta),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tempo de consulta excedido')),7000))]);
   if(!Array.isArray(resultado))throw new Error('Consulta inválida');
   eventos=resultado;
 }catch(e){erroHistorico=true;console.warn('[V19] Histórico na impressão indisponível:',e.message);}
 escrever(janela,construir(c,eventos,erroHistorico));
};
})();