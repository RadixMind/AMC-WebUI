import { useState, useEffect } from 'react';
import { MOBILE_BREAKPOINT_PX } from '@/constants/layout';
import { useWindowContext } from '@/contexts/WindowContext';

export const useIsMobile = () => {
  const { window: targetWindow } = useWindowContext();
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof targetWindow === 'undefined') return false;
    return targetWindow.innerWidth < MOBILE_BREAKPOINT_PX;
  });

  useEffect(() => {
    if (typeof targetWindow === 'undefined') return;
    const mediaQuery = targetWindow.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);

    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [targetWindow]);

  return isMobile;
};

export const useResponsiveValue = <T>(
  mobileValue: T,
  desktopValue: T,
  breakpoint: number = MOBILE_BREAKPOINT_PX,
): T => {
  const { window: targetWindow } = useWindowContext();
  const [value, setValue] = useState<T>(() => {
    if (typeof targetWindow !== 'undefined' && targetWindow.innerWidth < breakpoint) {
      return mobileValue;
    }
    return desktopValue;
  });

  useEffect(() => {
    if (typeof targetWindow === 'undefined') return;
    const mediaQuery = targetWindow.matchMedia(`(max-width: ${breakpoint}px)`);

    const updateBreakpointMatch = () => {
      setValue(mediaQuery.matches ? mobileValue : desktopValue);
    };

    updateBreakpointMatch();
    mediaQuery.addEventListener('change', updateBreakpointMatch);
    return () => mediaQuery.removeEventListener('change', updateBreakpointMatch);
  }, [targetWindow, breakpoint, mobileValue, desktopValue]);

  return value;
};

export interface DeviceInfo {
  isMobile: boolean;
}

export const useDevice = (): DeviceInfo => {
  const isMobile = useIsMobile();
  return { isMobile };
};
