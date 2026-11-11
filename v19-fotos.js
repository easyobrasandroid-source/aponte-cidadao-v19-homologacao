/* Aponte Cidadão V19 — fotografias e histórico persistentes no Supabase */
(function () {
  'use strict';
  const html = value => String(value == null ? '' : value).replace(/[&<>"']/g, x =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const validUUID = value => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(value || ''));
  const pathUrl = p => String(p || '').split('/').map(encodeURIComponent).join('/');
  const noticeError = e => showToast(html(e?.message || String(e)), 'erro');
  let lastPhotoQuery=0, lastHistQuery=0;

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
      box.innerHTML='<div class="card-title" style="margin-bottom:8px">Registro fotográfico no Supabase</div>'+
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">'+groups+'</div>';
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
        // Registra metadados pela RPC autenticada: não liberar POST direto em tabelas.
        const registered=await sbFetch('rpc/v19_registrar_foto','POST',{
          p_chamado_id:protocolo,p_storage_path:storagePath,p_tipo:tipo
        });
        if(!validUUID(registered))
          throw new Error('Arquivo enviado, mas a RPC não confirmou o registro. Não reenvie antes de conferir o Storage.');
        showToast('✅ Foto salva no Supabase.','ok');
        if(CC?._supaId===protocolo)await renderFotosChamado();
      }catch(e){console.error('[V19] foto:',e);noticeError(e);}
    },{once:true});
    input.click();
  };

  async function renderHistoricoChamado() {
    const box=document.getElementById('dw-tc-historico');
    if(!box||!CC)return;
    const ch=CC,seq=++lastHistQuery;
    box.innerHTML='<div class="card-title">Histórico do chamado</div>'+
      '<div style="font-size:12px;color:var(--gray-500)">Consultando histórico…</div>';
    try {
      const rows=await sbSelect('chamado_historico',
        'select=*&chamado_id=eq.'+encodeURIComponent(ch._supaId)+'&order=created_at.asc');
      if(!Array.isArray(rows))throw new Error('Não foi possível consultar o histórico no Supabase.');
      if(seq!==lastHistQuery || CC?._supaId!==ch._supaId)return;
      box.innerHTML='<div class="card-title">Histórico do chamado</div>'+
        (rows.length?rows.map((h,i)=>'<div class="tl-item"><div class="tl-dot-col">'+
          '<div class="tl-dot" style="background:#1251A3"></div>'+
          (i<rows.length-1?'<div class="tl-line"></div>':'')+'</div>'+
          '<div class="tl-body"><div class="tl-s">'+html(h.status||h.mensagem||'Atualização')+'</div>'+
          '<div class="tl-m">'+html(h.usuario_nome||'Sistema')+' · '+
           html(h.created_at?new Date(h.created_at).toLocaleString('pt-BR'):'')+'</div>'+
          (h.observacao?'<div class="tl-o">'+html(h.observacao)+'</div>':'')+
          '</div></div>').join(''):
          '<p style="font-size:12px;color:var(--gray-400)">Nenhum histórico registrado no banco.</p>');
    }catch(e){
      if(seq===lastHistQuery)box.innerHTML='<div class="card-title">Histórico do chamado</div>'+
        '<p style="font-size:12px;color:var(--red)">'+html(e.message)+'</p>';
    }
  }

  const olderShowDTab=window.showDTab;
  window.showDTab=function (tab,el) {
    olderShowDTab(tab,el);
    if(tab==='fotos')void renderFotosChamado();
    if(tab==='historico')void renderHistoricoChamado();
  };
  console.info('[Aponte V19] fotos e histórico persistentes carregados.');
})();