import { useState } from 'react';
import { Field } from '../../common/EditorFields';
import { Select } from '../../common/Select';
import type { ImageControls } from './controls';
export default function Resize({values,set,preview,originalDimensions,format,outputFormats,onFormatChange}:ImageControls) {
 const [locked,setLocked]=useState(true);
 const source=originalDimensions.current;
 const width=values.width || String(source?.width || preview?.width || '');
 const height=values.height || String(source?.height || preview?.height || '');
 function dimension(key:'width'|'height',value:string) {
  set(key,value);
  if(locked && source && Number(value)>0) set(key==='width'?'height':'width',String(Math.max(1,Math.round(Number(value)*(key==='width'?source.height/source.width:source.width/source.height)))));
 }
 return <><div className="image-tool-field-grid"><Field label="Width (px)" value={width} onChange={value=>dimension('width',value)} min={1}/><Field label="Height (px)" value={height} onChange={value=>dimension('height',value)} min={1}/></div><label className="image-tool-check"><input type="checkbox" checked={locked} onChange={event=>setLocked(event.target.checked)}/>Lock aspect ratio</label><Select label="Fit" value={values.fit} onChange={value=>set('fit',value)} options={[{value:'inside',label:'Inside'},{value:'cover',label:'Cover and crop'},{value:'fill',label:'Stretch'}]}/><Select label="Output extension" value={format} onChange={onFormatChange} options={outputFormats.map(value=>({value,label:value.toUpperCase()}))}/></>;
}
