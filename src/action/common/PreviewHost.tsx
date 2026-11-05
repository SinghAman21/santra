import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../common/bridge';
import type { LocalFile } from '../../common/types';
import './preview-window.css';

export default function PreviewHost() {
  const [file, setFile] = useState<LocalFile | null>(null);
  const [url, setUrl] = useState('');
  const [waveform, setWaveform] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!api.previewContext || !api.preview) throw new Error('Quick Preview is unavailable.');
      const context = await api.previewContext();
      const result = await api.preview(context.path);
      if (active) { setFile(context); setUrl(result.url); setWaveform(result.waveform || ''); }
    })().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void api.closePreview?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const extension = file?.ext.toLowerCase() || '';
  const audio = ['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac'].includes(extension);
  const video = ['mp4', 'm4v', 'webm'].includes(extension);
  return <main className="quick-preview" aria-label="Quick Preview">
    <header><strong title={file?.name}>{file?.name || 'Quick Preview'}</strong><button aria-label="Close preview" onClick={() => void api.closePreview?.()}><X size={18}/></button></header>
    <div className="quick-preview-content">
      {error ? <p role="alert">{error}</p> : !url ? <p role="status">Preparing local preview…</p> : audio ? <div>{waveform && <img src={waveform} alt="Waveform of the first five minutes"/>}<audio controls src={url} aria-label={`Audio preview of ${file?.name}`}/></div> : video ? <video controls src={url} aria-label={`Video preview of ${file?.name}`}/> : <img src={url} alt={`Preview of ${file?.name}`} onError={() => setError('Santra could not render this local image preview.')}/>}
    </div>
  </main>;
}
