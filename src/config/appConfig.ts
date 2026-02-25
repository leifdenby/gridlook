const fallbackDatasetPath = "static/index_mr_dpp0066.json";

function normalizeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

const runtimeConfig = window.__GRIDLOOK_CONFIG__ ?? {};

export const DEFAULT_DATASET_PATH =
  normalizeValue(runtimeConfig.defaultDatasetPath) ??
  normalizeValue(import.meta.env.GRIDLOOK_DEFAULT_DATASET_PATH) ??
  normalizeValue(import.meta.env.VITE_DEFAULT_DATASET_PATH) ??
  fallbackDatasetPath;

export const DEFAULT_VARIABLE_NAME =
  normalizeValue(runtimeConfig.defaultVariableName) ??
  normalizeValue(import.meta.env.GRIDLOOK_DEFAULT_VARIABLE_NAME) ??
  normalizeValue(import.meta.env.VITE_DEFAULT_VARIABLE_NAME);
