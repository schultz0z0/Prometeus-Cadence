'use client';

import {Children,Fragment,isValidElement,useContext,useId,useRef,useState,type ReactNode,type SelectHTMLAttributes} from 'react';
import {FieldLabelContext} from './primitives';
import {SelectMenu} from './select-menu';
import styles from './select-menu.module.css';

type Option = readonly [string,string,boolean?];

function optionText(children:ReactNode):string {
  return Children.toArray(children).map(child=>
    typeof child==='string'||typeof child==='number'?String(child):
      isValidElement<{children?:ReactNode}>(child)?optionText(child.props.children):'',
  ).join('');
}

function readOptions(children:ReactNode):Option[] {
  return Children.toArray(children).flatMap(child=>{
    if(!isValidElement<{value?:string|number;disabled?:boolean;children?:ReactNode}>(child))return [];
    if(child.type===Fragment)return readOptions(child.props.children);
    if(child.type!=='option')return [];
    const text=optionText(child.props.children);
    return [[String(child.props.value??text),text,child.props.disabled] as const];
  });
}

export function SelectField({value,defaultValue,children,disabled,required,onChange,className,name,'aria-label':label,icon}:Pick<
  SelectHTMLAttributes<HTMLSelectElement>,'value'|'defaultValue'|'children'|'disabled'|'required'|'onChange'|'className'|'name'|'aria-label'
>&{icon?:string}) {
  const id=useId();
  const labelledBy=useContext(FieldLabelContext);
  const select=useRef<HTMLSelectElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const [uncontrolled,setUncontrolled]=useState(defaultValue===undefined?undefined:String(defaultValue));
  const [showInvalid,setShowInvalid]=useState(false);
  const options=readOptions(children);
  const requested=value===undefined?uncontrolled:String(value);
  const effective=options.find(([key])=>key===requested)?.[0]??options.find(option=>!option[2])?.[0]??'';
  const invalid=showInvalid&&required&&!effective;
  function change(next:string) {
    const field=select.current;
    if(!field||next===requested)return;
    field.value=next;
    field.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return <>
    <SelectMenu label={label} labelledBy={labelledBy} value={effective} options={options} onChange={change} fieldId={id}
      buttonRef={trigger} className={className} disabled={disabled} required={required} invalid={invalid} describedBy={invalid?id+'-error':undefined} icon={icon}/>
    <select ref={select} id={id} name={name} aria-hidden="true" tabIndex={-1} hidden disabled={disabled} required={required}
      className={styles.native} value={value} defaultValue={defaultValue}
      onInvalid={event=>{event.preventDefault();setShowInvalid(true);trigger.current?.focus();}}
      onChange={event=>{if(value===undefined)setUncontrolled(event.target.value);setShowInvalid(false);onChange?.(event);}}>
      {children}
    </select>
    {invalid&&<small id={id+'-error'} role="alert">Selecione uma opção.</small>}
  </>;
}
