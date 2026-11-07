import { Checkbox } from '../../common/ui/checkbox';
import { Button as UiNativeButton, Input as UiNativeInput } from '../../common/ui/primitives';
import { Slider } from '../../common/EditorFields';
import { RotateCcw, RotateCw } from 'lucide-react';
import type { ImageControls } from './controls';
export default function Rotate({values,set}:ImageControls) {
 const rotate=(delta:number)=>set('angle',String(((Number(values.angle||0)+delta+180)%360+360)%360-180));
 return <><label className="image-tool-control-label">Rotate</label><div className="image-tool-rotate-buttons"><UiNativeButton onClick={()=>rotate(-90)}><RotateCcw size={17}/>90°</UiNativeButton><UiNativeButton onClick={()=>set('angle','0')}>0°</UiNativeButton><UiNativeButton onClick={()=>rotate(90)}>90°<RotateCw size={17}/></UiNativeButton></div><Slider label="Exact angle" min={-180} max={180} step={1} value={values.angle} onChange={value=>set('angle',value)}/><label className="image-tool-check"><Checkbox checked={values.flipHorizontal==='true'} onCheckedChange={checked=>set('flipHorizontal',String(checked === true))}/>Flip horizontal</label><label className="image-tool-check"><Checkbox checked={values.flipVertical==='true'} onCheckedChange={checked=>set('flipVertical',String(checked === true))}/>Flip vertical</label></>;
}
