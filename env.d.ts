/// <reference types="vite/client" />

interface Window {
  __GRIDLOOK_DATASET_PATH_RESOLVER__?: () =>
    | string
    | Promise<string>
    | undefined;
  __GRIDLOOK_CONFIG__?: {
    defaultDatasetPath?: string;
    defaultVariableName?: string;
  };
}
