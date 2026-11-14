"use client";
import {useEffect,useRef,useState} from 'react';
import {Icon} from '@/components/ui/icon';
// shortcut: a fixed set of common emojis, no search or skin tones; switch to a picker library if operators ask for the full set.
export const emojiGroups:{label:string;items:string[]}[]=[
 {label:'Rostos',items:['😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂','😉','😍','😘','😎','🤩','🥳','🤔','🤗','🙏','😇','😐','😶','🙄','😏','😬','😌','😴','😢','😭','😤','😡','😱','🤯','😳','🥲','🤝']},
 {label:'Gestos',items:['👍','👎','👌','✌️','🤞','👏','🙌','💪','👋','🤙','👉','👈','☝️','👇','✍️','🫡']},
 {label:'Símbolos',items:['❤️','🧡','💛','💚','💙','💜','🔥','✨','⭐','🎉','✅','❌','⚠️','❓','❗','💯','📌','📎','📅','⏰','📞','📧','💬','🚀','💡','📈','💰','🏆','🎯','🤖']},
];
export function EmojiPicker({onPick,disabled}:{onPick:(emoji:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;
  const away=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);},esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('pointerdown',away);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',esc);};
 },[open]);
 return <div className="emoji-picker" ref={root}><button type="button" className="icon-btn" disabled={disabled} aria-label="Inserir emoji" title="Inserir emoji" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Icon name="Smile" size={20}/></button>
  {open&&<div className="emoji-panel" role="dialog" aria-label="Emojis">{emojiGroups.map(g=><section key={g.label}><h4>{g.label}</h4><div className="emoji-grid">{g.items.map(e=><button type="button" key={e} aria-label={'Inserir '+e} onClick={()=>onPick(e)}>{e}</button>)}</div></section>)}</div>}
 </div>;
}
