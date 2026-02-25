import type { TDataSource, TSources } from "@/types/GlobeTypes";

function normalizeStandardName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function findWindComponentVarNames(vars: Record<string, TDataSource>): {
  eastward?: string;
  northward?: string;
} {
  let eastward: string | undefined;
  let northward: string | undefined;

  for (const [name, variable] of Object.entries(vars)) {
    const standardName = normalizeStandardName(variable.attrs?.standard_name);
    if (!eastward && standardName === "eastward_wind") {
      eastward = name;
    } else if (
      !northward &&
      (standardName === "northward_wind" || standardName === "northword_wind")
    ) {
      northward = name;
    }
  }

  return { eastward, northward };
}

export function windSpeedDerivedName(eastward: string, northward: string) {
  return `wind speed (${eastward} ${northward})`;
}

export function withDerivedVariables(sources: TSources): TSources {
  const level = sources.levels[0];
  const baseVars = level.datasources;
  const { eastward, northward } = findWindComponentVarNames(baseVars);
  if (!eastward || !northward) {
    return sources;
  }

  const east = baseVars[eastward];
  const north = baseVars[northward];
  const derivedName = windSpeedDerivedName(eastward, northward);
  if (baseVars[derivedName]) {
    return sources;
  }

  const units =
    east.attrs?.units && east.attrs?.units === north.attrs?.units
      ? east.attrs.units
      : undefined;

  const derivedVar: TDataSource = {
    store: east.store,
    dataset: east.dataset,
    derived: {
      kind: "wind_speed",
      components: {
        eastward,
        northward,
      },
    },
    attrs: {
      long_name: `Wind speed (${eastward}, ${northward})`,
      standard_name: "wind_speed",
      ...(units ? { units } : {}),
    },
  };

  return {
    ...sources,
    levels: [
      {
        ...level,
        datasources: {
          ...baseVars,
          [derivedName]: derivedVar,
        },
      },
      ...sources.levels.slice(1),
    ],
  };
}

export function resolvePhysicalVarName(
  datasources: TSources,
  selectedVarname: string
) {
  const datasource = datasources.levels[0].datasources[selectedVarname];
  if (datasource?.derived?.kind === "wind_speed") {
    return datasource.derived.components.eastward;
  }
  return selectedVarname;
}

export function isWindSpeedDerived(
  datasources: TSources | undefined,
  selectedVarname: string
) {
  if (!datasources) return false;
  return (
    datasources.levels[0].datasources[selectedVarname]?.derived?.kind ===
    "wind_speed"
  );
}
