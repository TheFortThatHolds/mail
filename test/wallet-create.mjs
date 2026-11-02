import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const source=readFileSync(new URL("../worker.js",import.meta.url),"utf8");
const logs=[];
const context=vm.createContext({crypto:webcrypto,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,AbortSignal,atob,btoa,setTimeout,clearTimeout,WorkerEntrypoint:class{},console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
vm.runInContext(source.replace(/^import .*;$/gm,"").replace("export default {","const worker = {").replace("export class RiverMailPort","class RiverMailPort")+"\nglobalThis.api={worker,walletCreate,creationPassword,adminKey,setVerify(fn){imapVerify=fn;}};",context);
const {api}=context;
const input={addr:"fixture@example.test",name:"Fixture"};
function fixture(options={}){
  const map=new Map([["wallet_key",btoa("k".repeat(32))],["imapboxes",JSON.stringify(["other@example.test"])],["imap:other@example.test","unrelated-preserved"]]);
  for(let i=0;i<10000;i++)map.set("unrelated:"+i,"x");
  const calls=[];let mailbox=options.existing?settings():null;let password;let reads=0;
  function settings(){return {...input,address:input.addr,may_receive:true,may_send:true,may_access_imap:true,may_access_pop3:false,may_access_managesieve:false,is_internal:false,forwardings:[]};}
  context.fetch=async(url,init)=>{
    const {request}=JSON.parse(init.body);calls.push({method:request.method,url:request.url});
    let status=200,body;
    if(options.brokerDenied)return Response.json({authorized:false,status:403,body:{password:"must-not-escape"}});
    if(request.url.includes("/aliases/")){status=options.alias?200:404;body={};}
    else if(request.method==="GET"){status=mailbox?200:404;body=mailbox||{};}
    else if(request.method==="POST"){
      const p=JSON.parse(request.body);password=p.password;
      assert.equal(p.password_method,"password");assert.equal(p.local_part,"fixture");assert.equal(p.may_access_pop3,false);assert.equal(p.may_access_managesieve,false);assert.ok(!("forwarding_to" in p));assert.ok(!("password_recovery_email" in p));
      if(options.providerFailure){status=400;body={password};}
      else if(mailbox){status=400;body={error:"exists",password};}
      else{mailbox=settings();if(options.settingsDrift)mailbox.may_access_pop3=true;body={...mailbox,password};}
      if(options.lostReply){mailbox=settings();throw new Error(password);}
    }else assert.fail("destructive/update method");
    return Response.json({authorized:true,status,body});
  };
  api.setVerify(async(host,user,pw,opts)=>{assert.equal(host,"imap.migadu.com");assert.equal(user,input.addr);assert.ok(opts.timeoutMs<=8000);if(options.verifyThrows)throw new Error(pw);return {ok:!options.verifyFailure&&(!password||pw===password)};});
  const env={TRIGGER_KEY:"synthetic-admin",MIGADU_BROKER_URL:"https://broker.test",MIGADU_BROKER_REPO:"fixture/repo",MIGADU_BROKER_CARD:"fixture-card",TOKENS:{async get(k){reads++;return map.get(k)??null;},async put(k,v){map.set(k,v);},list(){assert.fail("unbounded scan");}}};
  return {env,map,calls,options,get reads(){return reads;},get password(){return password;},setMailbox(x){mailbox=x;}};
}
let checks=0;
async function check(name,fn){await fn();checks++;console.log("PASS "+name);}
const request=(headers={},body=input,method="POST",query="")=>new Request("https://mail.test/wallet-create"+query,{method,headers,...(method==="POST"?{body:JSON.stringify(body)}:{})});
await check("query and exact wallet bearer auth; reject missing/incorrect/missing configured key",async()=>{
  for(const [headers,query,expected] of [[{},"",401],[{authorization:"Bearer incorrect"},"",401],[{authorization:"Basic synthetic-admin"},"",401],[{authorization:"synthetic-admin"},"",401],[{authorization:"Bearer synthetic-admin"},"",200],[{},"?key=synthetic-admin",200]]){
    const f=fixture();const r=await api.worker.fetch(request(headers,input,"POST",query),f.env);assert.equal(r.status,expected);
    if(expected===401)assert.equal(f.reads,0);
  }
  const f=fixture();delete f.env.TRIGGER_KEY;assert.equal((await api.worker.fetch(request({authorization:"Bearer undefined"}),f.env)).status,401);
});
await check("POST only, bounded JSON, fail closed inputs",async()=>{
  const f=fixture();const auth={authorization:"Bearer synthetic-admin"};
  assert.equal((await api.worker.fetch(request(auth,input,"GET"),f.env)).status,405);
  assert.equal((await api.worker.fetch(request(auth,{name:"x".repeat(1100)}),f.env)).status,400);
  for(const p of [null,[],{}, {...input,password:"forbidden"},{...input,addr:"OTHER@example.test"},{...input,name:"bad\nname"},{...input,addr:"x@outside.test"}])assert.equal((await api.walletCreate(f.env,p)).ok,false);
  assert.equal(f.calls.length,0);
});
await check("existing provider mailbox and alias protected",async()=>{
  for(const options of [{existing:true},{alias:true}]){const f=fixture(options);assert.equal((await api.walletCreate(f.env,input)).ok,false);assert.ok(!f.calls.some(x=>x.method==="POST"));assert.ok(!f.map.has("create:"+input.addr));}
});
await check("existing FortMail credential protected",async()=>{
  const f=fixture();f.map.set("imap:"+input.addr,JSON.stringify({sealed:"existing"}));assert.equal((await api.walletCreate(f.env,input)).state,"already_connected");assert.equal(f.calls.length,0);
});
await check("successful creation sealed and indexed; bounded calls with large unrelated store",async()=>{
  const f=fixture();const out=await api.walletCreate(f.env,input);assert.equal(out.verified_imap,true);assert.equal(f.calls.length,4);assert.ok(f.reads<16);assert.equal(f.map.get("imap:other@example.test"),"unrelated-preserved");
  assert.deepEqual(JSON.parse(f.map.get("imapboxes")),["other@example.test",input.addr]);assert.equal(JSON.parse(f.map.get("create:"+input.addr)).state,"done");
  assert.ok(!JSON.stringify([...f.map.values(),out,logs]).includes(f.password));
});
await check("provider failure retains sealed state, no repeated create",async()=>{
  const f=fixture({providerFailure:true});assert.equal((await api.walletCreate(f.env,input)).state,"provider_unconfirmed");assert.ok(!f.map.has("imap:"+input.addr));assert.equal((await api.walletCreate(f.env,input)).state,"reconciliation_required");assert.equal(f.calls.filter(x=>x.method==="POST").length,1);assert.ok(!JSON.stringify([...f.map.values(),logs]).includes(f.password));
});
await check("verification failure retains pending state; replay verifies without reset",async()=>{
  const f=fixture({verifyFailure:true});assert.equal((await api.walletCreate(f.env,input)).state,"verify_failed");assert.ok(!f.map.has("imap:"+input.addr));f.options.verifyFailure=false;assert.equal((await api.walletCreate(f.env,input)).ok,true);assert.equal(f.calls.filter(x=>x.method==="POST").length,1);
});
await check("lost provider reply reconciles existing mailbox without repeated POST",async()=>{
  const f=fixture({lostReply:true});assert.equal((await api.walletCreate(f.env,input)).state,"provider_unconfirmed");assert.equal((await api.walletCreate(f.env,input)).ok,true);assert.equal(f.calls.filter(x=>x.method==="POST").length,1);
});
await check("done replay rechecks provider and IMAP; repairs missing index",async()=>{
  const f=fixture();await api.walletCreate(f.env,input);f.map.set("imapboxes",JSON.stringify(["other@example.test"]));assert.equal((await api.walletCreate(f.env,input)).ok,true);assert.ok(JSON.parse(f.map.get("imapboxes")).includes(input.addr));assert.equal(f.calls.filter(x=>x.method==="POST").length,1);
});
await check("settings drift and missing provider fail closed without reset",async()=>{
  const f=fixture({settingsDrift:true});assert.equal((await api.walletCreate(f.env,input)).state,"settings_unverified");assert.ok(!f.map.has("imap:"+input.addr));f.setMailbox(null);assert.equal((await api.walletCreate(f.env,input)).state,"reconciliation_required");assert.equal(f.calls.filter(x=>x.method==="POST").length,1);
});
await check("secret-free HTTP failure responses and no logs",async()=>{
  for(const opts of [{verifyThrows:true},{providerFailure:true},{brokerDenied:true}]){const f=fixture(opts);const r=await api.worker.fetch(request({authorization:"Bearer synthetic-admin"}),f.env);const body=await r.text();assert.ok(r.status>=400);if(f.password)assert.ok(!body.includes(f.password));assert.ok(!body.includes("must-not-escape"));assert.ok(!JSON.stringify([...f.map.values(),logs]).includes("must-not-escape"));}
  assert.equal(logs.length,0);
});
await check("concurrent initial attempts use identical strong password; no overwrite/reset",async()=>{
  const f=fixture();const a=await api.creationPassword(f.env,input.addr),b=await api.creationPassword(f.env,input.addr);assert.equal(a,b);assert.ok(a.length>=40);assert.notEqual(a,await api.creationPassword(f.env,"different@example.test"));
  const results=await Promise.all([api.walletCreate(f.env,input),api.walletCreate(f.env,input)]);assert.ok(results.some(x=>x.ok));assert.ok(!f.calls.some(x=>x.method==="PUT"||x.method==="DELETE"));assert.equal((await api.walletCreate(f.env,input)).ok,true);
});
console.log(`${checks} fixture checks passed; no live provider calls.`);
