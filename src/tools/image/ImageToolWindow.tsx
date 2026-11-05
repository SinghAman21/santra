import './image-tool-window.css';
import Crop from './Crop';
import Resize from './Resize';
import Rotate from './Rotate';
import Background from './Background';
import Adjust from './Adjust';
import Compress from './Compress';
import Metadata from './Metadata';
import StripMetadata from './StripMetadata';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Maximize, Minus, Plus, RotateCcw, RotateCw, X } from 'lucide-react';
import type { Capability, LocalFile } from '../../common/types';
import { api, isDesktop } from '../../common/bridge';


type Props = {
  capability: Capability;
  file: LocalFile;
  format: string;
  initialOptions: Record<string, string>;
  onClose: () => void;
  onApply: (format: string, options: Record<string, string>) => void | Promise<void>;
};

const labels: Record<string, string> = {
  'edit-image': 'Edit photo', background: 'Add background', crop: 'Crop', resize: 'Resize',
  rotate: 'Rotate & flip', flip: 'Flip', compress: 'Compress', metadata: 'Edit metadata', 'strip-metadata': 'Edit metadata',
};
const ratios: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '3:2': 3 / 2 };

export default function ImageToolWindow({ capability, file, format, initialOptions, onClose, onApply }: Props) {
  const windowRef = useRef<HTMLElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const cropDragRef = useRef<{ mode: 'draw' | 'move' | 'resize'; handle?: string; startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const operation = capability.operation || capability.id.split(':').pop() || '';
  const [values, setValues] = useState<Record<string, string>>(() => ({ quality: '85', brightness: '1', saturation: '1', contrast: '1', width: '', height: '', x: '0', y: '0', angle: operation === 'rotate' ? '90' : '0', direction: 'horizontal', backgroundType: 'solid', backgroundColor: '#ffffff', backgroundColor2: '#ff5a00', padding: operation === 'background' ? '32' : '0', fit: operation === 'background' ? 'contain' : 'inside', stripMetadata: 'false', flipHorizontal: 'false', flipVertical: 'false', title: '', artist: '', copyright: '', description: '', dateTime: '', ...initialOptions }));
  const [selectedFormat, setSelectedFormat] = useState(format);
  const [changed, setChanged] = useState(false);
  const [preview, setPreview] = useState<{ url: string; width?: number; height?: number; sourceWidth?: number; sourceHeight?: number } | null>(null);
  const originalDimensions = useRef<{ width: number; height: number } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [ratio, setRatio] = useState('Free');
  const [previewBounds, setPreviewBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const title = labels[operation] || capability.label;
  const set = (key: string, value: string) => setValues(previous => {
    if (previous[key] !== value) setChanged(true);
    return { ...previous, [key]: value };
  });
  const recipe = useMemo(() => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')), [values]);
  const previewRecipe = useMemo<Record<string, string>>(() => operation === 'metadata' ? {} : recipe, [operation, recipe]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = windowRef.current;
    panel?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = panel?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(async () => {
      if (!isDesktop || !api.imagePreview) { setPreview(null); setPreviewError('Live image previews are available in the Santra desktop app.'); return; }
      setBusy(true); setPreviewError('');
      try {
        const previewOperation = operation === 'crop' || (operation === 'resize' && !previewRecipe.width && !previewRecipe.height) ? 'edit-image' : operation;
        const result = await api.imagePreview(file.path, previewOperation, previewRecipe);
        if (current) {
          setPreview(result);
          const sourceWidth = result.sourceWidth || result.width;
          const sourceHeight = result.sourceHeight || result.height;
          if (sourceWidth && sourceHeight) originalDimensions.current = { width: sourceWidth, height: sourceHeight };
          if (operation === 'resize') setValues(previous => previous.width && previous.height ? previous : ({ ...previous, width: previous.width || String(sourceWidth || ''), height: previous.height || String(sourceHeight || '') }));
          if (operation === 'background') setValues(previous => {
            if (previous.width && previous.height) return previous;
            const padding = Number(previous.padding) || 0;
            return { ...previous, width: previous.width || String((sourceWidth || 0) + padding * 2), height: previous.height || String((sourceHeight || 0) + padding * 2) };
          });
        }
      } catch (error) { if (current) setPreviewError(error instanceof Error ? error.message : String(error)); }
      finally { if (current) setBusy(false); }
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [file.path, operation, previewRecipe]);

  useEffect(() => {
    const wrap = previewWrapRef.current;
    const image = previewImageRef.current;
    if (!wrap || !image || operation !== 'crop') { setPreviewBounds({ left: 0, top: 0, width: 0, height: 0 }); return; }
    const update = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      setPreviewBounds({ left: imageRect.left - wrapRect.left, top: imageRect.top - wrapRect.top, width: imageRect.width, height: imageRect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    observer.observe(image);
    image.addEventListener('load', update);
    update();
    return () => { observer.disconnect(); image.removeEventListener('load', update); };
  }, [operation, preview?.url, zoom]);

  useEffect(() => {
    if (operation !== 'resize' || !preview?.width || !preview.height) return;
    const dimensions = originalDimensions.current;
    setValues(previous => previous.width && previous.height ? previous : { ...previous, width: previous.width || String(dimensions?.width || preview.width), height: previous.height || String(dimensions?.height || preview.height) });
  }, [operation, preview?.width, preview?.height]);

  function setCropRatio(value: string) {
    setRatio(value);
    const dimensions = originalDimensions.current || (preview?.width && preview.height ? { width: preview.width, height: preview.height } : null);
    if (value === 'Free' || !ratios[value] || !dimensions) return;
    const target = ratios[value];
    const imageRatio = dimensions.width / dimensions.height;
    const width = imageRatio > target ? Math.round(dimensions.height * target) : dimensions.width;
    const height = imageRatio > target ? dimensions.height : Math.round(dimensions.width / target);
    setValues(previous => ({ ...previous, x: String(Math.max(0, Math.round((dimensions.width - width) / 2))), y: String(Math.max(0, Math.round((dimensions.height - height) / 2))), width: String(width), height: String(height) }));
  }

  function panBy(x: number, y: number) {
    const wrap = previewWrapRef.current;
    const image = previewImageRef.current;
    if (!wrap || !image) return;
    const maxX = Math.max(48, (image.offsetWidth * zoom - wrap.clientWidth) / 2);
    const maxY = Math.max(48, (image.offsetHeight * zoom - wrap.clientHeight) / 2);
    setPan(current => ({ x: Math.max(-maxX, Math.min(maxX, current.x + x)), y: Math.max(-maxY, Math.min(maxY, current.y + y)) }));
  }

  function cropPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const image = previewImageRef.current;
    const dimensions = originalDimensions.current;
    if (!image || !dimensions) return { x: 0, y: 0 };
    const rect = image.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dimensions.width, Math.round((event.clientX - rect.left) / rect.width * dimensions.width))),
      y: Math.max(0, Math.min(dimensions.height, Math.round((event.clientY - rect.top) / rect.height * dimensions.height))),
    };
  }

  function beginCrop(event: ReactPointerEvent<HTMLDivElement>) {
    if (operation !== 'crop' || !originalDimensions.current) return;
    event.preventDefault();
    const point = cropPoint(event);
    const dimensions = originalDimensions.current;
    const current = { x: Number(values.x) || 0, y: Number(values.y) || 0, width: Number(values.width) || dimensions.width, height: Number(values.height) || dimensions.height };
    const handle = (event.target as HTMLElement).dataset.cropHandle;
    const hasExplicitCrop = Boolean(values.width && values.height);
    const inside = hasExplicitCrop && point.x >= current.x && point.x <= current.x + current.width && point.y >= current.y && point.y <= current.y + current.height;
    cropDragRef.current = { mode: handle ? 'resize' : inside ? 'move' : 'draw', handle, startX: point.x, startY: point.y, ...current };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!handle && !inside) setValues(previous => ({ ...previous, x: String(point.x), y: String(point.y), width: '1', height: '1' }));
  }

  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    const dimensions = originalDimensions.current;
    if (!drag || !dimensions) return;
    const point = cropPoint(event);
    const dx = point.x - drag.startX, dy = point.y - drag.startY;
    let { x, y, width, height } = drag;
    if (drag.mode === 'move') {
      x = Math.max(0, Math.min(dimensions.width - width, x + dx));
      y = Math.max(0, Math.min(dimensions.height - height, y + dy));
    } else if (drag.mode === 'draw') {
      x = Math.min(drag.startX, point.x); y = Math.min(drag.startY, point.y);
      width = Math.max(1, Math.abs(dx)); height = Math.max(1, Math.abs(dy));
    } else {
      if (drag.handle?.includes('w')) { x = Math.max(0, Math.min(drag.x + drag.width - 1, drag.x + dx)); width = drag.x + drag.width - x; }
      if (drag.handle?.includes('e')) width = Math.max(1, Math.min(dimensions.width - drag.x, drag.width + dx));
      if (drag.handle?.includes('n')) { y = Math.max(0, Math.min(drag.y + drag.height - 1, drag.y + dy)); height = drag.y + drag.height - y; }
      if (drag.handle?.includes('s')) height = Math.max(1, Math.min(dimensions.height - drag.y, drag.height + dy));
    }
    setValues(previous => ({ ...previous, x: String(Math.round(x)), y: String(Math.round(y)), width: String(Math.round(width)), height: String(Math.round(height)) }));
    setChanged(true);
    setRatio('Free');
  }

  const controls = { values, set, preview, originalDimensions, ratio, setRatio, setCropRatio, file, format: selectedFormat, outputFormats: capability.outputs, onFormatChange: (next: string) => { if (next !== selectedFormat) setChanged(true); setSelectedFormat(next); } };

  const sourceDimensions = originalDimensions.current;
  const outputName = `New ${selectedFormat.toUpperCase()} copy · ${file.name}`;
  // Processor limits belong to capability/error states, not every editor panel.
  const notice = applyError;

  return <div className="image-tool-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={windowRef} className="image-tool-window" role="dialog" aria-modal="true" aria-label={title}>
      <header className="image-tool-header"><div><h2>{title}</h2><p title={file.name}>{file.name}{sourceDimensions ? ` · ${sourceDimensions.width} × ${sourceDimensions.height}` : ''} · {(file.size / 1024 / 1024).toFixed(2)} MB</p></div><button className="image-tool-close" aria-label="Close editor" disabled={applying} onClick={onClose}><X size={17}/></button></header>
      <div className="image-tool-body">
        <div className="image-tool-preview-column"><span className="image-tool-preview-label">Local preview</span>
        <div className="image-tool-preview-wrap" ref={previewWrapRef} style={operation === 'background' && values.backgroundType !== 'image' ? { backgroundImage: 'none', backgroundColor: values.backgroundColor } : undefined}>
          {preview?.url ? <img ref={previewImageRef} className="image-tool-preview" style={{ '--image-zoom': zoom, '--image-pan-x': `${pan.x}px`, '--image-pan-y': `${pan.y}px` } as CSSProperties} src={preview.url} alt={`Local preview of ${file.name}`}/> : <div className="image-tool-preview-empty"><span>{busy ? 'Updating preview…' : 'Local preview'}</span>{previewError && <small>{previewError}</small>}</div>}
          {operation === 'crop' && preview?.url && originalDimensions.current && previewBounds.width > 0 && <div className="image-tool-crop-overlay" role="group" aria-label="Crop selection" style={{ left: previewBounds.left, top: previewBounds.top, width: previewBounds.width, height: previewBounds.height }} onPointerDown={beginCrop} onPointerMove={moveCrop} onPointerUp={() => { cropDragRef.current = null; }} onPointerCancel={() => { cropDragRef.current = null; }}>
            <div tabIndex={0} className="image-tool-crop-selection" aria-label="Crop frame. Use arrow keys to nudge." onKeyDown={event => { const nudge = event.shiftKey ? 10 : 1; if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault(); const dx = event.key === 'ArrowLeft' ? -nudge : event.key === 'ArrowRight' ? nudge : 0; const dy = event.key === 'ArrowUp' ? -nudge : event.key === 'ArrowDown' ? nudge : 0; const width = Number(values.width) || originalDimensions.current!.width; const height = Number(values.height) || originalDimensions.current!.height; setValues(previous => ({ ...previous, x: String(Math.max(0, Math.min(originalDimensions.current!.width - width, (Number(previous.x) || 0) + dx))), y: String(Math.max(0, Math.min(originalDimensions.current!.height - height, (Number(previous.y) || 0) + dy))) })); setChanged(true); }} style={{ left: `${(Number(values.x) || 0) / originalDimensions.current.width * 100}%`, top: `${(Number(values.y) || 0) / originalDimensions.current.height * 100}%`, width: `${(Number(values.width) || originalDimensions.current.width) / originalDimensions.current.width * 100}%`, height: `${(Number(values.height) || originalDimensions.current.height) / originalDimensions.current.height * 100}%` }}>
              {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => <span key={handle} data-crop-handle={handle} className={`crop-handle ${handle}`} aria-hidden="true"/>)}
            </div>
          </div>}
          {preview?.sourceWidth && preview.sourceHeight && <span className="image-tool-dimensions">{preview.sourceWidth} × {preview.sourceHeight} px</span>}
        </div>
        <div className="image-tool-preview-toolbar"><span>Before / current</span><div><details className="image-tool-navigation"><summary>Zoom &amp; pan</summary>          <div className="image-tool-zoom" role="group" aria-label="Preview controls"><button aria-label="Zoom out" title="Zoom out" disabled={zoom <= 0.5} onClick={() => { setZoom(current => Math.max(0.5, Number((current - 0.25).toFixed(2)))); setPan({ x: 0, y: 0 }); }}><Minus size={15}/></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" title="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(current => Math.min(3, Number((current + 0.25).toFixed(2))))}><Plus size={15}/></button><button aria-label="Reset zoom" title="Reset zoom" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize size={14}/></button></div>
          <div className="image-tool-pan" role="group" aria-label="Move image preview"><button aria-label="Move image up" disabled={!preview?.url} onClick={() => panBy(0, -48)}><ArrowUp size={15}/></button><button aria-label="Move image left" disabled={!preview?.url} onClick={() => panBy(-48, 0)}><ArrowLeft size={15}/></button><button aria-label="Move image right" disabled={!preview?.url} onClick={() => panBy(48, 0)}><ArrowRight size={15}/></button><button aria-label="Move image down" disabled={!preview?.url} onClick={() => panBy(0, 48)}><ArrowDown size={15}/></button></div>
