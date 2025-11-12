<script lang="ts" setup>
import * as THREE from "three";
import * as zarr from "zarrita";
import {
  availableColormaps,
  calculateColorMapProperties,
  makeTextureMaterial,
} from "./utils/colormapShaders.ts";
import { decodeTime } from "./utils/timeHandling.ts";
import { datashaderExample } from "./utils/exampleFormatters.ts";
import {
  computed,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";

import { useGlobeControlStore } from "./store/store.js";
import { storeToRefs } from "pinia";
import type { TSources } from "../types/GlobeTypes.ts";
import { useToast } from "primevue/usetoast";
import { useLog } from "./utils/logging";
import { useSharedGlobeLogic } from "./sharedGlobe.ts";
import {
  detectProjectedGridMetadata,
  lambertParamsFromAttributes,
  lambertXYToLatLon,
  lambertLatLonToXY,
  readAxisValues,
  type LambertProjectionParams,
} from "./utils/cfProjection.ts";
import {
  latLongToXYZ,
  cartesianToLatLon,
  generateGridIndices,
} from "./utils/sphereMath.ts";
import { focusCameraOnRegion } from "./utils/cameraFocus.ts";
import { sampleColormapColor } from "./utils/colormapSampler.ts";
import { getDataSourceStore } from "./utils/zarrUtils.ts";

const props = defineProps<{
  datasources?: TSources;
}>();

const store = useGlobeControlStore();
const toast = useToast();
const { logError } = useLog();
const {
  timeIndexSlider,
  colormap,
  varnameSelector,
  invertColormap,
  selection,
} = storeToRefs(store);

let canvas: Ref<HTMLCanvasElement | undefined> = ref();
let box: Ref<HTMLDivElement | undefined> = ref();
const {
  getScene,
  getCamera,
  getRenderer,
  getOrbitControls,
  redraw,
  makeSnapshot,
  toggleRotate,
  resetDataVars,
  getDataVar,
  getTimeVar,
  updateLandSeaMask,
} = useSharedGlobeLogic(canvas, box);

const bounds = computed(() => selection.value);

let mainMesh: THREE.Mesh | undefined = undefined;
let gridInfoLogged = false;
const cameraCentered = ref(false);

const updateCount = ref(0);
const updatingData = ref(false);
const gridShape = ref<{ rows: number; cols: number }>();
const lambertAxisOrder = ref<"yx" | "xy">("yx");
const lambertAxes = ref<{
  x: Float64Array;
  y: Float64Array;
  params: LambertProjectionParams;
}>();
const currentField = ref<Float32Array | null>(null);
const currentUnits = ref<string | undefined>(undefined);
const colormapRange = ref<{ low: number; high: number }>();
const colormapTransform = ref<{ addOffset: number; scaleFactor: number }>();
const hoverInfo = ref<
  | {
      x: number;
      y: number;
      value: number;
      units?: string;
      color?: string;
    }
  | null
>(null);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hoverDelayMs = 300;
const hoverTimeoutId = ref<number | null>(null);
const isPointerDown = ref(false);

watch(
  () => varnameSelector.value,
  () => {
    getData();
  }
);

watch(
  () => timeIndexSlider.value,
  () => {
    getData();
  }
);

watch(
  () => props.datasources,
  () => {
    datasourceUpdate();
  }
);

watch(
  [() => bounds.value, () => invertColormap.value, () => colormap.value],
  () => {
    updateColormap();
  }
);

watch(
  () => bounds.value,
  (val) => {
    if (
      val &&
      typeof val.low === "number" &&
      typeof val.high === "number" &&
      Number.isFinite(val.high - val.low)
    ) {
      colormapRange.value = { low: val.low, high: val.high };
    }
  }
);

const gridsource = computed(() => {
  if (props.datasources) {
    return props.datasources.levels[0].grid;
  } else {
    return undefined;
  }
});

const datasource = computed(() => {
  if (props.datasources) {
    return props.datasources.levels[0].datasources[varnameSelector.value];
  } else {
    return undefined;
  }
});

async function datasourceUpdate() {
  resetDataVars();
  gridShape.value = undefined;
  if (props.datasources !== undefined) {
    gridInfoLogged = false;
    currentField.value = null;
    lambertAxes.value = undefined;
    cameraCentered.value = false;
    await prepareLambertGeometry();
    await getData();
    updateLandSeaMask();
    updateColormap();
  }
}

async function prepareLambertGeometry() {
  if (!props.datasources) {
    return;
  }
  const gridsrc = gridsource.value;
  if (!gridsrc) {
    return;
  }
  let gridGroup: zarr.Group<zarr.FetchStore> | undefined = undefined;
  try {
    const root = zarr.root(new zarr.FetchStore(gridsrc.store));
    gridGroup = await zarr.open(root.resolve(gridsrc.dataset), {
      kind: "group",
    });
  } catch (error) {
    console.warn("[GlobeLambert] Could not open dedicated grid store", error);
  }
  try {
    const datavar = await getDataVar(varnameSelector.value, props.datasources);
    if (!datavar) {
      throw new Error("Variable unavailable for Lambert grid");
    }
    let metadataSource:
      | zarr.Group<zarr.FetchStore>
      | undefined = undefined;
    let metadata:
      | Awaited<ReturnType<typeof detectProjectedGridMetadata>>
      | undefined = undefined;
    if (gridGroup) {
      try {
        metadata = await detectProjectedGridMetadata(gridGroup, datavar);
        metadataSource = gridGroup;
      } catch (error) {
        console.warn(
          "[GlobeLambert] Failed to detect metadata in grid group",
          error
        );
      }
    }
    if (!metadata) {
      try {
        const dataRoot = getDataSourceStore(
          props.datasources!,
          varnameSelector.value
        );
        const dataGroup = await zarr.open(dataRoot, { kind: "group" });
        metadata = await detectProjectedGridMetadata(dataGroup, datavar);
        metadataSource = dataGroup;
      } catch (error) {
        console.warn(
          "[GlobeLambert] Failed to detect metadata in datasource group",
          error
        );
      }
    }
    if (!metadata || !metadataSource || !metadata.x || !metadata.y) {
      throw new Error("Lambert projection metadata missing");
    }
    const lambertParams = lambertParamsFromAttributes(
      metadata.gridMappingAttrs
    );
    if (!lambertParams) {
      throw new Error("Lambert projection parameters incomplete");
    }
    lambertAxisOrder.value =
      metadata.y.index < metadata.x.index ? "yx" : "xy";
    const [xValues, yValues] = await Promise.all([
      readAxisValues(metadataSource, metadata.x),
      readAxisValues(metadataSource, metadata.y),
    ]);
    lambertAxes.value = {
      x: xValues,
      y: yValues,
      params: lambertParams,
    };
    if (!gridInfoLogged) {
      gridInfoLogged = true;
      console.info("[GlobeLambert] grid metadata", {
        xAxis: metadata.x.name,
        yAxis: metadata.y.name,
        xCount: xValues.length,
        yCount: yValues.length,
        axisOrder: lambertAxisOrder.value,
        lambertParams,
        gridMappingAttrsPreview: {
          crs_wkt:
            typeof metadata.gridMappingAttrs?.crs_wkt === "string"
              ? metadata.gridMappingAttrs.crs_wkt.slice(0, 200)
              : undefined,
          spatial_ref:
            typeof metadata.gridMappingAttrs?.spatial_ref === "string"
              ? metadata.gridMappingAttrs.spatial_ref.slice(0, 200)
              : undefined,
        },
        xSample: {
          min: xValues[0],
          mid: xValues[Math.floor(xValues.length / 2)],
          max: xValues[xValues.length - 1],
          units: metadata.x.attrs?.units,
        },
        ySample: {
          min: yValues[0],
          mid: yValues[Math.floor(yValues.length / 2)],
          max: yValues[yValues.length - 1],
          units: metadata.y.attrs?.units,
        },
      });
    }
    gridShape.value = {
      rows: yValues.length,
      cols: xValues.length,
    };
    const { geometry, center, extent } = buildLambertGeometry(
      xValues,
      yValues,
      lambertParams
    );
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    console.info("[GlobeLambert] geometry extent", {
      vertexCount: positions.count,
      sample: {
        first: [
          positions.getX(0),
          positions.getY(0),
          positions.getZ(0),
        ],
        mid: [
          positions.getX(Math.floor(positions.count / 2)),
          positions.getY(Math.floor(positions.count / 2)),
          positions.getZ(Math.floor(positions.count / 2)),
        ],
      },
      center,
      extent,
    });
    centerCameraOn(center.lat, center.lon, extent.latSpan, extent.lonSpan);
    mainMesh!.geometry.dispose();
    mainMesh!.geometry = geometry;
    redraw();
  } catch (error) {
    logError(error, "Could not prepare Lambert grid");
  }
}

function buildLambertGeometry(
  xCoords: Float64Array,
  yCoords: Float64Array,
  params: LambertProjectionParams
): {
  geometry: THREE.BufferGeometry;
  center: { lat: number; lon: number };
  extent: { latSpan: number; lonSpan: number };
} {
  const rows = yCoords.length;
  const cols = xCoords.length;
  const vertices = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const { lat, lon } = lambertXYToLatLon(xCoords[j], yCoords[i], params);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      const [x, y, z] = latLongToXYZ(lat, lon, 1.0);
      const index = i * cols + j;
      vertices[index * 3 + 0] = x;
      vertices[index * 3 + 1] = y;
      vertices[index * 3 + 2] = z;
      uvs[index * 2 + 0] = cols === 1 ? 0 : j / (cols - 1);
      uvs[index * 2 + 1] = rows === 1 ? 0 : i / (rows - 1);
    }
  }

  const indices = generateGridIndices(rows, cols, false);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  if (centerLat < 42) {
    console.warn("[GlobeLambert] Unexpected lat range", {
      minLat,
      maxLat,
      minLon,
      maxLon,
      centerLat,
      centerLon,
    });
  } else {
    console.info("[GlobeLambert] Lat/Lon extent", {
      minLat,
      maxLat,
      minLon,
      maxLon,
      centerLat,
      centerLon,
    });
  }
  return {
    geometry,
    center: { lat: centerLat, lon: centerLon },
    extent: { latSpan: maxLat - minLat, lonSpan: maxLon - minLon },
  };
}

