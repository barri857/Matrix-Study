'use client';

import { useRef, useState } from 'react';
import { Download, Upload, FolderCheck } from 'lucide-react';
import type { Kit } from '@/lib/study';
import { emptyWorkspace, type Workspace } from '@/lib/workspace';
import { createTransferBundle, parseTransferBundle, planTransferImport, safeTransferWorkspace, transferCounts, TRANSFER_MAX_BYTES, type TransferBundle } from '@/lib/transfer';

type Props = {
  kits: Kit[];
  userKey: string;
  /** Adds these new validated copies; existing kit IDs are never sent for replacement. */
  onImportKits: (kits: Kit[]) => void | Promise<void>;
  notify: (message: string, error?: boolean) => void;
};

type Snapshot = { workspace: Workspace; authenticated: boolean };

async function fetchWorkspace(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { ...init, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again before transferring this account’s workspace.' : 'Your online workspace could not be reached. Please try again.');
    return await response.json() as { authenticated?: boolean; data?: unknown };
  } finally { clearTimeout(timeout); }
}

async function currentSnapshot(userKey: string): Promise<Snapshot> {
  let local = emptyWorkspace();
  const saved = localStorage.getItem(`matrix-workspace-v1:${userKey}`);
  if (saved) {
    try { local = safeTransferWorkspace(JSON.parse(saved)); }
    catch { throw new Error('The saved workspace on this device could not be read. Open your notes or planner and try again.'); }
  }
  if (userKey === 'guest') return { workspace: local, authenticated: false };
  const response = await fetchWorkspace('/api/workspace');
  if (!response.authenticated) throw new Error('Sign in again before transferring this account’s workspace.');
  const remote = response.data ? safeTransferWorkspace(response.data) : emptyWorkspace();
  return { workspace: remote.updatedAt >= local.updatedAt ? remote : local, authenticated: true };
}

