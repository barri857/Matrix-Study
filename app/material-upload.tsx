'use client';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { CheckCircle2, FileWarning, LoaderCircle, Upload } from 'lucide-react';
import { readStudyFiles, STUDY_FILE_ACCEPT, type StudyFileResult } from '../lib/files';
import './material-upload.css';

type Props = { value: string; onChange: (text: string) => void; onTitle: (title: string) => void; onBusy: (busy: boolean) => void; notify: (message: string, error?: boolean) => void; disabled: boolean };
export default function MaterialUpload({ value, onChange, onTitle, onBusy, notify, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null), reading = useRef(false), mounted = useRef(true), depth = useRef(0);
  const [dragging, setDragging] = useState(false), [current, setCurrent] = useState(''), [summary, setSummary] = useState('');
  const [results, setResults] = useState<StudyFileResult[]>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function addFiles(files: File[]) {
    if (!files.length || disabled || reading.current) return;
    reading.current = true;
    setResults([]); setSummary(''); setDragging(false); depth.current = 0; onBusy(true);
    try {
      const batch = await readStudyFiles(files, value, progress => {
        if (mounted.current) { setCurrent(`Reading ${progress.index + 1} of ${progress.total}: ${progress.name}`); setResults(progress.results); }
      });
      if (!mounted.current) return;
      const added = batch.results.filter(result => result.status === 'added').length, skipped = batch.results.length - added;
      setResults(batch.results);
      if (added) { onChange(batch.text); onTitle(batch.title); }
      const message = `${added} file${added === 1 ? '' : 's'} added${skipped ? `; ${skipped} could not be added. See details below.` : '. Review the extracted text below.'}`;
      setSummary(message); notify(message, skipped > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'These files could not be read.';
      if (mounted.current) { setSummary(message); notify(message, true); }
    } finally {
      reading.current = false;
      if (mounted.current) setCurrent('');
      if (input.current) input.current.value = '';
      onBusy(false);
    }
  }
  function fileDrag(event: DragEvent) { return Array.from(event.dataTransfer.types).includes('Files'); }
  return <div className="material-upload" aria-busy={Boolean(current)}
    onDragEnter={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); if (!disabled && !reading.current) { depth.current++; setDragging(true); } }}
    onDragOver={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled || reading.current ? 'none' : 'copy'; }}
    onDragLeave={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={event => { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}>
    <input ref={input} type="file" multiple hidden accept={STUDY_FILE_ACCEPT} onChange={event => void addFiles(Array.from(event.target.files || []))} />
    <button type="button" className={`upload-zone${dragging ? ' is-dragging' : ''}${current ? ' is-reading' : ''}`} disabled={disabled || Boolean(current)} onClick={() => input.current?.click()}>
      {current ? <LoaderCircle size={28} className="material-spinner" /> : <Upload size={28} />}
      <strong>{current ? 'Reading your documents…' : dragging ? 'Drop your files here' : 'Drop files here, or click to choose'}</strong>
      <span>PDF, Word, PowerPoint, text & captions</span>
      <span>Up to 20 files · 12 MB each · 120,000 characters combined</span>
    </button>
    <p className="material-upload-note muted tiny">Files are read on your device. PowerPoint imports slide text; images, diagrams and speaker notes are not read.</p>
    <p className="material-upload-status tiny" role="status" aria-live="polite">{current || summary}</p>
    {results.length > 0 && <ul className="material-upload-results" aria-label="File reading results">{results.map((result, index) => <li key={`${index}:${result.name}`} className={result.status}>
      {result.status === 'added' ? <CheckCircle2 size={17} aria-hidden="true" /> : <FileWarning size={17} aria-hidden="true" />}
      <div><strong>{result.name}</strong><span>{result.status === 'added' ? `Added · ${result.characters?.toLocaleString()} characters` : result.message}</span></div>
    </li>)}</ul>}
  </div>;
}
