import { NativeSelect as UiNativeSelect } from './ui/primitives';
import { useState, useEffect, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import ReferenceEditor from './ReferenceEditor';
import { wheelFamily } from './file-kind';
import { wheelProfiles } from './wheel-profiles';
import { api } from './bridge';
import OperationFields from './OperationFields';
import type { Capability, LocalFile } from './types';
import './operation-window.css';
export interface OperationWindowProps { title?:string; capability:Capability; files:LocalFile[]; format:string; initialOptions:Record<string,string>; onClose:()=>void; onApply:(format:string,values:Record<string,string>)=>Promise<void>; children?:ReactNode | ((format:string, values:Record<string,string>, onChange:(values:Record<string,string>)=>void)=>ReactNode) }
export default function OperationWindow({title,capability,files,format:initialFormat,initialOptions,onClose,onApply,children}:OperationWindowProps) {
 const [format,setFormat]=useState(initialFormat),[values,setValues]=useState(initialOptions),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const file=files[0],family=wheelFamily(files),Icon=wheelProfiles[family].icon;
 const [preview,setPreview]=useState('');
 const [previewError,setPreviewError]=useState('');
 useEffect(()=>{let active=true;setPreview('');setPreviewError('');if(file?.path && api.preview && !['archive','presentation','spreadsheet'].includes(family))void api.preview(file.path).then(result=>{if(active && result.url.startsWith('data:image/'))setPreview(result.url);else if(active && ['pdf','image'].includes(family))setPreview(result.url)}).catch(()=>{if(active)setPreviewError('A rendered preview is not available for this file.')});return()=>{active=false}},[file?.path,family]);
 const submit=async()=>{if(busy)return;setBusy(true);setError('');try{await onApply(format,values);onClose()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 return <ReferenceEditor title={title || capability.label} ariaLabel={capability.label} subtitle={<>{file?.name}{files.length>1?` · ${files.length} selected`:''} · Local processing</>} preview={<><span>{preview?'Local preview':'Selected source'}</span><section className={`operation-source operation-source--${family}`} aria-label="Selected source files">{preview?<img className="operation-source-image" src={preview} alt={`Source preview of ${file?.name}`}/>:<><Icon size={48} strokeWidth={1.3} aria-hidden="true"/><ul>{files.map(file=><li key={file.id}><div><strong>{file.name}</strong><span>{file.ext.toUpperCase()} · {(file.size/1024).toFixed(1)} KB</span></div></li>)}</ul><p>{previewError || 'Originals are preserved. Files stay on this device.'}</p></>}</section></>} settings={<>{(capability.operation || capability.id.split(':').pop())!=='extract'&&<label className="field-label">Output format<UiNativeSelect value={format} onChange={e=>setFormat(e.target.value)}>{capability.outputs.map(f=><option key={f} value={f}>{f.toUpperCase()}</option>)}</UiNativeSelect></label>}<OperationFields capability={capability} values={values} onChange={setValues}/>{typeof children==='function'?children(format,values,setValues):children}</>} notice={error || capability.warning || 'Uses your configured destination and collision handling. No silent overwrites.'} error={Boolean(error)} output={`${format==='directory'?'New output folder':`New ${format.toUpperCase()} copy`} · ${file?.name || 'selection'}`} busy={busy} disabled={!files.length||!capability.available} onClose={onClose} onReset={()=>{setFormat(initialFormat);setValues(initialOptions);setError('')}} onSubmit={submit}/>;
}
