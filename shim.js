/* Gestor Financeiro MD — versão web: conexão com o Supabase */
(function(){
  var C=window.GESTOR_CONFIG||{};
  var ok=C.SUPABASE_URL&&C.SUPABASE_ANON_KEY&&!/COLE_AQUI/.test(C.SUPABASE_URL+C.SUPABASE_ANON_KEY);
  var sb=(ok&&window.supabase)? window.supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}}) : null;
  window.__sb=sb; window.__cfgOk=!!sb;
  var resolveAuth; var authReady=new Promise(function(r){resolveAuth=r;}); window.__authReady=authReady; window.__resolveAuth=function(){ resolveAuth(); };
  var P="empresa", BUCKET="comprovantes";
  function E(code,msg){ var e=new Error(msg||code); e.code=code; return e; }
  function net(m){ return /fetch|network|timeout|Failed/i.test(m||""); }
  var db={ collection:function(){ return {
    get:async function(){ var r=await sb.from("docs").select("id,data").eq("path",P); if(r.error) throw E(net(r.error.message)?"unavailable":"read_failed",r.error.message);
      return {empty:!r.data.length,docs:r.data.map(function(x){return {id:x.id,data:function(){return x.data;}};})}; },
    doc:function(id){ return { set:async function(d){ var r=await sb.from("docs").upsert({path:P,id:id,data:d,updated_at:new Date().toISOString()}); if(r.error) throw E(net(r.error.message)?"unavailable":"write_failed",r.error.message); } }; },
    onSnapshot:function(next,onErr){
      var ch=sb.channel("docs-"+P).on("postgres_changes",{event:"*",schema:"public",table:"docs",filter:"path=eq."+P},function(pl){
        var row=(pl.new&&pl.new.id)? pl.new : pl.old; if(!row||!row.id) return;
        var type=pl.eventType==="DELETE"?"removed":pl.eventType==="INSERT"?"added":"modified";
        next({docChanges:function(){ return [{type:type,doc:{id:row.id,data:function(){ return pl.new? pl.new.data : null; }}}]; }});
      }).subscribe(function(st){ if((st==="CHANNEL_ERROR"||st==="TIMED_OUT")&&onErr) onErr(E("unavailable")); });
      return function(){ sb.removeChannel(ch); }; }
  }; } };
  var user={ id:async function(){ await authReady; return P; } };
  function hex32(){ var a=new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(function(b){return b.toString(16).padStart(2,"0");}).join(""); }
  var assets={
    upload:async function(blob,o){ var id=hex32(), type=(o&&o.type)||blob.type||"application/octet-stream";
      var r=await sb.storage.from(BUCKET).upload(id,blob,{contentType:type,upsert:false});
      if(r.error) throw E(/size|large/i.test(r.error.message)?"too_large":/mime|type/i.test(r.error.message)?"unsupported_type":"upstream_error",r.error.message);
      return {id:id,url:"",sizeBytes:blob.size,contentType:type}; },
    delete:async function(ref){ var id=String(ref).replace(/^.*\//,""); var r=await sb.storage.from(BUCKET).remove([id]); return {deleted:!r.error}; },
    list:async function(){ return {assets:[]}; }
  };
  var downloads={ save:async function(req){ var u=URL.createObjectURL(req.data), a=document.createElement("a"); a.href=u; a.download=req.filename||"arquivo"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(u);},60000); return {saved:true}; } };
  window.claude={ use:async function(n){
    if(n==="downloads") return downloads;
    if(!sb) return null;
    if(n==="db"||n==="user"||n==="assets"){ await authReady; return n==="db"?db:n==="user"?user:assets; }
    return null; } };
  // comprovantes e logo guardados no Supabase
  var cache={};
  window.__blobFetch=async function(id){ if(!sb) return new Response("",{status:404}); var r=await sb.storage.from(BUCKET).download(id); if(r.error) return new Response("",{status:404}); return new Response(r.data,{headers:{"Content-Type":r.data.type||""}}); };
  function urlDe(id){ if(cache[id]) return cache[id]; cache[id]=window.__blobFetch(id).then(function(r){ return r.ok? r.blob().then(function(b){ return URL.createObjectURL(b); }) : ""; }); return cache[id]; }
  function hidratar(root){ (root.querySelectorAll? root.querySelectorAll("[data-blob]") : []).forEach(function(el){ if(el.dataset.blobOk===el.dataset.blob) return; el.dataset.blobOk=el.dataset.blob; urlDe(el.dataset.blob).then(function(u){ if(u) el.src=u; }); }); }
  new MutationObserver(function(ms){ ms.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n.nodeType===1){ if(n.dataset&&n.dataset.blob) hidratar(n.parentNode||document); hidratar(n); } }); }); }).observe(document.documentElement,{childList:true,subtree:true});
})();
