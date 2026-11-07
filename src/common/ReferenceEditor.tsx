import { Button as UiNativeButton } from './ui/primitives';
import type { ReactNode } from 'react';
import Modal from './Modal';
import './reference-editor.css';
export interface ReferenceEditorProps {
 title:string; ariaLabel?:string; subtitle?:ReactNode; preview:ReactNode; settings:ReactNode;
 notice:ReactNode; error?:boolean; output:string; busy?:boolean; disabled?:boolean;
 onClose:()=>void; onReset:()=>void; onSubmit:()=>void|Promise<void>; actionLabel?:string;
}
export default function ReferenceEditor({title,ariaLabel,subtitle,preview,settings,notice,error=false,output,busy=false,disabled=false,onClose,onReset,onSubmit,actionLabel='Save new copy'}:ReferenceEditorProps) {
 return <Modal title={title} ariaLabel={ariaLabel} subtitle={subtitle} onClose={()=>{if(!busy)onClose()}} wide className="reference-editor-modal"><form className="reference-editor" aria-busy={busy} onSubmit={event=>{event.preventDefault();if(!busy&&!disabled)void onSubmit()}}>
  <div className="reference-editor-body"><section className="reference-editor-preview">{preview}</section><section className="reference-editor-settings"><div className="editor-section-label">Output settings</div><fieldset disabled={busy}>{settings}</fieldset></section></div>
  <div className={`reference-editor-notice ${error?'has-error':''}`} role={error?'alert':'status'}>{notice}</div>
  <footer className="reference-editor-footer"><div><strong>{output}</strong><span>New copy · configured destination · collision-safe</span></div><nav aria-label="Editor actions"><UiNativeButton type="button" className="editor-cancel" disabled={busy} onClick={onReset}>Reset</UiNativeButton><UiNativeButton type="button" className="editor-cancel" disabled={busy} onClick={onClose}>Cancel</UiNativeButton><UiNativeButton type="submit" className="button primary" disabled={busy||disabled}>{busy?'Queueing…':actionLabel}</UiNativeButton></nav></footer>
 </form></Modal>;
}
