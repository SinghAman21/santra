import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, FileOutput, LockKeyhole } from 'lucide-react';
import { families, familyOptions, catalogueHref, catalogueSelection, type Family, type WheelOption } from '../tools-data';
import { ToolMotion } from './ToolMotion';

type Mode = 'convert' | 'tools';
type TourStep = { familyId: string; mode: Mode; index: number };
const CONVERT_DURATION = 3600;
const TOOL_DURATION = 3000;
const initialStep: TourStep = { familyId: 'images', mode: 'convert', index: 2 };
const sampleFiles: Record<string, string> = {
  images: 'summer-evening.png',
  video: 'studio-cut.mp4',
  audio: 'field-notes.wav',
  pdf: 'proposal.pdf',
  documents: 'draft.md',
  subtitles: 'captions.srt',
  archives: 'project.txt',
  spreadsheets: 'quarter.xlsx',
};
const formatExtensions: Record<string, string> = { JPG: 'jpg', Markdown: 'md', WebP: 'webp', Opus: 'opus', 'Extract archive': 'folder' };
const defaultFormats: Record<string, string> = { images: 'WebP', video: 'WebM', audio: 'MP3', pdf: 'PNG', documents: 'DOCX', subtitles: 'VTT', archives: 'TAR' };

function startingStep(family: Family): TourStep {
  if (family.outputs.length) return { familyId: family.id, mode: 'convert', index: Math.max(0, family.outputs.findIndex(item => item.label === defaultFormats[family.id])) };
  return { familyId: family.id, mode: 'tools', index: 0 };
}

function nextStep(current: TourStep): TourStep {
  const index = families.findIndex(item => item.id === current.familyId);
  const family = families[index] ?? families[0];
  if (current.mode === 'convert' && family.tools.length) return { familyId: family.id, mode: 'tools', index: 0 };
  if (current.mode === 'tools' && current.index + 1 < family.tools.length) return { ...current, index: current.index + 1 };
  for (let offset = 1; offset <= families.length; offset++) {
    const candidate = families[(index + offset) % families.length];
    if (candidate.outputs.length || candidate.tools.length) return startingStep(candidate);
  }
  return current;
}

function outputName(family: Family, mode: Mode, operation?: WheelOption) {
  if (!operation) return 'No output available';
  const file = family.id === 'archives' && mode === 'tools' ? 'project.zip' : sampleFiles[family.id];
  const dot = file.lastIndexOf('.');
  const stem = file.slice(0, dot);
  const originalExt = file.slice(dot + 1);
  if (mode === 'convert') {
    if (family.id === 'archives') return `${stem}.${operation.label.toLowerCase() === 'gzip' ? 'gz' : operation.label.toLowerCase()}`;
    return `${stem}-converted.${formatExtensions[operation.label] ?? operation.label.toLowerCase()}`;
  }
  const special: Record<string, string> = {
    'Extract archive': `${stem}-extracted/`,
    'Render page': `${stem}-page-001.png`,
    'Snapshot': `${stem}-frame-001.png`,
    'Create GIF': `${stem}.gif`,
    'Extract audio': `${stem}-audio.mp3`,
    'Merge PDFs': `${stem}-merged.pdf`,
  };
  return special[operation.label] ?? `${stem}-${operation.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${originalExt}`;
}