</details><button className="image-tool-fit" aria-label="Fit image" onClick={() => { setZoom(1); setPan({x:0,y:0}); }}>Fit</button></div></div></div>
        <div className="image-tool-controls"><div className="editor-section-label">Output settings</div>
          {operation === 'crop' && <Crop {...controls}/>}
          {operation === 'resize' && <Resize {...controls}/>}
          {operation === 'rotate' && <Rotate {...controls}/>}
          {operation === 'background' && <Background {...controls}/>}
          {operation === 'edit-image' && <Adjust {...controls}/>}
          {operation === 'compress' && <Compress {...controls}/>}
          {operation === 'metadata' && <Metadata {...controls}/>}
          {operation === 'strip-metadata' && <StripMetadata {...controls}/>}
          {capability.preservesMetadata && operation !== 'metadata' && <label className="image-tool-check"><input type="checkbox" checked={values.stripMetadata === 'true'} onChange={event => set('stripMetadata', String(event.target.checked))}/> {capability.preservesMetadata ? 'Remove metadata from the copy' : 'This local image backend removes metadata from the copy'}</label>}
        </div>
      </div>
      {notice && <div className={`image-tool-notice ${applyError ? 'has-error' : ''}`} role={applyError ? 'alert' : 'status'}>{notice}</div>}
      <footer className="image-tool-footer"><div className="image-tool-output"><strong>{outputName}</strong><span>New copy · configured destination · collision-safe</span></div><div className="image-tool-footer-actions"><button className="image-tool-reset" disabled={applying || !changed} onClick={() => { setRatio('Free'); setZoom(1); setPan({ x: 0, y: 0 }); setApplyError(''); setSelectedFormat(format); const padding = operation === 'background' ? 32 : 0; setValues({ quality: '85', brightness: '1', saturation: '1', contrast: '1', width: operation === 'background' ? String((originalDimensions.current?.width || 0) + padding * 2) : '', height: operation === 'background' ? String((originalDimensions.current?.height || 0) + padding * 2) : '', x: '0', y: '0', angle: operation === 'rotate' ? '90' : '0', direction: 'horizontal', backgroundType: 'solid', backgroundColor: '#ffffff', backgroundColor2: '#ff5a00', padding: String(padding), fit: operation === 'background' ? 'contain' : 'inside', stripMetadata: 'false', flipHorizontal: 'false', flipVertical: 'false', title: '', artist: '', copyright: '', description: '', dateTime: '' }); setChanged(false); }}>Reset</button><button className="editor-cancel" disabled={applying} onClick={onClose}>Cancel</button><button className="image-tool-apply" disabled={applying} onClick={async () => { setApplying(true); setApplyError(''); try { await onApply(selectedFormat, values); } catch (error) { setApplyError(error instanceof Error ? error.message : String(error)); } finally { setApplying(false); } }}>{applying ? <RotateCw className="spin" size={16}/> : <Check size={16}/>} {applying ? 'Queueing…' : 'Save new copy'}</button></div></footer>
    </section>
  </div>;
}
