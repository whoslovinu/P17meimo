import { useState, useEffect } from 'react';

/**
 * Returns true only after the component has hydrated on the client.
 * Use this to guard any `window` / `document` / `localStorage` access.
 */
export function useIsClient(): boolean {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  return isClient;
}
