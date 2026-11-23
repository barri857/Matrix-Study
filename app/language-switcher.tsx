'use client';

import { useId } from 'react';
import { useLanguage, type Language } from '@/lib/i18n';
import styles from './language-switcher.module.css';

const choices: { value: Language; name: string }[] = [
  { value: 'en', name: 'English' },
  { value: 'ru', name: 'Русский' },
  { value: 'kk', name: 'Қазақша' },
];

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  const headingId = useId();
  return <div className={styles.setting}>
    <h3 id={headingId}>{t('Interface language')}</h3>
    <div className={styles.switcher} role="group" aria-labelledby={headingId}>
      {choices.map(choice => <button key={choice.value} type="button" lang={choice.value}
        className={styles.choice} aria-pressed={language === choice.value}
        onClick={() => setLanguage(choice.value)}>{choice.name}</button>)}
    </div>
  </div>;
}
