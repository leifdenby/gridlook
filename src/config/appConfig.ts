const fallbackDatasetPath = "static/index_mr_dpp0066.json";

function normalizeValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

const runtimeConfig = window.__GRIDLOOK_CONFIG__ ?? {};
let resolverScriptLoadPromise: Promise<void> | undefined;

const configuredDefaultDatasetPath =
  normalizeValue(import.meta.env.GRIDLOOK_DEFAULT_DATASET_PATH) ??
  normalizeValue(runtimeConfig.defaultDatasetPath) ??
  fallbackDatasetPath;

export const DEFAULT_DATASET_PATH = configuredDefaultDatasetPath;

export const DEFAULT_VARIABLE_NAME =
  normalizeValue(import.meta.env.GRIDLOOK_DEFAULT_VARIABLE_NAME) ??
  normalizeValue(runtimeConfig.defaultVariableName);

function isResolverScriptPath(path: string) {
  return path.toLowerCase().endsWith(".js");
}

async function loadResolverScript(path: string) {
  if (!path.startsWith("/")) {
    throw new Error(
      `Resolver script must be a local absolute path (got: ${path})`
    );
  }
  if (resolverScriptLoadPromise) {
    return resolverScriptLoadPromise;
  }
  resolverScriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = path;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load resolver: ${path}`));
    document.head.appendChild(script);
  });
  return resolverScriptLoadPromise;
}

export async function resolveDefaultDatasetPath() {
  if (!isResolverScriptPath(configuredDefaultDatasetPath)) {
    console.info("[Gridlook] default dataset path mode: direct", {
      value: configuredDefaultDatasetPath,
    });
    return configuredDefaultDatasetPath;
  }
  console.info("[Gridlook] default dataset path mode: resolver-script", {
    scriptPath: configuredDefaultDatasetPath,
  });
  try {
    await loadResolverScript(configuredDefaultDatasetPath);
    const resolver = window.__GRIDLOOK_DATASET_PATH_RESOLVER__;
    if (typeof resolver !== "function") {
      console.warn(
        "[Gridlook] Resolver script loaded but __GRIDLOOK_DATASET_PATH_RESOLVER__ is not a function"
      );
      console.warn("[Gridlook] Falling back to static default dataset path", {
        fallback: fallbackDatasetPath,
      });
      return fallbackDatasetPath;
    }
    const value = await resolver();
    const resolved = normalizeValue(value);
    if (!resolved) {
      console.warn(
        "[Gridlook] Resolver returned empty value, falling back to static default dataset path",
        {
          fallback: fallbackDatasetPath,
        }
      );
      return fallbackDatasetPath;
    }
    console.info("[Gridlook] Resolver produced dataset path", {
      resolvedPath: resolved,
    });
    return resolved;
  } catch (error) {
    console.warn("[Gridlook] Failed to resolve default dataset path", error);
    console.warn("[Gridlook] Falling back to static default dataset path", {
      fallback: fallbackDatasetPath,
    });
    return fallbackDatasetPath;
  }
}
