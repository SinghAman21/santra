import { NativeButton as UiNativeButton } from './ui/primitives';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { RadialWheelProps, WheelItem } from './RadialWheel';
import { api } from './bridge';
import { wheelProfiles } from './wheel-profiles';
import type { WheelFamily } from './file-kind';
import './reference-wheel.css';

const point = (radius: number, angle: number) => [220 + Math.cos(angle) * radius, 220 + Math.sin(angle) * radius].join(' ');
// Four rounded corners connect the outer arc, radial sides, and inner arc.
export function referenceSlicePath(index: number, count: number) {
  const step = Math.PI * 2 / count;
  const middle = -Math.PI / 2 + index * step;
  const a = middle - step / 2 + .009, b = middle + step / 2 - .009;
  const outer = 211, inner = 80, corner = 11;
  const outerInset = Math.min(corner / outer, step / 5), innerInset = Math.min(corner / inner, step / 5);
  return `M ${point(outer, a + outerInset)} A ${outer} ${outer} 0 ${b-a>Math.PI?1:0} 1 ${point(outer,b-outerInset)} Q ${point(outer,b)} ${point(outer-corner,b)} L ${point(inner+corner,b)} Q ${point(inner,b)} ${point(inner,b-innerInset)} A ${inner} ${inner} 0 ${b-a>Math.PI?1:0} 0 ${point(inner,a+innerInset)} Q ${point(inner,a)} ${point(inner+corner,a)} L ${point(outer-corner,a)} Q ${point(outer,a)} ${point(outer,a+outerInset)} Z`;
}
function orderedItems(items: WheelItem[], label: string, family: WheelFamily) {
  const profile=wheelProfiles[family];
  if(label!=='Convert')return label==='Tools'?[...items].sort((a,b)=>{
    const rank=(item:WheelItem)=>{const i=profile.tools.indexOf(item.id.split('|')[0].split(':').pop()!);return i<0?99:i};return rank(a)-rank(b);
  }):items;
  const unique=new Map<string,WheelItem>();
  for(const item of items){const name=family==='image'?(item.label==='JPEG'?'JPG':item.label==='TIF'?'TIFF':item.label):item.label;if(!unique.has(name)||item.label===name)unique.set(name,{...item,label:name});}
  const rank=(item:WheelItem)=>{const i=profile.formats.indexOf(item.label);return i<0?99:i};
  return [...unique.values()].sort((a,b)=>rank(a)-rank(b));
}
export default function ReferenceWheel({family: incomingFamily='other',items: incoming,label,subtitle,selected='',onHighlight,onChoose,preview,sourceName,sourceFile,dragging=false,hideDescription=false}: RadialWheelProps) {
  const family = incomingFamily as WheelFamily;
  const profile = wheelProfiles[family] || wheelProfiles.other;
  const Icon = profile.icon;
  const unresolved = family === 'other' && !sourceFile?.path && !sourceFile?.ext;
  const [thumbnail,setThumbnail]=useState('');
  const [waveform,setWaveform]=useState('');
  useEffect(()=>{
    let active=true;setThumbnail('');setWaveform('');
    if(sourceFile?.path && ['image','video','audio','pdf'].includes(family)) {
      const request=family==='image'&&api.imagePreview?api.imagePreview(sourceFile.path,'edit-image',{}):api.preview?.(sourceFile.path);
      if(request)void request.then(value=>{if(active){setThumbnail(value.url);if('waveform' in value)setWaveform(String(value.waveform||''))}}).catch(()=>{});
    }
    return()=>{active=false};
  },[sourceFile?.path,family]);
  const [page,setPage]=useState(0),[focused,setFocused]=useState('');
  const capacity=family==='video'?12:10;
  const items=orderedItems(incoming,label,family), pages=Math.ceil(items.length/capacity);
  const currentPage=Math.min(page,Math.max(0,pages-1));
  const visible=items.slice(currentPage*capacity,currentPage*capacity+capacity);
  const active=selected||focused;
  const activeItem=visible.find(item=>item.id===active);
  useEffect(()=>{setPage(0);setFocused('')},[label]);
  const highlight=(id:string)=>{setFocused(id);onHighlight?.(id)};
  return <div data-family={family} className={`citrus-wheel reference-wheel ${family==='image'?'image-wheel':''} ${visible.length?'':'has-empty'} ${dragging?'is-dragging':''}`}>
    {!visible.length ? <section className="reference-wheel-empty" role="status"><h2>{unresolved?'Detecting file type':label==='Tools'?profile.noTools:label==='Convert'?'Conversion is not enabled':'No actions available'}</h2><p>{unresolved?'Move the dragged file over this window, or drop to inspect it locally.':label==='Tools'?'File actions remain available with Ctrl.':'Only verified local routes are shown. Check Settings for local engines.'}</p></section> : <div className="citrus-rind" role="menu" aria-label={label} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();
      const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'));
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
      buttons[next]?.focus();
    }}>
      <svg viewBox="0 0 440 440" className="citrus-segments" aria-hidden="true">{visible.map((item,index)=><path key={item.id} data-wheel-item={item.id} d={referenceSlicePath(index,visible.length)} className={`${item.id===active?'chosen':''} ${item.disabled?'unavailable':''}`} onMouseEnter={()=>{if(!item.disabled)highlight(item.id)}} onDragEnter={event=>{event.preventDefault();if(!item.disabled)highlight(item.id)}} onClick={()=>{if(!item.disabled)onChoose(item.id)}}/>)}</svg>
      {visible.map((item,index)=>{const angle=-Math.PI/2+index*Math.PI*2/visible.length;return <UiNativeButton type="button" role="menuitem" key={item.id} data-wheel-item={item.id} aria-label={item.detail?`${item.label} · ${item.detail}`:item.label} disabled={item.disabled} className={`citrus-label ${label==='Convert'?'image-format-label':''} ${item.id===active?'chosen':''}`} style={{left:`${(220+Math.cos(angle)*150)/4.4}%`,top:`${(220+Math.sin(angle)*150)/4.4}%`}} onMouseEnter={()=>highlight(item.id)} onDragEnter={event=>{event.preventDefault();highlight(item.id)}} onFocus={()=>highlight(item.id)} onClick={()=>onChoose(item.id)}>{item.icon}<span>{item.label}</span></UiNativeButton>})}
      <div className="citrus-core" aria-hidden="true"><div className="image-wheel-thumbnail">{preview||(family==='audio'&&waveform?<img src={waveform} alt=""/>:thumbnail&&family==='video'?<video src={thumbnail} muted playsInline preload="metadata" onError={()=>setThumbnail('')}/>:thumbnail&&family!=='audio'?<img src={thumbnail} alt=""/>:<Icon strokeWidth={1.5}/>)}</div><span className="image-wheel-selection">{activeItem?.label||profile.title}</span></div>
    </div>}
    <div className="image-wheel-source">{sourceName||profile.title} · Originals preserved</div>
    {!hideDescription&&<div className="wheel-description"><strong>{label}</strong><span>{subtitle||'Choose a slice to continue'}</span></div>}
    {pages>1&&<div className="wheel-pagination"><UiNativeButton data-wheel-page="previous" aria-label="Previous operations" disabled={!currentPage} onDragEnter={()=>{if(currentPage>0){setPage(currentPage-1);highlight('')}}} onClick={()=>{setPage(currentPage-1);highlight('')}}><ChevronLeft size={16}/></UiNativeButton><span>{currentPage+1} / {pages}</span><UiNativeButton data-wheel-page="next" aria-label="More operations" disabled={currentPage===pages-1} onDragEnter={()=>{if(currentPage<pages-1){setPage(currentPage+1);highlight('')}}} onClick={()=>{setPage(currentPage+1);highlight('')}}><ChevronRight size={16}/></UiNativeButton></div>}
  </div>;
}