function updateColormap() {
  const low = bounds.value?.low as number;
  const high = bounds.value?.high as number;
  const { addOffset, scaleFactor } = calculateColorMapProperties(
    low,
    high,
    invertColormap.value
  );

  if (mainMesh) {
    const material = mainMesh.material as THREE.ShaderMaterial;
    material.uniforms.colormap.value = availableColormaps[colormap.value];
    material.uniforms.addOffset.value = addOffset;
    material.uniforms.scaleFactor.value = scaleFactor;
    redraw();
  }
  colormapTransform.value = { addOffset, scaleFactor };
}

async function getData() {
  store.startLoading();
  try {
    hoverInfo.value = null;
    updateCount.value += 1;
    const myUpdateCount = updateCount.value;
    if (updatingData.value) {
      return;
    }
    updatingData.value = true;
    if (!gridShape.value) {
      await prepareLambertGeometry();
    }
    const localVarname = varnameSelector.value;
    const currentTimeIndexSliderValue = timeIndexSlider.value;
    const [timevar, datavar] = await Promise.all([
      getTimeVar(props.datasources!),
      getDataVar(localVarname, props.datasources!),
    ]);

    let timeinfo = {};
    if (timevar !== undefined) {
      const timeattrs = timevar.attrs;
      const timevalues = (await zarr.get(timevar, [null])).data;
      timeinfo = {
        values: timevalues,
        current: decodeTime(
          (timevalues as number[])[currentTimeIndexSliderValue],
          timeattrs
        ),
      };
    }
    if (datavar !== undefined && gridShape.value) {
      const rawData = await zarr.get(datavar, [
        currentTimeIndexSliderValue,
        ...Array(datavar.shape.length - 1).fill(null),
      ]);
      const baseArray =
        rawData.data instanceof Float64Array
          ? (rawData.data as Float64Array)
          : Float64Array.from(rawData.data as ArrayLike<number>);
      const orderedData = orientLambertData(
        baseArray,
        gridShape.value.rows,
        gridShape.value.cols,
        lambertAxisOrder.value === "yx"
      );
      const fillCandidates = [
        datavar.attrs?._FillValue,
        datavar.attrs?.missing_value,
      ].flat();
      const fillValues = new Set(
        fillCandidates
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      );
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      const textureData = new Float32Array(orderedData.length);
      for (let i = 0; i < orderedData.length; i++) {
        const value = orderedData[i];
        if (fillValues.has(value) || Number.isNaN(value)) {
          textureData[i] = Number.NaN;
          continue;
        }
        const value32 = Number(value);
        textureData[i] = value32;
        min = Math.min(min, value32);
        max = Math.max(max, value32);
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 1;
      } else if (min === max) {
        max = min + 1e-6;
      }
      const lowBound =
        (bounds.value?.low as number | undefined) ?? min ?? 0;
      const highBound =
        (bounds.value?.high as number | undefined) ?? max ?? 1;
      const texture = new THREE.DataTexture(
        textureData,
        gridShape.value.cols,
        gridShape.value.rows,
        THREE.RedFormat,
        THREE.FloatType,
        THREE.UVMapping
      );
      currentField.value = textureData;
      currentUnits.value = datavar.attrs?.units
        ? String(datavar.attrs.units)
        : undefined;
      colormapRange.value = { low: lowBound, high: highBound };
      texture.needsUpdate = true;
      const { addOffset, scaleFactor } = calculateColorMapProperties(
        lowBound,
        highBound,
        invertColormap.value
      );
      colormapTransform.value = { addOffset, scaleFactor };
      const material = makeTextureMaterial(
        texture,
        colormap.value,
        addOffset,
        scaleFactor
      );
      mainMesh!.material = material;
      mainMesh!.material.needsUpdate = true;

      store.updateVarInfo({
        attrs: datavar.attrs,
        timeinfo,
        timeRange: { start: 0, end: datavar.shape[0] - 1 },
        bounds: { low: min, high: max },
      });
    }
    updatingData.value = false;
    if (updateCount.value !== myUpdateCount) {
      await getData();
    }
  } catch (error) {
    logError(error, "Could not fetch Lambert data");
    updatingData.value = false;
  } finally {
    store.stopLoading();
  }
}

