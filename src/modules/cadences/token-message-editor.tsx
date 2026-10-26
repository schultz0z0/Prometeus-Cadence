"use client";
import { useEffect, useRef } from "react";

const variables: Record<string,string>={nome:'Nome',email:'E-mail',telefone:'Telefone',site:'Site',cidade:'Cidade',razaoSocial:'Razão social',cnpj:'CNPJ'};

// Labels are presentation only. The sending contract remains a plain template.
function plainText(node: Node): string {
 if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
 if(!(node instanceof HTMLElement))return '';
 if(node.dataset.variable)return node.dataset.variable;
 // Browsers keep a terminal BR to position the caret in an empty line.
 if(node.tagName==='BR')return node.nextSibling?'\n':'';
 return Array.from(node.childNodes).map((child,index)=>{
  const text=plainText(child);
  return index>0&&child instanceof HTMLElement&&['DIV','P'].includes(child.tagName)&&!(child.previousSibling instanceof HTMLBRElement)?'\n'+text:text;
 }).join('');
}
function decorate(editor:HTMLDivElement,value:string){
 const fragment=document.createDocumentFragment();
 let start=0;
 for(const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)){
  const label=variables[match[1]];
  if(!label)continue;
  fragment.append(document.createTextNode(value.slice(start,match.index)));
  const token=document.createElement('span');
  token.dataset.variable=match[0];token.contentEditable='false';token.className='message-variable';token.textContent=label;
  token.title=match[0];fragment.append(token);start=match.index+match[0].length;
 }
 fragment.append(document.createTextNode(value.slice(start)));
 editor.replaceChildren(fragment);
}
export function TokenMessageEditor({value,onChange,invalid=false}:{value:string;onChange:(value:string)=>void;invalid?:boolean}){
 const ref=useRef<HTMLDivElement>(null),selection=useRef<Range|null>(null),latest=useRef(value);
 useEffect(()=>{if(ref.current&&plainText(ref.current)!==value)decorate(ref.current,value);latest.current=value;},[value]);
 function remember(){const range=window.getSelection();if(range?.rangeCount&&ref.current?.contains(range.anchorNode))selection.current=range.getRangeAt(0).cloneRange();}
 function changed(){if(ref.current){latest.current=plainText(ref.current);onChange(latest.current);remember();}}
 function insert(text:string){
  const editor=ref.current;if(!editor)return;editor.focus();
  const selected=window.getSelection();if(!selected)return;
  if(selection.current&&editor.contains(selection.current.startContainer)){selected.removeAllRanges();selected.addRange(selection.current);}
  else{const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selected.removeAllRanges();selected.addRange(range);}
  // Native insertion preserves browser undo and never interprets pasted HTML.
  if(!document.execCommand('insertText',false,text)){
   const range=selected.getRangeAt(0);range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selected.removeAllRanges();selected.addRange(range);
  }
  changed();
 }
 return <div className="token-message-field"><div className="token-message-label">Mensagem de texto <span>(modelo base para IA)</span></div><div ref={ref} className="token-message-editor" role="textbox" aria-label="Mensagem *" aria-required="true" aria-invalid={invalid} aria-multiline="true" contentEditable suppressContentEditableWarning onInput={changed} onKeyUp={remember} onMouseUp={remember} onFocus={remember} onBlur={()=>{if(ref.current)decorate(ref.current,latest.current);selection.current=null;}} onPaste={event=>{event.preventDefault();insert(event.clipboardData.getData('text/plain'));}}/>{invalid&&<small role="alert">Escreva a mensagem da etapa.</small>}<div className="step-reference-tokens"><small>Inserir:</small>{Object.entries(variables).map(([key,label])=><button key={key} type="button" className="token-button" onMouseDown={e=>e.preventDefault()} onClick={()=>insert('{{'+key+'}}')}>{label}</button>)}</div></div>;
}
