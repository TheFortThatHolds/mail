export default {
  async fetch() {
    const NS = "1710a5020c3c440882d1d88c0f8a732f";
    const PREFIX = "fortmail-fn-patch-20260912";
    const ACCOUNT = "eda7ec96bd3ba7a54851d552fcbd24e0";
    const PUT = "https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/workers/scripts/fort-mail/content";
    const BROKER = "https://card.thefortthatholds.com/agent/use";
    const CARD = "card_7e3fe991";
    const REPO = "TheFortThatHolds/fort-central-config";
    async function broker(req){
      const r = await fetch(BROKER,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:REPO,card:CARD,request:req})});
      const text = await r.text();
      let j; try{j=JSON.parse(text);}catch{j={raw:text.slice(0,500)};}
      return {http:r.status,j};
    }
    try {
      const metaR = await broker({url:`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS}/values/${PREFIX}:meta`,method:"GET"});
      const metaBody = metaR.j && (metaR.j.body || metaR.j);
      const meta = typeof metaBody === "string" ? JSON.parse(metaBody) : metaBody;
      if(!meta || !meta.n) return Response.json({ok:false,error:"no meta",metaR}, {status:500});
      const parts = [];
      for(let i=0;i<meta.n;i++){
        const key = `${PREFIX}:c${String(i).padStart(2,"0")}`;
        const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS}/values/${key}`;
        const rr = await broker({url,method:"GET"});
        const b = rr.j && (rr.j.body !== undefined ? rr.j.body : rr.j);
        if(typeof b !== "string" || b.length < 8) return Response.json({ok:false,error:"bad chunk",i,rr}, {status:500});
        parts.push(b);
      }
      const b64 = parts.join("");
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const script = new TextDecoder().decode(bin);
      if(!script.includes("gmailFindPartByFilename") || !script.includes("get_attachment")){
        return Response.json({ok:false,error:"bad script",length:script.length,head:script.slice(0,120)}, {status:500});
      }
      const b = "FortMailFnAttach9";
      const mp = "--"+b+"\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{\"main_module\":\"worker.js\"}\r\n--"+b+"\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n"+script+"\r\n--"+b+"--\r\n";
      const put = await broker({url:PUT,method:"PUT",headers:{"Content-Type":"multipart/form-data; boundary="+b},body:mp});
      const success = !!(put.j && (put.j.status===200 || (put.j.body && put.j.body.success)));
      return Response.json({ok:success, source_bytes:script.length, hasFilename:true, put});
    } catch(e) {
      return Response.json({ok:false,error:String((e&&e.message)||e)}, {status:500});
    }
  }
};
