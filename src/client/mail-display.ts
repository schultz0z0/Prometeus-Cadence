/** Display-only disclosure: the original stored message is never changed. */
export function splitQuotedMail(text:string):{body:string;quoted:string|null}{
 const lines=text.split('\n');
 for(let i=0;i<lines.length;i++){
  if(!/^\s*(?:Em |On )/.test(lines[i]))continue;
  const header=lines.slice(i,Math.min(lines.length,i+6)).join('\n');
  if(!/(?:escreveu|wrote):\s*\n(?:\s*\n)*\s*>/.test(header))continue;
  return {body:lines.slice(0,i).join('\n').trimEnd(),quoted:lines.slice(i).join('\n')};
 }
 return {body:text,quoted:null};
}
