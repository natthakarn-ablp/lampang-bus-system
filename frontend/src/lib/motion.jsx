/**
 * Motion utilities for the Lampang Bus System.
 *
 * Design principle (PRODUCT.md): "Motion explains, never decorates."
 * Every animation here maps to a state change — content arriving, status
 * changing, a value updating. Nothing animates "because it looks nice."
 *
 * All animations respect prefers-reduced-motion via the global CSS rule
 * in index.css (animation-duration: 1ms) AND motion's built-in reducedMotion
 * support. Double coverage so users who disable motion never see movement.
 */

import { animate, useMotionValue, useTransform, motion, AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

// ─── 1. CountUp — KPI numbers animate from 0 to value on mount ─────────────
// "Content arriving" motion. The number ticking up signals fresh data landed.
export function CountUp({ value, duration = 0.8, className = '' }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(0);
  const target = typeof value === 'number' ? value : parseInt(value, 10) || 0;

  useEffect(() => {
    if (target === 0) { setDisplay(0); return; }
    const controls = animate(0, target, {
      duration,
      ease: [0.16, 1, 0.3, 1], // ease-out-quint
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, duration]);

  return <span ref={ref} className={className}>{display.toLocaleString('th-TH')}</span>;
}

// ─── 2. PageTransition — wraps route content with fade-in-up ───────────────
// Signals "new page loaded" — the content rises 8px and fades in.
// Reduced-motion users see it instantly (global CSS override).
export function PageTransition({ children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── 3. StaggerItem — child wrapper for use inside StaggerContainer ─────────
export function StaggerItem({ children, className = '', ...rest }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ─── 4. StaggerContainer — orchestrates staggered child reveals ────────────
// Replaces the CSS .stagger-children class with motion-powered staggering
// that works even when children mount at different times (e.g. data loads).
export function StaggerContainer({ children, className = '', delay = 0, stagger = 0.05, ...rest }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            delayChildren: delay,
            staggerChildren: stagger,
          },
        },
      }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ─── 5. PulseDot — live status indicator (e.g. "tracking active") ──────────
// Pulses to show "this is live, updating right now." Used on driver GPS,
// live vehicle tracking, active emergency indicators.
export function PulseDot({ color = 'bg-success', size = 'sm', className = '' }) {
  const sizeCls = size === 'sm' ? 'w-2 h-2' : size === 'md' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  return (
    <span className={`relative inline-flex ${sizeCls} ${className}`}>
      <motion.span
        className={`absolute inset-0 rounded-full ${color} opacity-75`}
        animate={{ scale: [1, 2.2], opacity: [0.7, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
      />
      <span className={`relative inline-flex ${sizeCls} rounded-full ${color}`} />
    </span>
  );
}

// ─── 6. AnimatePresence wrapper for exit animations ────────────────────────
// Use around toasts, modals, dropdowns so they animate out, not just disappear.
export { AnimatePresence };

// ─── 7. MotionCard — AppCard with spring entrance ──────────────────────────
// For cards that should "settle into place" on mount (dashboards, lists).
export function MotionCard({ children, className = '', delay = 0, ...rest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ─── 8. Skeleton — shimmer placeholder while data loads ────────────────────
// "Data is on its way" motion. The shimmer sweep signals loading without
// a spinner (which implies "waiting on you" rather than "working on it").
export function Skeleton({ className = '' }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-surface-border/60 ${className}`}
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
        animate={{ x: ['-100%', '100%'] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// ─── 9. ToastSlide — entrance + exit for toast notifications ───────────────
export function ToastSlide({ children, ...rest }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ─── 10. Pressable — button/link with press-down tactile feedback ──────────
// "I clicked it and it responded" motion. The scale-down on tap is the
// digital equivalent of a button click — physical, immediate, satisfying.
export function Pressable({ children, as: Tag = 'button', className = '', ...rest }) {
  const MotionTag = motion[Tag] || motion.button;
  return (
    <MotionTag
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className={className}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
