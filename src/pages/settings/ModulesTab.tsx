// Settings → Modules (and onboarding): the optional parts of Canon a church uses. A part switched off is hidden and
// refused, and AI assistants don't see it; its data is kept, so switching it on again brings everything back.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { useAction } from '../../components/ui.tsx';
import { OPTIONAL_LABEL, OPTIONAL_MODULES, type ModuleSwitches, type OptionalModule } from '../../../shared/modules.ts';

export function ModulesPanel({ initial, onSaved }: { initial: ModuleSwitches; onSaved?: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [modules, setModules] = useState(initial);
  const set = (m: OptionalModule, on: boolean) => run(async () => {
    setModules(await api.put<ModuleSwitches>('/modules', { [m]: on }));
    onSaved?.();
  }, t('Saved.'));
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{t('Turn off what your church doesn’t use: it is hidden for everyone and AI assistants don’t see it. Nothing is deleted — turning it on again brings everything back.')}</p>
      {OPTIONAL_MODULES.map((m) => (
        <label key={m} className="check" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={modules[m] !== false} disabled={busy} onChange={(e) => set(m, e.target.checked)} />
          <span><strong>{t(OPTIONAL_LABEL[m].name)}</strong><br /><span className="small muted">{t(OPTIONAL_LABEL[m].description)}</span></span>
        </label>
      ))}
    </div>
  );
}
