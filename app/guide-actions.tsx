'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Download, ImagePlus, Pencil, RefreshCw, Sparkles, Square, Volume2, X } from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '@/lib/i18n';
import { guideActionTranslations } from './guide-action-translations';
import styles from './guide-actions.module.css';

type GuideActionsProps = {
  hasGuide: boolean;
  hasReadableContent: boolean;
  busy: boolean;
  reading?: boolean;
  hasAI?: boolean;
  onRequestAI?: () => void;
  onEdit: () => void;
  onAddImages: (files: File[]) => void;
  onSmartEdit: (instruction: string) => Promise<string>;
  onApplySmartEdit: (nextGuide: string) => void;
  onRegenerate: () => void | Promise<void>;
  onReadAloud: () => void;
  onDownload: () => void;
};

type GuideDialog = 'smart' | 'regenerate';

export function GuideActions({
  hasGuide, hasReadableContent, busy, reading = false, hasAI = true,
  onRequestAI, onEdit, onAddImages, onSmartEdit, onApplySmartEdit,
  onRegenerate, onReadAloud, onDownload,
}: GuideActionsProps) {
  const { t } = useLanguage(guideActionTranslations);
  const trigger = useRef<HTMLButtonElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const openingDialog = useRef(false);
  const [dialog, setDialog] = useState<GuideDialog | null>(null);
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (draft !== null) previewHeading.current?.focus();
  }, [draft]);

  function openDialog(next: GuideDialog) {
    if (!hasAI && onRequestAI) {
      openingDialog.current = true;
      onRequestAI();
      return;
    }
    openingDialog.current = true;
    setInstruction('');
    setDraft(null);
    setError('');
    setDialog(next);
  }

  async function previewEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = instruction.trim();
    if (!request || working || busy) return;
    setWorking(true);
    setError('');
    try {
      const result = await onSmartEdit(request);
      if (!result.trim()) throw new Error(t('The AI returned an empty guide. Please try again.'));
      setDraft(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not edit the guide. Please try again.'));
    } finally {
      setWorking(false);
    }
  }

  function closeDialog() {
    if (!working) setDialog(null);
  }

  async function regenerate() {
    if (working || busy) return;
    setWorking(true);
    setError('');
    try {
      await onRegenerate();
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not regenerate the guide. Please try again.'));
    } finally {
      setWorking(false);
    }
  }

  function applyEdit() {
    if (draft === null) return;
    try {
      onApplySmartEdit(draft);
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not edit the guide. Please try again.'));
    }
  }

  return <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button ref={trigger} type="button" className="button secondary small" disabled={busy}>
          {t('Actions')} <ChevronDown size={15} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.menu}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={event => {
            if (openingDialog.current) event.preventDefault();
            openingDialog.current = false;
          }}
        >
          <DropdownMenu.Item className={styles.item} onSelect={onEdit}>
            <Pencil size={16} aria-hidden="true" /> {t('Edit')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.item} onSelect={() => imageInput.current?.click()}>
            <ImagePlus size={16} aria-hidden="true" /> {t('Add images')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.item} disabled={!reading && !hasReadableContent} onSelect={onReadAloud}>
            {reading ? <Square size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            {t(reading ? 'Stop reading' : 'Read aloud')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.item} aria-haspopup="dialog" disabled={!hasGuide} onSelect={() => openDialog('smart')}>
            <Sparkles size={16} aria-hidden="true" /> {t('Smart edit')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.item} aria-haspopup="dialog" onSelect={() => openDialog('regenerate')}>
            <RefreshCw size={16} aria-hidden="true" /> {t('Regenerate')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.item} disabled={!hasGuide} onSelect={onDownload}>
            <Download size={16} aria-hidden="true" /> {t('Download')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <input
      ref={imageInput}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp"
      hidden
      multiple
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (files.length) onAddImages(files);
      }}
    />

    <Dialog.Root open={dialog !== null} onOpenChange={open => { if (!open) closeDialog(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          aria-busy={working}
          onOpenAutoFocus={event => {
            event.preventDefault();
            if (dialog === 'smart') instructionInput.current?.focus();
            else cancelButton.current?.focus();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="modal-header">
            <Dialog.Title>{dialog === 'regenerate' ? t('Regenerate guide') : t('Smart edit guide')}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-button" type="button" aria-label={t('Close')} disabled={working}>
                <X size={18} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          {dialog === 'regenerate' ? <>
            <div className="modal-body">
              <Dialog.Description className={styles.description}>
                {t('Generate a new guide from your study material? It will replace the current guide text when it is ready.')}
              </Dialog.Description>
              {error && <p role="alert" className={styles.error}>{error}</p>}
            </div>
            <div className="modal-footer">
              <Dialog.Close asChild>
                <button ref={cancelButton} className="button secondary" type="button" disabled={working}>{t('Cancel')}</button>
              </Dialog.Close>
              <button className="button primary" type="button" disabled={busy || working} onClick={regenerate}>
                {t(working ? 'Regenerating…' : 'Regenerate')}
              </button>
            </div>
          </> : <form className={styles.form} onSubmit={previewEdit}>
            <div className="modal-body">
              <Dialog.Description className={styles.description}>
                {t('Describe your changes and review the result before applying it.')}
              </Dialog.Description>
              {draft === null ? <label className="field">
                {t('What should change?')}
                <textarea
                  ref={instructionInput}
                  className="textarea"
                  rows={4}
                  maxLength={3000}
                  required
                  disabled={working}
                  value={instruction}
                  placeholder={t('Example: Add a worked example to the last section.')}
                  onChange={event => setInstruction(event.currentTarget.value)}
                />
              </label> : <div className={styles.preview}>
                <h3 ref={previewHeading} tabIndex={-1}>{t('Proposed guide')}</h3>
                <div className="markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                    a: ({ children }) => <span>{children}</span>,
                    img: ({ alt }) => alt ? <span>{alt}</span> : null,
                  }}>{draft}</ReactMarkdown>
                </div>
              </div>}
              {error && <p role="alert" className={styles.error}>{error}</p>}
            </div>
            <div className="modal-footer">
              <Dialog.Close asChild>
                <button className="button secondary" type="button" disabled={working}>{t('Cancel')}</button>
              </Dialog.Close>
              {draft === null ? <button className="button primary" type="submit" disabled={working || busy || !instruction.trim()}>
                {working ? t('Preparing preview…') : t('Preview changes')}
              </button> : <button className="button primary" type="button" disabled={busy} onClick={applyEdit}>
                {t('Apply changes')}
              </button>}
            </div>
          </form>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}

export default GuideActions;
