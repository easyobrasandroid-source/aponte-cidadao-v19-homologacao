/* Aponte Cidadão V19 — ETAPA 550
   Painel exclusivo de CONSULTA de estoque por empresa.
   NÃO habilitar entradas, saídas, consumo, edição ou estorno até a
   integração das RPCs de escrita e homologação ponta a ponta.
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
    const safety = panel(root, 'Movimentações temporariamente indisponíveis',
      'A entrada, saída, consumo, edição e estorno ainda não estão liberados na interface.' +
      ' As novas rotinas serão homologadas antes da ativação.');
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
          const count = new Set(visible.map(x => x.empresa_id)).size;
          const top = panel(results, 'Saldos empresariais',
            count + ' empresa(s) · ' + visible.length + ' material(is) exibido(s)');
          if (!visible.length) {
            node('p', top, 'Nenhum material cadastrado para os filtros selecionados.',
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