function FilePreview({ family, mode, operation }: { family: Family; mode: Mode; operation?: WheelOption }) {
  if (mode === 'tools' && operation) return <div className="desk-canvas tool-canvas">
    <div className="desk-canvas-header"><span>ILLUSTRATIVE TOOL MOTION</span><span>{operation.availability === 'concept' ? 'PLANNED / NOT IN APP' : 'LOCAL / NO UPLOAD'}</span></div>
    <ToolMotion key={`${family.id}-${operation.label}`} family={family} operation={operation}/>
    <div className="desk-canvas-foot">{operation.availability === 'concept' ? <LockKeyhole size={15}/> : <Check size={15}/>}<span>{operation.availability === 'concept' ? 'These editor tools are design concepts only.' : 'The original stays in place.'}</span></div>
  </div>;
  const Icon = family.Icon;
  const source = family.id === 'archives' && mode === 'tools' ? 'project.zip' : sampleFiles[family.id];
  const result = outputName(family, mode, operation);
  const sourceExt = source.split('.').at(-1)?.toUpperCase() ?? 'FILE';
  const resultExt = result.endsWith('/') ? 'DIR' : result.split('.').at(-1)?.toUpperCase() ?? 'FILE';
  return <div className="desk-canvas">
    <div className="desk-canvas-header"><span>ILLUSTRATIVE FILE FLOW</span><span>LOCAL / NO UPLOAD</span></div>
    <div className="file-stage">
      <div className="file-sheet source-sheet">
        <span className="sheet-icon"><Icon size={22} strokeWidth={1.7}/></span>
        <span className="sheet-extension">{sourceExt}</span>
        <span className="sheet-filename">{source}</span>
        <span className="sheet-caption">ORIGINAL</span>
      </div>
      {operation ? <div key={`${family.id}-${mode}-${operation.label}`} className="file-sheet result-sheet">
        <span className="sheet-icon"><FileOutput size={22} strokeWidth={1.7}/></span>
        <span className="sheet-extension">{resultExt}</span>
        <span className="sheet-filename">{result}</span>
        <span className="sheet-caption">NEW COPY</span>
      </div> : <div className="file-sheet waiting-sheet"><LockKeyhole size={25}/><span>NO ROUTE ENABLED</span></div>}
    </div>
    <div className="desk-canvas-foot"><Check size={15}/><span>{operation ? 'The original stays in place.' : 'Unavailable operations stay out of the app.'}</span></div>
  </div>;
}

function FamilyPicker({ current, onSelect }: { current: string; onSelect: (id: string) => void }) {
  return <aside className="family-index" aria-label="Choose a file family">
    <div className="family-index-head"><span>01</span><span>START WITH A FILE</span></div>
    <div className="family-index-list" role="group" aria-label="File families">
      {families.map((family, index) => {
        const Icon = family.Icon;
        return <button key={family.id} type="button" aria-pressed={current === family.id} onClick={() => onSelect(family.id)} className={`family-index-item ${current === family.id ? 'is-current' : ''}`}>
          <span className="family-index-number">{String(index + 1).padStart(2, '0')}</span>
          <Icon size={17} strokeWidth={1.8} className="family-index-icon"/>
          <span className="family-index-name">{family.name}</span>
          <span className={`family-index-signal status-${family.status}`} aria-label={family.status === 'disabled' ? 'Not enabled' : family.status === 'bundled' ? 'Built in' : 'Requires a detected engine'}/>
        </button>;
      })}
    </div>
  </aside>;
}

