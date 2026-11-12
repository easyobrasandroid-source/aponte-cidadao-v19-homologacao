/*
 * APONTE CIDADÃO V19 — ETAPA 70
 * Gerenciamento real de usuarios V19 via Edge Function com Auth, RLS e RPC auditada.
 * O cadastro e convite ficam disponíveis somente quando o servidor autorizar escritas.
 * A V18 permanece intocada.
 */
(function () {
  'use strict';
  const PROJECT_URL = 'https://xurrhczvyqpwyjemight.supabase.co';
  const PERFIS = Object.freeze({
    master: 'Administrador Master',
    consorcio: 'Gestor de Consórcio',
    prefeitura: 'Prefeitura',
    empresa: 'Empresa executora',
    garantia: 'Garantia LED'
  });
  const PERFIS_CONSORCIO = ['prefeitura', 'empresa', 'garantia'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CSS = {
    card: 'background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.04)',
    note: 'padding:12px;border-radius:8px;border:1px solid #bfdbfe;background:#eff6ff;color:#1e40af;font-size:12px;line-height:1.6',
    muted: 'font-size:12px;line-height:1.5;color:#64748b',
    button: 'padding:9px 12px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#1e40af;cursor:pointer;font-weight:600;font-size:12px',
    input: 'width:100%;min-height:36px;border:1px solid #cbd5e1;border-radius:7px;padding:7px 10px;font-size:13px;background:#fff',
    label: 'display:block;margin:0 0 5px;font-size:11px;font-weight:700;color:#475569'
  };
  const stato = {seq: 0};

  function admin() {
    return typeof CU !== 'undefined' && CU && ['master', 'consorcio'].includes(CU.perfil);
  }
  function el(tag, parent, text, style) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (style) node.style.cssText = style;
    if (parent) parent.appendChild(node);
    return node;
  }
  function card(b, title, body, error) {
    b.textContent = '';
    const root = el('div', b, null, CSS.card);
    el('div', root, title, `font-weight:700;margin-bottom:8px;color:${error ? '#b91c1c' : '#334155'}`);
    el('p', root, body, CSS.muted);
  }
  function pill(parent, label, warning) {
    return el('span', parent, label, `display:inline-block;padding:4px 7px;margin-left:5px;border-radius:7px;background:${warning ? '#ffedd5' : '#f1f5f9'};color:${warning ? '#9a3412' : '#475569'};font-size:11px`);
  }
  function labelControl(parent, title, input) {
    const box = el('div', parent);
    el('label', box, title, CSS.label);
    input.style.cssText = CSS.input;
    box.appendChild(input);
    return box;
  }
  function option(select, value, label) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
    return opt;
  }
  function loadOptions(select, items, selectedId, emptyLabel) {
    select.textContent = '';
    option(select, '', emptyLabel);
    for (const item of items) option(select, item.id, item.nome || 'Sem nome');
    select.value = selectedId || '';
  }
  function validCatalog(rows) { return Array.isArray(rows) ? rows : []; }
  function labelOrg(u, catalog) {
    const lookup = (items, id) => items.find(it => it.id === id)?.nome;
    const label = (u.perfil === 'empresa' && lookup(catalog.empresas, u.empresa_id)) ||
      (u.perfil === 'prefeitura' && lookup(catalog.cidades, u.cidade_id)) ||
      lookup(catalog.consorcios, u.consorcio_id);
    if (label) return label;
    if (u.perfil === 'master') return 'Administração geral';
    if (u.org && !UUID.test(String(u.org))) return String(u.org);
    return 'Nome do vínculo indisponível';
  }
  function isActive(u) { return u.status === 'ativo'; }
  function session() {
    if (typeof SB_SESSION === 'undefined' || !SB_SESSION?.access_token) return false;
    return typeof SUPA_CONFIGURADO !== 'undefined' && SUPA_CONFIGURADO &&
      typeof SUPA_URL !== 'undefined' && SUPA_URL === PROJECT_URL;
  }
  async function accessStatus() {
    // ÚNICO POST permitido neste módulo: consulta administrativa sem mutação.
    let response;
    try {
      response = await fetch(PROJECT_URL + '/functions/v1/v19-usuarios', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SB_SESSION.access_token,
          'apikey': SUPA_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({acao: 'verificar_acesso'})
      });
      const data = await response.json();
      return {status: response.status, code: data.codigo || 'SEM_CODIGO',
        role: data.perfil || null, backendWrites: data.gravacao_habilitada === true};
    } catch (_err) {
      return {status: 0, code: 'SEM_CONEXAO', role: null, backendWrites: false};
    }
  }
  function fieldForm(container, label, type, key, value, required) {
    const input = document.createElement('input');
    input.type = type;
    input.name = key;
    input.value = value || '';
    input.required = !!required;
    input.maxLength = {nome: 250, email: 320, telefone: 50, cargo: 160}[key] || 320;
    if (key === 'email' && type === 'email') input.autocomplete = 'email';
    labelControl(container, label, input);
    return input;
  }
  function fieldSelect(container, title, items, value, emptyLabel) {
    const select = document.createElement('select');
    labelControl(container, title, select);
    loadOptions(select, items, value, emptyLabel);
    return select;
  }
  function grid(parent) {
    return el('div', parent, null, 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px');
  }
  function safeMsg(root, msg, warning) {
    root.textContent = msg;
    root.style.cssText = `padding:9px 11px;border-radius:7px;font-size:12px;line-height:1.6;background:${warning?'#fff7ed':'#f0fdf4'};color:${warning?'#9a3412':'#166534'};border:1px solid ${warning?'#fed7aa':'#bbf7d0'}`;
  }

  // Todas as gravações passam pela Edge Function autenticada; nunca pela REST direto.
  async function operar(acao, payload) {
    if (!session()) throw new Error('Sessão V19 expirada. Entre novamente.');
    let r, data;
    try {
      r = await fetch(PROJECT_URL+'/functions/v1/v19-usuarios',{
        method:'POST', cache:'no-store',
        headers:{'Authorization':'Bearer '+SB_SESSION.access_token,'apikey':SUPA_KEY,
          'Content-Type':'application/json'},
        body:JSON.stringify({acao,...payload})
      });
      data = await r.json();
    } catch (_) { throw new Error('Não foi possível conectar ao serviço de usuários.'); }
    if (!r.ok || data?.ok!==true) {
      const errorCode=String(data?.codigo||'ERRO_INTERNO');
      const errors={
        GRAVACAO_DESABILITADA_HOMOLOGACAO:'A escrita ainda está bloqueada na Edge Function V19.',
        REDIRECT_CONVITE_NAO_CONFIGURADO:'Redirecionamento do convite não configurado no Supabase V19.',
        REGISTRO_DUPLICADO:'E-mail já cadastrado.',
        EMAIL_JA_EXISTE_NO_AUTH:'Este e-mail já tem uma conta de autenticação.',
        CONVITE_NAO_ENVIADO:'Convite não enviado. Nenhum acesso foi liberado.',
        VINCULO_PENDENTE_RECONCILIACAO:'Convite pode ter sido enviado, mas o vínculo ficou pendente. Não reenviar até conciliar.',
        CONVITE_FALHOU_RESERVA_PENDENTE:'Reserva pendente após falha. Não reenviar sem conciliar.',
        AUTOALTERACAO_BLOQUEADA:'Não é permitido alterar a própria conta.',
        ALVO_FORA_ESCOPO:'Usuário pertence a outro consórcio ou empresa.',
        PERFIL_NAO_AUTORIZADO:'Seu perfil não tem permissão para esta operação.',
        CONVITE_PENDENTE_NAO_EDITAVEL:'Convite pendente não pode ser editado.',
        STATUS_DE_CONVITE_PENDENTE_IMUTAVEL:'Convite pendente não pode ter status alterado.'
      };
      throw new Error(errors[errorCode]||('Operação negada pelo servidor: '+errorCode));
    }
    if (data.auditoria_confirmada!==true) throw new Error('Auditoria não confirmada. Verifique antes de tentar novamente.');
    return data;
  }

  function formulario(outlet,user,catalog,rows,habilitado,recarregar) {
    outlet.textContent='';
    const editando=!!user, root=el('section',outlet,null,CSS.card+';margin-top:14px');
    el('h3',root,editando?'Editar usuário':'Cadastrar e enviar convite','font-size:16px;margin:0 0 8px');
    el('p',root,'Cadastro real no Supabase V19. A senha é definida apenas pelo destinatário do e-mail.',CSS.muted);
    const form=el('form',root), fields=grid(form);
    const nome=fieldForm(fields,'Nome *','text','nome',user?.nome||'',true);
    const email=fieldForm(fields,'E-mail *','email','email',user?.email||'',true);
    email.readOnly=editando;
    const roles=CU.perfil==='master'?Object.keys(PERFIS):PERFIS_CONSORCIO;
    const perfil=fieldSelect(fields,'Perfil *',roles.map(id=>({id,nome:PERFIS[id]})),user?.perfil||'','Escolha o perfil');
    const consList=CU.perfil==='consorcio'
      ?[{id:CU.consorcio_id,nome:catalog.consorcios.find(c=>c.id===CU.consorcio_id)?.nome||CU.org||'Consórcio'}]
      :catalog.consorcios.filter(isActive);
    const cons=fieldSelect(fields,'Consórcio *',consList,
      user?.consorcio_id||(CU.perfil==='consorcio'?CU.consorcio_id:''),'Escolha o consórcio');
    if(CU.perfil==='consorcio')cons.disabled=true;
    const cidade=fieldSelect(fields,'Município da prefeitura *',[],user?.cidade_id||'','Escolha o município');
    const empresa=fieldSelect(fields,'Empresa executora *',[],user?.empresa_id||'','Escolha a empresa');
    const telefone=fieldForm(fields,'Telefone','tel','telefone',user?.telefone||'',false);
    const cpf=fieldForm(fields,'CPF','text','cpf',user?.cpf||'',false);cpf.maxLength=25;
    const cargo=fieldForm(fields,'Cargo','text','cargo',user?.cargo||'',false);
    const aviso=el('p',form,null,CSS.muted+';margin-top:10px');
    const resultado=el('p',form);
    const botoes=el('div',form,null,'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap');
    const salvar=el('button',botoes,editando?'Salvar alterações':'Cadastrar e enviar convite',
      CSS.button+';background:#1251a3;color:white');
    salvar.type='submit';salvar.disabled=!habilitado;
    const cancelar=el('button',botoes,'Cancelar',CSS.button);cancelar.type='button';
    cancelar.addEventListener('click',()=>{outlet.textContent='';});
    function ajustar() {
      const role=perfil.value,cid=cons.value;
      const oldCity=cidade.value||(user?.cidade_id||''),oldEmp=empresa.value||(user?.empresa_id||'');
      loadOptions(cidade,catalog.cidades.filter(c=>c.consorcio_id===cid&&isActive(c)),oldCity,'Escolha o município');
      loadOptions(empresa,catalog.empresas.filter(e=>e.consorcio_id===cid&&isActive(e)),oldEmp,'Escolha a empresa');
      cons.parentElement.hidden=role==='master';
      cidade.parentElement.hidden=role!=='prefeitura';
      empresa.parentElement.hidden=role!=='empresa';
      aviso.textContent='Vínculos selecionados dos cadastros reais do Supabase V19.';
    }
    perfil.addEventListener('change',()=>{cidade.value='';empresa.value='';ajustar();});
    cons.addEventListener('change',()=>{cidade.value='';empresa.value='';ajustar();});ajustar();
    if(!habilitado)safeMsg(resultado,'Gravação ainda desabilitada na Edge Function V19.',true);
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(!habilitado)return;
      const role=perfil.value, consId=role==='master'?null:cons.value;
      const data={nome:nome.value.trim(),email:email.value.trim().toLowerCase(),perfil:role,
        consorcio_id:consId,cidade_id:role==='prefeitura'?(cidade.value||null):null,
        empresa_id:role==='empresa'?(empresa.value||null):null,
        telefone:telefone.value.trim()||null,cpf:cpf.value.trim()||null,cargo:cargo.value.trim()||null};
      let msg='';
      if(!data.nome)msg='Nome obrigatório.';
      else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))msg='E-mail inválido.';
      else if(!roles.includes(role))msg='Perfil não permitido.';
      else if(role!=='master'&&!consId)msg='Consórcio obrigatório.';
      else if(CU.perfil==='consorcio'&&consId!==CU.consorcio_id)msg='Consórcio fora de seu escopo.';
      else if(role==='empresa'&&!data.empresa_id)msg='Empresa obrigatória.';
      else if(role==='prefeitura'&&!data.cidade_id)msg='Município obrigatório.';
      else if(!editando&&rows.some(u=>u.email?.toLowerCase()===data.email))msg='E-mail já cadastrado.';
      if(msg){safeMsg(resultado,msg,true);return;}
      if(!window.confirm(editando?'Confirmar alterações do usuário?':
        'Confirmar cadastro e envio de convite REAL por e-mail?'))return;
      salvar.disabled=true;cancelar.disabled=true;
      safeMsg(resultado,'Enviando solicitação ao Supabase V19…',false);
      try {
        await operar(editando?'editar':'criar',editando?{usuario_id:user.id,usuario:data}:{usuario:data});
        window.alert(editando?'Usuário atualizado com auditoria.':'Usuário cadastrado; convite enviado por e-mail.');
        recarregar();
      }catch(error){safeMsg(resultado,error.message||'Falha na operação.',true);}
      finally{salvar.disabled=!habilitado;cancelar.disabled=false;}
    });
    outlet.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function renderUsers(body,title,actions,rows,catalog,status,seq) {
    if(seq!==stato.seq||!body.isConnected||title.textContent!=='Usuários — V19')return;
    actions.textContent='';body.textContent='';
    const main=el('div',body,null,CSS.card);
    el('div',main,status.backendWrites
      ?'Gerenciamento ativo. Cadastros, convites e alterações passam pela Edge Function e auditoria.'
      :'Consulta ativa. Escrita da Edge Function ainda não habilitada no Supabase V19.',CSS.note);
    el('p',main,'Edge Function: '+status.code+' (HTTP '+status.status+').',CSS.muted+';margin-top:10px');
    const falta=['consorcios','empresas','cidades'].filter(k=>catalog[k+'Falhou']);
    if(falta.length)el('p',main,'Catálogos indisponíveis: '+falta.join(', '),'font-size:12px;color:#b45309');
    const row=el('div',main,null,'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0');
    const search=document.createElement('input');search.type='search';search.placeholder='Buscar por nome ou e-mail';
    search.style.cssText=CSS.input+';max-width:330px';row.appendChild(search);
    const add=el('button',row,'+ Cadastrar e convidar',CSS.button+';background:#eff6ff');
    add.type='button';add.disabled=!status.backendWrites;
    const total=el('span',row,null,CSS.muted);
    const wrap=el('div',main,null,'overflow-x:auto');
    const table=el('table',wrap,null,'min-width:850px;width:100%;border-collapse:collapse');
    const head=el('tr',el('thead',table));
    ['Nome','E-mail','Perfil','Organização','Situação','Ações'].forEach(x=>
      el('th',head,x,'font-size:11px;padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#64748b'));
    const bodyRows=el('tbody',table),outlet=el('div',main);
    const reload=()=>window.vUsuarios(body,title,actions);
    add.addEventListener('click',()=>formulario(outlet,null,catalog,rows,status.backendWrites,reload));
    function draw(){
      bodyRows.textContent='';
      const term=search.value.trim().toLocaleLowerCase('pt-BR');
      const filtered=rows.filter(u=>((u.nome||'')+' '+(u.email||'')).toLocaleLowerCase('pt-BR').includes(term));
      for(const u of filtered){
        const tr=el('tr',bodyRows);
        [u.nome||'—',u.email||'—',PERFIS[u.perfil]||u.perfil,labelOrg(u,catalog)].forEach(x=>
          el('td',tr,x,'padding:10px;border-bottom:1px solid #e5e7eb;font-size:12px'));
        const cell=el('td',tr,null,'padding:10px;border-bottom:1px solid #e5e7eb');
        pill(cell,u.status||'sem status',u.status!=='ativo');
        if(u.v19_convite_pendente)pill(cell,'Convite pendente',true);
        if(!u.auth_user_id)pill(cell,'Sem Auth',true);
        const actions=el('td',tr,null,'padding:8px;border-bottom:1px solid #e5e7eb');
        const roleAllowed=CU.perfil==='master'||(u.consorcio_id===CU.consorcio_id&&
          !['master','consorcio'].includes(u.perfil));
        const allowed=!!status.backendWrites&&roleAllowed&&!!u.auth_user_id&&
          !u.v19_convite_pendente&&u.auth_user_id!==SB_SESSION?.user?.id;
        const edit=el('button',actions,'Editar',CSS.button+';margin-right:6px');
        edit.type='button';edit.disabled=!allowed;
        edit.addEventListener('click',()=>formulario(outlet,u,catalog,rows,status.backendWrites,reload));
        const next=u.status==='ativo'?'inativo':'ativo';
        const toggle=el('button',actions,next==='ativo'?'Ativar':'Desativar',CSS.button);
        toggle.type='button';toggle.disabled=!allowed||!['ativo','inativo'].includes(u.status);
        toggle.addEventListener('click',async()=>{
          if(!window.confirm((next==='ativo'?'Ativar':'Desativar')+' o acesso de '+u.nome+'?'))return;
          toggle.disabled=true;edit.disabled=true;
          try{
            await operar('alterar_status',{usuario_id:u.id,status:next});
            window.alert('Situação alterada com auditoria.');reload();
          }catch(error){
            window.alert(error.message||'Falha ao atualizar.');
            toggle.disabled=false;edit.disabled=false;
          }
        });
      }
      if(!filtered.length){const tr=el('tr',bodyRows);
        const td=el('td',tr,'Nenhum usuário encontrado nesta pesquisa.',CSS.muted+';padding:13px');
        td.colSpan=6;}
      total.textContent=filtered.length+' usuário(s) exibido(s) do Supabase V19';
    }
    search.addEventListener('input',draw);draw();
    el('p',main,'Convites e mudanças usam exclusivamente a Edge Function e a RPC auditada. Senhas nunca são definidas pelo administrador.',CSS.muted+';margin-top:14px');
  }
  window.vUsuarios = async function (body, title, actions) {
    const seq = ++stato.seq;
    title.textContent = 'Usuários — V19';
    actions.textContent='';
    if (!admin()) {card(body,'Acesso restrito','Somente Master ou Gestor de Consórcio podem consultar esta administração.',true);return;}
    if (!session()) {card(body,'Sessão ausente ou projeto incorreto','Faça login novamente na V19 de homologação.',true);return;}
    card(body,'Carregando usuários da V19…','Consultando registros reais e permissões.');
    const [users,cons,emp,city,status] = await Promise.all([
      sbSelect('usuarios','select=id,auth_user_id,consorcio_id,cidade_id,empresa_id,nome,email,perfil,org,status,telefone,cpf,cargo,v19_convite_pendente&order=nome.asc'),
      sbSelect('consorcios','select=id,nome,status&order=nome.asc'),
      sbSelect('empresas','select=id,nome,consorcio_id,status&order=nome.asc'),
      sbSelect('cidades','select=id,nome,consorcio_id,status&order=nome.asc'),
      accessStatus()
    ]);
    if (seq!==stato.seq || title.textContent!=='Usuários — V19') return;
    if (status.status!==200 || status.code!=='ACESSO_ADMIN_CONFIRMADO' || status.role!==CU.perfil) {
      card(body,'Não foi possível confirmar o acesso administrativo','O serviço v19-usuarios não confirmou a autorização desta sessão. Nenhum cadastro foi modificado.',true);
      return;
    }
    if (!Array.isArray(users)) {
      card(body,'Falha na leitura dos usuários','A API não retornou uma lista de usuários. Nenhuma informação simulada será exibida.',true);
      return;
    }
    const catalog = {consorcios:validCatalog(cons),empresas:validCatalog(emp),cidades:validCatalog(city),
      consorciosFalhou:!Array.isArray(cons),empresasFalhou:!Array.isArray(emp),cidadesFalhou:!Array.isArray(city)};
    renderUsers(body,title,actions,users,catalog,status,seq);
  };
  // Oculta navegação não administrativa; autorização REAL sempre cabe à API e RLS.
  const oldSetup = window.setupUI;
  if (typeof oldSetup === 'function') {
    window.setupUI = function(user) {
      oldSetup(user);
      const menu=document.getElementById('sb-usuarios');
      if(menu)menu.style.display=user&&['master','consorcio'].includes(user.perfil)?'flex':'none';
    };
  }
})();
