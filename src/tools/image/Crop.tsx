import { Button as UiNativeButton } from '../../common/ui/primitives';
import { Field } from '../../common/EditorFields';
import type { ImageControls } from './controls';
const presets=['Free','1:1','4:3','16:9','3:2'];
export default function Crop({values,set,preview,ratio,setRatio,setCropRatio}:ImageControls) {
 return <><label className="image-tool-control-label">Aspect ratio</label><div className="image-tool-presets">{presets.map(item=><UiNativeButton key={item} aria-pressed={ratio===item} className={ratio===item?'selected':''} onClick={()=>setCropRatio(item)}>{item}</UiNativeButton>)}</div><div className="image-tool-field-grid"><Field label="Width" value={values.width || String(preview?.width || '')} onChange={value=>{set('width',value);setRatio('Free')}} min={1}/><Field label="Height" value={values.height || String(preview?.height || '')} onChange={value=>{set('height',value);setRatio('Free')}} min={1}/><Field label="Left" value={values.x} onChange={value=>set('x',value)}/><Field label="Top" value={values.y} onChange={value=>set('y',value)}/></div><dl className="image-tool-facts"><div><dt>Orientation</dt><dd>EXIF orientation applied</dd></div></dl></>;
}
