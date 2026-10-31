export interface MarkdownNode {tag:string;text?:string;children?:MarkdownNode[];href?:string;start?:number;checked?:boolean;align?:'left'|'right'|'center'}
const text=(value:string):MarkdownNode=>({tag:'text',text:value});
export function markdownUrl(value:string):string|undefined {
  if(/[\u0000-\u0020\u007f]/.test(value))return;
  try{const url=new URL(value);if(['https:','http:','mailto:'].includes(url.protocol))return url.href;}catch{}
}
/** Parse a bounded set of prose Markdown into elements, never into executable HTML. */
export function markdownInline(source:string,depth=0):MarkdownNode[]{
  if(depth>16)return [text(source)];
  const out:MarkdownNode[]=[];let plain='';
  const flush=()=>{if(plain){out.push(text(plain));plain='';}};
  for(let i=0;i<source.length;){
    const rest=source.slice(i);let m:RegExpMatchArray|null;
    if((m=rest.match(/^\\([\\`*{}\[\]()#+\-.!_>~|])/))){plain+=m[1];i+=m[0].length;continue;}
    if(rest[0]==='`'){
      const fence=rest.match(/^`+/)![0],end=source.indexOf(fence,i+fence.length);
      if(end>=0){flush();out.push({tag:'code',text:source.slice(i+fence.length,end).replace(/\n/g,' ')});i=end+fence.length;continue;}
    }
    if((m=rest.match(/^(!?)\[([^\]\n]*)\]\(<?([^\s<>]*?(?:\([^\s<>]*\)[^\s<>]*)?)>?(?:\s+"[^"\n]*")?\)/))){
      flush();const href=markdownUrl(m[3]);
      // Remote images are explicit links; opening a document never fetches trackers.
      out.push(href?{tag:'a',href,children:markdownInline((m[1]?'图片：':'')+m[2],depth+1)}:text(m[2]||m[3]));i+=m[0].length;continue;
    }
    if((m=rest.match(/^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/))){flush();out.push({tag:'a',href:markdownUrl(m[1]),children:[text(m[1])]});i+=m[0].length;continue;}
    const marker=['***','___','**','__','~~','*','_'].find(v=>rest.startsWith(v)&&!(v.includes('_')&&/[\p{L}\p{N}]/u.test(source[i-1]??'')));
    if(marker){
      const end=source.indexOf(marker,i+marker.length),inside=end>=0?source.slice(i+marker.length,end):'';
      if(inside&&!/^\s|\s$/.test(inside)){
        flush();const children=markdownInline(inside,depth+1);
        out.push(marker.length===3?{tag:'strong',children:[{tag:'em',children}]}:{tag:marker==='~~'?'del':marker.length===2?'strong':'em',children});i=end+marker.length;continue;
      }
    }
    plain+=source[i++];
  }
  flush();return out;
}
const listLine=(line:string)=>line.match(/^( {0,3})([-+*]|\d+[.)])\s+(.*)$/);
const rule=(line:string)=>/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
function cells(line:string):string[]{
  const body=line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'');let current='',code=false;const out:string[]=[];
  for(let i=0;i<body.length;i++){const c=body[i];if(c==='\\'&&body[i+1]==='|'){current+='|';i++;continue;}if(c==='`')code=!code;if(c==='|'&&!code){out.push(current.trim());current='';}else current+=c;}
  out.push(current.trim());return out;
}
const tableRule=(line:string)=>line.includes('|')&&cells(line).every(c=>/^:?-{3,}:?$/.test(c));
const blockStart=(line:string)=>/^ {0,3}(#{1,6}\s|>|`{3,}|~{3,})/.test(line)||Boolean(listLine(line))||rule(line);
export function parseMarkdown(source:string,depth=0):MarkdownNode[]{
  if(depth>16)return [{tag:'p',children:[text(source)]}];
  const lines=source.replace(/\r\n?/g,'\n').split('\n'),out:MarkdownNode[]=[];
  for(let i=0;i<lines.length;){
    const line=lines[i];let m:RegExpMatchArray|null;
    if(!line.trim()){i++;continue;}
    if((m=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/))){
      const fence=m[1],body:string[]=[];i++;
      while(i<lines.length&&!new RegExp('^ {0,3}'+fence[0]+'{'+fence.length+',}\\s*$').test(lines[i]))body.push(lines[i++]);
      if(i<lines.length)i++;out.push({tag:'pre',children:[{tag:'code',text:body.join('\n')}]});continue;
    }
    if((m=line.match(/^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/))){out.push({tag:'h'+m[1].length,children:markdownInline(m[2])});i++;continue;}
    if(i+1<lines.length&&/^ {0,3}(?:=+|-+)\s*$/.test(lines[i+1])&&!listLine(line)){
      out.push({tag:lines[i+1].trim()[0]==='='?'h1':'h2',children:markdownInline(line)});i+=2;continue;
    }
    if(rule(line)){out.push({tag:'hr'});i++;continue;}
    if(/^ {0,3}>/.test(line)){
      const body:string[]=[];while(i<lines.length&&/^ {0,3}>/.test(lines[i]))body.push(lines[i++].replace(/^ {0,3}> ?/,''));
      out.push({tag:'blockquote',children:parseMarkdown(body.join('\n'),depth+1)});continue;
    }
    if(i+1<lines.length&&line.includes('|')&&tableRule(lines[i+1])){
      const head=cells(line),rules=cells(lines[i+1]);
      if(head.length===rules.length){
        const aligns=rules.map(v=>v.startsWith(':')&&v.endsWith(':')?'center':v.endsWith(':')?'right':'left') as ('left'|'right'|'center')[];
        const row=(values:string[],tag:string):MarkdownNode=>({tag:'tr',children:head.map((_,n)=>({tag,align:aligns[n],children:markdownInline(values[n]??'')}))});
        i+=2;const rows:MarkdownNode[]=[];while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(row(cells(lines[i++]),'td'));
        out.push({tag:'table',children:[{tag:'thead',children:[row(head,'th')]},{tag:'tbody',children:rows}]});continue;
      }
    }
    if((m=listLine(line))){
      const ordered=/\d/.test(m[2]),start=ordered?parseInt(m[2],10):undefined,items:MarkdownNode[]=[];
      while(i<lines.length){
        const item=listLine(lines[i]);if(!item||/\d/.test(item[2])!==ordered)break;
        const indent=item[1].length+item[2].length+1,body=[item[3]];i++;
        while(i<lines.length){
          if(!lines[i].trim()){
            if(i+1<lines.length&&lines[i+1].startsWith(' '.repeat(indent))){body.push('');i++;continue;}break;
          }
          if(!lines[i].startsWith(' '.repeat(indent)))break;
          body.push(lines[i++].slice(indent));
        }
        const task=body[0].match(/^\[([ xX])\]\s+(.*)$/);if(task)body[0]=task[2];
        items.push({tag:'li',checked:task?task[1].toLowerCase()==='x':undefined,children:parseMarkdown(body.join('\n'),depth+1)});
        if(!lines[i]?.trim()&&listLine(lines[i+1]??''))i++;
      }
      out.push({tag:ordered?'ol':'ul',start,children:items});continue;
    }
    if(/^ {4}|^\t/.test(line)){
      const body:string[]=[];while(i<lines.length&&/^( {4}|\t)/.test(lines[i]))body.push(lines[i++].replace(/^( {4}|\t)/,''));
      out.push({tag:'pre',children:[{tag:'code',text:body.join('\n')}]});continue;
    }
    const body=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!blockStart(lines[i])&&!(lines[i].includes('|')&&tableRule(lines[i+1]??''))){body.push(lines[i++]);}
    out.push({tag:'p',children:markdownInline(body.join('\n'))});
  }
  return out;
}
