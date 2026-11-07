import { useEffect, useState } from 'react';
import type { AudioEditorContext } from '../../common/types';
import { api } from '../../common/bridge';
import AudioToolWindow from './AudioToolWindow';
import './audio.css';

export default function AudioToolHost() {
  const [context, setContext] = useState<AudioEditorContext | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let requestId = 0;
    const accept = (value: AudioEditorContext) => { if (active) { requestId++; setContext(value); setError(''); } };
    const load = () => {
      const current = ++requestId;
      if (!api.audioToolContext) { setError('Audio editor is unavailable.'); return; }
      void api.audioToolContext().then(value => { if (active && current === requestId) accept(value); }).catch(reason => {
        if (!active || current !== requestId) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message === 'Audio editor is no longer available') { setContext(null); setError(''); }
        else setError(message);
      });
    };
    const stop = api.onAudioToolContext?.(accept);
    window.addEventListener('focus', load);
    load();
    return () => { active = false; stop?.(); window.removeEventListener('focus', load); };
  }, []);
  if (error) return <main className="audio-tool-state" role="alert"><h1>Could not open audio editor</h1><p>{error}</p><button onClick={() => void api.closeAudioTool?.()}>Close</button></main>;
  if (!context) return <main className="audio-tool-state" aria-live="polite">Preparing local audio preview…</main>;
  return <AudioToolWindow
    key={context.id || `${context.capability.id}:${context.files[0]?.path}`}
    capability={context.capability}
    files={context.files}
    format={context.format}
    initialOptions={context.options}
    onClose={() => { void api.closeAudioTool?.(); setContext(null); }}
    onApply={async (nextFormat, values) => {
      await api.applyAudioTool?.({ format: nextFormat, options: values });
      setContext(null);
    }}
  />;
}
