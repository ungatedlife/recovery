/**
 * Server-side handoff of the dataset to the island without serializing it as a
 * prop. The page loads the dataset (async), stashes it here, renders the island;
 * the island reads it synchronously on the server and from an inline JSON script
 * on the client. This module is tiny on purpose: it ships in the client bundle.
 */
import type { Dataset } from './types.ts';

let current: Dataset | null = null;

export function setCurrentDataset(ds: Dataset): void {
  current = ds;
}

export const DATA_SCRIPT_ID = 'dw-data';

/** Server: the dataset the page just loaded. Client: the inline JSON. */
export function readDataset(): Dataset {
  if (typeof document !== 'undefined') {
    const el = document.getElementById(DATA_SCRIPT_ID);
    if (el?.textContent) return JSON.parse(el.textContent) as Dataset;
  }
  if (!current) throw new Error('dataset not loaded; call setCurrentDataset() before rendering');
  return current;
}

/** JSON safe to inline in a <script> (no premature close, no HTML comment tricks). */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
