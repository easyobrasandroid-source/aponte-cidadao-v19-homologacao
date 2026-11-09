/*
 * APONTE CIDADÃO V19 — ETAPA 70
 * Interface integrada: consulta de usuários + verificação da Edge Function,
 * catálogos reais de vínculos e prévia de cadastro/edição.
 * IMPORTANTE: ESTA ETAPA NUNCA ENVIA REQUISIÇÕES DE GRAVAÇÃO.
 * Não altera usuarios, auth.users, auditoria ou qualquer outro objeto.
 * V18 e branch main NÃO devem carregar este arquivo.
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
  function showPreview(outlet, user, catalog, currentList) {
    outlet.textContent = '';
    const editar = !!user;
    const root = el('section', outlet, null, CSS.card + ';margin-top:12px');
    el('h3', root, editar ? 'Prévia de edição — não salva' : 'Prévia de cadastro — não envia convite', 'font-size:15px;margin:0 0 8px');
    el('p', root, 'Esta etapa permite conferir os campos e vínculos. Nenhuma solicitação de criação, edição ou desativação será enviada ao servidor.', CSS.muted + ';margin-bottom:13px');
    const form = el('form', root);
    form.noValidate = true;
    const fields = grid(form);
    const nome = fieldForm(fields, 'Nome *', 'text', 'nome', user?.nome || '', true);
    const email = fieldForm(fields, 'E-mail *', 'email', 'email', user?.email || '', true);
    email.readOnly = editar; // Banco exige e-mail imutável na edição.
    if (editar) email.title = 'E-mail não pode ser alterado pela operação de edição';
    const roles = CU.perfil === 'master' ? Object.keys(PERFIS) : PERFIS_CONSORCIO;
    const perfil = fieldSelect(fields, 'Perfil *', roles.map(id => ({id, nome: PERFIS[id]})), user?.perfil || '', 'Selecione o perfil');
    const consorcios = CU.perfil === 'consorcio'
      ? [{id: CU.consorcio_id, nome: (catalog.consorcios.find(c => c.id === CU.consorcio_id)?.nome || CU.org || 'Consórcio atual')}]
      : catalog.consorcios.filter(c => isActive(c));
    const cons = fieldSelect(fields, 'Consórcio *', consorcios, user?.consorcio_id || (CU.perfil==='consorcio'?CU.consorcio_id:''), 'Selecione o consórcio');
    if (CU.perfil === 'consorcio') cons.disabled = true;
    const cidade = fieldSelect(fields, 'Município da prefeitura *', [], user?.cidade_id || '', 'Selecione o município');
    const empresa = fieldSelect(fields, 'Empresa executora *', [], user?.empresa_id || '', 'Selecione a empresa');
    const telefone = fieldForm(fields, 'Telefone (opcional)', 'tel', 'telefone', user?.telefone || '', false);
    const cargo = fieldForm(fields, 'Cargo (opcional)', 'text', 'cargo', user?.cargo || '', false);
    const help = el('p', form, null, CSS.muted + ';margin:10px 0');
    const result = el('p', form);
    const buttons = el('div', form, null, 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px');
    const validate = el('button', buttons, 'Validar preenchimento (não salva)', CSS.button + ';background:#eff6ff');
    validate.type = 'submit';
    const close = el('button', buttons, 'Fechar prévia', CSS.button);
    close.type = 'button';
    close.addEventListener('click', () => { outlet.textContent = ''; });
    function recalc() {
      const role = perfil.value;
      const consId = cons.value;
      const cityOld = cidade.value || (user?.cidade_id || '');
      const empOld = empresa.value || (user?.empresa_id || '');
      loadOptions(cidade, catalog.cidades.filter(c => c.consorcio_id === consId && isActive(c)), cityOld, 'Selecione o município');
      loadOptions(empresa, catalog.empresas.filter(e => e.consorcio_id === consId && isActive(e)), empOld, 'Selecione a empresa');
      cidade.parentElement.hidden = role !== 'prefeitura';
      empresa.parentElement.hidden = role !== 'empresa';
      cons.parentElement.hidden = role === 'master';
      const warnings = [];
      if (role === 'prefeitura' && catalog.cidadesFalhou)
        warnings.push('O catálogo de municípios não pôde ser consultado: existe uma pendência de permissão de leitura no Supabase.');
      if (role === 'empresa' && catalog.empresasFalhou)
        warnings.push('O catálogo de empresas não pôde ser consultado: revisar a permissão de leitura.');
      if (role !== 'master' && !consId)
        warnings.push('Selecione um consórcio real antes de prosseguir.');
      help.textContent = warnings.length ? warnings.join(' ') : 'Vínculos mostrados a partir dos catálogos consultáveis no Supabase V19.';
      help.style.color = warnings.length ? '#b45309' : '#64748b';
    }
    perfil.addEventListener('change', () => {cidade.value='';empresa.value='';recalc();});
    cons.addEventListener('change', () => {cidade.value='';empresa.value='';recalc();});
    recalc();
    form.addEventListener('submit', event => {
      event.preventDefault();
      const role = perfil.value, consId = role==='master' ? null : cons.value;
      const nomeVal = nome.value.trim(), emailVal = email.value.trim().toLowerCase();
      let error = '';
      if (!nomeVal || nomeVal.length > 250) error = 'Informe um nome válido.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal) || emailVal.length > 320) error = 'Informe um e-mail válido.';
      else if (!roles.includes(role)) error = 'Perfil não permitido para este administrador.';
      else if (role !== 'master' && !consId) error = 'Consórcio obrigatório.';
      else if (CU.perfil==='consorcio' && consId !== CU.consorcio_id) error = 'O consórcio deve ser o da sua sessão.';
      else if (role === 'prefeitura' && !cidade.value) error = 'Município obrigatório. Confira o catálogo do banco.';
      else if (role === 'empresa' && !empresa.value) error = 'Empresa obrigatória. Confira o catálogo do banco.';
      else if (telefone.value.trim().length > 50 || cargo.value.trim().length > 160) error = 'Telefone ou cargo maior que o permitido.';
      else if (!editar && currentList.some(u=>String(u.email).toLowerCase()===emailVal)) error = 'Este e-mail já aparece nos usuários visíveis.';
      if (error) safeMsg(result, error + ' Nenhuma solicitação foi enviada.', true);
      else safeMsg(result, 'Campos conferidos SOMENTE neste navegador. Não foi criado ou editado nenhum usuário, e nenhum convite foi enviado.', false);
    });
  }

  function renderUsers(body, title, actions, rows, catalog, status, seq) {
    if (seq !== stato.seq || !body.isConnected || title.textContent !== 'Usuários — V19 | etapa 70') return;
    actions.textContent=''; body.textContent='';
    const main = el('div', body, null, CSS.card);
    el('div', main, 'Etapa 70 — cadastros reais em consulta, formulário de prévia sem gravação. O backend de usuários continua bloqueado para escrita.', CSS.note);
    const note = el('p', main, null, CSS.muted + ';margin-top:10px');
    note.textContent = `Edge Function: ${status.code} (HTTP ${status.status}). ` +
      (status.code==='ACESSO_ADMIN_CONFIRMADO' ? 'Sessão administrativa reconhecida. ' : 'Permissão administrativa não confirmada. ') +
      (status.backendWrites ? 'ATENÇÃO: servidor relata gravações habilitadas, mas esta página mantém todas as escritas desativadas.' : 'Gravações desabilitadas no servidor.');
    if (status.backendWrites) note.style.color='#b91c1c';
    const warning = [];
    if (catalog.consorciosFalhou) warning.push('consórcios');
    if (catalog.empresasFalhou) warning.push('empresas');
    if (catalog.cidadesFalhou) warning.push('municípios');
    if (warning.length) el('p', main, 'Catálogos não disponíveis para leitura: '+warning.join(', ')+'. Não será possível validar alguns vínculos até corrigir as permissões.', 'font-size:12px;color:#9a3412;padding:8px 0');
    const row = el('div', main, null, 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0');
    const search = document.createElement('input');
    search.type='search'; search.placeholder='Buscar por nome ou e-mail'; search.style.cssText=CSS.input+';max-width:330px'; row.appendChild(search);
    const preview = el('button', row, '+ Prévia de cadastro', CSS.button);
    preview.type='button';
    const count = el('span', row, null, CSS.muted);
    const tableWrap = el('div', main, null, 'overflow-x:auto');
    const table = el('table', tableWrap, null, 'min-width:820px;width:100%;border-collapse:collapse');
    const th = el('thead', table), head = el('tr', th);
    ['Nome','E-mail','Perfil','Organização','Situação','Ações de homologação'].forEach(x => {
      el('th', head, x, 'font-size:11px;padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#64748b');
    });
    const tbody = el('tbody', table);
    const outlet = el('div', main);
    preview.addEventListener('click', () => showPreview(outlet, null, catalog, rows));
    function draw() {
      const q=search.value.toLocaleLowerCase('pt-BR').trim();
      const filtered=rows.filter(u=>(u.nome+' '+u.email).toLocaleLowerCase('pt-BR').includes(q));
      tbody.textContent='';
      for (const u of filtered) {
        const tr=el('tr',tbody);
        [u.nome||'—',u.email||'—',PERFIS[u.perfil]||u.perfil||'—',labelOrg(u,catalog)].forEach(v =>
          el('td',tr,v,'padding:10px;border-bottom:1px solid #e5e7eb;font-size:12px'));
        const statuscell = el('td', tr, '', 'padding:10px;border-bottom:1px solid #e5e7eb');
        pill(statuscell,u.status||'sem status',u.status!=='ativo');
        if (u.v19_convite_pendente) pill(statuscell,'Convite pendente',true);
        if (!u.auth_user_id) pill(statuscell,'Sem Auth',true);
        const actioncell = el('td',tr,null,'padding:8px;border-bottom:1px solid #e5e7eb');
        const edit = el('button',actioncell,'Prévia de edição',CSS.button);
        edit.type='button';
        edit.disabled = CU.perfil==='consorcio' && (u.perfil==='master'||u.perfil==='consorcio');
        edit.addEventListener('click', () => {
          if (!edit.disabled) {showPreview(outlet,u,catalog,rows);outlet.scrollIntoView({behavior:'smooth',block:'nearest'});}
        });
      }
      if (!filtered.length) {
        const tr=el('tr',tbody); const td=el('td',tr,'Nenhum usuário visível para esta pesquisa.',CSS.muted+';padding:13px');td.colSpan=6;
      }
      count.textContent=`${filtered.length} usuário(s) exibido(s); dados lidos do Supabase V19`;
    }
    search.addEventListener('input',draw);
    draw();
    el('p',main,'Nenhum botão desta etapa envia dados para salvar. Convites, edição de contas e ativação/desativação serão testados separadamente após liberação controlada.',CSS.muted+';margin-top:14px');
  }
  window.vUsuarios = async function (body, title, actions) {
    const seq = ++stato.seq;
    title.textContent = 'Usuários — V19 | etapa 70';
    actions.textContent='';
    if (!admin()) {card(body,'Acesso restrito','Somente Master ou Gestor de Consórcio podem consultar esta administração.',true);return;}
    if (!session()) {card(body,'Sessão ausente ou projeto incorreto','Faça login novamente na V19 de homologação.',true);return;}
    card(body,'Carregando usuários da V19…','Consultas reais ao banco; nenhuma operação de escrita será realizada.');
    const [users,cons,emp,city,status] = await Promise.all([
      sbSelect('usuarios','select=id,auth_user_id,consorcio_id,cidade_id,empresa_id,nome,email,perfil,org,status,telefone,cargo,v19_convite_pendente&order=nome.asc'),
      sbSelect('consorcios','select=id,nome,status&order=nome.asc'),
      sbSelect('empresas','select=id,nome,consorcio_id,status&order=nome.asc'),
      sbSelect('cidades','select=id,nome,consorcio_id,status&order=nome.asc'),
      accessStatus()
    ]);
    if (seq!==stato.seq || title.textContent!=='Usuários — V19 | etapa 70') return;
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
