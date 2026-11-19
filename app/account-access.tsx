'use client';
import {useEffect,useState,type FormEvent} from 'react';

export const independentMatrix=process.env.NEXT_PUBLIC_MATRIX_INDEPENDENT==='true';
export default function AccountAccess({signedIn,notify}:{signedIn:boolean;notify:(message:string,error?:boolean)=>void}){
  const [mode,setMode]=useState<'signin'|'signup'>('signin'),[name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[googleReady,setGoogleReady]=useState(false);
  useEffect(()=>{if(independentMatrix)fetch('/api/account-config').then(r=>r.ok?r.json():null).then(c=>setGoogleReady(!!(c as {googleReady?:boolean}|null)?.googleReady)).catch(()=>{})},[]);
  async function auth(path:string,data:unknown){
    const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json() as {message?:string;url?:string;error?:{message?:string}};
    if(!response.ok)throw new Error(result.message||result.error?.message||'We could not sign you in. Please try again.');
    return result;
  }
  async function submit(e:FormEvent){e.preventDefault();setPending(true);setError('');try{
    await auth(mode==='signup'?'sign-up/email':'sign-in/email',{email,password,...(mode==='signup'?{name}:{}),callbackURL:'/'});
    location.reload();
  }catch(e){setError(e instanceof Error?e.message:'Could not sign in.');setPending(false)}}
  async function google(){setPending(true);setError('');try{const data=await auth('sign-in/social',{provider:'google',callbackURL:'/',errorCallbackURL:'/?auth=failed'});if(!data.url)throw new Error('Google sign-in is not available yet.');const target=new URL(data.url);if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw new Error('Unexpected sign-in destination.');location.assign(target.href)}catch(e){setError(e instanceof Error?e.message:'Could not connect to Google.');setPending(false)}}
  if(!independentMatrix)return <a className={`button ${signedIn?'secondary':'primary'}`} href={signedIn?'/signout-with-chatgpt?return_to=/':'/signin-with-chatgpt?return_to=/'} target="_top">{signedIn?'Sign out':'Sign in with ChatGPT'}</a>;
  if(signedIn)return <button className="button secondary" disabled={pending} onClick={async()=>{setPending(true);try{await auth('sign-out',{});location.reload()}catch(e){setPending(false);notify(e instanceof Error?e.message:'Could not sign out.',true)}}}>{pending?'Signing out…':'Sign out'}</button>;
  return <div className="matrix-account-access"><div className="tabs"><button className={`tab ${mode==='signin'?'active':''}`} onClick={()=>{setMode('signin');setError('')}}>Sign in</button><button className={`tab ${mode==='signup'?'active':''}`} onClick={()=>{setMode('signup');setError('')}}>Create account</button></div>
    <button className="button secondary" onClick={google} disabled={pending||!googleReady} style={{width:'100%',margin:'18px 0 8px'}}>Continue with Google</button>
    {!googleReady&&<p className="muted tiny">Google sign-in is awaiting the owner’s Google setup. Email accounts are available now.</p>}
    <form onSubmit={submit}>
      {mode==='signup'&&<label className="field">Your name<input className="input" required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>}
      <label className="field">Email<input className="input" type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label className="field">Password<input className="input" type="password" required minLength={mode==='signup'?12:1} maxLength={128} autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {mode==='signup'&&<p className="muted tiny">Use at least 12 characters and save your password. Email verification and password-reset emails are not enabled yet.</p>}
      {error&&<p role="alert" className="notice">{error}</p>}
      <button className="button primary" type="submit" disabled={pending}>{pending?'Please wait…':mode==='signup'?'Create Matrix account':'Sign in to Matrix'}</button>
    </form>
    <p className="muted tiny">A Matrix account is independent of ChatGPT. Your AI provider and API key are your choice.</p>
  </div>;
}
