import { Button as UiNativeButton } from '../../common/ui/primitives';
import { useEffect, useState } from 'react';
import type { ImageEditorContext } from '../../common/types';
import { api } from '../../common/bridge';
import ImageToolWindow from './ImageToolWindow';
import './image-tool-window.css';

export default function ImageToolHost() {
  const [context, setContext] = useState<ImageEditorContext | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let requestId = 0;
    const accept = (value: ImageEditorContext) => { if (active) { requestId++; setContext(value); setError(''); } };
    const load = () => {
      const current = ++requestId;
      if (!api.imageToolContext) { setError('Image editor is unavailable.'); return; }
      void api.imageToolContext().then(value => { if (active && current === requestId) accept(value); }).catch(reason => {
        if (!active || current !== requestId) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message === 'Image editor is no longer available') { setContext(null); setError(''); }
        else setError(message);
      });
    };
    const stop = api.onImageToolContext?.(accept);
    window.addEventListener('focus', load);
    load();
    return () => { active = false; stop?.(); window.removeEventListener('focus', load); };
  }, []);
  if (error) return <main className="image-tool-error" role="alert"><h1>Could not open image editor</h1><p>{error}</p><UiNativeButton onClick={() => void api.closeImageTool?.()}>Close</UiNativeButton></main>;
  if (!context) return <main className="image-tool-loading" aria-live="polite">Preparing local image preview…</main>;
  return <ImageToolWindow
    key={context.id || `${context.capability.id}:${context.files[0]?.path}`}
    capability={context.capability}
    file={context.files[0]}
    format={context.format}
    initialOptions={context.options}
    onClose={() => { void api.closeImageTool?.(); setContext(null); }}
    onApply={async (format, options) => { if (!api.applyImageTool) throw new Error('Image output is unavailable in this session.'); await api.applyImageTool({ format, options }); setContext(null); }}
  />;
}
