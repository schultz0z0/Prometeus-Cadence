'use client';

import {useId,useLayoutEffect,useRef,useState,type KeyboardEvent,type Ref} from 'react';
import {Icon} from './icon';
import styles from './select-menu.module.css';

export function SelectMenu<T extends string>({label,labelledBy,value,options,onChange,up=false,fieldId,buttonRef,className,disabled,required,invalid,describedBy,icon}:{
  label?:string;
  labelledBy?:string;
  value:T;
  options:readonly (readonly [T,string,boolean?])[];
  onChange:(value:T)=>void;
  up?:boolean;
  fieldId?:string;
  buttonRef?:Ref<HTMLButtonElement>;
  className?:string;
  disabled?:boolean;
  required?:boolean;
  invalid?:boolean;
  describedBy?:string;
  icon?:string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLUListElement>(null);
  const search = useRef({text:'',time:0});
  const [active,setActive] = useState<number|null>(null);
  const enabled = options.flatMap((option,index)=>option[2]?[]:[index]);
  const selected = options.findIndex(([key])=>key===value);
  const first = enabled[0];
  const initial = enabled.includes(selected)?selected:first;
  const open = active!==null&&first!==undefined&&!disabled;
  const current = active!==null&&enabled.includes(active)?active:initial;

  useLayoutEffect(()=>{
    const menu=popup.current,button=trigger.current;
    if(!open||!menu||!button)return;
    const topLayer=typeof menu.showPopover==='function';
    if(topLayer)menu.showPopover();
    function position() {
      if(!menu||!button)return;
      const box=button.getBoundingClientRect();
      const below=Math.max(0,window.innerHeight-box.bottom-10);
      const above=Math.max(0,box.top-10);
      const placeAbove=up?above>=Math.min(menu.scrollHeight,192)||above>=below:below<Math.min(menu.scrollHeight,192)&&above>below;
      const width=Math.min(Math.max(box.width,144),window.innerWidth-16);
      menu.style.width=width+'px';
      menu.style.maxHeight=Math.min(288,placeAbove?above:below)+'px';
      menu.style.left=Math.max(8,Math.min(box.left,window.innerWidth-width-8))+'px';
      menu.style.top=placeAbove?Math.max(8,box.top-menu.offsetHeight-4)+'px':box.bottom+4+'px';
    }
    position();
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
    return ()=>{
      if(topLayer)menu.hidePopover();
      window.removeEventListener('resize',position);
      window.removeEventListener('scroll',position,true);
    };
  },[open,up,options.length]);

  useLayoutEffect(()=>{
    if(open)document.getElementById(`${id}-${current}`)?.scrollIntoView({block:'nearest'});
  },[open,id,current]);

  function close() {
    setActive(null);
    search.current={text:'',time:0};
  }

  function choose(index:number|undefined) {
    if(index!==undefined&&!options[index]?.[2]&&options[index])onChange(options[index][0]);
    close();
  }

  function keyDown(event:KeyboardEvent<HTMLButtonElement>) {
    if(first===undefined)return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const offset = event.key==='ArrowDown'?1:-1;
        const position = current===undefined?0:enabled.indexOf(current);
        setActive(open?enabled[Math.max(0,Math.min(enabled.length-1,position+offset))]:initial);
        break;
      }
      case 'Home':
      case 'End':
        if (!open) break;
        event.preventDefault();
        setActive(event.key==='Home'?first:enabled.at(-1)??first);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(current);
        else setActive(initial);
        break;
      case 'Tab':
        if(open)choose(current);
        break;
      case 'Escape':
        if (!open) break;
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      default: {
        if(event.key.length!==1||event.altKey||event.ctrlKey||event.metaKey)break;
        const time=Date.now();
        const term=(time-search.current.time>550?'':search.current.text)+event.key.toLocaleLowerCase('pt-BR');
        search.current={text:term,time};
        const match=enabled.find(index=>options[index][1].toLocaleLowerCase('pt-BR').startsWith(term));
        if(match!==undefined){event.preventDefault();setActive(match);}
      }
    }
  }

  const control = <>
    <button ref={element=>{
      trigger.current=element;
      if(typeof buttonRef==='function')buttonRef(element);
      else if(buttonRef)buttonRef.current=element;
    }} type="button" role="combobox" aria-label={label} aria-labelledby={label?undefined:labelledBy} aria-expanded={open}
      aria-controls={id} aria-activedescendant={open?`${id}-${current}`:undefined}
      aria-required={required||undefined} aria-invalid={invalid||undefined} aria-describedby={describedBy}
      data-select-field={fieldId} disabled={disabled}
      className={[styles.trigger,className].filter(Boolean).join(' ')} onBlur={close} onKeyDown={keyDown}
      onClick={event=>{
        event.currentTarget.focus();
        if(open)close();
        else if(initial!==undefined)setActive(initial);
      }}>
      <span className={styles.caption}>
        {icon&&<Icon name={icon} size={15}/>}
        <span>{options[selected]?.[1]??'—'}</span>
      </span>
      <Icon name="ChevronDown" size={14}/>
    </button>
    <ul ref={popup} id={id} popover="manual" role="listbox" aria-label={label} aria-labelledby={label?undefined:labelledBy}
      className={styles.options} hidden={!open}>
      {open&&options.map(([key,text,unavailable],index)=><li key={index} id={`${id}-${index}`}
        role="option" aria-selected={key===value} aria-disabled={unavailable||undefined} data-active={index===current}
        onPointerDown={event=>event.preventDefault()}
        onClick={event=>{event.preventDefault();if(!unavailable)choose(index);}}>
        {text}
      </li>)}
    </ul>
  </>;
  return fieldId?control:<div className={styles.root}>{control}</div>;
}
