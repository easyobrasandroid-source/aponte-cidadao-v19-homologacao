/*
 * Aponte Cidadão V19 — convite e recuperação de senha.
 * Usa somente a credencial temporária do próprio destinatário, via Supabase Auth.
 * Sem cadastro, sem operações administrativas e sem gravação na tabela usuarios.
 */
(() => {
  'use strict';
  let pending = null, panel = null;

  function notify(msg, error) {
    const p = document.getElementById('v19-invite-msg');
    if (p) { p.textContent = msg; p.style.color = error ? '#b91c1c' : '#166534'; }
  }
  function showReturn() {
    document.getElementById('v19-invite-back').style.display = 'block';
  }
  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'pg-v19-invite';
    panel.className = 'page';
    panel.innerHTML = '<div class="login-shell"><div class="login-card">' +
      '<div class="login-logo"><div class="login-logo-icon">🔆</div>' +
      '<div class="login-logo-name">Aponte Cidadão</div>' +
      '<div class="login-logo-sub">V19 — homologação</div></div>' +
      '<h2 style="font-size:19px;margin:12px 0">Definir senha de acesso</h2>' +
      '<p id="v19-invite-msg" role="status" aria-live="polite" ' +
      'style="font-size:13px;line-height:1.5;margin:12px 0">Validando link…</p>' +
      '<form id="v19-invite-form" style="display:none">' +
      '<div class="lf"><label for="v19-invite-password">Nova senha</label>' +
      '<input id="v19-invite-password" type="password" autocomplete="new-password" ' +
      'minlength="12" required placeholder="No mínimo 12 caracteres"></div>' +
      '<div class="lf"><label for="v19-invite-confirm">Confirmar senha</label>' +
      '<input id="v19-invite-confirm" type="password" autocomplete="new-password" ' +
      'minlength="12" required placeholder="Repita a senha"></div>' +
      '<button id="v19-invite-save" type="submit" class="login-btn">Definir minha senha</button>' +
      '</form><button id="v19-invite-back" type="button" class="login-btn" ' +
      'style="display:none;margin-top:12px">Voltar ao login</button></div></div>';
    document.body.appendChild(panel);
    document.getElementById('v19-invite-form').addEventListener('submit', submitPassword);
    document.getElementById('v19-invite-back').addEventListener('click', () => {
      pending = null;
      if (typeof saveSession === 'function') saveSession(null);
      document.getElementById('v19-invite-password').value = '';
      document.getElementById('v19-invite-confirm').value = '';
      goPage('pg-login');
    });
  }
  async function verifyUser() {
    if (!pending) return;
    if (!SUPA_CONFIGURADO) {
      pending = null;
      notify('Configuração pública de autenticação indisponível para novos usuários. Contate o administrador.', true);
      showReturn();
      return;
    }
    try {
      const r = await fetch(SUPA_URL + '/auth/v1/user', {
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + pending.accessToken },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error('invalid');
      const u = await r.json();
      if (!u || !u.id) throw new Error('invalid');
      notify(pending.kind === 'invite'
        ? 'Convite confirmado. Defina sua senha para entrar.'
        : 'Identidade confirmada. Escolha uma nova senha.', false);
      document.getElementById('v19-invite-form').style.display = 'block';
    } catch (_) {
      pending = null;
      notify('O link expirou ou não pôde ser validado. Solicite outro convite ou recuperação.', true);
      showReturn();
    }
  }
  async function submitPassword(event) {
    event.preventDefault();
    if (!pending || !SUPA_CONFIGURADO) return;
    const p = document.getElementById('v19-invite-password');
    const confirm = document.getElementById('v19-invite-confirm');
    const save = document.getElementById('v19-invite-save');
    if (p.value.length < 12) { notify('Use pelo menos 12 caracteres na senha.', true); return; }
    if (p.value !== confirm.value) { notify('As senhas não coincidem.', true); return; }
    save.disabled = true;
    notify('Salvando senha…', false);
    try {
      // O JWT do link só pode alterar a própria conta via API Auth.
      const r = await fetch(SUPA_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + pending.accessToken,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ password: p.value }),
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'expired' : 'rejected');
      pending = null;
      if (typeof saveSession === 'function') saveSession(null);
      p.value = ''; confirm.value = '';
      document.getElementById('v19-invite-form').style.display = 'none';
      notify('Senha definida com sucesso. Entre com seu e-mail e a nova senha.', false);
      showReturn();
    } catch (e) {
      notify(e.message === 'expired'
        ? 'Link expirado. Solicite outro convite ou recuperação.'
        : 'Não foi possível salvar a senha. Verifique os requisitos e tente novamente.', true);
    } finally { save.disabled = false; }
  }

  window.v19HandleAuthCallback = function() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const search = new URLSearchParams(window.location.search);
    const callbackKeys = ['access_token', 'refresh_token', 'token_hash', 'error', 'error_code'];
    if (!callbackKeys.some(k => hash.has(k) || search.has(k))) return false;
    const kind = hash.get('type') || search.get('type') || '';
    const token = hash.get('access_token');
    // Remover qualquer credencial da URL antes de chamadas à rede.
    const clean = new URL(window.location.href);
    [...callbackKeys, 'code', 'error_description', 'type'].forEach(k => clean.searchParams.delete(k));
    window.history.replaceState(null, '', clean.pathname + clean.search);
    if (typeof saveSession === 'function') saveSession(null);
    buildPanel();
    goPage('pg-v19-invite');
    if ((kind === 'invite' || kind === 'recovery') && token) {
      pending = { kind, accessToken: token };
      verifyUser();
    } else {
      notify('Link inválido ou em formato não suportado. Solicite outro link.', true);
      showReturn();
    }
    return true;
  };
})();
