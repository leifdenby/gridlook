import * as zarr from "zarrita";

type AxisKey = "x" | "y";

type AxisMetadata = {
  name: string;
  attrs: zarr.Attributes;
  index: number;
};

export type ProjectedGridMetadata = {
  x: AxisMetadata;
  y: AxisMetadata;
  dimensions: string[];
  gridMappingName?: string;
  gridMappingAttrs?: zarr.Attributes;
};

const NON_SPATIAL_DIMS = new Set([
  "time",
  "time1",
  "time2",
  "bnds",
  "bounds",
  "nv",
  "vertex",
  "lev",
  "level",
  "plev",
  "height",
]);

const PROJECTED_AXIS_STANDARD_NAMES: Record<AxisKey, string[]> = {
  x: ["projection_x_coordinate"],
  y: ["projection_y_coordinate"],
};

const LENGTH_UNITS = new Set([
  "m",
  "meter",
  "meters",
  "metre",
  "metres",
  "km",
  "kilometer",
  "kilometers",
  "kilometre",
  "kilometres",
]);

function normalizeString(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function hasLinearUnits(units: unknown) {
  return LENGTH_UNITS.has(normalizeString(units));
}

function matchesAxis(
  axis: AxisKey,
  attrs: zarr.Attributes | undefined
): boolean {
  if (!attrs) {
    return false;
  }
  const standardName = normalizeString(attrs.standard_name);
  if (PROJECTED_AXIS_STANDARD_NAMES[axis].includes(standardName)) {
    return true;
  }
  const axisAttr = normalizeString(attrs.axis);
  if (axisAttr === axis) {
    return hasLinearUnits(attrs.units);
  }
  const longName = normalizeString(attrs.long_name);
  if (
    longName.includes(`projection_${axis}_coordinate`) ||
    longName.includes(`grid_${axis}`)
  ) {
    return hasLinearUnits(attrs.units);
  }
  return false;
}

function sanitizeGridMappingName(name: unknown) {
  if (!name) return undefined;
  return String(name).toLowerCase();
}

function normalizeStandardParallel(value: unknown): number[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  }
  if (
    typeof value === "object" &&
    "length" in (value as { length: number }) &&
    !Array.isArray(value)
  ) {
    const asArray = Array.from(value as ArrayLike<number>);
    return asArray.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  }
  return [Number(value)].filter((v) => Number.isFinite(v));
}

function getLongitudeOrigin(attrs: zarr.Attributes | undefined) {
  if (!attrs) return 0;
  if (attrs.longitude_of_central_meridian !== undefined) {
    return Number(attrs.longitude_of_central_meridian);
  }
  if (attrs.longitude_of_projection_origin !== undefined) {
    return Number(attrs.longitude_of_projection_origin);
  }
  return 0;
}

function getEarthRadius(attrs: zarr.Attributes | undefined) {
  if (!attrs) return 6371229.0;
  if (attrs.earth_radius !== undefined) {
    return Number(attrs.earth_radius);
  }
  if (attrs.semi_major_axis !== undefined && attrs.semi_minor_axis !== undefined) {
    return (Number(attrs.semi_major_axis) + Number(attrs.semi_minor_axis)) / 2;
  }
  if (attrs.semi_major_axis !== undefined) {
    return Number(attrs.semi_major_axis);
  }
  return 6371229.0;
}

export type LambertProjectionParams = {
  standardParallels: number[];
  lat0: number;
  lon0: number;
  falseEasting: number;
  falseNorthing: number;
  radius: number;
};

export function lambertParamsFromAttributes(
  attrs: zarr.Attributes | undefined
): LambertProjectionParams | undefined {
  if (!attrs) return undefined;
  const standardParallels = normalizeStandardParallel(attrs.standard_parallel);
  if (standardParallels.length === 0) {
    return undefined;
  }
  const lat0 =
    attrs.latitude_of_projection_origin !== undefined
      ? Number(attrs.latitude_of_projection_origin)
      : 0;
  const lon0 = getLongitudeOrigin(attrs);
  return {
    standardParallels,
    lat0,
    lon0,
    falseEasting:
      attrs.false_easting !== undefined ? Number(attrs.false_easting) : 0,
    falseNorthing:
      attrs.false_northing !== undefined ? Number(attrs.false_northing) : 0,
    radius: getEarthRadius(attrs),
  };
}

