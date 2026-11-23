export const MATRIX_VIEWS = ['home', 'library', 'materials', 'guide', 'cards', 'smart', 'test', 'tutor', 'focus', 'courses', 'planner', 'notes', 'resources', 'grades'] as const;
export type MatrixView = typeof MATRIX_VIEWS[number];
export type GuideMode = 'guide' | 'summary';
export interface MatrixNavigation {
  view: MatrixView;
  selected: string;
  guideMode: GuideMode;
}
export const DEFAULT_NAVIGATION: Readonly<MatrixNavigation> = {view: 'home', selected: '', guideMode: 'guide'};
const VIEWS = new Set<string>(MATRIX_VIEWS);
const KIT_ID = /^[a-zA-Z0-9_-]{1,100}$/;

export function validMatrixView(value: unknown): value is MatrixView {
  return typeof value === 'string' && VIEWS.has(value);
}

/** Hash navigation leaves OAuth callbacks and public share query parameters untouched. */
export function parseMatrixNavigation(hash: string): MatrixNavigation {
  if (hash.length > 600) return {...DEFAULT_NAVIGATION};
  const match = /^#\/([a-z]+)(?:\?([^#]*))?$/.exec(hash);
  if (!match || !validMatrixView(match[1])) return {...DEFAULT_NAVIGATION};
  const params = new URLSearchParams(match[2] || '');
  // Ambiguous duplicate values are ignored rather than selecting an unexpected kit.
  const id = params.getAll('kit');
  const tabs = params.getAll('tab');
  return {
    view: match[1],
    selected: id.length === 1 && KIT_ID.test(id[0]) ? id[0] : '',
    guideMode: tabs.length === 1 && tabs[0] === 'summary' ? 'summary' : 'guide',
  };
}

export function matrixNavigationHash(route: MatrixNavigation): string {
  const params = new URLSearchParams();
  if (KIT_ID.test(route.selected)) params.set('kit', route.selected);
  if (route.guideMode === 'summary') params.set('tab', 'summary');
  const query = params.toString();
  return `#/${validMatrixView(route.view) ? route.view : 'home'}${query ? '?' + query : ''}`;
}

export function matrixNavigationUrl(location: Pick<Location, 'pathname' | 'search'>, route: MatrixNavigation): string {
  return location.pathname + location.search + matrixNavigationHash(route);
}

/** Do not resolve a deep-linked kit against sample data before cloud/local loading completes. */
export function resolveNavigationSelection(route: MatrixNavigation, kits: readonly {id: string}[], ready: boolean): MatrixNavigation {
  if (!ready || kits.some(kit => kit.id === route.selected)) return route;
  const selected = kits.find(kit => KIT_ID.test(kit.id))?.id || '';
  return selected === route.selected ? route : {...route, selected};
}
