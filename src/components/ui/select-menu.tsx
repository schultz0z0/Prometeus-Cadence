'use client';

import {useId,useState,type KeyboardEvent} from 'react';
import {Icon} from './icon';
import styles from './select-menu.module.css';

export function SelectMenu<T extends string>({label,value,options,onChange,up=false}:{
  label:string;
  value:T;
  options:readonly (readonly [T,string])[];
  onChange:(value:T)=>void;
  up?:boolean;
}) {
  const id = useId();
  const [active,setActive] = useState<number|null>(null);
  const selected = options.findIndex(([key])=>key===value);
  const open = active!==null;

  function choose(index:number) {
    onChange(options[index][0]);
    setActive(null);
  }

  function keyDown(event:KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const offset = event.key==='ArrowDown'?1:-1;
        setActive(active===null?selected:Math.max(0,Math.min(options.length-1,active+offset)));
        break;
      }
      case 'Home':
      case 'End':
        if (!open) break;
        event.preventDefault();
        setActive(event.key==='Home'?0:options.length-1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (active===null) setActive(selected);
        else choose(active);
        break;
      case 'Escape':
        if (!open) break;
        event.preventDefault();
        event.stopPropagation();
        setActive(null);
        break;
    }
  }

  return <div className={styles.root}>
    <button type="button" role="combobox" aria-label={label} aria-expanded={open}
      aria-controls={id} aria-activedescendant={open?`${id}-${active}`:undefined}
      className={styles.trigger} onBlur={()=>setActive(null)} onKeyDown={keyDown}
      onClick={event=>{event.currentTarget.focus();setActive(open?null:selected);}}>
      {options[selected][1]}<Icon name="ChevronDown" size={14}/>
    </button>
    <ul id={id} role="listbox" aria-label={label} className={styles.options} data-up={up} hidden={!open}>
      {options.map(([key,text],index)=><li key={key} id={`${id}-${index}`}
        role="option" aria-selected={key===value} data-active={index===active}
        onPointerDown={event=>event.preventDefault()} onClick={()=>choose(index)}>
        {text}
      </li>)}
    </ul>
  </div>;
}
