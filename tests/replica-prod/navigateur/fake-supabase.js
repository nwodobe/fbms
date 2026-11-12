/* Client Supabase de TEST (navigateur) : renvoie les résultats calculés par la réplique isolée. */
(function(){
  const F = window.__FIX__ || {};
  const rows = {
    profils: {role:'Branch Manager',nom:'BM FICTIF',actif:true},
    campaigns: [{id:'c0000000-0000-4000-8000-00000000000a',code:'0002',status:'OPEN',is_current:true},{id:'c0000000-0000-4000-8000-00000000000b',code:'2027',status:'OPEN',is_current:false}],
    rt: [{id:'RT-A1',nom:'RT A1 FICTIF',cluster:'CLUSTER-A',village_id:'V-A1',village_nom:'VILLAGE A1',deleted:false}]
  };
  function q(t){ const b={_single:false};
    ['select','eq','is','order','limit','in'].forEach(m=>b[m]=()=>b);
    b.maybeSingle=()=>{b._single=true;return b;};
    b.then=(res,rej)=>{ let d = F[t]!==undefined?F[t]:(rows[t]!==undefined?rows[t]:[]);
      if(b._single && Array.isArray(d)) d=d[0]||null; if(!b._single && d && !Array.isArray(d)) d=[d];
      return Promise.resolve({data:d,error:null}).then(res,rej); };
    return b; }
  window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'a0000000-0000-4000-8000-000000000001',email:'bm@test.invalid'}},error:null})},
    from:q, rpc:async(n,a)=>{(window.__RPC__=window.__RPC__||[]).push(n);return {data:{ok:true},error:null};},
    storage:{from:()=>({upload:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:'#'},error:null})})}})};
})();
