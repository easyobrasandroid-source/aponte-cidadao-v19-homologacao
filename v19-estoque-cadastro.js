/* Aponte Cidadão V19 — ETAPA 561: cadastro de novos materiais por empresa.
   Apenas o próprio usuário de perfil Empresa pode cadastrar materiais.
   Master e Consórcio permanecem somente leitura. V18 intocada.
   A fonte autoritativa de empresa e consórcio é o usuário JWT na RPC. */
(function () {
  'use strict';

  const previousVEstoque=window.vEstoque;
  let renderVersion=0;
  const numberOk=n=>Number.isFinite(n) && n>=0 && n<=9999999999 &&
    Math.abs(Math.round(n*100)/100-n)<=1e-9;
  const validUUID=v=>typeof v==='string' &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  const displayMoney=n=>Number(n).toLocaleString('pt-BR',
    {minimumFractionDigits:2,maximumFractionDigits:2});
  function elem(tag, parent, text, style) {
    const el=document.createElement(tag);
    if(text!==null && text!==undefined)el.textContent=String(text);
    if(style)el.style.cssText=style;
    if(parent)parent.appendChild(el);
    return el;
  }

  window.vEstoque=function(body,title,actions) {
    const version=++renderVersion;
    previousVEstoque(body,title,actions);
    const role=CU?.perfil || '';
    const company=CU?.empresa_id || null;
    const consortium=CU?.consorcio_id || null;
    const identity=SB_SESSION?.user?.id || null;
    if(role!=='empresa'||!validUUID(company)||!validUUID(consortium)||!identity)return;

    // Somente a empresa ve o botão. O backend repete todas as verificacoes.
    const create=elem('button',actions,'+ Adicionar material',
      'background:#0f766e;color:#fff;border:0;border-radius:8px;' +
      'padding:9px 14px;font-weight:700;cursor:pointer;margin-left:8px;');
    create.type='button';

    const root=body.firstElementChild;
    if(!root)return;
    const editor=elem('section',null,null,
      'background:#fff;border:1px solid #d5e5df;border-radius:12px;' +
      'padding:16px;margin-bottom:12px;');
    editor.hidden=true;
    elem('h3',editor,'Cadastrar novo material da minha empresa',
      'font-size:15px;color:#0f172a;margin:0 0 6px;');
    elem('p',editor,
      'Este material será exclusivo da sua empresa, com quantidade inicial zero.' +
      ' Depois do cadastro, use Registrar entrada / saída para incluir unidades.',
      'font-size:12px;color:#64748b;margin:0 0 14px;');

    const form=elem('form',editor,null,
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));' +
      'gap:12px;align-items:end;');
    function field(labelText,type,init,placeholder,required) {
      const label=elem('label',form,null,
        'display:flex;flex-direction:column;gap:5px;' +
        'font-size:12px;font-weight:650;color:#334155;');
      elem('span',label,labelText);
      const input=elem('input',label,null,
        'min-width:0;width:100%;box-sizing:border-box;' +
        'padding:9px;border:1px solid #cbd5e1;border-radius:8px;');
      input.type=type;
      input.value=init;
      input.placeholder=placeholder;
      input.required=required;
      return input;
    }
    const name=field('Nome do material *','text','','Ex.: Lâmpada LED 50W',true);
    name.minLength=2;name.maxLength=120;
    const unit=field('Unidade *','text','Un.','Ex.: Un., kg, m, cx',true);
    unit.maxLength=20;
    const stockMin=field('Estoque mínimo','number','0','0',true);
    stockMin.min='0';stockMin.step='0.01';stockMin.max='9999999999';
    const price=field('Preço unitário (R$)','number','0','0.00',true);
    price.min='0';price.step='0.01';price.max='9999999999';
    const actionsRow=elem('div',form,null,
      'grid-column:1/-1;display:flex;flex-wrap:wrap;gap:10px;margin-top:2px;');
    const save=elem('button',actionsRow,'Conferir cadastro',
      'background:#0f766e;color:#fff;border:0;border-radius:8px;' +
      'padding:10px 14px;font-weight:700;cursor:pointer;');
    save.type='submit';
    const cancel=elem('button',actionsRow,'Cancelar',
      'border:1px solid #cbd5e1;background:#fff;color:#334155;' +
      'border-radius:8px;padding:10px 14px;cursor:pointer;');
    cancel.type='button';
    const info=elem('p',editor,
      'O cadastro não transferirá materiais nem saldos de outras empresas.',
      'font-size:12px;color:#64748b;margin:10px 0 0;');

    // O formulário e renderizado acima do restante da consulta.
    root.insertBefore(editor,root.firstChild);

    const stillActive=()=>version===renderVersion &&
      SB_SESSION?.user?.id===identity &&
      CU?.perfil==='empresa' &&
      CU?.empresa_id===company && CU?.consorcio_id===consortium &&
      title.textContent==='Controle de estoque' &&
      body.contains(editor);
    create.addEventListener('click',()=>{
      if(!stillActive())return;
      editor.hidden=!editor.hidden;
      if(!editor.hidden)name.focus();
    });
    cancel.addEventListener('click',()=>{editor.hidden=true;});

    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(form.dataset.sent==='1'||!stillActive())return;

      const nome=String(name.value||'').trim();
      const unidade=String(unit.value||'').trim();
      const minimo=Number(stockMin.value);
      const preco=Number(price.value);
      if(nome.length<2||nome.length>120||unidade.length<1||unidade.length>20 ||
        stockMin.value===''||price.value===''||!numberOk(minimo)||!numberOk(preco)) {
        info.textContent='Informe nome de 2 a 120 caracteres, unidade de 1 a 20' +
          ' e números não negativos com até duas casas decimais.';
        info.style.color='#b91c1c';
        return;
      }
      const confirmed=window.confirm(
        'Cadastrar novo material EXCLUSIVO para a sua empresa?' +
        '\nMaterial: '+nome+' ('+unidade+')'+
        '\nEstoque mínimo: '+minimo+
        '\nPreço unitário: R$ '+displayMoney(preco)+
        '\nQuantidade inicial: zero'+
        '\nA operação será gravada no Supabase V19.'
      );
      if(!confirmed)return;
      // Revalidar depois da confirmacao: a sessao pode ter mudado.
      if(!stillActive())return;
      form.dataset.sent='1';
      save.disabled=true;
      cancel.disabled=true;
      info.style.color='#64748b';
      info.textContent='Criando material exclusivo na empresa…';

      try {
        const response=await sbFetch('rpc/v19_criar_material_empresa','POST',{
          p_nome:nome,p_unidade:unidade,
          p_estoque_minimo:minimo,p_preco_unitario:preco
        });
        if(response?.ok!==true||!validUUID(response.material_id) ||
           !validUUID(response.estoque_id)||response.empresa_id!==company ||
           response.consorcio_id!==consortium ||
           Number(response.quantidade_contratada)!==0 ||
           Number(response.quantidade_disponivel)!==0) {
          throw new Error('Resposta não confirmada. Confira o cadastro no estoque.');
        }
        if(stillActive())window.vEstoque(body,title,actions);
      }catch(error) {
        // Falhas de rede podem ocorrer APOS o commit: nunca reenviar
        // automaticamente nem liberar o mesmo formulario para duplo envio.
        if(stillActive()){
          info.style.color='#b91c1c';
          info.textContent='Cadastro sem confirmação: '+
            (error?.message||'Erro de comunicação.')+
            ' Atualize a consulta e confira antes de tentar cadastrar novamente.';
          create.focus();
        }
      }
    });
  };
})();
