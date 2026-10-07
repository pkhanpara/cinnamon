import { loadSelection, parseUrlSelection, reconcile, saveSelection } from './account-selection';

describe('parseUrlSelection', () => {
  it('distinguishes absent, empty and ids', () => {
    expect(parseUrlSelection(null)).toBeNull();
    expect(parseUrlSelection('')).toEqual([]);
    expect(parseUrlSelection('1,3')).toEqual([1, 3]);
  });
  it('ignores junk', () => {
    for (const bad of ['a', '1,x', '1.5', '-2', '0', '1,,2']) expect(parseUrlSelection(bad)).toBeNull();
  });
});

describe('reconcile', () => {
  it('selects everything when nothing is saved', () => {
    expect(reconcile([1, 2, 3], null, null)).toEqual([1, 2, 3]);
  });
  it('URL beats saved state', () => {
    expect(reconcile([1, 2, 3], [2], { selected: [1], known: [1, 2, 3] })).toEqual([2]);
  });
  it('an explicit empty URL selection means none', () => {
    expect(reconcile([1, 2], [], null)).toEqual([]);
  });
  it('drops deleted accounts', () => {
    expect(reconcile([1, 3], null, { selected: [1, 2, 3], known: [1, 2, 3] })).toEqual([1, 3]);
    expect(reconcile([1], [1, 99], null)).toEqual([1]);
  });
  it('keeps an account the user unticked unticked', () => {
    expect(reconcile([1, 2], null, { selected: [1], known: [1, 2] })).toEqual([1]);
  });
  it('ticks accounts created after the save', () => {
    expect(reconcile([1, 2, 3], null, { selected: [1], known: [1, 2] })).toEqual([1, 3]);
  });
  it('remembers a deliberate "none" without treating everything as new', () => {
    expect(reconcile([1, 2], null, { selected: [], known: [1, 2] })).toEqual([]);
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per user', () => {
    saveSelection(1, [1], [1, 2]);
    expect(loadSelection(1)).toEqual({ selected: [1], known: [1, 2] });
    expect(loadSelection(2)).toBeNull();
  });
  it('treats corrupt or malformed data as nothing saved', () => {
    localStorage.setItem('cinnamon.holdings.selection.1', '{nope');
    expect(loadSelection(1)).toBeNull();
    localStorage.setItem('cinnamon.holdings.selection.1', JSON.stringify({ selected: ['a'], known: [] }));
    expect(loadSelection(1)).toBeNull();
  });
  it('survives storage throwing', () => {
    const boom = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadSelection(1)).toBeNull();
    boom.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveSelection(1, [1], [1])).not.toThrow();
    set.mockRestore();
  });
});
