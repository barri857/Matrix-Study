import {z} from 'zod';
import {aiRequestSchema,runAI,SafeError,MAX_AI_REQUEST_BYTES} from '../lib/ai';
import {body,errorResponse,idSchema,json,kitSchema,sameOrigin} from '../app/api/_shared';
import {createAuth,getAuthConfig,getUser,type AuthEnv} from './auth';
import {workspaceSchema} from './workspace-schema';

interface Env extends AuthEnv {ASSETS:Fetcher}
const methods:Record<string,string[]>={'/api/library':['GET','POST','DELETE'],'/api/workspace':['GET','PUT'],'/api/share':['GET','POST'],'/api/ai':['POST'],'/api/account-config':['GET']};

async function limitedAuthRequest(request:Request){
  if(!request.body)return request;
  const limit=16384;
  if(Number(request.headers.get('content-length')||0)>limit)throw new SafeError('This account request is too large.',413);
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit){await reader.cancel();throw new SafeError('This account request is too large.',413)}chunks.push(next.value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return new Request(request,{body:bytes});
}

async function api(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/api/auth/'))return createAuth(env).handler(await limitedAuthRequest(request));
  if(!methods[path])return json({error:'This page could not be found.'},404);
  if(!methods[path].includes(request.method))return json({error:'This action is not supported.'},405);
  if(path==='/api/account-config')return json(getAuthConfig(env));
  if(path==='/api/ai')return json(await runAI(aiRequestSchema.parse(await body(request,MAX_AI_REQUEST_BYTES))));
  if(path==='/api/share'&&request.method==='GET'){
    const id=z.string().uuid().parse(url.searchParams.get('id'));
    const row=await env.DB.prepare('SELECT data FROM kits WHERE share_id=?').bind(id).first<{data:string}>();
    if(!row)throw new SafeError('This shared kit is unavailable or its owner has stopped sharing it.',404);
    const saved=kitSchema.parse(JSON.parse(row.data));
    return json({kit:{...saved,id:crypto.randomUUID(),demo:false,history:[],createdAt:Date.now(),updatedAt:Date.now(),cards:saved.cards.map(({id,front,back})=>({id,front,back}))}});
  }
  const user=await getUser(request,env);
  if(path==='/api/library'&&request.method==='GET'){
    if(!user)return json({user:null,kits:[]});
    const {results}=await env.DB.prepare('SELECT data,share_id FROM kits WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100').bind(user.userId).all<{data:string;share_id:string|null}>();
    return json({user:{id:user.userId,name:user.displayName},kits:results.map(r=>({...JSON.parse(r.data),shareId:r.share_id}))});
  }
  if(path==='/api/workspace'&&request.method==='GET'){
    if(!user)return json({authenticated:false,data:null});
    const row=await env.DB.prepare('SELECT data FROM workspaces WHERE owner_id=?').bind(user.userId).first<{data:string}>();
    return json({authenticated:true,data:row?JSON.parse(row.data):null});
  }
  sameOrigin(request);
  if(!user)throw new SafeError('Sign in to save your workspace across devices.',401);
  if(path==='/api/library'){
    if(request.method==='DELETE'){
      const id=idSchema.parse(url.searchParams.get('id'));
      await env.DB.prepare('DELETE FROM kits WHERE owner_id=? AND id=?').bind(user.userId,id).run();
      return json({deleted:true});
    }
    const input=await body(request) as {kit?:unknown},kit=kitSchema.parse(input?.kit),data=JSON.stringify(kit);
    if(new TextEncoder().encode(data).byteLength>500000)throw new SafeError('Keep this kit under 500 KB to sync it.',413);
    const bytes=new TextEncoder().encode(data).byteLength;
    const existingBytes=await env.DB.prepare('SELECT coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM kits WHERE owner_id=? AND id<>?').bind(user.userId,kit.id).first<{bytes:number}>();
    if((existingBytes?.bytes||0)+bytes>8000000)throw new SafeError('Your cloud library has reached its 8 MB storage limit. Export and remove an unused kit to make room.',409);
    await env.DB.prepare(`INSERT INTO kits(owner_id,id,data,updated_at) SELECT ?,?,?,?
      WHERE ((SELECT COUNT(*) FROM kits WHERE owner_id=?)<100 OR EXISTS(SELECT 1 FROM kits WHERE owner_id=? AND id=?))
      AND (SELECT coalesce(sum(length(CAST(data AS BLOB))),0) FROM kits WHERE owner_id=? AND id<>?)+?<=8000000
      ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE excluded.updated_at>=kits.updated_at`)
      .bind(user.userId,kit.id,data,kit.updatedAt,user.userId,user.userId,kit.id,user.userId,kit.id,bytes).run();
    const saved=await env.DB.prepare('SELECT data,share_id FROM kits WHERE owner_id=? AND id=?').bind(user.userId,kit.id).first<{data:string;share_id:string|null}>();
    if(!saved)throw new SafeError('Your cloud library holds 100 kits. Remove a kit before adding another.',409);
    return json({kit:{...JSON.parse(saved.data),shareId:saved.share_id}});
  }
  if(path==='/api/workspace'){
    const input=await body(request,310000) as {data?:unknown},workspace=workspaceSchema.parse(input?.data),data=JSON.stringify(workspace);
    if(new TextEncoder().encode(data).byteLength>300000)throw new SafeError('Keep your workspace under 300 KB to sync it.',413);
    await env.DB.prepare(`INSERT INTO workspaces(owner_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE excluded.updated_at>=workspaces.updated_at`).bind(user.userId,data,workspace.updatedAt).run();
    const row=await env.DB.prepare('SELECT data FROM workspaces WHERE owner_id=?').bind(user.userId).first<{data:string}>();
    return json({authenticated:true,data:row?JSON.parse(row.data):workspace});
  }
  const input=z.object({id:idSchema,enabled:z.boolean()}).parse(await body(request,2000));
  const saved=await env.DB.prepare('UPDATE kits SET share_id=CASE WHEN ? THEN coalesce(share_id,?) ELSE NULL END WHERE owner_id=? AND id=? RETURNING share_id').bind(input.enabled?1:0,crypto.randomUUID(),user.userId,input.id).first<{share_id:string|null}>();
  if(!saved)throw new SafeError('Save this kit to your cloud library before sharing it.',404);
  return json({shareId:saved.share_id});
}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    let response:Response;
    try{response=new URL(request.url).pathname.startsWith('/api/')?await api(request,env):await env.ASSETS.fetch(request)}catch(error){response=errorResponse(error)}
    const result=new Response(response.body,response);
    result.headers.set('X-Content-Type-Options','nosniff');
    result.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    result.headers.set('X-Frame-Options','DENY');
    result.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(new URL(request.url).pathname.startsWith('/api/'))result.headers.set('Cache-Control','no-store');
    return result;
  }
} satisfies ExportedHandler<Env>;
