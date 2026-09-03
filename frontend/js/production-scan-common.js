(function(){
  const API=location.hostname==='127.0.0.1'?'http://127.0.0.1:3001':'http://localhost:3001'
  const token=localStorage.getItem('mowo_token')||''
  let buffer='',timer=null,busy=false
  function auth(json=false){return{Authorization:`Bearer ${token}`,...(json?{'Content-Type':'application/json'}:{})}}
  async function request(path,options={}){const res=await fetch(`${API}${path}`,{...options,headers:{...auth(!!options.body),...(options.headers||{})}});const data=await res.json().catch(()=>({success:false,message:'服务器返回内容无法读取'}));if(!res.ok||!data.success)throw new Error(data.message||'操作失败');return data.data}
  function esc(value){const d=document.createElement('div');d.textContent=value??'';return d.innerHTML}
  function toast(message,error=false){const el=document.getElementById('toast');if(!el)return;el.textContent=message;el.className=`toast${error?' error':''}`;el.style.display='block';clearTimeout(el._timer);el._timer=setTimeout(()=>el.style.display='none',2800)}
  function beep(kind=true){try{const ctx=new(window.AudioContext||window.webkitAudioContext)(),osc=ctx.createOscillator(),gain=ctx.createGain(),warning=kind==='warn';osc.frequency.value=warning?520:kind?880:190;gain.gain.value=.06;osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+(warning?0.14:kind?0.09:0.22))}catch{}}
  function classify(code){const value=String(code||'').trim().toUpperCase();if(value.startsWith('FP-'))return'FRAME';if(value.startsWith('KB-')||value.startsWith('LEGACY-KIT-'))return'KIT_BATCH';if(value.startsWith('BX-'))return'KIT_BOX';return'TRACKING'}
  function installScanner(handler){
    document.addEventListener('keydown',event=>{
      if(event.ctrlKey||event.altKey||event.metaKey)return
      const target=event.target,editable=target?.matches?.('input,textarea,select,[contenteditable="true"]')
      if(editable)return
      if(event.key==='Enter'){
        if(!buffer)return
        event.preventDefault();const code=buffer;buffer='';clearTimeout(timer)
        if(busy)return toast('上一条扫码仍在处理中',true)
        busy=true;Promise.resolve(handler(code,classify(code))).catch(error=>{toast(error.message||'扫码失败',true);beep(false)}).finally(()=>{busy=false})
        return
      }
      if(event.key.length===1){buffer+=event.key;clearTimeout(timer);timer=setTimeout(()=>buffer='',180)}
    })
  }
  async function ensureStaff(){try{const user=await fetchCurrentUser();if(!user?.staffRole)throw new Error();return user}catch{location.href='auth.html?redirect='+encodeURIComponent(location.pathname+location.search);return null}}
  function manual(id,handler){const input=document.getElementById(id);const run=()=>{const code=input.value.trim();if(code){Promise.resolve(handler(code,classify(code))).catch(error=>{toast(error.message||'操作失败',true);beep(false)});input.value=''}};input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run()}});return run}
  function formatTime(value){return value?new Date(value).toLocaleString('zh-CN'):'-'}
  window.MowoScan={API,token,auth,request,esc,toast,beep,classify,installScanner,ensureStaff,manual,formatTime}
})()