export function lambertXYToLatLon(
  x: number,
  y: number,
  params: LambertProjectionParams
) {
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;
  const [phi1Deg, phi2Deg] =
    params.standardParallels.length >= 2
      ? params.standardParallels
      : [params.standardParallels[0], params.standardParallels[0]];
  const phi1 = phi1Deg * deg2rad;
  const phi2 = phi2Deg * deg2rad;
  const lat0 = params.lat0 * deg2rad;
  const lon0 = params.lon0 * deg2rad;

  const n =
    Math.abs(phi1 - phi2) < 1e-7
      ? Math.sin(phi1)
      : Math.log(Math.cos(phi1) / Math.cos(phi2)) /
        Math.log(
          Math.tan(Math.PI / 4 + phi2 / 2) /
            Math.tan(Math.PI / 4 + phi1 / 2)
        );

  const f =
    (Math.cos(phi1) *
      Math.pow(Math.tan(Math.PI / 4 + phi1 / 2), n)) /
    n;

  const rho0 =
    params.radius *
    f *
    Math.pow(Math.tan(Math.PI / 4 + lat0 / 2), -n);

  const xAdj = x - params.falseEasting;
  const yAdj = y - params.falseNorthing;

  const rho = Math.sign(n) * Math.sqrt(xAdj * xAdj + (rho0 - yAdj) ** 2);
  const theta = Math.atan2(xAdj, rho0 - yAdj);
  const rhoAbs = Math.abs(rho) === 0 ? 1e-12 : Math.abs(rho);
  const lat =
    2 *
      Math.atan(Math.pow((params.radius * f) / rhoAbs, 1 / n)) -
    Math.PI / 2;
  const lon = lon0 + theta / n;
  return {
    lat: lat * rad2deg,
    lon: ((lon * rad2deg + 540) % 360) - 180,
  };
}

export async function detectProjectedGridMetadata(
  group: zarr.Group<zarr.FetchStore>,
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>
): Promise<ProjectedGridMetadata | undefined> {
  const dimsAttr = datavar.attrs?._ARRAY_DIMENSIONS;
  if (!Array.isArray(dimsAttr)) {
    return undefined;
  }
  const dims = (dimsAttr as unknown[]).filter(
    (dim): dim is string => typeof dim === "string"
  );
  if (dims.length < 2) {
    return undefined;
  }

  const axes: Partial<Record<AxisKey, AxisMetadata>> = {};

  for (const [idx, dim] of dims.entries()) {
    if (axes.x && axes.y) {
      break;
    }
    if (NON_SPATIAL_DIMS.has(dim)) {
      continue;
    }
    try {
      const coord = await zarr.open(group.resolve(dim), { kind: "array" });
      if (!coord) continue;
      if (!axes.x && matchesAxis("x", coord.attrs)) {
        axes.x = { name: dim, attrs: coord.attrs ?? {}, index: idx };
        continue;
      }
      if (!axes.y && matchesAxis("y", coord.attrs)) {
        axes.y = { name: dim, attrs: coord.attrs ?? {}, index: idx };
      }
    } catch {
      continue;
    }
  }

  if (!axes.x || !axes.y) {
    return undefined;
  }

  let gridMappingName: string | undefined;
  let gridMappingAttrs: zarr.Attributes | undefined;
  const mappingAttr = datavar.attrs?.grid_mapping;
  if (typeof mappingAttr === "string") {
    const mappingVar = mappingAttr.split(":")[0];
    try {
      const crsVar = await zarr.open(group.resolve(mappingVar), {
        kind: "array",
      });
      gridMappingName = sanitizeGridMappingName(
        crsVar.attrs?.grid_mapping_name
      );
      gridMappingAttrs = crsVar.attrs ?? {};
    } catch {
      gridMappingName = undefined;
      gridMappingAttrs = undefined;
    }
  }

  return {
    x: axes.x,
    y: axes.y,
    dimensions: dims,
    gridMappingName,
    gridMappingAttrs,
  };
}

function axisUnitScale(attrs: zarr.Attributes | undefined) {
  const units = normalizeString(attrs?.units);
  if (
    units === "km" ||
    units === "kilometer" ||
    units === "kilometers" ||
    units === "kilometre" ||
    units === "kilometres"
  ) {
    return 1000;
  }
  if (
    units === "m" ||
    units === "meter" ||
    units === "meters" ||
    units === "metre" ||
    units === "metres"
  ) {
    return 1;
  }
  return 1;
}

export async function readAxisValues(
  group: zarr.Group<zarr.FetchStore>,
  axis: AxisMetadata
): Promise<Float64Array> {
  const axisArray = await zarr.open(group.resolve(axis.name), {
    kind: "array",
  });
  const axisData = await zarr.get(axisArray, [null]);
  const raw = axisData.data as ArrayLike<number>;
  const result = Float64Array.from(raw);
  const scale = axisUnitScale(axis.attrs);
  if (scale !== 1) {
    for (let i = 0; i < result.length; i++) {
      result[i] *= scale;
    }
  }
  return result;
}

export const LAMBERT_GRID_MAPPING_NAMES = new Set([
  "lambert_conformal_conic",
  "lambert_conformal_conic_1sp",
  "lambert_conformal_conic_2sp",
]);
