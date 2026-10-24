/* Calculadora Nutricional Clínica · capa local para la app instalable.
   Reemplaza el almacenamiento de Claude por IndexedDB en el teléfono y entrega
   archivos (PDF y respaldo) por el menú Compartir del sistema.
   Los datos nunca salen del dispositivo salvo que el usuario los comparta. */
(function(){
  const DB_NAME='calcnutri', STORE='docs', LS_BACKUP='calcnutri.lastBackup';
  let dbp=null;
  function openDb(){
    if(dbp) return dbp;
    dbp=new Promise((res,rej)=>{
      if(!('indexedDB' in window)) return rej(new Error('IndexedDB no disponible'));
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess=()=>res(r.result);
      r.onerror=()=>rej(r.error);
    });
    return dbp;
  }
  function tx(mode,fn){
    return openDb().then(db=>new Promise((res,rej)=>{
      const t=db.transaction(STORE,mode), s=t.objectStore(STORE);
      let out; Promise.resolve(fn(s)).then(v=>{ out=v; });
      t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error);
    }));
  }
  const reqP=r=>new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  function allDocs(){
    return tx('readonly',s=>new Promise((res,rej)=>{
      const out=[], c=s.openCursor();
      c.onsuccess=()=>{ const cur=c.result; if(cur){ out.push({id:String(cur.key),v:cur.value}); cur.continue(); } else res(out); };
      c.onerror=()=>rej(c.error);
    }));
  }
  const listeners=new Set();
  async function emit(){
    let rows; try{ rows=await allDocs(); }catch(e){ listeners.forEach(l=>l.err&&l.err(e)); return; }
    const snap={docs:rows.map(r=>({id:r.id,data:()=>r.v}))};
    listeners.forEach(l=>{ try{ l.cb(snap); }catch(e){ console.error(e); } });
    try{ window.dispatchEvent(new Event('localdata')); }catch(e){}
  }
  function doc(id){
    id=String(id);
    return {
      set:obj=>tx('readwrite',s=>{ s.put(JSON.parse(JSON.stringify(obj)),id); }).then(emit),
      update:obj=>tx('readwrite',s=>reqP(s.get(id)).then(old=>{ s.put(Object.assign({},old||{},JSON.parse(JSON.stringify(obj))),id); })).then(emit),
      delete:()=>tx('readwrite',s=>{ s.delete(id); }).then(emit)
    };
  }
  const collection={
    doc,
    onSnapshot(cb,err){ const l={cb,err}; listeners.add(l); emit(); return ()=>listeners.delete(l); }
  };

  // Entrega de archivos: menú Compartir del teléfono; si no existe, descarga directa.
  async function deliver(filename,data,type){
    const blob=data instanceof Blob?data:new Blob([data],{type});
    try{
      const file=new File([blob],filename,{type});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:filename});
        return true;
      }
    }catch(e){ if(e && e.name==='AbortError'){ const x=new Error('cancelado'); x.code='declined'; throw x; } }
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    return true;
  }
  const typeOf=n=>/\.pdf$/i.test(n)?'application/pdf':/\.json$/i.test(n)?'application/json':'application/octet-stream';

  window.claude={
    use: async name=>{
      if(name==='db'){ await openDb(); return {collection:()=>collection}; }
      if(name==='user') return {id:async()=>'local'};
      if(name==='downloads') return {save:({filename,data})=>deliver(filename,data,typeOf(filename))};
      return null;
    }
  };

  // ---------- Respaldo de datos ----------
  const stamp=()=>{ const d=new Date(), p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); };
  async function exportBackup(){
    const rows=await allDocs();
    const payload={app:'calcnutri',formato:1,exportado:new Date().toISOString(),docs:rows};
    await deliver('respaldo-calcnutri-'+stamp()+'.json',JSON.stringify(payload),'application/json');
    try{ localStorage.setItem(LS_BACKUP,new Date().toISOString()); }catch(e){}
    return rows.length;
  }
  async function importBackup(file,replace){
    const txt=await file.text(); let o;
    try{ o=JSON.parse(txt); }catch(e){ throw new Error('El archivo no es un respaldo válido.'); }
    if(!o || o.app!=='calcnutri' || !Array.isArray(o.docs)) throw new Error('El archivo no es un respaldo de esta app.');
    await tx('readwrite',s=>{ if(replace) s.clear(); o.docs.forEach(r=>{ if(r && r.id!=null && r.v && typeof r.v==='object') s.put(r.v,String(r.id)); }); });
    await emit();
    return o.docs.length;
  }
  function lastBackup(){ try{ return localStorage.getItem(LS_BACKUP); }catch(e){ return null; } }
  window.LOCALBACKUP={exportBackup,importBackup,lastBackup,count:()=>allDocs().then(r=>r.length)};

  // Persistencia: pide al navegador no borrar los datos por falta de espacio.
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
  // Service worker para uso sin conexión.
  if('serviceWorker' in navigator && location.protocol!=='file:') window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
