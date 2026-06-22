/**
 * Dashboard-style Material button class strings. These mirror the native
 * `md-btn` / `md-btn-soft` buttons used on the Dashboard page (see index.css),
 * right-sized for in-page actions. Use on native <button>/<Link> elements so the
 * rest of the app keeps the clay `Button` component untouched.
 */

/** Primary brand button (gradient fill) — for the main action in a cluster. */
export const mdBtn =
  'md-btn inline-flex items-center justify-center gap-2 bg-gradient-to-br from-[#296ef9] to-[#024ad8] px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/** Subtle/secondary button (outlined surface) — for secondary actions. */
export const mdBtnSoft =
  'md-btn-soft inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
