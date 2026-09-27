import { useEffect, useMemo, useRef, type RefObject } from 'react';

export const MIN_TITLE_REVEAL_PX = 8;
const TITLE_MARQUEE_PX_PER_MS = 0.03;

function placeTitle(title: HTMLElement, left: number, range: number): void {
  if (typeof title.scrollTo === 'function') {
    title.scrollTo({ left, behavior: 'instant' });
  } else {
    title.scrollLeft = left;
  }
  if (left > 0) {
    title.dataset.scrolled = '';
  } else {
    delete title.dataset.scrolled;
  }
  if (left < range) {
    title.dataset.clipped = '';
  } else {
    delete title.dataset.clipped;
  }
}

function restTitle(title: HTMLElement): void {
  if (typeof title.scrollTo === 'function') {
    title.scrollTo({ left: 0, behavior: 'instant' });
  } else {
    title.scrollLeft = 0;
  }
  delete title.dataset.scrolled;
  delete title.dataset.clipped;
}

export function useTitleMarquee(titleRef: RefObject<HTMLElement | null>): {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
} {
  const frameRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return useMemo(
    () => ({
      onPointerEnter: () => {
        const element = titleRef.current;
        if (!element) return;
        const range = element.scrollWidth - element.clientWidth;
        if (range <= MIN_TITLE_REVEAL_PX) return;

        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
          placeTitle(element, range, range);
          return;
        }

        cancelAnimationFrame(frameRef.current);
        let previous: number | undefined;
        let position = 0;
        const step = (now: DOMHighResTimeStamp) => {
          position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
          previous = now;
          placeTitle(element, Math.min(position, range), range);
          if (position < range) {
            frameRef.current = requestAnimationFrame(step);
          }
        };
        frameRef.current = requestAnimationFrame(step);
      },
      onPointerLeave: () => {
        cancelAnimationFrame(frameRef.current);
        const element = titleRef.current;
        if (!element) return;
        restTitle(element);
      },
    }),
    [titleRef],
  );
}
