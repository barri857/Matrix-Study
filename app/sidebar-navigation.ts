'use client';

import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';

export function useSidebarNavigation(menu:boolean,setMenu:Dispatch<SetStateAction<boolean>>) {
  const [collapsed,setCollapsed]=useState<boolean|null>(null);
  const [compact,setCompact]=useState(false);
  const toggleRef=useRef<HTMLButtonElement>(null);

  useEffect(()=>{
    try { setCollapsed(localStorage.getItem('matrix-sidebar-collapsed')==='true'); }
    catch { setCollapsed(false); }
    const media=window.matchMedia('(max-width:800px)');
    const resize=()=>{setCompact(media.matches);setMenu(false);};
    resize();
    media.addEventListener('change',resize);
    const keydown=(event:KeyboardEvent)=>{
      const target=event.target;
      const editing=target instanceof HTMLElement&&Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'));
      if((event.ctrlKey||event.metaKey)&&event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='s'&&!editing&&!document.querySelector('[role="dialog"]')){
        event.preventDefault();
        if(media.matches)setMenu(value=>!value);
        else { toggleRef.current?.focus();setCollapsed(value=>!value); }
      }
    };
    document.addEventListener('keydown',keydown);
    return()=>{media.removeEventListener('change',resize);document.removeEventListener('keydown',keydown);};
  },[setMenu]);

  useEffect(()=>{
    if(collapsed===null)return;
    try { localStorage.setItem('matrix-sidebar-collapsed',String(collapsed)); } catch {}
  },[collapsed]);

  useEffect(()=>{
    if(!compact||!menu)return;
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape') { setMenu(false);toggleRef.current?.focus(); }
    };
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[compact,menu,setMenu]);

  return {
    collapsed:collapsed===true,
    hidden:compact?!menu:collapsed===true,
    toggleRef,
    toggle:()=>compact?setMenu(value=>!value):setCollapsed(value=>!value),
  };
}
