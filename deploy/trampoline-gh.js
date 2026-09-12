export default {
  async fetch() {
    const ACCOUNT = "eda7ec96bd3ba7a54851d552fcbd24e0";
    const PUT = "https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/workers/scripts/fort-mail/content";
    const BROKER = "https://card.thefortthatholds.com/agent/use";
    const CARD = "card_7e3fe991";
    const REPO = "TheFortThatHolds/fort-central-config";
    const SRC = "https://raw.githubusercontent.com/TheFortThatHolds/mail/cursor/filename-attach-lookup-ee61/deploy/fort-mail.filename.js";
    async function broker(req){
      const r = await fetch(BROKER,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:REPO,card:CARD,request:req})});
      const text = await r.text();
      let j; try{j=JSON.parse(text);}catch{j={raw:text.slice(0,800)};}
      return {http:r.status,j};
    }
    try {
      const srcR = await fetch(SRC,{headers:{"user-agent":"fort-mail-fn-put"}});
      const script = await srcR.text();
      if(!srcR.ok || !script.includes("gmailFindPartByFilename") || !script.includes("MailSteward") || !script.includes("get_attachment")){
        return Response.json({ok:false,error:"bad script",status:srcR.status,length:script.length,head:script.slice(0,200)}, {status:500});
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