export default function DataTransfer({ kits, userKey, onImportKits, notify }: Props) {
  const [busy, setBusy] = useState('');
  const [incoming, setIncoming] = useState<TransferBundle | null>(null);
  const [filename, setFilename] = useState('');
  const [replaceCourses, setReplaceCourses] = useState(false);
  const [replaceGrades, setReplaceGrades] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const owner = useRef(userKey);
  owner.current = userKey;

  async function exportWorkspace() {
    const exportingUser = userKey;
    setBusy('Preparing export…');
    try {
      const snapshot = await currentSnapshot(exportingUser);
      if (owner.current !== exportingUser) throw new Error('The signed-in account changed. Start the export again.');
      const bundle = createTransferBundle(kits, snapshot.workspace);
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `matrix-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Workspace exported. Import this file in Matrix on the new website or another device.');
    } catch (error) { notify(error instanceof Error ? error.message : 'The workspace could not be exported.', true); }
    finally { setBusy(''); }
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    setBusy('Reading workspace…');
    try {
      if (file.size > TRANSFER_MAX_BYTES) throw new Error('Choose a Matrix workspace file smaller than 12 MB.');
      const bundle = parseTransferBundle(await file.text());
      setIncoming(bundle); setFilename(file.name); setReplaceCourses(false); setReplaceGrades(false);
    } catch (error) { notify(error instanceof Error ? error.message : 'This workspace file could not be read.', true); }
    finally { setBusy(''); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function importWorkspace() {
    if (!incoming) return;
    const importingUser = userKey;
    let workspaceSaved = false;
    setBusy('Importing workspace…');
    try {
      const current = await currentSnapshot(importingUser);
      if (owner.current !== importingUser) throw new Error('The signed-in account changed. Start the import again.');
      const plan = planTransferImport(kits, current.workspace, incoming, { replaceCoursePlans: replaceCourses, replaceGrades });
      let saved = plan.workspace;
      if (current.authenticated) {
        const response = await fetchWorkspace('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: saved }) });
        if (!response.authenticated || !response.data) throw new Error('The online workspace did not confirm the import. Please try again.');
        const returned = safeTransferWorkspace(response.data);
        if (returned.updatedAt > saved.updatedAt) throw new Error('Your workspace changed on another device. Review the latest changes, then import again.');
        saved = returned;
        workspaceSaved = true;
      }
      if (owner.current !== importingUser) throw new Error('The signed-in account changed during the import. Reopen the correct account to check its workspace.');
      try { localStorage.setItem(`matrix-workspace-v1:${importingUser}`, JSON.stringify(saved)); }
      catch { if (!workspaceSaved) throw new Error('This device is out of storage. Free some space before importing.'); }
      workspaceSaved = true;
      // The parent refreshes any open planner/notebook using this user-scoped event.
      window.dispatchEvent(new CustomEvent('matrix-workspace-imported', { detail: { userKey: importingUser } }));
      await onImportKits(plan.kits);
      setIncoming(null); setFilename('');
      const preserved = plan.keptCoursePlans || plan.keptGradeRows ? ' Existing course plans and grade entries were kept where they overlapped.' : '';
      const skipped = plan.skippedKits ? ` ${plan.skippedKits} identical kit${plan.skippedKits === 1 ? ' was' : 's were'} skipped.` : '';
      notify(`Workspace imported with ${plan.kits.length} new study kit${plan.kits.length === 1 ? '' : 's'}.${skipped}${preserved}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The workspace could not be imported.';
      notify(workspaceSaved ? `Notes and plans were saved, but the study-kit import may be incomplete. ${message}` : message, true);
    } finally { setBusy(''); }
  }

  const counts = incoming ? transferCounts(incoming) : null;
  return <section className="panel" aria-label="Workspace transfer">
    <h3>Move your whole workspace</h3>
    <p className="muted">Download your study kits, notes, tasks, resources, exam plans, and grades. Import the file into Matrix on the new website or another device.</p>
    <p className="tiny muted">AI keys, connection settings, and account details are never included. Your existing work is kept when you import.</p>
    <div className="top-actions" style={{ flexWrap: 'wrap', marginTop: 18 }}>
      <button className="button secondary" disabled={Boolean(busy)} onClick={exportWorkspace}><Download size={17}/>Export workspace</button>
      <button className="button secondary" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><Upload size={17}/>Import workspace</button>
    </div>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => { void chooseFile(event.target.files?.[0]); }}/>
    {busy && <p className="muted" role="status" style={{ marginTop: 16 }}>{busy}</p>}
    {incoming && counts && <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><FolderCheck size={21}/><h4 style={{ margin: 0, overflowWrap: 'anywhere' }}>{filename}</h4></div>
      <p className="muted">{counts.kits} kits · {counts.notes} notes · {counts.tasks} tasks · {counts.resources} resources · {counts.courses} course plans · {counts.grades} grade entries</p>
      <p className="tiny muted">New entries are copied into your workspace. Identical entries are skipped. Matching course plans and your current grade calculator are kept unless you choose below.</p>
      {counts.courses > 0 && <label className="check-row"><input type="checkbox" checked={replaceCourses} disabled={Boolean(busy)} onChange={event => setReplaceCourses(event.target.checked)}/>Use imported exam plans for matching courses</label>}
      {counts.grades > 0 && <label className="check-row"><input type="checkbox" checked={replaceGrades} disabled={Boolean(busy)} onChange={event => setReplaceGrades(event.target.checked)}/>Replace my grade calculator with the imported grades</label>}
      <div className="top-actions" style={{ flexWrap: 'wrap', marginTop: 18 }}><button className="button primary" disabled={Boolean(busy)} onClick={importWorkspace}>Import into this workspace</button><button className="button ghost" disabled={Boolean(busy)} onClick={() => { setIncoming(null); setFilename(''); }}>Cancel</button></div>
    </div>}
  </section>;
}
