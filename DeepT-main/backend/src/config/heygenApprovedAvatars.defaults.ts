import type { AvatarLibraryEntry } from '../models/nodeEngine.js';

/**
 * HBMSU Avatar Library — institution-curated HeyGen avatar allowlist.
 *
 * ONLY avatars listed here appear in Settings → Video. Restart the backend after edits.
 *
 * OPTION A — Character / identity IDs (easiest):
 *   Add HeyGen avatar group IDs to `heygenApprovedAvatarGroupIds` below.
 *   We fetch that character's looks automatically (requires HEYGEN_API_KEY).
 *
 * OPTION B — Specific looks:
 *   Add full entries to `heygenApprovedAvatarsDefaults` when you want exact outfits only.
 *
 * ID types in HeyGen:
 *   - Identity / group ID  → character (e.g. Annie) — from GET /v3/avatars
 *   - Look ID              → one outfit — passed to video render as avatar_id
 */
export const heygenApprovedAvatarGroupIds: string[] = [
  '1727664276', // Gala
  'e5753adb268d4a15ac52448735346d47', // Darlene
  'f75f4ccb9d2241a5b77d0cfa5e5c4c63', // Milo
  '1745a82d263a458f80990d4da8111bb1', // Vera
  '2e3bb541fac24638972b186b1cfa1805', // Imani
  '1a4b36f9b7c54ab9ae3646bf32bd41e4', // Raviy
  '68a021aabc2246a88a6f88c12ca2b37f', // Dustin
  '05f88a5681a14c868d26c4acebc72423', // Sawyer
  'c58d907a18d3426085da01a855034d82', // Brianna
  '1872a1dae86243818818bfb33ff6baec', // Kendra
  '12fa36bd2021468494c3bae446ccfe97', // Brayden
  '78eed2017ef2446d992c94c61eda0574', // Rami
  'b6ca3b0c8a2f44b695ef2671f9223c44', // Ralph
  '1de1ee3503794a75b1360319a7e7b56f', // Varrick
  '4d83ba2fadc94cbbb0ac500299db3c97', // Caryns
  '5b3e3f8baf824f4b890fc0ad7d45ca64', // Julie
  '5b51943b55f44deea61ce73c4849bb1c', // Ruben
  '2c46e00fdd84439aa0a48bc058e9ba0c', // Victor
  'b67781d57e41468a86e9a8441c8399e0', // Norman
  '0d1ffca61dbb427c94f42c06389090b8', // Saad
  '6602295a74fa438ba3f54d70942f0fb9', // James
];

export const heygenApprovedAvatarsDefaults: AvatarLibraryEntry[] = [
  // Or list specific looks, e.g.:
  // {
  //   id: 'Daphne_public_1',
  //   name: 'Daphne in Grey blazer',
  //   character_name: 'Daphne',
  //   group_id: 'c1926d821b4d43d6a5f07f2985bb5cd1',
  // },
];
