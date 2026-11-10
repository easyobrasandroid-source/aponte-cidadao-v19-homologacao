/* Aponte Cidadao V19 - designacao administrativa, somente homologacao.
   A autorizacao real e feita pela RPC v19_designar_empresa_chamado. */
(function () {
  'use strict';

  const isAdmin = () => !!(typeof CU !== 'undefined' && CU &&
    (CU.perfil === 'master' || CU.perfil === 'consorcio'));
  const validUUID = s => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(s || ''));
  const modalId = 'v19-designacao-overlay';
  let ocupada = false;

  function elemento(tag, texto, classe) {
    const el = document.createElement(tag);
    if (texto != null) el.textContent = String(texto);
    if (classe) el.className = classe;
    return el;
  }
  function fechar() {
    document.getElementById(modalId)?.remove();
    document.body.style.overflow = '';
  }
  function mostrarErro(msg) {
    if (typeof showToast === 'function') showToast(String(msg), 'erro');
    else console.error(msg);
  }
  function adicionarCelula(tr, texto) {
    const td = elemento('td', texto);
    td.style.padding = '9px 6px';
    tr.appendChild(td);
    return td;
  }

  async function designar(chamado, empresaId, botao) {
    if (!isAdmin() || ocupada || !validUUID(chamado?._supaId) || !validUUID(empresaId)) return;
    if (!confirm('Designar a empresa escolhida para o chamado ' + chamado.protocolo + '?')) return;
    ocupada = true;
    botao.disabled = true;
    botao.textContent = 'Designando...';
    try {
      const resposta = await sbFetch('rpc/v19_designar_empresa_chamado', 'POST', {
        p_chamado_id: chamado._supaId,
        p_empresa_id: empresaId
      });
      const resultado = Array.isArray(resposta) ? resposta[0] : resposta;
      if (resultado?.ok !== true || resultado.empresa_id !== empresaId) {
        throw new Error('O servidor nao confirmou a designacao.');
      }
      fechar();
      showToast('Empresa designada para o chamado ' + resultado.protocolo + '.', 'ok');
      const atualizado = await carregarChamadosDoBanco();
      if (!atualizado) {
        mostrarErro('Designacao confirmada, mas a listagem nao atualizou. Recarregue a pagina.');
        return;
      }
      showView('chamados');
    } catch (erro) {
      mostrarErro('Designacao nao confirmada: ' + erro.message);
      if (document.contains(botao)) {
        botao.disabled = false;
        botao.textContent = 'Designar';
      }
    } finally {
      ocupada = false;
    }
  }

  window.v19MostrarDesignacao = async function () {
    if (!isAdmin()) {
      mostrarErro('Somente Master ou Consorcio pode designar empresas.');
      return;
    }
    if (ocupada) return;
    ocupada = true;
    fechar();
    const overlay = elemento('div');
    overlay.id = modalId;
    overlay.style.cssText = 'position:fixed;inset:0;background:#111827aa;z-index:20000;display:flex;align-items:center;justify-content:center;padding:12px';
    const painel = elemento('section');
    painel.style.cssText = 'background:#fff;border-radius:12px;padding:20px;width:min(1000px,96vw);max-height:88vh;overflow:auto;box-shadow:0 20px 50px #0003';
    const cabecalho = elemento('div');
    cabecalho.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
    cabecalho.appendChild(elemento('h3', 'Designar empresa executora'));
    const fecharBtn = elemento('button', 'Fechar', 'btn btn-ghost');
    fecharBtn.type = 'button';
    fecharBtn.addEventListener('click', fechar);
    cabecalho.appendChild(fecharBtn);
    painel.appendChild(cabecalho);
    const descricao = elemento('p', 'Somente chamados sem empresa, em municipios com duas ou mais empresas ativas. O servidor verifica as permissoes antes de gravar.');
    descricao.style.cssText = 'font-size:12px;color:#64748b;margin:8px 0';
    painel.appendChild(descricao);
    const corpo = elemento('div', 'Consultando chamados e empresas do Supabase...');
    painel.appendChild(corpo);
    overlay.appendChild(painel);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    try {
      const carregado = await carregarChamadosDoBanco();
      if (!carregado) throw new Error('Nao foi possivel atualizar os chamados.');
      const [empresas, vinculos] = await Promise.all([
        sbFetch('empresas?select=id,nome,consorcio_id,status&status=eq.ativo&order=nome.asc'),
        sbFetch('empresa_cidades?select=empresa_id,cidade_id')
      ]);
      if (!Array.isArray(empresas) || !Array.isArray(vinculos)) {
        throw new Error('Catalogo de empresas ou vinculos indisponivel.');
      }
      if (!document.getElementById(modalId)) return;
      corpo.replaceChildren();
      const tabela = elemento('table');
      tabela.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      const head = elemento('thead');
      const thRow = elemento('tr');
      ['Protocolo', 'Municipio', 'Tipo', 'SLA', 'Empresa executora', 'Acao'].forEach(t => {
        const th = elemento('th', t);
        th.style.cssText = 'text-align:left;padding:8px 6px;border-bottom:1px solid #e5e7eb';
        thRow.appendChild(th);
      });
      head.appendChild(thRow);
      tabela.appendChild(head);
      const tbody = elemento('tbody');
      let mostrados = 0;
      for (const ch of DB.chamados || []) {
        if (mostrados >= 100) break;
        if (ch.empresa_id || !['Recebido','Em programação'].includes(ch.status) ||
            !validUUID(ch._supaId) || !validUUID(ch.cidade_id) || !validUUID(ch.consorcio_id) ||
            (CU.perfil === 'consorcio' && ch.consorcio_id !== CU.consorcio_id)) continue;
        const candidatos = empresas.filter(e => e.status === 'ativo' &&
          e.consorcio_id === ch.consorcio_id &&
          vinculos.some(v => v.empresa_id === e.id && v.cidade_id === ch.cidade_id));
        if (candidatos.length < 2) continue;
        mostrados++;
        const tr = elemento('tr');
        tr.style.borderBottom = '1px solid #f1f5f9';
        adicionarCelula(tr, ch.protocolo);
        adicionarCelula(tr, ch.cidade);
        adicionarCelula(tr, ch.tipo);
        adicionarCelula(tr, ch.sla_horas == null ? 'Nao apuravel' : (ch.sla_horas / 24) + ' dias');
        const escolha = adicionarCelula(tr, null);
        const select = elemento('select');
        select.style.cssText = 'width:100%;max-width:260px;padding:7px';
        const inicial = elemento('option', 'Escolha a empresa');
        inicial.value = '';
        select.appendChild(inicial);
        candidatos.forEach(e => {
          const opt = elemento('option', e.nome);
          opt.value = e.id;
          select.appendChild(opt);
        });
        escolha.appendChild(select);
        const acao = adicionarCelula(tr, null);
        const btn = elemento('button', 'Designar', 'btn btn-save');
        btn.type = 'button';
        btn.disabled = true;
        select.addEventListener('change', () => { btn.disabled = !validUUID(select.value); });
        btn.addEventListener('click', () => designar(ch, select.value, btn));
        acao.appendChild(btn);
        tbody.appendChild(tr);
      }
      tabela.appendChild(tbody);
      if (mostrados) corpo.appendChild(tabela);
      else corpo.appendChild(elemento('p', 'Nenhum chamado aguardando designacao administrativa.'));
      const rodape = elemento('p', 'Exibindo ate 100 chamados elegiveis. A regra definitiva de autorizacao esta no Supabase.');
      rodape.style.cssText = 'font-size:11px;color:#64748b;margin-top:12px';
      corpo.appendChild(rodape);
    } catch (erro) {
      if (document.getElementById(modalId)) {
        corpo.replaceChildren(elemento('p', 'Nao foi possivel consultar a designacao: ' + erro.message));
      }
      console.error('[V19] Designacao:', erro);
    } finally {
      ocupada = false;
    }
  };

  const vChamadosAnterior = window.vChamados;
  if (typeof vChamadosAnterior === 'function') {
    window.vChamados = function (b, t, a) {
      vChamadosAnterior(b, t, a);
      if (!isAdmin() || !a) return;
      const botao = elemento('button', 'Designar empresa', 'btn btn-save');
      botao.type = 'button';
      botao.addEventListener('click', window.v19MostrarDesignacao);
      a.appendChild(botao);
    };
  }
  console.info('[Aponte V19] interface de designacao administrativa preparada.');
})();
