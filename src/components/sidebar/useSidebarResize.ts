import React from 'react';

const DEFAULT_SIDEBAR_WIDTH = 259;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_STORAGE_KEY = 'amc-history-sidebar-width';

const getInitialSidebarWidth = (): number => {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (Number.isFinite(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_SIDEBAR_WIDTH;
};

export function useSidebarResize() {
  const [sidebarWidth, setSidebarWidth] = React.useState<number>(getInitialSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = React.useState(false);
  const isResizingSidebarRef = React.useRef(false);
  const sidebarWidthRef = React.useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const startSidebarResize = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizingSidebar(true);
    isResizingSidebarRef.current = true;
  }, []);

  const stopSidebarResize = React.useCallback(() => {
    setIsResizingSidebar(false);
    isResizingSidebarRef.current = false;
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(sidebarWidthRef.current)));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleSidebarResize = React.useCallback((event: MouseEvent) => {
    if (!isResizingSidebarRef.current) return;
    const newWidth = Math.min(
      Math.max(event.clientX, MIN_SIDEBAR_WIDTH),
      Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth * 0.5),
    );
    sidebarWidthRef.current = newWidth;
    setSidebarWidth(newWidth);
  }, []);

  const resetSidebarWidth = React.useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    try {
      localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSidebarWidth((prevWidth) => {
          const next = Math.min(prevWidth + 10, MAX_SIDEBAR_WIDTH);
          try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
          } catch {
            // Ignore storage errors
          }
          return next;
        });
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSidebarWidth((prevWidth) => {
          const next = Math.max(prevWidth - 10, MIN_SIDEBAR_WIDTH);
          try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
          } catch {
            // Ignore storage errors
          }
          return next;
        });
      } else if (event.key === 'Home') {
        event.preventDefault();
        resetSidebarWidth();
      }
    },
    [resetSidebarWidth],
  );

  React.useEffect(() => {
    if (isResizingSidebar) {
      window.addEventListener('mousemove', handleSidebarResize);
      window.addEventListener('mouseup', stopSidebarResize);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', handleSidebarResize);
      window.removeEventListener('mouseup', stopSidebarResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', handleSidebarResize);
      window.removeEventListener('mouseup', stopSidebarResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar, handleSidebarResize, stopSidebarResize]);

  return {
    sidebarWidth,
    setSidebarWidth,
    isResizingSidebar,
    startSidebarResize,
    stopSidebarResize,
    resetSidebarWidth,
    handleKeyDown,
  };
}