function copyPythonExample() {
  const example = datashaderExample({
    cameraPosition: getCamera()!.position,
    datasrc: datasource.value!.store + datasource.value!.dataset,
    gridsrc: gridsource.value!.store + gridsource.value!.dataset,
    varname: varnameSelector.value,
    timeIndex: timeIndexSlider.value,
    varbounds: bounds.value!,
    colormap: colormap.value,
    invertColormap: invertColormap.value,
  });
  navigator.clipboard.writeText(example);
  toast.add({
    detail: `Copied into clipboard`,
    life: 3000,
    severity: "success",
  });
}

onMounted(() => {
  getScene()?.add(mainMesh as THREE.Mesh);
  canvas.value?.addEventListener("mousemove", handleMouseMove);
  canvas.value?.addEventListener("mouseleave", handleMouseLeave);
  canvas.value?.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointerup", handlePointerUp);
});

onBeforeMount(async () => {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial();
  mainMesh = new THREE.Mesh(geometry, material);
  await datasourceUpdate();
});

onBeforeUnmount(() => {
  canvas.value?.removeEventListener("mousemove", handleMouseMove);
  canvas.value?.removeEventListener("mouseleave", handleMouseLeave);
  canvas.value?.removeEventListener("pointerdown", handlePointerDown);
  window.removeEventListener("pointerup", handlePointerUp);
});

