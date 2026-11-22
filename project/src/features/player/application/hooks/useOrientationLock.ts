import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';

/** Pleyer açılanda landscape, çıxanda portrait. */
export function useOrientationLock() {
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
    };
  }, []);
}