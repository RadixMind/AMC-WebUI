import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  LibraryCategoryFilter,
  LibraryFileTypeFilter,
  LibrarySortOption,
  LibrarySourceFilter,
  LibraryViewMode,
} from '@/types';
import { createSyncedPersist } from './syncedPersist';

const LIBRARY_PREFERENCES_STORAGE_KEY = 'amc_library_preferences_v1';
const { storage: librarySyncedStorage } = createSyncedPersist(LIBRARY_PREFERENCES_STORAGE_KEY, {
  enableCrossTabSync: false,
});

interface LibraryState {
  viewMode: LibraryViewMode;
  categoryFilter: LibraryCategoryFilter;
  sourceFilter: LibrarySourceFilter;
  fileTypeFilter: LibraryFileTypeFilter;
  sortOption: LibrarySortOption;
  searchQuery: string;
  selectedFileIds: Set<string>;
  isFilterMenuOpen: boolean;
  isNewDropdownOpen: boolean;
}

interface LibraryActions {
  setViewMode: (mode: LibraryViewMode) => void;
  setCategoryFilter: (category: LibraryCategoryFilter) => void;
  setSourceFilter: (source: LibrarySourceFilter) => void;
  setFileTypeFilter: (fileType: LibraryFileTypeFilter) => void;
  setSortOption: (sort: LibrarySortOption) => void;
  setSearchQuery: (query: string) => void;
  toggleSelectFile: (id: string) => void;
  selectAllFiles: (ids: string[]) => void;
  invertSelection: (allIds: string[]) => void;
  selectRange: (ids: string[]) => void;
  clearSelection: () => void;
  setIsFilterMenuOpen: (isOpen: boolean | ((prev: boolean) => boolean)) => void;
  setIsNewDropdownOpen: (isOpen: boolean | ((prev: boolean) => boolean)) => void;
}

export interface PersistedLibraryPreferences {
  viewMode: LibraryViewMode;
  categoryFilter: LibraryCategoryFilter;
  sourceFilter: LibrarySourceFilter;
  fileTypeFilter: LibraryFileTypeFilter;
  sortOption: LibrarySortOption;
  searchQuery: string;
  selectedFileIds: string[];
}

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  persist(
    (set) => ({
      viewMode: 'list',
      categoryFilter: 'all',
      sourceFilter: 'all',
      fileTypeFilter: 'all',
      sortOption: 'date_desc',
      searchQuery: '',
      selectedFileIds: new Set<string>(),
      isFilterMenuOpen: false,
      isNewDropdownOpen: false,

      setViewMode: (mode) => set({ viewMode: mode }),
      setCategoryFilter: (category) => set({ categoryFilter: category, selectedFileIds: new Set() }),
      setSourceFilter: (source) => set({ sourceFilter: source, selectedFileIds: new Set() }),
      setFileTypeFilter: (fileType) => set({ fileTypeFilter: fileType, selectedFileIds: new Set() }),
      setSortOption: (sort) => set({ sortOption: sort }),
      setSearchQuery: (searchQuery) => set({ searchQuery, selectedFileIds: new Set() }),

      toggleSelectFile: (id) =>
        set((state) => {
          const next = new Set(state.selectedFileIds);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return { selectedFileIds: next };
        }),

      selectAllFiles: (ids) =>
        set((state) => {
          const allSelected = ids.length > 0 && ids.every((id) => state.selectedFileIds.has(id));
          return {
            selectedFileIds: allSelected ? new Set() : new Set(ids),
          };
        }),

      invertSelection: (allIds) =>
        set((state) => {
          const next = new Set<string>();
          for (const id of allIds) {
            if (!state.selectedFileIds.has(id)) {
              next.add(id);
            }
          }
          return { selectedFileIds: next };
        }),

      selectRange: (ids) =>
        set((state) => {
          const next = new Set(state.selectedFileIds);
          for (const id of ids) {
            next.add(id);
          }
          return { selectedFileIds: next };
        }),

      clearSelection: () => set({ selectedFileIds: new Set() }),

      setIsFilterMenuOpen: (value) =>
        set((state) => ({
          isFilterMenuOpen: typeof value === 'function' ? value(state.isFilterMenuOpen) : value,
        })),

      setIsNewDropdownOpen: (value) =>
        set((state) => ({
          isNewDropdownOpen: typeof value === 'function' ? value(state.isNewDropdownOpen) : value,
        })),
    }),
    {
      name: LIBRARY_PREFERENCES_STORAGE_KEY,
      storage: createJSONStorage(() => librarySyncedStorage),
      partialize: (state) => ({
        viewMode: state.viewMode,
        sortOption: state.sortOption,
        categoryFilter: state.categoryFilter,
        sourceFilter: state.sourceFilter,
        fileTypeFilter: state.fileTypeFilter,
        searchQuery: state.searchQuery,
        selectedFileIds: Array.from(state.selectedFileIds),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<PersistedLibraryPreferences>;
        const validCategories: LibraryCategoryFilter[] = ['all', 'image', 'document', 'audio', 'video'];
        const validSources: LibrarySourceFilter[] = ['all', 'uploaded', 'generated'];
        const validFileTypes: LibraryFileTypeFilter[] = [
          'all',
          'image',
          'document',
          'spreadsheet',
          'presentation',
          'pdf',
          'audio',
          'video',
        ];
        const validSortOptions: LibrarySortOption[] = [
          'date_desc',
          'date_asc',
          'name_asc',
          'name_desc',
          'size_desc',
          'size_asc',
        ];
        const validViewModes: LibraryViewMode[] = ['list', 'grid'];

        let selectedFileIds = currentState.selectedFileIds;
        const rawSelectedFileIds: unknown = persisted.selectedFileIds;
        if (Array.isArray(rawSelectedFileIds)) {
          selectedFileIds = new Set(rawSelectedFileIds.filter((id): id is string => typeof id === 'string'));
        } else if (rawSelectedFileIds instanceof Set) {
          selectedFileIds = rawSelectedFileIds as Set<string>;
        }

        return {
          ...currentState,
          viewMode:
            persisted.viewMode && validViewModes.includes(persisted.viewMode)
              ? persisted.viewMode
              : currentState.viewMode,
          sortOption:
            persisted.sortOption && validSortOptions.includes(persisted.sortOption)
              ? persisted.sortOption
              : currentState.sortOption,
          categoryFilter:
            persisted.categoryFilter && validCategories.includes(persisted.categoryFilter)
              ? persisted.categoryFilter
              : currentState.categoryFilter,
          sourceFilter:
            persisted.sourceFilter && validSources.includes(persisted.sourceFilter)
              ? persisted.sourceFilter
              : currentState.sourceFilter,
          fileTypeFilter:
            persisted.fileTypeFilter && validFileTypes.includes(persisted.fileTypeFilter)
              ? persisted.fileTypeFilter
              : currentState.fileTypeFilter,
          searchQuery: typeof persisted.searchQuery === 'string' ? persisted.searchQuery : currentState.searchQuery,
          selectedFileIds,
        };
      },
    },
  ),
);
