'use client';

import { Languages } from 'lucide-react';
import { useLanguage, type Language } from '@/lib/i18n';
import styles from './language-switcher.module.css';

const choices: { value: Language; label: string; name: string }[] = [
  { value: 'en', label: 'ENG', name: 'English' },
  { value: 'ru', label: 'РУС', name: 'Русский' },
  { value: 'kk', label: 'ҚАЗ', name: 'Қазақша' },
];

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  return <div className={styles.switcher} role="group" aria-label={t('Interface language')}>
    <Languages size={15} aria-hidden="true" className={styles.icon}/>
    {choices.map(choice => <button key={choice.value} type="button" lang={choice.value}
      className={styles.choice} aria-label={choice.name} title={choice.name}
      aria-pressed={language === choice.value} onClick={() => setLanguage(choice.value)}>{choice.label}</button>)}
  </div>;
}
