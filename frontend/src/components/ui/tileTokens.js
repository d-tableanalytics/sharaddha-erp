/**
 * The icon-chip tones a tile can wear.
 *
 * Its own module, not an export beside a component, for two reasons: a file
 * that exports both components and constants loses Fast Refresh, and the HR
 * Dashboard's Quick Access tile and the Work Queue's stat tile both need these
 * — one map means a tone added or re-tuned here lands on both surfaces at
 * once, which is the only way two screens built in different files stay
 * looking like one product.
 *
 * The `group-hover:` halves assume the tile itself carries `group`.
 */
export const TILE_TONE = {
  primary: "bg-primary-50 text-primary-700 group-hover:bg-primary-100",
  success: "bg-success-50 text-success-600 group-hover:bg-success-100",
  warning: "bg-warning-50 text-warning-600 group-hover:bg-warning-100",
  danger: "bg-error-50 text-error-500 group-hover:bg-error-100",
  neutral: "bg-slate-100 text-slate-600 group-hover:bg-slate-200",
};
