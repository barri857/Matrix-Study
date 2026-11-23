'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileText, GraduationCap, Link2, NotebookPen, Plus, Search, Trash2 } from 'lucide-react';
import type { Kit } from '@/lib/study';
import { useLanguage } from '@/lib/i18n';
import { superToolsTranslations } from '@/lib/super-tools-translations';
import { emptyCourseExams, emptyWorkspace, examTypes, gradeSummary, hasWorkspaceContent, mergeGuestWorkspace, pendingWorkspaceBody, readWorkspace, safeBookmarkUrl, updateCourseExam, type Exam, type ExamType, type Workspace } from '@/lib/workspace';
import './super-tools.css';

type Props = {
  view: 'courses' | 'planner' | 'notes' | 'resources' | 'grades';
  kits: Kit[];
  userKey: string;
  onStudy: (id: string, mode: 'guide' | 'test' | 'smart') => void;
  onPractice?: (ids: string[], variant: number) => void;
  onCreate?: () => void;
  notify: (message: string, error?: boolean) => void;
};
const headings = {
  courses: ['YOUR LEARNING SPACE', 'Courses & exams', 'Your materials, practice, and exam plans in one place.'],
  planner: ['A LITTLE EVERY DAY', 'Study planner', 'Make room for what matters. Turn big goals into small steps.'],
  notes: ['THINK IT THROUGH', 'Your notebook', 'A place for connections, questions, and ideas in your own words.'],
  resources: ['KEEP THE GOOD STUFF', 'Resource library', 'Your useful links, organized and ready when you need them.'],
  grades: ['KNOW WHERE YOU STAND', 'Grade calculator', 'Understand your weighted results and plan your next target.'],
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function SuperTools({ view, kits, userKey, onStudy, onPractice, onCreate, notify }: Props) {
  const { language, t } = useLanguage(superToolsTranslations);
  const locale = language === 'ru' ? 'ru-RU' : language === 'kk' ? 'kk-KZ' : 'en-US';
  const dateLabel = (date: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : t('No date set');
  const tRef = useRef(t);
  tRef.current = t;
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<'loading' | 'local' | 'saving' | 'saved' | 'error'>('loading');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [term, setTerm] = useState<ExamType>('Endterm');
  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'done'>('all');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(today);
  const [taskSubject, setTaskSubject] = useState('');
  const [selectedNote, setSelectedNote] = useState('');
  const [noteSearch, setNoteSearch] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [bookmarkUrl, setBookmarkUrl] = useState('');
  const [bookmarkSubject, setBookmarkSubject] = useState('');
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const [gradeTarget, setGradeTarget] = useState(80);
  const [guestWorkspace, setGuestWorkspace] = useState<Workspace | null>(null);
  const dataRef = useRef(data);
  const dirtyRef = useRef(false);
  const cloudRef = useRef(false);
  const inFlightRef = useRef(0);
  const flushedRef = useRef(0);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const storageKey = `matrix-workspace-v1:${userKey}`;

  useEffect(() => {
    setGuestWorkspace(null);
    if (userKey === 'guest') return;
    try {
      const stored = localStorage.getItem('matrix-workspace-v1:guest');
      if (!stored) return;
      const guest = readWorkspace(JSON.parse(stored));
      const previousImport = localStorage.getItem(`matrix-guest-imported:${userKey}`);
      if (hasWorkspaceContent(guest) && (previousImport === null || Number(previousImport) < guest.updatedAt)) setGuestWorkspace(guest);
    } catch { /* An invalid guest cache is never imported into an account. */ }
  }, [userKey]);

  useEffect(() => {
    let active = true;
    let local = emptyWorkspace();
    setReady(false); setSync('loading'); dirtyRef.current = false; cloudRef.current = false; inFlightRef.current = 0; flushedRef.current = 0;
    try { const saved = localStorage.getItem(storageKey); if (saved) local = readWorkspace(JSON.parse(saved)); } catch { /* A corrupt local cache does not overwrite cloud data. */ }
    dataRef.current = local; setData(local);
    void (async () => {
      try {
        const response = await fetch('/api/workspace', { cache: 'no-store' });
        if (!active) return;
        if (!response.ok) { setSync(response.status === 401 ? 'local' : 'error'); return; }
        const body = await response.json() as { data?: unknown; user?: unknown; authenticated?: boolean };
        if (!active) return;
        cloudRef.current = body.authenticated === true || body.user != null;
        const remote = body.data ? readWorkspace(body.data) : null;
        if (remote && !dirtyRef.current && remote.updatedAt >= local.updatedAt) {
          dataRef.current = remote; setData(remote);
          try { localStorage.setItem(storageKey, JSON.stringify(remote)); } catch { /* Cloud copy remains available. */ }
          setSync('saved');
        } else if (local.updatedAt > 0 && cloudRef.current) { dirtyRef.current = true; setSync('saving'); }
        else setSync(cloudRef.current ? 'saved' : 'local');
      } catch { if (active) setSync('error'); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    const flush = () => {
      const latest = dataRef.current;
      const body = pendingWorkspaceBody(latest, dirtyRef.current, cloudRef.current, Math.max(inFlightRef.current, flushedRef.current));
      if (!body) return;
      flushedRef.current = latest.updatedAt;
      // The local copy is already durable. This final request survives navigation;
      // the server rejects stale timestamps if a newer save reaches it first.
      void fetch('/api/workspace', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body })
        .catch(() => { /* The next visit retries the newer local copy. */ });
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [storageKey]);

  const change = useCallback((update: (current: Workspace) => Workspace) => {
    const next = { ...update(dataRef.current), updatedAt: Math.max(Date.now(), dataRef.current.updatedAt + 1) };
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 280000) { notifyRef.current(tRef.current('Your workspace is full. Shorten a note or remove old items before saving.'), true); return false; }
    dataRef.current = next; dirtyRef.current = true; setData(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { notifyRef.current(tRef.current('Device storage is full. Keep this page open until cloud saving finishes.'), true); }
    setSync(cloudRef.current ? 'saving' : 'local');
    return true;
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !dirtyRef.current || !cloudRef.current) return;
    let active = true;
    const timer = setTimeout(async () => {
      const saving = dataRef.current;
      inFlightRef.current = saving.updatedAt;
      try {
        const response = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: saving }) });
        if (!active) return;
        if (!response.ok) { if (response.status === 401) cloudRef.current = false; throw new Error(); }
        const body = await response.json() as { data?: unknown };
        if (!active) return;
        if (dataRef.current.updatedAt === saving.updatedAt) {
          if (body.data) {
            const saved = readWorkspace(body.data);
            if (saved.updatedAt > saving.updatedAt) {
              dataRef.current = saved; setData(saved);
              try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Cloud copy is saved. */ }
              notifyRef.current(tRef.current('A newer workspace from another device has been loaded.'));
            }
          }
          dirtyRef.current = false; setSync('saved');
        }
      } catch { if (active) setSync(cloudRef.current ? 'error' : 'local'); }
      finally { if (inFlightRef.current === saving.updatedAt) inFlightRef.current = 0; }
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [data, ready, storageKey]);

  const subjects = useMemo(() => [...new Set([...kits.map(kit => kit.subject || 'General'), ...Object.keys(data.courses)])].sort(), [kits, data.courses]);
  const course = subjects.includes(selectedCourse) ? selectedCourse : subjects[0] || 'General';
  const courseKits = kits.filter(kit => (kit.subject || 'General') === course);
  const practiceKits = courseKits.filter(kit => kit.questions.length > 0);
  const practiceQuestionCount = Math.min(30, practiceKits.reduce((sum, kit) => sum + kit.questions.length, 0));
  const courseExams = data.courses[course] ?? emptyCourseExams();
  const exam = courseExams[term];
  const examName = term === 'Custom' ? courseExams.Custom.title.trim() || t('Custom exam') : t(term);
  const updateExam = (patch: Partial<Exam> & { title?: string }) => change(current => ({ ...current, courses: { ...current.courses, [course]: updateCourseExam(current.courses[course], term, patch) } }));
  const notes = data.notes.filter(note => `${note.title} ${note.body} ${note.subject}`.toLowerCase().includes(noteSearch.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  const note = data.notes.find(item => item.id === selectedNote) ?? notes[0];
  const activeTasks = data.tasks.filter(task => !task.done);
  const completed = data.tasks.length - activeTasks.length;
  const progress = data.tasks.length ? Math.round(completed / data.tasks.length * 100) : 0;
  const sortedTasks = data.tasks.filter(task => taskFilter === 'all' || (taskFilter === 'done' ? task.done : !task.done)).sort((a, b) => Number(a.done) - Number(b.done) || (a.date || '9999').localeCompare(b.date || '9999'));
  const resourceList = data.bookmarks.filter(bookmark => `${bookmark.title} ${bookmark.subject} ${bookmark.url}`.toLowerCase().includes(resourceSearch.toLowerCase()));
  const grades = gradeSummary(data.grades);
  const remainingWeight = 100 - grades.weight;
  const neededScore = remainingWeight > 0 ? (gradeTarget - grades.points) * 100 / remainingWeight : null;
  const syncLabel = sync === 'loading' ? 'Opening workspace' : sync === 'saving' ? 'Saving changes…' : sync === 'saved' ? 'Saved across devices' : sync === 'error' ? 'Saved on device · sync unavailable' : 'Saved on this device';
  const [eyebrow, heading, description] = headings[view].map(value => t(value));

  return <div className="super-tools">
    <div className="page-heading super-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{heading}</h1><p>{description}</p></div><span className="super-sync"><CheckCircle2 size={15} />{t(syncLabel)}</span></div>
    {guestWorkspace && <div className="super-guest-import"><div><h3>{t("Bring your guest work with you")}</h3><p>{t("You have notes, plans, or resources from guest mode on this device. Import them into this account; existing course plans and grade entries will stay unchanged.")}</p></div><button className="button secondary" disabled={!ready || !cloudRef.current} onClick={() => {
      try {
        const combined = mergeGuestWorkspace(dataRef.current, guestWorkspace);
        if (!change(() => combined)) return;
        try { localStorage.setItem(`matrix-guest-imported:${userKey}`, String(guestWorkspace.updatedAt)); } catch { /* Identical entries are deduplicated if this prompt reappears. */ }
        setGuestWorkspace(null);
        notify(t('Guest workspace imported. Your existing course plans and grades were kept.'));
      } catch (error) { notify(error instanceof Error ? t(error.message) : t('The guest workspace could not be imported.'), true); }
    }}>{t("Import guest workspace")}</button></div>}
    {!ready && <div className="notice">{t("Loading your saved workspace…")}</div>}
    <fieldset className="super-fieldset" disabled={!ready}>
    {view === 'courses' && <>
      <div className="super-course-tabs" role="tablist" aria-label={t("Courses")}>{subjects.length ? subjects.map(subject => <button key={subject} role="tab" aria-selected={course === subject} className={`super-course-tab ${course === subject ? 'selected' : ''}`} onClick={() => setSelectedCourse(subject)}><BookOpen size={18}/>{subject}<span>{kits.filter(kit => kit.subject === subject).length}</span></button>) : <div className="notice">{t("Create a study kit to build your first course. Kits are grouped by subject here.")}</div>}</div>
      <div className="super-course-layout">
        <section>
          <div className="super-course-banner"><div className="super-course-symbol"><GraduationCap size={34}/></div><div><span className="eyebrow">{t("COURSE WORKSPACE")}</span><h2>{course}</h2><p>{t('Study kits: {kits} · Practice questions: {questions} · Flashcards: {cards}', { kits: courseKits.length, questions: courseKits.reduce((sum, kit) => sum + kit.questions.length, 0), cards: courseKits.reduce((sum, kit) => sum + kit.cards.length, 0) })}</p></div></div>
          <div className="section-heading"><h2>{t("Lectures & topics")}</h2>{onCreate ? <button className="button secondary small" onClick={onCreate}><Plus size={16}/>{t("Add materials")}</button> : <span className="muted">{t("Open a topic to explore")}</span>}</div>
          <div className="super-lectures">{courseKits.length ? courseKits.map(kit => <details key={kit.id} className="super-lecture"><summary><div className="super-lecture-icon" style={{ color: kit.color }}><FileText size={21}/></div><div><h3>{kit.title}</h3><span>{t('Questions: {questions} · Cards: {cards}', { questions: kit.questions.length, cards: kit.cards.length })}{kit.demo ? ` · ${t('Sample kit')}` : ''}</span></div><ChevronDown size={19} /></summary><div className="super-lecture-body"><p>{kit.summary || t('Open the study guide to explore this topic.')}</p><div className="super-topic-list">{kit.guide.split('\n').filter(line => line.startsWith('## ')).slice(0, 8).map((line, index) => <span key={index}><CheckCircle2 size={14}/>{line.slice(3)}</span>)}</div><div className="super-actions"><button className="button secondary" onClick={() => onStudy(kit.id, 'guide')}><BookOpen size={16}/>{t("Read study guide")}</button><button className="button primary" onClick={() => onStudy(kit.id, 'test')} disabled={!kit.questions.length}>{t("Start topic test")}</button><button className="button ghost" onClick={() => onStudy(kit.id, 'smart')} disabled={!kit.questions.length}>{t("Smart practice")}</button></div></div></details>) : <div className="empty-state"><BookOpen size={30}/><h3>{t("Your course starts with a kit")}</h3><p>{t("Create a study kit and assign it to this subject to see lectures and practice here.")}</p></div>}</div>
          <section className="super-variants"><div className="section-heading"><div><span className="eyebrow">{t("CHECK YOUR READINESS")}</span><h2>{t("Practice variants")}</h2></div><span className="pill">{t('Preparing for {exam}', { exam: examName })}</span></div><p className="super-variants-description">{t('Each variant draws shuffled questions from this course’s study kits ({count}). Review your answers and explanations when you finish.', { count: practiceKits.length })}</p><div className="super-variant-grid">{[1, 2, 3].map(variant => <article className="super-variant-card" key={variant}><div className="super-variant-top"><div className="super-feature-icon"><GraduationCap size={22}/></div><span className="super-variant-count">{t('Questions: {count}', { count: practiceQuestionCount })}</span></div><h3>{t('Variant {number}', { number: variant })}</h3><p>{variant === 1 ? t('Find your starting point.') : variant === 2 ? t('Build on what you know.') : t('Check your exam readiness.')}</p><div className="super-variant-details"><span><BookOpen size={14}/>{t('Study kits: {count}', { count: practiceKits.length })}</span><span><CheckCircle2 size={14}/>{t("Answer review")}</span></div><button className="button secondary" disabled={!onPractice || !practiceQuestionCount} onClick={() => onPractice?.(practiceKits.map(kit => kit.id), variant)}>{t('Start variant {number}', { number: variant })}</button></article>)}</div>{!practiceQuestionCount && <div className="notice super-variant-notice">{t("Add study materials and generate practice questions to unlock course variants.")}{onCreate && <button className="button ghost small" onClick={onCreate}>{t("Add materials")}</button>}</div>}</section>
        </section>
        <aside className="super-course-aside">
          <section className="panel">
            <div className="panel-title"><CalendarDays size={19}/><h3>{t("Exam planning")}</h3></div>
            <div className="tabs super-term-tabs" role="group" aria-label={t("Exam type")} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>{examTypes.map(value => <button key={value} type="button" aria-pressed={term === value} className={`tab ${term === value ? 'active' : ''}`} onClick={() => setTerm(value)} style={{ whiteSpace: 'normal', paddingInline: 8, fontSize: '0.8125rem' }}>{t(value)}</button>)}</div>
            <div className="super-stack">
              {term === 'Custom' && <label className="field">{t("Exam name")}<input className="input" maxLength={160} placeholder={t("e.g. Algorithms quiz or certification")} value={courseExams.Custom.title} onChange={event => updateExam({ title: event.target.value })}/></label>}
              <label className="field">{t('Date for {exam}', { exam: examName })}<input className="input" type="date" value={exam.date} onChange={event => updateExam({ date: event.target.value })}/></label>
              <div className="super-two-fields"><label className="field">{t("Time")}<input className="input" type="time" value={exam.time} onChange={event => updateExam({ time: event.target.value })}/></label><label className="field">{t("Grade weight (%)")}<input className="input" type="number" min="0" max="100" value={exam.weight || ''} placeholder={t("e.g. 40")} onChange={event => updateExam({ weight: Math.min(100, Math.max(0, Number(event.target.value))) })}/></label></div>
              <label className="field">{t("What to prepare")}<textarea className="textarea" rows={4} maxLength={10000} placeholder={t("Topics, room, allowed materials…")} value={exam.notes} onChange={event => updateExam({ notes: event.target.value })}/></label>
            </div>
            <p className="tiny muted">{t("Each exam keeps its own date and preparation notes.")}</p>
            {exam.date && <p className="super-exam-caption"><Clock3 size={16}/>{dateLabel(exam.date)}{exam.time ? ` · ${exam.time}` : ''}</p>}
          </section>
          <section className="panel"><div className="panel-title"><Link2 size={18}/><h3>{t("Course resources")}</h3></div>{data.bookmarks.filter(bookmark => bookmark.subject === course).length ? data.bookmarks.filter(bookmark => bookmark.subject === course).map(bookmark => <a className="super-resource-mini" href={bookmark.url} key={bookmark.id} target="_blank" rel="noopener noreferrer"><span>{bookmark.title}</span><ExternalLink size={15}/></a>) : <p className="muted">{t('Add links in Resource library and select {course} to collect them here.', { course })}</p>}</section>
        </aside>
      </div>
    </>}

    {view === 'planner' && <>
      <div className="super-planner-overview"><div><div className="eyebrow">{t("YOUR PLAN, YOUR PACE")}</div><h2>{activeTasks.length ? t('Steps to keep you moving: {count}', { count: activeTasks.length }) : data.tasks.length ? t('A clear plan. A clear mind.') : t('Start with one small step.')}</h2><p>{t('Completed: {done} · Overdue: {overdue}', { done: completed, overdue: activeTasks.filter(task => task.date && task.date < today()).length })}</p></div><div className="super-completion"><strong>{progress}%</strong><span>{t("completed")}</span><div className="super-progress-track"><i style={{ width: `${progress}%` }}/></div></div></div>
      <form className="panel super-task-form" onSubmit={event => { event.preventDefault(); if (!taskTitle.trim()) return; if (data.tasks.length >= 500) return notify(t('You can keep up to 500 tasks. Remove old tasks to add more.'), true); change(current => ({ ...current, tasks: [...current.tasks, { id: crypto.randomUUID(), title: taskTitle.trim(), date: taskDate, subject: taskSubject, done: false }] })); setTaskTitle(''); }}><label className="field super-grow">{t("What is your next step?")}<input className="input" placeholder={t("Review chapter 3 before the final")} maxLength={300} required value={taskTitle} onChange={event => setTaskTitle(event.target.value)}/></label><label className="field">{t("Due date")}<input className="input" type="date" value={taskDate} onChange={event => setTaskDate(event.target.value)}/></label><label className="field">{t("Subject")}<select className="select" value={taskSubject} onChange={event => setTaskSubject(event.target.value)}><option value="">{t("General")}</option>{subjects.map(subject => <option key={subject}>{subject}</option>)}</select></label><button className="button primary" type="submit"><Plus size={18}/>{t("Add task")}</button></form>
      <div className="section-heading"><div className="tabs">{(['all', 'open', 'done'] as const).map(filter => <button key={filter} className={`tab ${taskFilter === filter ? 'active' : ''}`} onClick={() => setTaskFilter(filter)}>{filter === 'all' ? t('All tasks') : filter === 'open' ? t('To do') : t('Completed')}</button>)}</div><span className="muted">{t('Tasks: {count}', { count: sortedTasks.length })}</span></div>
      <div className="super-tasks">{sortedTasks.length ? sortedTasks.map(task => <div key={task.id} className={`super-task ${task.done ? 'done' : ''}`}><button className="super-check" aria-label={task.done ? t('Mark {title} incomplete', { title: task.title }) : t('Complete {title}', { title: task.title })} aria-pressed={task.done} onClick={() => change(current => ({ ...current, tasks: current.tasks.map(item => item.id === task.id ? { ...item, done: !item.done } : item) }))}>{task.done && <Check size={17}/>}</button><div className="super-grow"><strong>{task.title}</strong><span>{task.subject || t('General')}</span></div><span className={`super-task-date ${!task.done && task.date && task.date < today() ? 'overdue' : ''}`}><CalendarDays size={14}/>{task.date === today() ? t('Today') : dateLabel(task.date)}</span><button className="icon-button" aria-label={t('Delete {title}', { title: task.title })} onClick={() => change(current => ({ ...current, tasks: current.tasks.filter(item => item.id !== task.id) }))}><Trash2 size={17}/></button></div>) : <div className="empty-state"><CheckCircle2 size={32}/><h3>{taskFilter === 'done' ? t('Every step will count') : t('Room to focus')}</h3><p>{taskFilter === 'done' ? t('Completed tasks will appear here.') : t('Add a task above to give your next study session a clear direction.')}</p></div>}</div>
    </>}

    {view === 'notes' && <div className="super-notebook"><aside className="super-note-list"><div className="super-note-list-top"><div className="super-search"><Search size={17}/><input aria-label={t("Search notes")} placeholder={t("Search notes…")} value={noteSearch} onChange={event => setNoteSearch(event.target.value)}/></div><button className="button primary" onClick={() => { if (data.notes.length >= 100) return notify(t('Your notebook holds up to 100 notes. Remove an old note to make room.'), true); const id = crypto.randomUUID(); change(current => ({ ...current, notes: [{ id, title: '', body: '', subject: '', updatedAt: Date.now() }, ...current.notes] })); setSelectedNote(id); setNoteSearch(''); }}><Plus size={17}/>{t("New note")}</button></div><div className="super-note-items">{notes.map(item => <button key={item.id} className={`super-note-preview ${note?.id === item.id ? 'selected' : ''}`} onClick={() => { setSelectedNote(item.id); setDeleteNote(null); }}><div><NotebookPen size={16}/><span>{item.subject || t('Personal note')}</span></div><h3>{item.title || t('Untitled note')}</h3><p>{item.body.slice(0, 100) || t('Start writing your ideas…')}</p><time>{new Date(item.updatedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</time></button>)}{!notes.length && <p className="super-note-hint">{noteSearch ? t('No notes match your search.') : t('Your ideas will live here.')}</p>}</div></aside><section className="super-note-editor">{note ? <><div className="super-note-editor-toolbar"><select className="select" aria-label={t("Note subject")} value={note.subject} onChange={event => change(current => ({ ...current, notes: current.notes.map(item => item.id === note.id ? { ...item, subject: event.target.value, updatedAt: Date.now() } : item) }))}><option value="">{t("Personal note")}</option>{subjects.map(subject => <option key={subject}>{subject}</option>)}</select><span className="muted">{t("Autosaved")}</span><button className="icon-button" aria-label={t("Delete this note")} onClick={() => setDeleteNote(note.id)}><Trash2 size={18}/></button></div>{deleteNote === note.id && <div className="super-delete-confirm"><span>{t("Delete this note permanently?")}</span><button className="button danger small" onClick={() => { change(current => ({ ...current, notes: current.notes.filter(item => item.id !== note.id) })); setSelectedNote(''); setDeleteNote(null); }}>{t("Delete note")}</button><button className="button ghost small" onClick={() => setDeleteNote(null)}>{t("Keep note")}</button></div>}<input className="super-note-title" aria-label={t("Note title")} placeholder={t("Untitled note")} value={note.title} maxLength={300} onChange={event => change(current => ({ ...current, notes: current.notes.map(item => item.id === note.id ? { ...item, title: event.target.value, updatedAt: Date.now() } : item) }))}/><textarea className="super-note-body" aria-label={t("Note content")} placeholder={t("What did you learn? What are you still wondering about?")} maxLength={30000} value={note.body} onChange={event => change(current => ({ ...current, notes: current.notes.map(item => item.id === note.id ? { ...item, body: event.target.value, updatedAt: Date.now() } : item) }))}/><div className="super-note-status"><span>{t('Words: {count}', { count: note.body.trim() ? note.body.trim().split(/\s+/).length : 0 })}</span><span>{t('{count} / 30,000 characters', { count: note.body.length.toLocaleString(locale) })}</span></div></> : <div className="empty-state"><NotebookPen size={36}/><h3>{t("Make the knowledge your own")}</h3><p>{t("Create a note to capture your explanations, class notes, and ideas.")}</p></div>}</section></div>}

    {view === 'resources' && <>
      <form className="panel super-bookmark-form" onSubmit={event => { event.preventDefault(); const url = safeBookmarkUrl(bookmarkUrl.trim()); if (!url) return notify(t('Use a complete HTTPS link, such as https://example.com.'), true); if (data.bookmarks.length >= 300) return notify(t('You can save up to 300 links. Remove an old link first.'), true); change(current => ({ ...current, bookmarks: [{ id: crypto.randomUUID(), title: bookmarkTitle.trim() || new URL(url).hostname, url, subject: bookmarkSubject }, ...current.bookmarks] })); setBookmarkTitle(''); setBookmarkUrl(''); notify(t('Resource saved.')); }}><div className="super-bookmark-intro"><div className="super-feature-icon"><Link2 size={23}/></div><div><h3>{t("Save something worth coming back to")}</h3><p>{t("Lectures, articles, course pages, and helpful videos.")}</p></div></div><div className="super-bookmark-fields"><label className="field">{t("Title")}<input className="input" required maxLength={300} placeholder={t("A useful resource")} value={bookmarkTitle} onChange={event => setBookmarkTitle(event.target.value)}/></label><label className="field super-grow">{t("Link")}<input className="input" type="url" required maxLength={4000} placeholder="https://…" value={bookmarkUrl} onChange={event => setBookmarkUrl(event.target.value)}/></label><label className="field">{t("Subject")}<select className="select" value={bookmarkSubject} onChange={event => setBookmarkSubject(event.target.value)}><option value="">{t("General")}</option>{subjects.map(subject => <option key={subject}>{subject}</option>)}</select></label><button className="button primary" type="submit"><Plus size={17}/>{t("Save link")}</button></div></form>
      <div className="section-heading"><h2>{t("Saved resources")} <span className="muted">{data.bookmarks.length}</span></h2><div className="super-search"><Search size={17}/><input aria-label={t("Search resources")} placeholder={t("Find a resource…")} value={resourceSearch} onChange={event => setResourceSearch(event.target.value)}/></div></div><div className="super-resource-grid">{resourceList.map(bookmark => <article className="super-resource-card" key={bookmark.id}><div className="super-resource-card-top"><span className="pill">{bookmark.subject || t('General')}</span><button className="icon-button" aria-label={t('Delete {title}', { title: bookmark.title })} onClick={() => change(current => ({ ...current, bookmarks: current.bookmarks.filter(item => item.id !== bookmark.id) }))}><Trash2 size={16}/></button></div><div className="super-feature-icon"><Link2 size={22}/></div><h3>{bookmark.title}</h3><p>{new URL(bookmark.url).hostname}</p><a className="button secondary" href={bookmark.url} target="_blank" rel="noopener noreferrer">{t("Open resource")}<ExternalLink size={15}/></a></article>)}</div>{!resourceList.length && <div className="empty-state"><Link2 size={34}/><h3>{resourceSearch ? t('No matching resources') : t('Your library, thoughtfully collected')}</h3><p>{resourceSearch ? t('Try another title, subject, or website.') : t('Save your first link above. Subject links will also appear in your course workspace.')}</p></div>}
    </>}

    {view === 'grades' && <div className="super-grade-layout"><section><div className="panel"><div className="section-heading"><div><h2>{t("Your assessments")}</h2><p className="muted">{t("Enter scores out of 100 and each assessment’s course weight.")}</p></div><button className="button secondary" onClick={() => { if (data.grades.length >= 100) return; change(current => ({ ...current, grades: [...current.grades, { id: crypto.randomUUID(), title: '', score: 0, weight: 0 }] })); }}><Plus size={16}/>{t("Add assessment")}</button></div><div className="super-grade-labels"><span>{t("Assessment")}</span><span>{t("Score / 100")}</span><span>{t("Weight %")}</span><span/></div>{data.grades.map((row, index) => <div className="super-grade-row" key={row.id}><input className="input" aria-label={t('Assessment {number} name', { number: index + 1 })} placeholder={t("e.g. Final exam")} value={row.title} maxLength={300} onChange={event => change(current => ({ ...current, grades: current.grades.map(item => item.id === row.id ? { ...item, title: event.target.value } : item) }))}/>{(['score', 'weight'] as const).map(field => <input key={field} className="input" type="number" min="0" max="100" step="0.1" aria-label={`${row.title || t('Assessment {number}', { number: index + 1 })}: ${t(field === 'score' ? 'Score / 100' : 'Weight %')}`} value={row[field]} onChange={event => { const value = Number(event.target.value); if (!Number.isFinite(value) || value < 0 || value > 100) return; change(current => ({ ...current, grades: current.grades.map(item => item.id === row.id ? { ...item, [field]: value } : item) })); }}/ >)}<button className="icon-button" aria-label={t('Remove {title}', { title: row.title || t('Assessment') })} onClick={() => change(current => ({ ...current, grades: current.grades.filter(item => item.id !== row.id) }))}><Trash2 size={17}/></button></div>)}{!data.grades.length && <div className="empty-state"><GraduationCap size={32}/><h3>{t("Bring your results together")}</h3><p>{t("Add quizzes, projects, endterms, and finals to calculate a weighted grade.")}</p><button className="button primary" onClick={() => change(current => ({ ...current, grades: [{ id: crypto.randomUUID(), title: t('Coursework'), score: 0, weight: 30 }, { id: crypto.randomUUID(), title: t('Endterm'), score: 0, weight: 30 }, { id: crypto.randomUUID(), title: t('Final exam'), score: 0, weight: 40 }] }))}>{t("Start with three assessments")}</button></div>}<div className="super-weight-total"><span>{t("Total weight")}</span><strong className={grades.weight > 100.01 ? 'super-error' : ''}>{grades.weight.toFixed(1)}%</strong></div><p className={`super-grade-message ${grades.weight > 100.01 ? 'super-error' : ''}`}>{grades.valid ? t('Weights add up to 100%. This is your complete weighted grade.') : grades.weight > 100.01 ? t('Weights exceed 100%. Adjust the weights before using this result.') : t('Add {weight}% more weight for a complete course grade.', { weight: (100 - grades.weight).toFixed(1) })}</p></div><div className="super-grade-explainer"><h3>{t("How it works")}</h3><p>{t('Each score contributes score × weight ÷ 100 points. For example, 80 on an assessment worth 25% contributes 20 course points. Use the weights in your syllabus.')}</p></div></section><aside><section className="super-grade-result"><div className="eyebrow">{grades.valid ? t('WEIGHTED COURSE GRADE') : t('AVERAGE OF ENTERED WORK')}</div><div className="super-grade-number">{grades.weight > 100.01 ? '—' : grades.average.toFixed(1)}<span>%</span></div><p>{grades.weight > 100.01 ? t('Resolve the weight total to see a valid result.') : t('{points} course points earned from {weight}% of the course.', { points: grades.points.toFixed(1), weight: grades.weight.toFixed(1) })}</p><div className="super-progress-track"><i style={{ width: `${Math.min(100, grades.weight)}%` }}/></div></section><section className="panel super-target"><div className="panel-title"><GraduationCap size={19}/><h3>{t("Plan a target")}</h3></div><label className="field">{t("Target course grade (%)")}<input className="input" type="number" min="0" max="100" value={gradeTarget} onChange={event => setGradeTarget(Math.min(100, Math.max(0, Number(event.target.value))))}/></label>{neededScore !== null ? <div className="super-target-result"><strong>{Math.max(0, neededScore).toFixed(1)}%</strong><p>{neededScore > 100 ? t('This target would need more than 100% on the remaining {weight}% of the course.', { weight: remainingWeight.toFixed(1) }) : t('Average needed on the remaining {weight}% of the course.', { weight: remainingWeight.toFixed(1) })}</p></div> : <p className="muted">{grades.valid ? t('All course weight has been entered. Adjust scores to explore another outcome.') : t('Correct the assessment weights to explore a target.')}</p>}<p className="tiny muted">{t("A planning calculation, not an official grade. Extra credit and course-specific rules may differ.")}</p></section></aside></div>}
    </fieldset>
  </div>;
}
