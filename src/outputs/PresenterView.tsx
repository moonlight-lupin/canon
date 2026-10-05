// Slides: the presenter view (current and next slide, clock, notes).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n.tsx';
import type { Lang, RenderedService } from '../types-client.ts';
import { Bi, biText, timeRange } from './content.tsx';
import { slideText, type SlideDef } from './slideModel.ts';
import { type Blank, Stage } from './slide-fit.tsx';
import './outputs.css';

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return now;
}

export function PresenterView({
  r, curFaceBlank, nextFace, blank, item, idx, n, controls, options, slides, langs, go, overview, digits,
}: {
  r: RenderedService;
  nextFace: ReactNode;
  blank: Blank;
  curFaceBlank: ReactNode;
  item: RenderedService['items'][number] | undefined;
  idx: number;
  n: number;
  controls: ReactNode;
  options: ReactNode;
  slides: SlideDef[];
  langs: Lang[];
  go: (i: number) => void;
  overview: ReactNode;
  digits: string;
}) {
  const { t } = useI18n();
  const now = useClock();
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [idx]);
  return (
    <div className="sp-root">
      <div className="sp-top">
        <div className="sp-title"><Bi v={r.title} langs={langs} /> <span className="muted">· {timeRange(r)}</span></div>
        <div className="row">{options}</div>
        <div className="sp-clock">{now.toLocaleTimeString('en-GB')}</div>
      </div>
      <div className="sp-main">
        <div className="sp-cur">
          <div className="sp-label">{t('Current slide')} {idx + 1} / {n}{blank !== 'none' && <span className="badge warn" style={{ marginLeft: 8 }}>{blank === 'black' ? t('Black screen') : t('Clear text')}</span>}</div>
          <Stage onClick={() => go(idx + 1)}>{curFaceBlank}</Stage>
          <div className="row sp-controls">{controls}{digits && <span className="kbd">{digits}</span>}</div>
        </div>
        <div className="sp-side">
          <div className="sp-label">{t('Next slide')}</div>
          {nextFace ? <Stage>{nextFace}</Stage> : <div className="sp-end">{t('End of slides')}</div>}
          {item && (
            <div className="sp-item">
              <div className="sp-item-time">{item.start}–{item.end} · {item.duration_min} {t('min')}</div>
              <div className="sp-item-title"><Bi v={item.title} langs={langs} /></div>
              {biText(item.subtitle, langs) && <div className="sp-item-sub"><Bi v={item.subtitle} langs={langs} sep="  ·  " /></div>}
              {(item.leader || item.role_name) && (
                <div className="sp-item-who">{item.role_name && <Bi v={item.role_name} langs={langs} />}{item.role_name && item.leader && ': '}{item.leader}</div>
              )}
              {item.notes && <div className="sp-notes">{item.notes}</div>}
            </div>
          )}
        </div>
      </div>
      <div className="sp-strip" ref={stripRef}>
        {slides.map((s, i) => (
          <button key={s.key} className={`sp-strip-item${i === idx ? ' on' : ''}`} onClick={() => go(i)} title={slideText(s, langs)}>
            <span className="n">{i + 1}</span>
            <span className="txt">{slideText(s, langs, 40)}</span>
          </button>
        ))}
      </div>
      {overview}
    </div>
  );
}