function centerCameraOn(
  lat: number,
  lon: number,
  latSpan?: number,
  lonSpan?: number
) {
  if (cameraCentered.value) {
    return;
  }
  const span = Math.max(latSpan ?? 0, lonSpan ?? 0);
  if (!Number.isFinite(span) || span >= 120) {
    return;
  }
  focusCameraOnRegion({
    camera: getCamera(),
    orbit: getOrbitControls(),
    redraw,
    lat,
    lon,
    span,
  });
  cameraCentered.value = true;
}

defineExpose({ makeSnapshot, copyPythonExample, toggleRotate });

function orientLambertData(
  arr: Float64Array,
  rows: number,
  cols: number,
  yFirst: boolean
) {
  if (yFirst) {
    return arr;
  }
  const transposed = new Float64Array(arr.length);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const srcIndex = x * rows + y;
      const dstIndex = y * cols + x;
      transposed[dstIndex] = arr[srcIndex];
    }
  }
  return transposed;
}

function handleMouseMove(event: MouseEvent) {
  if (isPointerDown.value) {
    hoverInfo.value = null;
    return;
  }
  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
  }
  hoverTimeoutId.value = window.setTimeout(() => {
    updateHoverInfo(event);
    hoverTimeoutId.value = null;
  }, hoverDelayMs);
}

