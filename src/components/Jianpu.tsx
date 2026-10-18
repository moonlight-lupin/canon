// A song's melody drawn in numbered notation (jianpu, 0.21.0): in the song's editor (redrawn as it is typed) and on
// Outputs → Sheet music. Problems are shown in Canon's words where it has them (shared/jianpu-messages.ts), else in
// jpFun's own (Chinese), with the line and column; jpFun's message is kept as the tooltip.
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { renderJianpu, type JianpuProblem } from './jianpu.ts';
import { fillHint, jianpuHint } from '../../shared/jianpu-messages.ts';

export function JianpuView({ source, delay = 0, problems: showProblems = false, className }: {
  source: string;
  /** wait this long (ms) after the last change before drawing (while typing) */
  delay?: number;
  /** list what jpFun found wrong under the drawing */
  problems?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [problems, setProblems] = useState<JianpuProblem[]>([]);
  const [state, setState] = useState<'drawing' | 'done' | 'failed'>('drawing');
  useEffect(() => {
    let live = true;
    if (!source.trim()) {
      box.current?.replaceChildren();
      setProblems([]);
      setState('done');
      return;
    }
    const timer = window.setTimeout(() => {
      renderJianpu(source).then((r) => {
        if (!live || !box.current) return;
        // a page that can't be drawn keeps the last good drawing while typing
        if (r.pages.length || !delay) box.current.replaceChildren(...r.pages);
        setProblems(r.problems);
        setState(r.pages.length ? 'done' : 'failed');
      }, () => live && setState('failed'));
    }, delay);
    return () => { live = false; window.clearTimeout(timer); };
  }, [source, delay]);
  return (
    <div className={`jianpu ${className ?? ''}`}>
      <div ref={box} className="jianpu-pages" />
      {state === 'drawing' && <div className="small muted">{t('Drawing the melody…')}</div>}
      {state === 'failed' && !showProblems && <div className="small muted">{t('This melody could not be drawn. Open the song in the Library to correct it.')}</div>}
      {showProblems && problems.length > 0 && (
        <ul className="jianpu-problems small">
          {problems.map((p, i) => {
            const hint = jianpuHint(p.code, p.message);
            return (
              <li key={i} className={p.error ? 'error' : 'muted'} title={hint ? p.message : undefined}>
                {t('Line {l}, column {c}').replace('{l}', String(p.line)).replace('{c}', String(p.column))}: {hint ? fillHint(t(hint.template), hint.vars) : p.message}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
