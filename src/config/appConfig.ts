const fallbackDatasetPath = "static/index_mr_dpp0066.json";

export const DEFAULT_DATASET_PATH =
  import.meta.env.VITE_DEFAULT_DATASET_PATH ?? fallbackDatasetPath;

export const DEFAULT_VARIABLE_NAME = import.meta.env.VITE_DEFAULT_VARIABLE_NAME;
