/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly GRIDLOOK_DEFAULT_DATASET_PATH?: string;
  readonly GRIDLOOK_DEFAULT_VARIABLE_NAME?: string;
  readonly VITE_DEFAULT_DATASET_PATH?: string;
  readonly VITE_DEFAULT_VARIABLE_NAME?: string;
}

interface Window {
  __GRIDLOOK_CONFIG__?: {
    defaultDatasetPath?: string;
    defaultVariableName?: string;
  };
}