export function ToolsPage({ onInstall }: { onInstall: () => void }) {
  const [step, setStep] = useState<TourStep>(()=>catalogueSelection(window.location.search)??initialStep);
  const [autoplay, setAutoplay] = useState(() => !catalogueSelection(window.location.search)&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tourNonce, setTourNonce] = useState(0);
  const operationListRef = useRef<HTMLDivElement>(null);
  const family = families.find(item => item.id === step.familyId) ?? families[0];
  const mode = step.mode;
  const options = familyOptions(family,mode);
  const selected = options[step.index];
  const conceptMode=selected?.availability==='concept';
  const optionStatus=conceptMode?'disabled':selected?.availability==='conditional'?'conditional':family.status;
  const currentIndex = selected ? step.index + 1 : 0;
  const hasBothModes = family.outputs.length > 0 && family.tools.length > 0;
  const duration = mode === 'convert' ? CONVERT_DURATION : TOOL_DURATION;

  useEffect(() => {
    if (!autoplay || !options.length) return;
    const timer = window.setTimeout(() => { setStep(current => nextStep(current)); setTourNonce(value => value + 1); }, duration);
    return () => window.clearTimeout(timer);
  }, [autoplay, step.familyId, step.mode, step.index, tourNonce, duration, options.length]);

  useEffect(() => {
    const list = operationListRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !active) return;
    const listBox = list.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.top < listBox.top) list.scrollTop -= listBox.top - activeBox.top;
    else if (activeBox.bottom > listBox.bottom) list.scrollTop += activeBox.bottom - listBox.bottom;
  }, [step.familyId, step.mode, step.index]);

  const selectStep = (next: TourStep) => {
    setStep(next);setAutoplay(false);setTourNonce(value => value + 1);
    const selectedFamily=families.find(item=>item.id===next.familyId);
    if(selectedFamily)window.history.replaceState(window.history.state,'',catalogueHref(selectedFamily,next.mode,familyOptions(selectedFamily,next.mode)[next.index]));
  };
  useEffect(()=>{const sync=()=>{const next=catalogueSelection(window.location.search);if(next){setStep(next);setAutoplay(false);}};window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
  const selectFamily = (id: string) => {
    const nextFamily = families.find(item => item.id === id) ?? families[0];
    selectStep(startingStep(nextFamily));
    if (!nextFamily.outputs.length && !nextFamily.tools.length) setAutoplay(false);
  };

  return <main className="tools-page">
    <section className="tools-intro">
      <div className="tools-intro-copy">
        <p className="tools-kicker"><span/> SANTRA / TOOL LIBRARY</p>
        <h1>Every file has<br/>a <em>next move.</em></h1>
        <p>Choose the work you want done. Santra brings the relevant local action close, then saves a new copy you can keep moving with.</p>
      </div>
      <div className="tools-intro-aside"><span className="tools-aside-number">01—03</span><p>From source, to action, to a new file beside the original.</p><span className="tools-aside-foot">A simple path through complex formats.</span></div>
    </section>

    <section id="santra-desk" className="desk-section" aria-labelledby="desk-title">
      <div className="desk-section-heading">
        <div><p className="tools-kicker"><span/> THE SANTRA DESK</p><div className="desk-heading-line"><h2 id="desk-title">Try the thought process.</h2><button type="button" className="desk-autoplay-toggle" role="switch" aria-checked={autoplay} aria-label="Autoplay tool tour" onClick={() => { if (!autoplay && !options.length) selectStep(initialStep); setAutoplay(value => !value); setTourNonce(value => value + 1); }}><span className="desk-toggle-track"><span/></span><span>Autoplay <strong>{autoplay ? 'On' : 'Off'}</strong></span></button></div></div>
        <p>Pick a file family, then an action. The preview illustrates the flow and marks planned concepts; the desktop app checks each real file and local engine before offering a route.</p>
      </div>
      <div className="desk-layout">
        <FamilyPicker current={family.id} onSelect={selectFamily}/>
        <div className="desk-workspace">
          <div className="desk-workspace-top"><span>{family.name.toUpperCase()} / WORKFLOW</span><span className={`desk-state status-${optionStatus}`}>{conceptMode ? 'EDITOR CONCEPT · NOT ENABLED' : optionStatus === 'bundled' ? 'BUILT IN' : optionStatus === 'conditional' ? 'ENGINE DEPENDENT' : 'CURRENTLY DISABLED'}</span></div>
          <div className="desk-tour-line"><span>{autoplay && options.length ? `AUTO TOUR / ${mode === 'convert' ? 'CONVERT' : `${String(currentIndex).padStart(2, '0')} OF ${String(options.length).padStart(2, '0')} TOOLS`}` : 'MANUAL EXPLORATION'}</span><span>{autoplay && options.length ? `${Math.round(duration / 1000)} SEC` : 'PAUSED'}</span></div>
          <div className="desk-tour-progress" aria-hidden="true">{autoplay && options.length && <span key={`${step.familyId}-${step.mode}-${step.index}-${tourNonce}`} style={{ animationDuration: `${duration}ms` }}/>}</div>
          <div className="desk-workspace-body">
            <FilePreview key={`${family.id}-${mode}-${selected?.label ?? 'empty'}-${tourNonce}`} family={family} mode={mode} operation={selected}/>
            <div className="desk-controls">
              <div className="desk-control-head"><span>02</span><div><small>{options.length > 6 ? 'CHOOSE WHAT HAPPENS · SCROLL OPTIONS' : 'CHOOSE WHAT HAPPENS'}</small><h3>{mode === 'convert' ? 'Change the format.' : conceptMode ? 'Explore the concept.' : 'Shape the file.'}</h3></div></div>
              {hasBothModes && <div className="desk-mode-switch" role="group" aria-label="Choose action type">
                <button type="button" aria-pressed={mode === 'convert'} onClick={() => selectStep({ familyId: family.id, mode: 'convert', index: startingStep(family).index })}><kbd>⇧</kbd><span>Convert</span></button>
                <button type="button" aria-pressed={mode === 'tools'} onClick={() => selectStep({ familyId: family.id, mode: 'tools', index: 0 })}><kbd>⌥</kbd><span>{family.tools.every(option=>option.availability==='concept') ? 'Tool concepts' : 'Tools'}</span></button>
              </div>}
              {conceptMode && <p className="desk-concept-note"><LockKeyhole size={14}/> Design previews only. These editor concepts are not in the current app.</p>}
              {options.length ? <>
                <div ref={operationListRef} className={`desk-operation-list ${options.length > 6 ? 'is-scrollable' : ''}`} role="group" aria-label={`${family.name} ${mode === 'convert' ? 'formats' : 'tools'}`}>
                  {options.map((operation, index) => <button type="button" key={operation.label} aria-pressed={selected?.label === operation.label} onClick={() => selectStep({ familyId: family.id, mode, index })} className="desk-operation">
                    <span className="desk-operation-number">{String(index + 1).padStart(2, '0')}</span><span className="desk-operation-label">{operation.label}</span><ArrowUpRight size={16} strokeWidth={1.7}/>
                  </button>)}
                </div>
              </> : <div className="desk-empty"><LockKeyhole size={20}/><strong>{family.status === 'disabled' ? 'This route is paused.' : 'No separate tool window yet.'}</strong><p>{family.status === 'disabled' ? family.detail : family.caveat}</p></div>}
              <div className="desk-selected" aria-live={autoplay ? 'off' : 'polite'}><div className="desk-selected-top"><span>{conceptMode ? '03 / PLANNED INTERACTION' : '03 / EXPECTED RESULT'}</span><span>{options.length ? `${currentIndex} OF ${options.length}` : 'NO ACTION'}</span></div><h4>{selected?.label ?? 'Available when verified'}</h4><p>{selected?.detail ?? family.caveat}</p><small>{selected?.backend??family.backend}</small></div>
            </div>
          </div>
          <div className="desk-workspace-bottom"><p>{family.caveat}</p><span>{family.formats}</span></div>
        </div>
      </div>
    </section>

    <section className="tool-ledger" aria-labelledby="ledger-title">
      <div className="tool-ledger-intro"><p className="tools-kicker"><span/> A CLEAR VIEW OF WHAT'S HERE</p><h2 id="ledger-title">Useful now.<br/><em>Honest about later.</em></h2><p>Routes appear in Santra only when the selected file and local backend support them. The web preview explains the scope; it does not process files.</p></div>
      <div className="tool-ledger-rows">
        <div className="ledger-row"><span className="ledger-index">01 / BUILT IN</span><h3>Everyday work, ready locally.</h3><p>Raster images, SRT/VTT subtitles, and bounded ZIP/TAR/GZIP workflows.</p><span className="ledger-mark status-bundled"/></div>
        <div className="ledger-row"><span className="ledger-index">02 / WHEN DETECTED</span><h3>More range from local engines.</h3><p>FFmpeg media, qpdf and Poppler PDF actions, and verified Pandoc document routes.</p><span className="ledger-mark status-conditional"/></div>
        <div className="ledger-row"><span className="ledger-index">03 / NOT ENABLED</span><h3>Planned, clearly marked.</h3><p>The audio editor animations are design concepts. Office conversion, PDF reconstruction, and other proposed routes remain disabled in the app.</p><span className="ledger-mark status-disabled"/></div>
      </div>
    </section>

    <section className="tools-closing"><div><p className="tools-kicker"><span/> BRING THE WORK HOME</p><h2>Keep the original.<br/><em>Make the next version.</em></h2></div><div><p>Santra is a desktop preview for Windows and Linux. The current Linux packages are available in the install section.</p><button type="button" onClick={onInstall} className="tools-install-button">Choose your installer <ArrowRight size={17}/></button></div></section>
  </main>;
}
