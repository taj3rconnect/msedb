import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Gap between the pointer and the bottom edge of the tip, in px. */
const POINTER_GAP = 18;
/** Smallest distance the tip keeps from any viewport edge, in px. */
const EDGE_PAD = 8;

/**
 * Cursor-anchored tooltip layer — mount once near the app root.
 *
 * Any element carrying a `data-tip` attribute gets a tooltip that follows the
 * pointer and is drawn ABOVE it. That is the whole point: the native `title`
 * tooltip renders below-right of the cursor, where it covers the next control
 * down, and no amount of CSS can move it. This replaces it.
 *
 * Positioning is written straight to the DOM node rather than held in React
 * state, so a pointermove never re-renders the tree — only a change of tip text
 * does. Elements that can be `disabled` should carry `data-tip` on a wrapping
 * `<span>`, because browsers do not dispatch pointer events on disabled form
 * controls (the event lands on the ancestor instead).
 *
 * A tip may contain newlines; they are preserved (`white-space: pre-line`).
 */
export function CursorTipLayer() {
  const [tip, setTip] = useState<string | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  /** Put the tip above `pointer.current`, clamped inside the viewport. */
  const place = useCallback(() => {
    const node = tipRef.current;
    if (!node) return;

    const { x, y } = pointer.current;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const half = w / 2;

    const minLeft = EDGE_PAD + half;
    const maxLeft = Math.max(minLeft, vw - EDGE_PAD - half);

    // `top` is the tip's BOTTOM edge (translateY(-100%)), so the box always
    // grows upward from the coordinate written here.
    const fitsAbove = y - POINTER_GAP - h >= EDGE_PAD;

    let left: number;
    let top: number;

    if (fitsAbove) {
      // The normal case: centred on the pointer, sitting above it.
      top = y - POINTER_GAP;
      left = Math.min(Math.max(x, minLeft), maxLeft);
    } else {
      // Not enough room above — near the top of the viewport, or a very tall tip.
      // Do NOT drop it below the pointer: that is the native `title` behaviour
      // this component exists to replace, and it covers the control underneath.
      // Pin to the top edge and step sideways so the box clears the pointer,
      // preferring the right, falling back to the left.
      top = Math.min(EDGE_PAD + h, Math.max(EDGE_PAD + h, vh - EDGE_PAD));
      const toRight = x + POINTER_GAP + half;
      const toLeft = x - POINTER_GAP - half;
      left = toRight <= maxLeft ? toRight : toLeft >= minLeft ? toLeft : Math.min(Math.max(x, minLeft), maxLeft);
    }

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    // The arrow points down at the pointer, so it is only correct when the tip
    // is actually above it.
    node.classList.toggle('cursor-tip--beside', !fitsAbove);
    // Keep the arrow under the actual pointer even when the box was clamped sideways.
    const arrowX = Math.min(Math.max(x - (left - half), 12), Math.max(12, w - 12));
    node.style.setProperty('--cursor-tip-arrow-x', `${arrowX}px`);
  }, []);

  // Measure and position as soon as the tip's content is in the DOM.
  useLayoutEffect(() => {
    if (tip) place();
  }, [tip, place]);

  useEffect(() => {
    function hostOf(target: EventTarget | null): HTMLElement | null {
      if (!(target instanceof Element)) return null;
      return target.closest<HTMLElement>('[data-tip]');
    }

    function readTip(host: HTMLElement | null): string | null {
      const raw = host?.dataset.tip?.trim();
      return raw ? raw : null;
    }

    function onPointerMove(e: PointerEvent) {
      pointer.current = { x: e.clientX, y: e.clientY };
      const next = readTip(hostOf(e.target));
      setTip((prev) => (prev === next ? prev : next));
      if (next) place();
    }

    function hide() {
      setTip(null);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') hide();
    }

    // Keyboard users get the same explanation, anchored above the focused control.
    function onFocusIn(e: FocusEvent) {
      const host = hostOf(e.target);
      const next = readTip(host);
      if (!host || !next) {
        hide();
        return;
      }
      const el = e.target;
      const keyboard = el instanceof Element && typeof el.matches === 'function' && el.matches(':focus-visible');
      if (!keyboard) return;
      const rect = host.getBoundingClientRect();
      pointer.current = { x: rect.left + rect.width / 2, y: rect.top };
      setTip(next);
    }

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('pointerleave', hide, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('pointerleave', hide, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [place]);

  if (!tip) return null;

  return createPortal(
    <div ref={tipRef} className="cursor-tip" role="tooltip" aria-hidden="true">
      {tip}
    </div>,
    document.body,
  );
}
