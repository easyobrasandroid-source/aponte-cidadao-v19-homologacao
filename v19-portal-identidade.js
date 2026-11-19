/* Aponte Cidadão V19 — identidade visual SOMENTE na abertura pública.
   Configuração puramente visual; não altera rede, URLs, sessão ou banco.
   Chaves dos dois consórcios consultadas na base V19 em 19/11/2026. */
(function () {
  'use strict';
  const ID_CISCAPARAO = '8fb9ffc2-9b36-43d2-8809-c6f26a943db3';
  const ID_CISVERDE = '73cc692f-d184-488c-b289-b73f774a303d';
  const logoCiscaparao = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="cap-blue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#03a0e3"/><stop offset="1" stop-color="#074e9d"/></linearGradient>
      <linearGradient id="cap-red" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ea2925"/><stop offset="1" stop-color="#ad1c2b"/></linearGradient>
      <linearGradient id="cap-green" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#008a47"/><stop offset="1" stop-color="#076521"/></linearGradient>
    </defs>
    <path d="M40 2 74 22 56 32 40 22 23 32 6 22Z" fill="url(#cap-blue)"/>
    <path d="M74 22V58L40 78V58L56 48V32Z" fill="url(#cap-red)"/>
    <path d="M40 78 6 58V22L23 32V48L40 58Z" fill="url(#cap-green)"/>
  </svg>`;
  // Símbolo vetorializado da referência institucional enviada para CIS-VERDE.
  const logoCisverde = `<svg viewBox="0 0 162 148" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <path fill="#fff" fill-rule="evenodd" d="M84,6 77,11 74,18 75,26 82,33 81,34 79,34 69,28 58,16 53,15 47,19 46,25 54,40 56,47 56,53 55,54 52,47 48,43 43,41 34,42 28,47 26,51 26,60 31,67 38,70 42,70 48,67 50,68 41,77 33,81 28,82 25,85 24,91 26,95 31,98 42,95 60,96 61,97 60,98 55,98 49,101 45,107 44,114 48,123 56,127 61,127 66,125 71,120 73,116 73,109 72,108 73,106 79,117 81,134 84,137 90,138 96,134 98,116 104,106 105,107 104,116 108,123 112,126 122,127 130,122 133,115 132,107 126,100 121,98 117,98 116,97 117,96 135,95 142,98 147,98 152,94 153,92 152,85 146,81 137,78 127,69 128,67 134,70 140,70 145,68 150,63 152,58 152,54 150,48 145,43 135,41 127,45 122,55 121,54 122,43 127,32 131,27 131,20 127,16 123,15 120,16 106,30 94,35 93,34 97,32 102,26 103,23 102,14 97,8 93,6Z M72,50 74,49 85,52 93,52 104,49 106,63 114,80 108,82 98,88 89,98 78,87 67,81 64,81 63,79 71,64Z"/>
  </svg>`;
  const consorcios = Object.freeze({
    [ID_CISCAPARAO]: Object.freeze({
      nome:'CISCAPARAÓ',
      subtitulo:'Consórcio Intermunicipal Multissetorial do Entorno do Caparaó',
      classe:'ciscaparao',
      logo:logoCiscaparao
    }),
    [ID_CISVERDE]: Object.freeze({
      nome:'CIS-VERDE',
      subtitulo:'Consórcio Intermunicipal Multifinalitário',
      classe:'cisverde',
      logo:logoCisverde
    })
  });

  function aplicarIdentidade() {
    const id = new URLSearchParams(window.location.search).get('consorcio_id');
    const marca = consorcios[id];
    const pagina = document.getElementById('pg-portal');
    const cabecalho = document.getElementById('v19-portal-marca');
    if (!pagina || !cabecalho) return;
    if (!marca) {
      cabecalho.hidden = true;
      pagina.removeAttribute('data-v19-consorcio');
      return;
    }
    const titulo = document.getElementById('v19-portal-marca-titulo');
    const subtitulo = document.getElementById('v19-portal-marca-subtitulo');
    const simbolo = document.getElementById('v19-portal-marca-simbolo');
    if (!titulo || !subtitulo || !simbolo) return;

    titulo.textContent = marca.nome;
    subtitulo.textContent = marca.subtitulo;
    // Apenas SVG de constantes fixas, nunca conteúdo retornado do servidor.
    simbolo.innerHTML = marca.logo;
    pagina.setAttribute('data-v19-consorcio', marca.classe);
    cabecalho.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aplicarIdentidade, {once:true});
  } else {
    aplicarIdentidade();
  }
})();