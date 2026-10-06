/* Tela de login */
(function(){
  var sb=window.__sb, ov=document.getElementById("loginOv"), msg=document.getElementById("lgMsg");
  function entrar(){ ov.classList.add("hidden"); window.__resolveAuth(); }
  if(!window.__cfgOk){ document.getElementById("lgForm").classList.add("hidden"); msg.innerHTML="⚙️ Falta configurar a conexão. Preencha o arquivo <b>config.js</b> com o endereço e a chave do Supabase e publique de novo."; return; }
  sb.auth.getSession().then(function(r){ if(r.data&&r.data.session){ entrar(); } else ov.classList.remove("hidden"); });
  document.getElementById("lgForm").addEventListener("submit",async function(e){ e.preventDefault(); msg.textContent="Entrando…";
    var r=await sb.auth.signInWithPassword({email:document.getElementById("lgEmail").value.trim(),password:document.getElementById("lgSenha").value});
    if(r.error){ msg.textContent=/Invalid login/i.test(r.error.message)?"E-mail ou senha incorretos.":"Não foi possível entrar: "+r.error.message; return; }
    msg.textContent=""; entrar(); });
  document.getElementById("lgEsqueci").addEventListener("click",async function(e){ e.preventDefault(); var em=document.getElementById("lgEmail").value.trim(); if(!em){ msg.textContent="Digite seu e-mail acima e clique de novo."; return; }
    var r=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname}); msg.textContent=r.error?"Não consegui enviar: "+r.error.message:"Enviamos um link de nova senha para o seu e-mail."; });
  sb.auth.onAuthStateChange(function(ev){ if(ev==="PASSWORD_RECOVERY"){ var n=prompt("Digite a nova senha (mínimo 6 caracteres):"); if(n) sb.auth.updateUser({password:n}).then(function(r){ alert(r.error?"Erro: "+r.error.message:"Senha alterada!"); }); } });
})();
