import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

let activeTransition;
export function changeView(update) {
  activeTransition?.skipTransition();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  activeTransition = document.startViewTransition(() => flushSync(update));
  activeTransition.ready.catch(() => {});
  activeTransition.finished.catch(() => {});
  return activeTransition.updateCallbackDone;
}

export function useSpring(ref, property, target, { held = false, onRest } = {}) {
  const position = useRef({ value: target, velocity: 0 });
  const rest = useRef(onRest);
  rest.current = onRest;
  const paint = () => ref.current?.style.setProperty(property, String(position.current.value));
  useEffect(() => {
    let frame;
    let previous;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      position.current = { value: target, velocity: 0 };
      paint();
      rest.current?.();
    };
    const tick = (time) => {
      if (motion.matches) { finish(); return; }
      const dt = Math.min((time - (previous ?? time)) / 1000, 0.032);
      previous = time;
      const state = position.current;
      const steps = Math.max(1, Math.ceil(dt / 0.008));
      for (let i = 0; i < steps; i++) {
        state.velocity += (360 * (target - state.value) - 38 * state.velocity) * dt / steps;
        state.value += state.velocity * dt / steps;
      }
      paint();
      if (Math.abs(state.value - target) < 0.001 && Math.abs(state.velocity) < 0.01) finish();
      else frame = requestAnimationFrame(tick);
    };
    if (!held) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref, property, target, held]);
  return (value, velocity = 0) => {
    position.current = { value, velocity };
    paint();
  };
}
