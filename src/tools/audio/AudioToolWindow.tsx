import { NativeSelect as UiNativeSelect } from '../../common/ui/primitives';
import { useEffect, useState } from 'react';
import type { Capability, LocalFile } from '../../common/types';
import { api } from '../../common/bridge';
import ReferenceEditor from '../../common/ReferenceEditor';
import { operationLabels } from '../../common/wheel-profiles';
import OperationFields from '../../common/OperationFields';
import Normalize from './Normalize';
import Channels from './Channels';
import Trim from './Trim';
import Visualize from './Visualize';
import Compress from './Compress';
import StripMetadata from './StripMetadata';
import type { AudioControlsProps } from './controls';
import type { ComponentType } from 'react';
import './audio.css';
const controls: Record<string,ComponentType<AudioControlsProps>> = {normalize:Normalize,channels:Channels,trim:Trim,visualize:Visualize,compress:Compress,'strip-metadata':StripMetadata};
export const audioEditorOperations = Object.keys(controls);
interface Props { capability:Capability; files:LocalFile[]; format:string; initialOptions:Record<string,string>; onClose:()=>void; onApply:(format:string,values:Record<string,string>)=>Promise<void> }
export default function AudioToolWindow({capability,files,format:initialFormat,initialOptions,onClose,onApply}:Props) {
 const operation=capability.operation || capability.id.split(':').pop()!;
 const defaults={...initialOptions,...(operation==='visualize'?{waveColor:'#ff5a00',backgroundColor:'#ffffff'}:{})};
 const [values,setValues]=useState<Record<string,string>>(defaults);
 const [format,setFormat]=useState(initialFormat);
 const [preview,setPreview]=useState<Awaited<ReturnType<NonNullable<typeof api.preview>>>|null>(null);
 const [previewError,setPreviewError]=useState('');
 const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
 const file=files[0]; const Controls=controls[operation];
 useEffect(()=>{let active=true; if(file && api.preview) void api.preview(file.path).then(v=>{if(active)setPreview(v)}).catch(e=>{if(active)setPreviewError(String(e))});return()=>{active=false}},[file?.path]);
 const submit=async()=>{if(busy)return;setBusy(true);setError('');try{await onApply(format,values);onClose()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 const reset=()=>{setValues(defaults);setFormat(initialFormat);setError('')};
 return <ReferenceEditor title={operationLabels[operation] || capability.label} ariaLabel={capability.label} subtitle={<>{file?.name}{preview?.duration ? ` · ${Math.floor(preview.duration/60)}:${String(Math.floor(preview.duration%60)).padStart(2,'0')}` : ''} · Original audio</>} preview={<><span>Local preview · original audio</span><div className="audio-preview">{preview?.waveform ? <img src={preview.waveform} alt={`Waveform of ${file?.name}`}/> : <p className="image-tool-hint">{previewError || 'Waveform preview is not available for this source.'}</p>}{preview?.url ? <audio controls src={preview.url} aria-label="Original audio preview"/> : <p role="status">{previewError || 'Loading local preview…'}</p>}</div><p className="reference-preview-label">Output settings are applied to the saved copy.</p></>} settings={<><label className="image-tool-select">Output format<UiNativeSelect value={format} onChange={e=>setFormat(e.target.value)}>{capability.outputs.map(f=><option key={f} value={f}>{f.toUpperCase()}</option>)}</UiNativeSelect></label>{Controls ? <Controls values={values} set={(key,value)=>setValues(v=>({...v,[key]:value}))}/> : <OperationFields capability={capability} values={values} onChange={setValues}/>}</>} notice={error || capability.warning || 'Save a new copy. Your original audio stays untouched.'} error={Boolean(error)} output={`New ${format.toUpperCase()} copy · ${file?.name || 'selection'}`} busy={busy} disabled={!files.length} onClose={onClose} onReset={reset} onSubmit={submit}/>;
}
