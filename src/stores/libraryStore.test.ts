import { beforeEach, describe, expect, it, vi } from 'vitest';

const LIBRARY_PREFERENCES_STORAGE_KEY = 'amc_library_preferences_v1';

const importFreshLibraryStore = async () => {
  vi.resetModules();
  return import('./libraryStore');
};

describe('useLibraryStore persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with standard default state', async () => {
    const { useLibraryStore } = await importFreshLibraryStore();
    const state = useLibraryStore.getState();

    expect(state.viewMode).toBe('list');
    expect(state.categoryFilter).toBe('all');
    expect(state.sourceFilter).toBe('all');
    expect(state.fileTypeFilter).toBe('all');
    expect(state.sortOption).toBe('date_desc');
    expect(state.searchQuery).toBe('');
    expect(state.selectedFileIds.size).toBe(0);
    expect(state.isFilterMenuOpen).toBe(false);
    expect(state.isNewDropdownOpen).toBe(false);
  });

  it('persists viewMode, sortOption, filters, searchQuery and selectedFileIds', async () => {
    const { useLibraryStore } = await importFreshLibraryStore();

    useLibraryStore.getState().setViewMode('grid');
    useLibraryStore.getState().setCategoryFilter('document');
    useLibraryStore.getState().setSourceFilter('uploaded');
    useLibraryStore.getState().setFileTypeFilter('pdf');
    useLibraryStore.getState().setSortOption('name_asc');
    useLibraryStore.getState().setSearchQuery('quarterly report');
    useLibraryStore.getState().toggleSelectFile('file-1');
    useLibraryStore.getState().toggleSelectFile('file-2');

    // Verify localStorage has persisted the state
    const rawStored = localStorage.getItem(LIBRARY_PREFERENCES_STORAGE_KEY);
    expect(rawStored).toBeTruthy();
    const parsed = JSON.parse(rawStored!);
    expect(parsed.state.viewMode).toBe('grid');
    expect(parsed.state.categoryFilter).toBe('document');
    expect(parsed.state.sourceFilter).toBe('uploaded');
    expect(parsed.state.fileTypeFilter).toBe('pdf');
    expect(parsed.state.sortOption).toBe('name_asc');
    expect(parsed.state.searchQuery).toBe('quarterly report');
    expect(parsed.state.selectedFileIds).toEqual(['file-1', 'file-2']);

    // Ensure transient menus are NOT persisted
    expect(parsed.state.isFilterMenuOpen).toBeUndefined();
    expect(parsed.state.isNewDropdownOpen).toBeUndefined();

    // Rehydrate fresh store and ensure state is restored properly
    const { useLibraryStore: freshStore } = await importFreshLibraryStore();
    const restored = freshStore.getState();

    expect(restored.viewMode).toBe('grid');
    expect(restored.categoryFilter).toBe('document');
    expect(restored.sourceFilter).toBe('uploaded');
    expect(restored.fileTypeFilter).toBe('pdf');
    expect(restored.sortOption).toBe('name_asc');
    expect(restored.searchQuery).toBe('quarterly report');
    expect(restored.selectedFileIds instanceof Set).toBe(true);
    expect(restored.selectedFileIds.has('file-1')).toBe(true);
    expect(restored.selectedFileIds.has('file-2')).toBe(true);
    expect(restored.selectedFileIds.size).toBe(2);
  });

  it('gracefully handles legacy storage without new persisted fields', async () => {
    // Simulate legacy storage containing only viewMode and sortOption
    localStorage.setItem(
      LIBRARY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: {
          viewMode: 'grid',
          sortOption: 'size_desc',
        },
        version: 0,
      }),
    );

    const { useLibraryStore } = await importFreshLibraryStore();
    const state = useLibraryStore.getState();

    expect(state.viewMode).toBe('grid');
    expect(state.sortOption).toBe('size_desc');
    expect(state.categoryFilter).toBe('all');
    expect(state.sourceFilter).toBe('all');
    expect(state.fileTypeFilter).toBe('all');
    expect(state.searchQuery).toBe('');
    expect(state.selectedFileIds.size).toBe(0);
  });

  it('sanitizes invalid or corrupted values during rehydration', async () => {
    localStorage.setItem(
      LIBRARY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: {
          viewMode: 'invalid_mode',
          sortOption: 'invalid_sort',
          categoryFilter: 'invalid_cat',
          sourceFilter: 'invalid_src',
          fileTypeFilter: 'invalid_type',
          searchQuery: 12345,
          selectedFileIds: 'not_an_array',
        },
        version: 0,
      }),
    );

    const { useLibraryStore } = await importFreshLibraryStore();
    const state = useLibraryStore.getState();

    expect(state.viewMode).toBe('list');
    expect(state.sortOption).toBe('date_desc');
    expect(state.categoryFilter).toBe('all');
    expect(state.sourceFilter).toBe('all');
    expect(state.fileTypeFilter).toBe('all');
    expect(state.searchQuery).toBe('');
    expect(state.selectedFileIds.size).toBe(0);
  });

  it('supports selectRange and invertSelection actions', async () => {
    const { useLibraryStore } = await importFreshLibraryStore();

    useLibraryStore.getState().selectRange(['f-1', 'f-2', 'f-3']);
    expect(Array.from(useLibraryStore.getState().selectedFileIds)).toEqual(['f-1', 'f-2', 'f-3']);

    useLibraryStore.getState().invertSelection(['f-1', 'f-2', 'f-3', 'f-4', 'f-5']);
    expect(Array.from(useLibraryStore.getState().selectedFileIds)).toEqual(['f-4', 'f-5']);

    useLibraryStore.getState().clearSelection();
    expect(useLibraryStore.getState().selectedFileIds.size).toBe(0);
  });
});
