/* Aponte Cidadão V19 — ETAPA 552
   Painel de estoque exclusivo por empresa.
   Entrada e saída MANUAL: só Master e Gestor Consórcio, via RPC empresarial
   da etapa 547. Consumo em chamado, edição e estorno seguem INDISPONÍVEIS
   na interface até a homologação coordenada.
   V18 de produção não deve ser alterada. */
(function () {
  'use strict';

  let renderSeq = 0;
  const permitted = new Set(['master', 'consorcio', 'empresa']);
  const money = n => Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const qty = n => Number(n || 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 2
  });
  function node(tag, parent, content, css) {
    const e = document.createElement(tag);
    if (content !== null && content !== undefined) e.textContent = String(content);
    if (css) e.style.cssText = css;
    if (parent) parent.appendChild(e);
    return e;
  }
  function option(select, value, label) {
    const o = document.createElement('option');
    o.value = String(value);
    o.textContent = String(label);
    select.appendChild(o);
    return o;
  }
  function panel(root, heading, description) {
    const x = node('div', root, null,
      'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-top:12px;');
    node('div', x, heading, 'font-size:15px;font-weight:750;color:#0f172a;');
    if (description) node('p', x, description,
      'font-size:12px;color:#64748b;margin:6px 0 0;');
    return x;
  }
  function validUuid(v) {
    return typeof v === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  }
  function checkRows(rows, role, consorcio, empresa) {
    if (!Array.isArray(rows)) throw new Error('Consulta empresarial não retornou uma lista.');
    const filtered = [];
    for (const row of rows) {
      if (!row || !row.empresa_id || row.saldo_legado === true) {
        throw new Error('A consulta retornou estoque sem empresa. Verifique a RPC V19.');
      }
      const contracted = Number(row.quantidade_contratada);
      const available = Number(row.quantidade_disponivel);
      if (!Number.isFinite(contracted) || !Number.isFinite(available) ||
          contracted < 0 || available < 0 || available > contracted) {
        throw new Error('Saldo inválido retornado pelo Supabase V19.');
      }
      if (role === 'empresa' &&
        (row.empresa_id !== empresa || row.consorcio_id !== consorcio)) {
        throw new Error('Retorno inesperado para empresa: consulta bloqueada por segurança.');
      }
      if (role === 'consorcio' && row.consorcio_id !== consorcio) {
        throw new Error('Retorno inesperado para consórcio: consulta bloqueada por segurança.');
      }
      filtered.push(row);
    }
    return filtered;
  }

  window.vEstoque = function (body, title, actions) {
    const seq = ++renderSeq;
    const role = CU?.perfil || '';
    const consorcio = CU?.consorcio_id || null;
    const empresa = CU?.empresa_id || null;
    const identity = SB_SESSION?.user?.id || null;

    title.textContent = 'Controle de estoque';
    actions.replaceChildren();
    const root = node('div', null, null, 'max-width:1150px;margin:0 auto;');
    body.replaceChildren(root);

    if (!identity || !permitted.has(role)) {
      panel(root, 'Acesso restrito',
        'A consulta de estoque está disponível para Master, gestor de consórcio e empresa vinculada.');
      return;
    }
    if ((role === 'empresa' && (!empresa || !consorcio)) ||
        (role === 'consorcio' && !consorcio)) {
      panel(root, 'Vínculo não confirmado',
        'A conta não possui todos os vínculos exigidos para consultar os estoques.');
      return;
    }

    const reload = node('button', actions, 'Atualizar saldos',
      'border:1px solid #cbd5e1;background:white;color:#334155;border-radius:8px;' +
      'font-weight:600;padding:9px 14px;cursor:pointer;');
    reload.type = 'button';
    reload.addEventListener('click', () => window.vEstoque(body, title, actions));

    panel(root, 'Estoque exclusivo por empresa',
      'Cada saldo pertence a uma empresa. O consórcio não possui estoque próprio.');
    const safety = panel(root, 'Operações de estoque em homologação',
      'Master e Gestor Consórcio podem registrar entradas e saídas diretamente no estoque da empresa.' +
      ' Consumo em chamados, edição e estorno permanecem indisponíveis na interface até os testes.');
    safety.style.borderLeft = '4px solid #c28524';

    const filterBox = panel(root, 'Consulta de saldos', null);
    const selects = node('div', filterBox, null,
      'display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;');
    const results = node('div', root, null, 'margin-top:12px;');
    node('div', results, 'Carregando saldos por empresa no Supabase V19…',
      'padding:18px;color:#64748b;font-size:13px;');

    (async () => {
      try {
        // RPC de leitura via POST; credenciais do usuário e validação
        // de perfil permanecem obrigatórias dentro do Supabase.
        const [data, companyRows, consortiumRows] = await Promise.all([
          sbFetch('rpc/v19_listar_estoques_por_empresa',
            'POST', {p_consorcio_id:null}),
          role === 'empresa' ? Promise.resolve([]) :
            sbSelect('empresas','select=id,nome,consorcio_id,status&status=eq.ativo&order=nome.asc'),
          role === 'master' ?
            sbSelect('consorcios','select=id,nome&order=nome.asc') : Promise.resolve([])
        ]);
        const rows = checkRows(data, role, consorcio, empresa);
        if (seq !== renderSeq || SB_SESSION?.user?.id !== identity ||
            title.textContent !== 'Controle de estoque') return;

        const consortium = new Map();
        const companies = new Map();
        rows.forEach(r => {
          if (!consortium.has(r.consorcio_id)) consortium.set(r.consorcio_id, r.consorcio_id);
          if (!companies.has(r.empresa_id)) companies.set(r.empresa_id, {
            id:r.empresa_id, name:r.empresa_nome, consorcio_id:r.consorcio_id
          });
        });
        // Inclui empresas que ainda não possuem materiais, como Beta A.
        // Para Consórcio, o filtro permanece restrito ao vínculo da sessão.
        if (Array.isArray(companyRows)) {
          companyRows.forEach(e => {
            if (!e?.id || !e?.consorcio_id || e.status !== 'ativo') return;
            if (role === 'consorcio' && e.consorcio_id !== consorcio) return;
            companies.set(e.id,{
              id:e.id,name:e.nome,consorcio_id:e.consorcio_id
            });
            if (!consortium.has(e.consorcio_id)) {
              consortium.set(e.consorcio_id,e.consorcio_id);
            }
          });
        }
        if (Array.isArray(consortiumRows) && role === 'master') {
          consortiumRows.forEach(c => {
            if (c?.id) consortium.set(c.id,c.nome || c.id);
          });
        }

        let consSelect = null;
        if (role === 'master' && consortium.size > 1) {
          const control = node('label', selects, 'Consórcio',
            'display:flex;flex-direction:column;gap:5px;min-width:200px;color:#334155;font-size:12px;font-weight:600;');
          consSelect = node('select', control, null,
            'padding:9px;border:1px solid #cbd5e1;border-radius:8px;');
          option(consSelect, '', 'Todos os consórcios');
          Array.from(consortium.keys())
            .sort((a,b)=>String(consortium.get(a)).localeCompare(String(consortium.get(b)),'pt-BR'))
            .forEach(id=>option(consSelect,id,consortium.get(id)));
        }

        let companySelect = null;
        if (role !== 'empresa') {
          const control = node('label', selects, 'Empresa',
            'display:flex;flex-direction:column;gap:5px;min-width:220px;color:#334155;font-size:12px;font-weight:600;');
          companySelect = node('select', control, null,
            'padding:9px;border:1px solid #cbd5e1;border-radius:8px;');
        } else {
          const companyName = rows[0]?.empresa_nome || CU?.org || 'Empresa vinculada';
          node('p', selects, companyName,
            'font-size:13px;font-weight:650;color:#0f172a;');
        }

        function updateCompanies() {
          if (!companySelect) return;
          const keep = companySelect.value;
          const cons = consSelect?.value || '';
          companySelect.replaceChildren();
          option(companySelect,'','Todas as empresas');
          Array.from(companies.values())
            .filter(x => !cons || x.consorcio_id === cons)
            .sort((a,b) => String(a.name).localeCompare(String(b.name),'pt-BR'))
            .forEach(x => option(companySelect,x.id,x.name));
          if (Array.from(companySelect.options).some(x => x.value === keep)) {
            companySelect.value = keep;
          }
        }
        function draw() {
          const cons = consSelect?.value || '';
          const cmp = companySelect?.value || '';
          const visible = rows.filter(r =>
            (!cons || r.consorcio_id===cons) &&
            (!cmp || r.empresa_id===cmp));
          results.replaceChildren();
          const count = Array.from(companies.values()).filter(x =>
            (!cons || x.consorcio_id===cons) && (!cmp || x.id===cmp)).length;
          const top = panel(results, 'Saldos empresariais',
            count + ' empresa(s) · ' + visible.length + ' posição(ões) de estoque exibida(s)');
          if (!visible.length) {
            node('p', top,
              cmp ? 'Esta empresa ainda não possui materiais cadastrados.' :
                'Nenhum material cadastrado para os filtros selecionados.',
              'font-size:13px;color:#64748b;margin-top:12px;');
            return;
          }
          const grid = node('div', results, null,
            'display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px;margin-top:12px;');
          visible.sort((a,b) =>
            (String(a.empresa_nome).localeCompare(String(b.empresa_nome),'pt-BR') ||
            String(a.material_nome).localeCompare(String(b.material_nome),'pt-BR'))
          ).forEach(r => {
            const card = node('article', grid, null,
              'background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;');
            node('div', card, r.empresa_nome,
              'font-size:12px;font-weight:750;color:#1e40af;');
            node('div', card, r.material_nome,
              'font-size:15px;font-weight:700;color:#0f172a;margin-top:8px;');
            node('div', card, 'Disponível: ' + qty(r.quantidade_disponivel) + ' ' + (r.unidade||''),
              'font-size:14px;font-weight:700;color:#047857;margin-top:10px;');
            node('div', card, 'Contratado: ' + qty(r.quantidade_contratada) + ' ' + (r.unidade||''),
              'font-size:12px;color:#475569;margin-top:3px;');
            node('div', card, 'Preço unitário: R$ ' + money(r.preco_unitario),
              'font-size:12px;color:#64748b;margin-top:6px;');
            if (!r.estoque_id) {
              node('div', card, 'Saldo empresarial ainda não cadastrado',
                'font-size:11px;color:#b45309;margin-top:10px;');
            }
            if ((role==='master' || role==='consorcio') &&
                validUuid(r.material_id) && validUuid(r.empresa_id) &&
                validUuid(r.estoque_id)) {
              const launch = node('button', card, 'Registrar entrada / saída',
                'display:block;width:100%;border:1px solid #94a3b8;background:#f8fafc;' +
                'color:#334155;border-radius:8px;padding:9px;margin-top:12px;' +
                'font-size:12px;font-weight:700;cursor:pointer;');
              launch.type = 'button';
              launch.addEventListener('click', () => {
                if (seq!==renderSeq || SB_SESSION?.user?.id!==identity) return;
                const current = card.querySelector('[data-v19-movimento]');
                if (current) { current.remove(); return; }

                const form = node('form', card, null,
                  'border-top:1px solid #e2e8f0;margin-top:10px;padding-top:12px;' +
                  'display:flex;flex-direction:column;gap:8px;');
                form.dataset.v19Movimento='1';
                function field(labelText, type, required) {
                  const wrap = node('label', form, null,
                    'font-size:12px;font-weight:600;color:#334155;' +
                    'display:flex;flex-direction:column;gap:4px;');
                  node('span', wrap, labelText);
                  const input = node(type==='select'?'select':type==='textarea'?'textarea':'input', wrap,
                    null,'padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;');
                  if (type!=='select' && type!=='textarea') input.type=type;
                  input.required=!!required;
                  return input;
                }
                node('div', form,
                  'Empresa: '+r.empresa_nome+' · Material: '+r.material_nome,
                  'font-size:12px;color:#0f172a;');
                const kind = field('Tipo de movimentação','select',true);
                option(kind,'entrada','Entrada de material');
                option(kind,'saida','Saída manual de material');
                const amount=field('Quantidade (máximo 2 casas decimais)','number',true);
                amount.min='0.01';amount.step='0.01';amount.max='9999999999';
                amount.placeholder='Ex.: 5';
                const note=field('Observação','textarea',false);
                note.maxLength=500;note.rows=2;
                const info=node('div',form,
                  'A operação será registrada apenas para '+r.empresa_nome+'.',
                  'font-size:11px;color:#64748b;');
                const submit = node('button',form,'Conferir movimentação',
                  'background:#0f766e;color:#fff;border:0;border-radius:8px;' +
                  'padding:10px;font-weight:700;cursor:pointer;');
                submit.type='submit';
                form.addEventListener('submit',async ev=>{
                  ev.preventDefault();
                  if (form.dataset.busy==='1') return;
                  if (seq!==renderSeq || SB_SESSION?.user?.id!==identity ||
                      CU?.perfil!==role) return;
                  const quantity=Number(amount.value);
                  const direction=kind.value;
                  if (!['entrada','saida'].includes(direction) ||
                      !Number.isFinite(quantity) || quantity<=0 ||
                      quantity>9999999999 ||
                      Math.round(quantity*100)!==quantity*100) {
                    info.textContent='Informe uma quantidade positiva com até duas casas decimais.';
                    return;
                  }
                  if (direction==='saida' && quantity>Number(r.quantidade_disponivel)) {
                    info.textContent='Saída maior do que o saldo desta empresa.';
                    return;
                  }
                  const description = direction==='entrada'?'ENTRADA':'SAÍDA';
                  const confirmed = window.confirm(
                    'Confirmar '+description+' de '+qty(quantity)+' '+(r.unidade||'')+
                    ' para a empresa '+r.empresa_nome+
                    '\\nMaterial: '+r.material_nome+
                    '\\nSaldo disponível atual: '+qty(r.quantidade_disponivel)+
                    '\\nEsta operação será gravada no Supabase V19.'
                  );
                  if (!confirmed) return;
                  form.dataset.busy='1';submit.disabled=true;
                  info.textContent='Registrando movimentação no estoque da empresa…';
                  try {
                    const response=await sbFetch('rpc/v19_movimentar_estoque_empresa',
                      'POST',{
                        p_material_id:r.material_id,
                        p_empresa_id:r.empresa_id,
                        p_tipo:direction,
                        p_quantidade:quantity,
                        p_observacao:note.value.trim().slice(0,500) ||
                          'Movimentação manual pela tela empresarial V19'
                      });
                    if (response?.ok!==true || response.empresa_id!==r.empresa_id ||
                        response.estoque_id!==r.estoque_id) {
                      throw new Error('Operação não confirmada. Consulte o saldo antes de tentar novamente.');
                    }
                    // Nunca reenviar automaticamente em caso de resposta de rede ambígua.
                    window.vEstoque(body,title,actions);
                  } catch(e) {
                    info.textContent='Falha ou confirmação indisponível: '+
                      (e?.message||'Verifique o estoque antes de repetir.');
                    submit.disabled=true;
                    info.style.color='#b91c1c';
                    // Em erro de rede, a transação pode ter sido gravada.
                    // A recuperação exige atualizar o saldo, nunca reenviar.
                    reload.focus();
                  }
                });
              });
            }
          });
        }
        consSelect?.addEventListener('change',() => {updateCompanies();draw();});
        companySelect?.addEventListener('change',draw);
        updateCompanies();
        draw();
      } catch(e) {
        if (seq !== renderSeq || SB_SESSION?.user?.id !== identity ||
            title.textContent !== 'Controle de estoque') return;
        selects.replaceChildren();
        results.replaceChildren();
        panel(results, 'Falha na consulta de estoques empresariais',
          e?.message || 'A conexão com o Supabase V19 falhou.');
      }
    })();
  };
})();
