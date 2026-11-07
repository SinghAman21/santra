import { Button as UiNativeButton } from '../../common/ui/primitives';
import { useEffect, useState } from 'react';
import type { VideoEditorContext } from '../../common/types';
import { api } from '../../common/bridge';
import VideoToolWindow from './VideoToolWindow';
import './video-tool-window.css';

export default function VideoToolHost() {
  const [context, setContext] = useState<VideoEditorContext | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let requestId = 0;
    const accept = (value: VideoEditorContext) => { if (active) { requestId++; setContext(value); setError(''); } };
    const load = () => {
      const current = ++requestId;
      if (!api.videoToolContext) { setError('Video editor is unavailable.'); return; }
      void api.videoToolContext().then(value => { if (active && current === requestId) accept(value); }).catch(reason => {
        if (!active || current !== requestId) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message === 'Video editor is no longer available') { setContext(null); setError(''); }
        else setError(message);
      });
    };
    const stop = api.onVideoToolContext?.(accept);
    window.addEventListener('focus', load);
    load();
    return () => { active = false; stop?.(); window.removeEventListener('focus', load); };
  }, []);
  if (error) return <main className="video-tool-state" role="alert"><h1>Could not open video editor</h1><p>{error}</p><UiNativeButton onClick={() => void api.closeVideoTool?.()}>Close</UiNativeButton></main>;
  if (!context) return <main className="video-tool-state" aria-live="polite">Preparing local video preview…</main>;
  return <VideoToolWindow
    key={context.id || `${context.capability.id}:${context.files[0]?.path}`}
    capability={context.capability}
    files={context.files}
    format={context.format}
    initialOptions={context.options}
    onClose={() => { void api.closeVideoTool?.(); setContext(null); }}
    onApply={async (nextFormat, options, orderedFiles) => { const result = await api.applyVideoTool?.({ format: nextFormat, options, files: orderedFiles }); setContext(null); return result; }}
  />;
}
