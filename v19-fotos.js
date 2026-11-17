/* Aponte Cidadão V19 — fotografias persistentes no Supabase.
   O histórico é renderizado exclusivamente por v19-chamado-edicao.js. */
(function () {
  'use strict';
  const html = value => String(value == null ? '' : value).replace(/[&<>"']/g, x =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const validUUID = value => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(value || ''));
  const pathUrl = p => String(p || '').split('/').map(encodeURIComponent).join('/');
  const noticeError = e => showToast(html(e?.message || String(e)), 'erro');
  let lastPhotoQuery=0;

  // Somente identificadores de envio, sem foto/token/dados pessoais.
  // Pendencias sobrevivem ao F5 apenas nesta aba e para a mesma conta Auth.
  const PHOTO_PENDING_PREFIX='v19-foto-registro-pendente:';
  const tiposFoto=['antes','durante','depois','ocorrencia'];
  const recoveries=new Set();
  const usuarioAtual=()=>String(SB_SESSION?.user?.id||'');
  const chavePendentes=()=>PHOTO_PENDING_PREFIX+usuarioAtual();
  const pathFotoValido=path=>/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(String(path||''));

  function lerPendentesFoto(){
    if(!validUUID(usuarioAtual()))return [];
    try {
      const values=JSON.parse(sessionStorage.getItem(chavePendentes())||'[]');
      return (Array.isArray(values)?values:[]).filter(p=>
        p && validUUID(p.chamadoId) && validUUID(p.consorcioId) &&
        pathFotoValido(p.storagePath) && tiposFoto.includes(p.tipo) &&
        p.storagePath.startsWith(p.consorcioId+'/'+p.chamadoId+'/')
      ).slice(-30);
    }catch(_){return [];}
  }
  function salvarPendentesFoto(values){
    if(!validUUID(usuarioAtual()))return;
    try {
      const data=values.slice(-30);
      if(data.length)sessionStorage.setItem(chavePendentes(),JSON.stringify(data));
      else sessionStorage.removeItem(chavePendentes());
    }catch(_){
      // Falha de armazenamento nunca deve justificar novo upload automático.
    }
  }
  function adicionarPendenteFoto(item){
    salvarPendentesFoto(lerPendentesFoto().filter(p=>p.storagePath!==item.storagePath).concat(item));
  }
  function confirmarPendenteFoto(path){
    salvarPendentesFoto(lerPendentesFoto().filter(p=>p.storagePath!==path));
  }
  function pendentesDoChamado(chamadoId){
    return lerPendentesFoto().filter(p=>p.chamadoId===chamadoId);
  }
  async function registroExisteFoto(chamadoId,storagePath){
    const rows=await sbSelect('chamado_fotos',
      'select=id,storage_path&chamado_id=eq.'+encodeURIComponent(chamadoId)+
      '&storage_path=eq.'+encodeURIComponent(storagePath)+'&limit=1');
    if(!Array.isArray(rows))throw new Error('Não foi possível confirmar os metadados da fotografia.');
    return rows.some(row=>validUUID(row.id)&&row.storage_path===storagePath);
  }
  async function registrarMetadadosFoto(item){
    // Sempre checar primeiro: timeout anterior pode ter gravado os metadados.
    if(await registroExisteFoto(item.chamadoId,item.storagePath))return true;
    try {
      const resultado=await sbFetch('rpc/v19_registrar_foto','POST',{
        p_chamado_id:item.chamadoId,
        p_storage_path:item.storagePath,
        p_tipo:item.tipo
      });
      if(validUUID(resultado))return true;
    }catch(e){
      // Erro de rede/resposta ambígua: checar novamente, nunca duplicar o upload.
      try { if(await registroExisteFoto(item.chamadoId,item.storagePath))return true; }
      catch(_){/* Manter pendência e aviso ao operador. */}
      throw e;
    }
    return await registroExisteFoto(item.chamadoId,item.storagePath);
  }
  window.v19RecuperarRegistroFoto=async function(storagePath){
    const chamado=CC?._supaId,consorcio=CC?.consorcio_id;
    if(!validUUID(usuarioAtual())||!validUUID(chamado)||!validUUID(consorcio))return;
    const item=pendentesDoChamado(chamado).find(p=>
      p.storagePath===storagePath&&p.consorcioId===consorcio);
    if(!item||recoveries.has(storagePath))return;
    recoveries.add(storagePath);
    showToast('Verificando o registro da foto já enviada (sem novo upload)…','aviso');
    try {
      if(!await registrarMetadadosFoto(item)){
        throw new Error('O registro ainda não foi confirmado.');
      }
      confirmarPendenteFoto(item.storagePath);
      showToast('✅ Foto recuperada e registrada sem novo envio.','ok');
      if(CC?._supaId===chamado)await renderFotosChamado();
    }catch(e){
      console.error('[V19] recuperação de registro fotográfico:',e);
      noticeError(new Error('Registro ainda pendente. O arquivo não será reenviado. Verifique o Storage/RPC antes de repetir. '+(e?.message||'')));
    }finally {recoveries.delete(storagePath);}
  };


  async function obterUrlAssinada(path) {
    const resposta=await fetch(SUPA_URL+'/storage/v1/object/sign/chamado-fotos/'+pathUrl(path),{
      method:'POST',headers:sbHeaders(),body:JSON.stringify({expiresIn:1800})
    });
    const body=await resposta.json().catch(()=>({}));
    if(!resposta.ok || !body.signedURL)throw new Error('Não foi possível abrir a foto privada (HTTP '+resposta.status+').');
    // O Supabase Storage devolve /object/sign/...; a URL pública exige /storage/v1.
    // Aceita também o formato completo já normalizado, sem duplicar o prefixo.
    const signedUrl = new URL(body.signedURL, SUPA_URL);
    if (signedUrl.origin !== new URL(SUPA_URL).origin) {
      throw new Error('Origem da URL assinada não corresponde ao Supabase configurado.');
    }
    if (signedUrl.pathname.startsWith('/object/sign/')) {
      signedUrl.pathname = '/storage/v1' + signedUrl.pathname;
    }
    if (!signedUrl.pathname.startsWith('/storage/v1/object/sign/chamado-fotos/')) {
      throw new Error('Caminho assinado de fotografia inválido.');
    }
    return signedUrl.href;
  }

  async function renderFotosChamado() {
    const box=document.getElementById('dw-tc-fotos');
    if(!box || !CC)return;
    const chamada=CC,seq=++lastPhotoQuery;
    box.innerHTML='<div class="card-title">Registro fotográfico</div>'+
      '<p style="font-size:12px;color:var(--gray-500)">Carregando fotos do Supabase…</p>';
    if(!validUUID(chamada._supaId)||!validUUID(chamada.consorcio_id)) {
      box.innerHTML='<p style="color:var(--red)">Chamado não identificado no banco. Reabra o chamado.</p>';return;
    }
    try {
      const rows=await sbSelect('chamado_fotos',
        'select=*&chamado_id=eq.'+encodeURIComponent(chamada._supaId)+'&order=created_at.desc');
      if(!Array.isArray(rows)) throw new Error('Falha ao consultar os registros das fotografias.');
      const signed=await Promise.all(rows.map(async r=>{
        try {return {...r, url:await obterUrlAssinada(r.storage_path)};}
        catch(e) {return {...r,url:null,erro:e.message};}
      }));
      if(seq!==lastPhotoQuery || CC?._supaId!==chamada._supaId)return;
      const types=['antes','durante','depois','ocorrencia'];
      const title={antes:'📷 Antes',durante:'🔧 Durante',depois:'✅ Depois',ocorrencia:'📍 Ocorrência'};
      const groups=types.map(type=>{
        const imgs=signed.filter(r=>r.tipo===type);
        return '<section style="border:1px solid var(--gray-200);border-radius:9px;padding:10px">' +
          '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:8px">'+
          '<strong style="font-size:12px">'+title[type]+'</strong>'+
          '<button class="btn btn-ghost" style="font-size:11px" onclick="uploadFotoChamado(\''+type+'\')">+ Anexar</button></div>'+
          (imgs.length ? '<div style="display:flex;flex-wrap:wrap;gap:8px">'+imgs.map(r=>
            r.url ? '<a href="'+html(r.url)+'" target="_blank" rel="noopener noreferrer" title="Abrir imagem">'+
              '<img src="'+html(r.url)+'" alt="Foto '+title[type]+'" loading="lazy" '+
              'style="width:118px;height:95px;object-fit:cover;border-radius:5px;border:1px solid #e5e7eb"></a>' :
              '<div style="font-size:11px;color:#b91c1c">Foto não disponível</div>').join('')+'</div>':
            '<div style="font-size:11px;color:var(--gray-400)">Nenhuma foto cadastrada.</div>')+
          '</section>';
      }).join('');
      const pendencias=pendentesDoChamado(chamada._supaId).filter(p=>p.consorcioId===chamada.consorcio_id);
      const avisos=pendencias.length
        ? '<div style="border:1px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:10px;margin:8px 0;font-size:12px;color:#92400e">'+
          '<strong>Registro de foto pendente ('+pendencias.length+')</strong><p>O arquivo foi enviado ao Storage, mas o registro não foi confirmado. Não envie a mesma imagem de novo.</p>'+
          pendencias.map(p=>'<button type="button" class="btn btn-ghost" style="margin:4px 6px 0 0;border:1px solid #f59e0b" onclick="v19RecuperarRegistroFoto(\''+html(p.storagePath)+'\')">Verificar / recuperar registro</button>').join('')+
          '</div>' : '';
      box.innerHTML='<div class="card-title" style="margin-bottom:8px">Registro fotográfico no Supabase</div>'+
        avisos+'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">'+groups+'</div>';
    } catch(e) {
      if(seq===lastPhotoQuery)box.innerHTML='<div class="card-title">Registro fotográfico</div>'+
        '<p style="color:var(--red)">'+html(e.message)+'</p>'+
        '<button class="btn btn-ghost" onclick="showDTab(\'fotos\')">Tentar novamente</button>';
    }
  }

  window.uploadFotoChamado = function (tipo) {
    if(!CC || !validUUID(CC._supaId) || !validUUID(CC.consorcio_id)) {
      showToast('Salve ou reabra o chamado antes de anexar fotos.','erro');return;
    }
    if(!['antes','durante','depois','ocorrencia'].includes(tipo)) {
      showToast('Tipo de foto inválido.','erro');return;
    }
    const protocolo=CC._supaId,cons=CC.consorcio_id;
    if(pendentesDoChamado(protocolo).some(p=>p.consorcioId===cons)){
      showToast('Há um registro fotográfico pendente neste chamado. Use “Verificar / recuperar registro” antes de outro upload.','erro');
      void renderFotosChamado();
      return;
    }
    const input=document.createElement('input');
    input.type='file'; input.accept='image/jpeg,image/png,image/webp';
    input.style.display='none';document.body.appendChild(input);
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];
      input.remove();
      if(!file)return;
      if(file.size<=0||file.size>5*1024*1024 ||
        !['image/jpeg','image/png','image/webp'].includes(file.type)){
        showToast('Use JPG, PNG ou WEBP com até 5 MB.','erro');return;
      }
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
      const unique=crypto?.randomUUID?.() || String(Date.now())+'-'+Math.random().toString(36).slice(2);
      const storagePath=cons+'/'+protocolo+'/'+unique+'.'+ext;
      showToast('Enviando foto para o Supabase…','aviso');
      try{
        const r=await fetch(SUPA_URL+'/storage/v1/object/chamado-fotos/'+pathUrl(storagePath),{
          method:'POST',
          headers:{apikey:SUPA_KEY,Authorization:'Bearer '+(SB_SESSION?.access_token||''),
            'Content-Type':file.type,'x-upsert':'false'},
          body:file
        });
        if(!r.ok){
          const body=await r.text().catch(()=>'');
          throw new Error('Falha no envio ao Storage (HTTP '+r.status+'). '+body.slice(0,140));
        }
        // A partir de HTTP 2xx, guardar o caminho antes da RPC.
        // Se a resposta falhar ou a página atualizar, recuperar metadados
        // do MESMO arquivo, sem reenviar bytes nem gerar um novo path.
        const item={chamadoId:protocolo,consorcioId:cons,storagePath,tipo};
        adicionarPendenteFoto(item);
        let registrado=false;
        try { registrado=await registrarMetadadosFoto(item); }
        catch(e) {console.warn('[V19] foto enviada sem confirmacao de metadados:',e);}
        if(!registrado){
          showToast('⚠ Arquivo enviado, mas o registro está pendente. Use “Verificar / recuperar registro” na aba Fotos; não reenvie a imagem.','erro');
          if(CC?._supaId===protocolo)await renderFotosChamado();
          return;
        }
        confirmarPendenteFoto(storagePath);
        showToast('✅ Foto salva no Supabase.','ok');
        if(CC?._supaId===protocolo)await renderFotosChamado();
      }catch(e){console.error('[V19] foto:',e);noticeError(e);}
    },{once:true});
    input.click();
  };

  const olderShowDTab=window.showDTab;
  window.showDTab=function (tab,el) {
    olderShowDTab(tab,el);
    if(tab==='fotos')void renderFotosChamado();
  };
  console.info('[Aponte V19] fotos persistentes carregadas; histórico tem um único renderizador.');
})();