/*
 * Aponte Iluminação V19 — Etapa 805
 * Apenas navegação visual mobile; nenhuma operação ou permissão alterada.
 */
(function(){
  'use strict';
  function iniciar(){
    const app=document.getElementById('pg-app');
    const menu=document.querySelector('#pg-app .sidebar');
    const abrir=document.getElementById('v19-mobile-menu-toggle');
    const fechar=document.getElementById('v19-mobile-nav-close');
    const fundo=document.getElementById('v19-mobile-nav-backdrop');
    if(!app||!menu||!abrir||!fechar||!fundo)return;
    const mq=window.matchMedia('(max-width:760px)');
    function fecharMenu(restaurarFoco){
      app.classList.remove('mobile-nav-open');
      abrir.setAttribute('aria-expanded','false');
      if(restaurarFoco&&mq.matches)abrir.focus();
    }
    function abrirMenu(){
      if(!mq.matches)return;
      app.classList.add('mobile-nav-open');
      abrir.setAttribute('aria-expanded','true');
      fechar.focus();
    }
    abrir.addEventListener('click',()=>{
      if(app.classList.contains('mobile-nav-open'))fecharMenu(true);
      else abrirMenu();
    });
    fechar.addEventListener('click',()=>fecharMenu(true));
    fundo.addEventListener('click',()=>fecharMenu(true));
    // Deixa os handlers existentes de cada item realizarem a navegação.
    menu.addEventListener('click',event=>{
      if(event.target.closest('.sbi,.sb-logout'))fecharMenu(false);
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&app.classList.contains('mobile-nav-open'))
        fecharMenu(true);
    });
    mq.addEventListener('change',()=>fecharMenu(false));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);
  else iniciar();
})();
