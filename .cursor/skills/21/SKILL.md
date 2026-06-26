---
name: "21"
description: Apply the Material Dashboard "stat card" style to dashboard metric cards - a color-matched icon tile floating above the card's top edge, label and large value top-right, a divider, then a footer line. Use when the user references skill "21" or asks to style/restyle the 4 dashboard stat cards.
disable-model-invocation: true
---

# 21 — Material Dashboard stat card

Restyle dashboard metric cards to the Material Dashboard 2 "stat card" pattern.

## Visual recipe

- A colored, rounded icon tile that **floats above the top edge** of the white card, with a **color-matched soft glow** under it.
- **Top-right**: a small muted label sitting over a large bold value.
- A thin divider, then a **footer line** (muted descriptor; colored accent text only when real delta data exists — do not invent percentages).
- Card keeps the existing flat elevation and lifts on hover.

## Where it applies

- Top 4 stat cards in [frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx)
  (`Total Courses`, `In Progress`, `Completed`, `Not Started`).
- Reuses the existing `.md-card` / `.md-tile` utility classes from [frontend/src/index.css](frontend/src/index.css). Do not change the Maestro Capabilities row.

## Tone styles

Each tone needs a `glow` (color-matched shadow) alongside the existing `tile` gradient:

```ts
const toneStyles: Record<Tone, { tile: string; soft: string; text: string; ring: string; glow: string }> = {
  slate:   { /* ... */ glow: 'shadow-lg shadow-slate-500/40' },
  blue:    { /* ... */ glow: 'shadow-lg shadow-[#024ad8]/40' },
  violet:  { /* ... */ glow: 'shadow-lg shadow-violet-500/40' },
  emerald: { /* ... */ glow: 'shadow-lg shadow-emerald-500/40' },
  amber:   { /* ... */ glow: 'shadow-lg shadow-amber-500/40' },
  rose:    { /* ... */ glow: 'shadow-lg shadow-rose-500/40' },
  teal:    { /* ... */ glow: 'shadow-lg shadow-teal-500/40' },
}
```

## Card template

```tsx
<div className="md-card md-card-interactive relative px-5 pb-4 pt-0">
  <div className="flex items-start justify-between">
    <div className={`md-tile -mt-6 inline-flex h-14 w-14 items-center justify-center ${t.tile} ${t.glow}`}>
      <stat.icon className="h-7 w-7" />
    </div>
    <div className="pt-5 text-right">
      <p className="text-sm text-muted-foreground">{stat.label}</p>
      <p className="text-2xl font-bold tracking-tight text-foreground">
        {loading ? '—' : stat.value}
      </p>
    </div>
  </div>
  <div className="mt-3 border-t border-border/70 pt-3">
    <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
  </div>
</div>
```

Key details:
- `pt-0` on the card + `-mt-6` on the tile make the icon poke above the top edge.
- Tile is `h-14 w-14` with an `h-7 w-7` icon to match the larger screenshot badge.
- The label/value block is right-aligned (`text-right`) with `pt-5` to clear the floated tile.

## Guardrails (from ui-ux-pro-max)

- Use SVG (lucide) icons, never emojis.
- Keep `md-card-interactive` for smooth hover; transitions stay 150-300ms.
- Ensure light/dark contrast: muted text via `text-muted-foreground`, value via `text-foreground`.