function updateHoverInfo(event: MouseEvent) {
  if (
    !mainMesh ||
    !gridShape.value ||
    !lambertAxes.value ||
    !currentField.value
  ) {
    hoverInfo.value = null;
    return;
  }
  const canvasEl = canvas.value;
  const boxEl = box.value;
  const camera = getCamera();
  if (!canvasEl || !boxEl || !camera) {
    hoverInfo.value = null;
    return;
  }
  const rect = canvasEl.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(mainMesh, true);
  if (!intersects.length) {
    hoverInfo.value = null;
    return;
  }
  const point = intersects[0].point;
  const { lat, lon } = cartesianToLatLon(point.x, point.y, point.z);
  const { params, x, y } = lambertAxes.value;
  try {
    const projected = lambertLatLonToXY(lat, lon, params);
    const xIdx = findNearestIndex(x, projected.x);
    const yIdx = findNearestIndex(y, projected.y);
    const cols = gridShape.value.cols;
    const index = yIdx * cols + xIdx;
    const value = currentField.value[index];
    if (value === undefined || Number.isNaN(value)) {
      hoverInfo.value = null;
      return;
    }
    let color: string | undefined = undefined;
    if (colormapTransform.value) {
      const normalized = THREE.MathUtils.clamp(
        colormapTransform.value.addOffset +
          colormapTransform.value.scaleFactor * value,
        0,
        1
      );
      color = sampleColormapColor(
        getRenderer(),
        colormap.value,
        normalized
      );
    }
    const boxRect = boxEl.getBoundingClientRect();
    hoverInfo.value = {
      x: event.clientX - boxRect.left,
      y: event.clientY - boxRect.top - 16,
      value,
      units: currentUnits.value,
      color,
    };
  } catch {
    hoverInfo.value = null;
  }
}

function handleMouseLeave() {
  hoverInfo.value = null;
  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }
  isPointerDown.value = false;
}

function findNearestIndex(array: Float64Array, value: number) {
  if (!array.length) {
    return 0;
  }
  let low = 0;
  let high = array.length - 1;
  const ascending = array[0] <= array[high];
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midVal = array[mid];
    if (midVal === value) {
      return mid;
    }
    if (ascending ? midVal < value : midVal > value) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const clamp = (idx: number) =>
    Math.max(0, Math.min(array.length - 1, idx));
  const lowIdx = clamp(low);
  const highIdx = clamp(high);
  const lowDiff = Math.abs(array[lowIdx] - value);
  const highDiff = Math.abs(array[highIdx] - value);
  return lowDiff < highDiff ? lowIdx : highIdx;
}

function handlePointerDown() {
  isPointerDown.value = true;
  hoverInfo.value = null;
  if (hoverTimeoutId.value !== null) {
    clearTimeout(hoverTimeoutId.value);
    hoverTimeoutId.value = null;
  }
}

function handlePointerUp() {
  isPointerDown.value = false;
}

</script>

<template>
  <div ref="box" class="globe_box" tabindex="0" autofocus>
    <canvas ref="canvas" class="globe_canvas"> </canvas>
    <div
      v-if="hoverInfo"
      class="globe-tooltip"
      :style="{ left: `${hoverInfo.x}px`, top: `${hoverInfo.y}px` }"
    >
      <span
        v-if="hoverInfo.color"
        class="globe-tooltip__swatch"
        :style="{ background: hoverInfo.color }"
      ></span>
      {{ hoverInfo.value.toFixed(3) }}
      <span v-if="hoverInfo.units">&nbsp;{{ hoverInfo.units }}</span>
    </div>
  </div>
</template>

<style>
div.globe_box {
  height: 100%;
  width: 100%;
  padding: 0;
  margin: 0;
  overflow: hidden;
  display: flex;
  position: relative;
}
div.globe_canvas {
  padding: 0;
  margin: 0;
}
.globe-tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 0.8rem;
  transform: translate(-50%, -100%);
  white-space: nowrap;
}
.globe-tooltip__swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
}
</style>
