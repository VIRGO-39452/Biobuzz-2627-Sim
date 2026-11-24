declare module '*.js';
interface Window { ftcsim?: { pickFolder(): Promise<string | null>; desktop: boolean }; viewer3d?: any; }
