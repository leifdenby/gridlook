<script lang="ts" setup>
import ColorBar from "@/components/ColorBar.vue";
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { useGlobeControlStore } from "./store/store.ts";
import { storeToRefs } from "pinia";
import debounce from "lodash.debounce";
import type { TModelInfo, TBounds } from "../types/GlobeTypes.js";
import { useUrlParameterStore } from "./store/paramStore.ts";

const props = defineProps<{ modelInfo?: TModelInfo }>();

defineEmits<{
  onSnapshot: [];
  onExample: [];
  onRotate: [];
}>();

const BOUND_MODES = {
  AUTO: "auto",
  DATA: "data",
  DEFAULT: "default",
  USER: "user",
} as const;

type TBoundModes = (typeof BOUND_MODES)[keyof typeof BOUND_MODES];

const store = useGlobeControlStore();
const {
  timeIndexSlider,
  colormap,
  invertColormap,
  temperatureUnitCelsius,
  varnameSelector,
  varinfo,
  hoverScalarValue,
  userBoundsLow,
  userBoundsHigh,
  landSeaMaskChoice,
  landSeaMaskUseTexture,
} = storeToRefs(store);

const urlParameterStore = useUrlParameterStore();
const {
  paramColormap,
  paramTimeIndex,
  paramInvertColormap,
  paramMaskMode,
  paramMaskingUseTexture,
  paramTempUnit,
} = storeToRefs(urlParameterStore);

const menuCollapsed: Ref<boolean> = ref(false);
const mobileMenuCollapsed: Ref<boolean> = ref(true);
const isMobileView: Ref<boolean> = ref(false);
const autoColormap: Ref<boolean> = ref(true);
const defaultBounds: Ref<TBounds> = ref({});
const pickedBounds: Ref<TBoundModes> = ref(BOUND_MODES.AUTO);
const colorbarWrap: Ref<HTMLDivElement | undefined> = ref(undefined);
const isDraggingRange: Ref<boolean> = ref(false);
const dragStartX: Ref<number> = ref(0);
const dragStartLow: Ref<number> = ref(0);
const dragStartHigh: Ref<number> = ref(0);

// Local copy of timeIndexSlider to allow debounced updates
const localTimeIndexSlider: Ref<number> = ref(timeIndexSlider.value);

const activeBoundsMode = computed(() => {
  if (pickedBounds.value === BOUND_MODES.AUTO) {
    if (
      userBoundsLow.value !== undefined &&
      userBoundsHigh.value !== undefined &&
      // if the input-fields are empty, they are interpreted as "" instead of a number
      (userBoundsHigh.value as unknown as string) !== "" &&
      (userBoundsLow.value as unknown as string) !== ""
    ) {
      return BOUND_MODES.USER;
    } else if (
      defaultBounds.value.low !== undefined &&
      defaultBounds.value.high !== undefined
    ) {
      return BOUND_MODES.DEFAULT;
    } else {
      return BOUND_MODES.DATA;
    }
  } else {
    return pickedBounds.value;
  }
});

const dataBounds = computed(() => {
  return varinfo.value?.bounds ?? {};
});

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function isKelvinUnit(units: string | undefined) {
  if (!units) return false;
  const normalized = units.trim().toLowerCase();
  return normalized === "k" || normalized === "kelvin";
}

const currentVarRawUnits = computed(() => {
  return String(varinfo.value?.attrs?.units ?? "-");
});

const hasKelvinUnit = computed(() => isKelvinUnit(currentVarRawUnits.value));

function toDisplayValue(value: number) {
  if (hasKelvinUnit.value && temperatureUnitCelsius.value) {
    return value - 273.15;
  }
  return value;
}

function fromDisplayValue(value: number) {
  if (hasKelvinUnit.value && temperatureUnitCelsius.value) {
    return value + 273.15;
  }
  return value;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function formatHistogramMarkerLabels(values: number[]) {
  if (values.length === 0) return [];
  let decimals = 0;
  let labels = values.map((value) => value.toFixed(decimals));

  while (new Set(labels).size < values.length && decimals < 12) {
    decimals += 1;
    labels = values.map((value) => value.toFixed(decimals));
  }

  return labels;
}

function niceStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = 10 ** exponent;
  const normalized = rawStep / base;
  let niceNormalized = 10;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  return niceNormalized * base;
}

function roundForDisplay(value: number) {
  return Number(value.toFixed(12));
}

function generateNiceMarkerValues(low: number, high: number, maxCount: number) {
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0 || maxCount <= 0) {
    return [];
  }
  const epsilon = span * 1e-9;

  function markersForStep(step: number) {
    const values: number[] = [];
    if (!Number.isFinite(step) || step <= 0) return values;
    let v = Math.ceil((low + epsilon) / step) * step;
    for (; v < high - epsilon; v += step) {
      values.push(roundForDisplay(v));
      if (values.length > 256) break;
    }
    return values;
  }

  let step = niceStep(span / (maxCount + 1));
  let values = markersForStep(step);
  while (values.length < Math.min(2, maxCount) && step > span * 1e-12) {
    step /= 2;
    values = markersForStep(step);
  }

  if (values.length > maxCount) {
    const sampled: number[] = [];
    for (let i = 0; i < maxCount; i += 1) {
      const idx = Math.round((i * (values.length - 1)) / (maxCount - 1));
      sampled.push(values[idx]);
    }
    values = sampled;
  }

  if (low < 0 && high > 0) {
    const zeroIdx = values.findIndex((v) => Math.abs(v) < 1e-9);
    if (zeroIdx === -1 && values.length > 0) {
      let closestIdx = 0;
      let closestDist = Math.abs(values[0]);
      for (let i = 1; i < values.length; i += 1) {
        const dist = Math.abs(values[i]);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      values[closestIdx] = 0;
    }
  }

  return values
    .filter((v, i) => values.findIndex((other) => Math.abs(other - v) < 1e-9) === i)
    .sort((a, b) => a - b);
}

const dataBoundsDisplay = computed(() => {
  const low = finiteNumber(dataBounds.value.low);
  const high = finiteNumber(dataBounds.value.high);
  if (low === undefined || high === undefined) return {};
  return { low: toDisplayValue(low), high: toDisplayValue(high) };
});

const defaultBoundsDisplay = computed(() => {
  const low = finiteNumber(defaultBounds.value.low);
  const high = finiteNumber(defaultBounds.value.high);
  if (low === undefined || high === undefined) return {};
  return { low: toDisplayValue(low), high: toDisplayValue(high) };
});

const sliderDomain = computed(() => {
  const dataLow = finiteNumber(dataBoundsDisplay.value.low);
  const dataHigh = finiteNumber(dataBoundsDisplay.value.high);
  if (
    dataLow !== undefined &&
    dataHigh !== undefined &&
    Number.isFinite(dataHigh - dataLow) &&
    dataHigh > dataLow
  ) {
    return { low: dataLow, high: dataHigh };
  }

  const defaultLow = finiteNumber(defaultBoundsDisplay.value.low);
  const defaultHigh = finiteNumber(defaultBoundsDisplay.value.high);
  if (
    defaultLow !== undefined &&
    defaultHigh !== undefined &&
    Number.isFinite(defaultHigh - defaultLow) &&
    defaultHigh > defaultLow
  ) {
    return { low: defaultLow, high: defaultHigh };
  }

  return { low: 0, high: 1 };
});

const hasSliderDomain = computed(() => sliderDomain.value.high > sliderDomain.value.low);

const userLowBound = computed(() => {
  const low = finiteNumber(userBoundsLowDisplay.value);
  if (low !== undefined) return low;
  return sliderDomain.value.low;
});

const userHighBound = computed(() => {
  const high = finiteNumber(userBoundsHighDisplay.value);
  if (high !== undefined) return high;
  return sliderDomain.value.high;
});

const userBoundsLowDisplay = computed<number | undefined>({
  get: () => {
    const low = finiteNumber(userBoundsLow.value);
    return low === undefined ? undefined : roundToTwo(toDisplayValue(low));
  },
  set: (v) => {
    const value = finiteNumber(v);
    userBoundsLow.value =
      value === undefined ? undefined : roundToTwo(fromDisplayValue(value));
  },
});

const userBoundsHighDisplay = computed<number | undefined>({
  get: () => {
    const high = finiteNumber(userBoundsHigh.value);
    return high === undefined ? undefined : roundToTwo(toDisplayValue(high));
  },
  set: (v) => {
    const value = finiteNumber(v);
    userBoundsHigh.value =
      value === undefined ? undefined : roundToTwo(fromDisplayValue(value));
  },
});

const sliderStep = computed(() => {
  const step = (sliderDomain.value.high - sliderDomain.value.low) / 500;
  return Number.isFinite(step) && step > 0 ? step : 0.001;
});

function normalizeToPercent(value: number) {
  const domain = sliderDomain.value;
  const span = domain.high - domain.low;
  if (span <= 0) return 0;
  return ((value - domain.low) / span) * 100;
}

const selectedLowPct = computed(() => normalizeToPercent(userLowBound.value));
const selectedHighPct = computed(() => normalizeToPercent(userHighBound.value));
const selectedSpanPct = computed(() =>
  Math.max(0.5, selectedHighPct.value - selectedLowPct.value)
);
const userLowLabel = computed(() => Number(userLowBound.value).toFixed(2));
const userHighLabel = computed(() => Number(userHighBound.value).toFixed(2));
const hoverMarkerDisplayValue = computed(() => {
  const value = finiteNumber(hoverScalarValue.value);
  if (value === undefined) return undefined;
  return toDisplayValue(value);
});
const hoverMarkerPct = computed(() => {
  const value = finiteNumber(hoverMarkerDisplayValue.value);
  if (value === undefined) return undefined;
  return Math.max(0, Math.min(100, normalizeToPercent(value)));
});
const hoverMarkerLabel = computed(() => {
  const value = finiteNumber(hoverMarkerDisplayValue.value);
  if (value === undefined) return undefined;
  return value.toFixed(2);
});

function beginRangeDrag(event: MouseEvent) {
  if (!hasSliderDomain.value || !colorbarWrap.value) return;
  isDraggingRange.value = true;
  dragStartX.value = event.clientX;
  dragStartLow.value = userLowBound.value;
  dragStartHigh.value = userHighBound.value;
  pickedBounds.value = BOUND_MODES.USER;
  window.addEventListener("mousemove", onRangeDrag);
  window.addEventListener("mouseup", endRangeDrag);
}

function onRangeDrag(event: MouseEvent) {
  if (!isDraggingRange.value || !colorbarWrap.value) return;
  const rect = colorbarWrap.value.getBoundingClientRect();
  if (rect.width <= 0) return;

  const domain = sliderDomain.value;
  const domainSpan = domain.high - domain.low;
  const deltaPx = event.clientX - dragStartX.value;
  const deltaValue = (deltaPx / rect.width) * domainSpan;

  let nextLow = dragStartLow.value + deltaValue;
  let nextHigh = dragStartHigh.value + deltaValue;

  if (nextLow < domain.low) {
    const shift = domain.low - nextLow;
    nextLow += shift;
    nextHigh += shift;
  }
  if (nextHigh > domain.high) {
    const shift = nextHigh - domain.high;
    nextLow -= shift;
    nextHigh -= shift;
  }

  userBoundsLowDisplay.value = nextLow;
  userBoundsHighDisplay.value = nextHigh;
}

function endRangeDrag() {
  isDraggingRange.value = false;
  window.removeEventListener("mousemove", onRangeDrag);
  window.removeEventListener("mouseup", endRangeDrag);
}

const distributionPath = computed(() => {
  const bins = varinfo.value?.histogram?.bins;
  if (!bins || bins.length === 0) {
    return "M 0,28 L 100,28";
  }

  const maxCount = Math.max(...bins, 0);
  if (maxCount <= 0) {
    return "M 0,28 L 100,28";
  }

  const values: string[] = [];
  for (let i = 0; i < bins.length; i += 1) {
    const t = bins.length > 1 ? i / (bins.length - 1) : 0;
    const x = t * 100;
    const y = 28 - (bins[i] / maxCount) * 22;
    values.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M ${values.join(" L ")}`;
});

const histogramMarkers = computed(() => {
  const low = sliderDomain.value.low;
  const high = sliderDomain.value.high;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return [];
  }
  const markerValues = generateNiceMarkerValues(low, high, 4);
  const labels = formatHistogramMarkerLabels(markerValues);

  return markerValues.map((value, idx) => ({
    value,
    pct: Math.max(0, Math.min(100, normalizeToPercent(value))),
    label: labels[idx],
  }));
});

function onUserLowSliderInput(event: Event) {
  const input = event.target as HTMLInputElement;
  if (userBoundsHigh.value === undefined) {
    userBoundsHigh.value = fromDisplayValue(sliderDomain.value.high);
  }
  userBoundsLowDisplay.value = Number(input.value);
  pickedBounds.value = BOUND_MODES.USER;
}

function onUserHighSliderInput(event: Event) {
  const input = event.target as HTMLInputElement;
  if (userBoundsLow.value === undefined) {
    userBoundsLow.value = fromDisplayValue(sliderDomain.value.low);
  }
  userBoundsHighDisplay.value = Number(input.value);
  pickedBounds.value = BOUND_MODES.USER;
}

const bounds = computed(() => {
  if (activeBoundsMode.value === BOUND_MODES.DATA) {
    return dataBounds.value;
  } else if (activeBoundsMode.value === BOUND_MODES.USER) {
    return {
      low: userBoundsLow.value,
      high: userBoundsHigh.value,
    };
  } else if (activeBoundsMode.value === BOUND_MODES.DEFAULT) {
    return defaultBounds.value;
  }
  return undefined;
});

const timeRange = computed(() => {
  return varinfo.value?.timeRange ?? { start: 0, end: 1 };
});

const debouncedUpdateTimeIndexSlider = debounce(() => {
  timeIndexSlider.value = localTimeIndexSlider.value;
}, 350);

watch(localTimeIndexSlider, () => {
  debouncedUpdateTimeIndexSlider();
});

const currentTimeValue = computed(() => {
  return varinfo.value?.timeinfo?.current;
});

const currentVarName = computed(() => {
  return store.varnameDisplay ?? "-";
});

const currentVarLongname = computed(() => {
  return varinfo.value?.attrs?.long_name ?? "-";
});

const currentVarUnits = computed(() => {
  if (hasKelvinUnit.value && temperatureUnitCelsius.value) return "C";
  return currentVarRawUnits.value;
});

const isHidden = computed(() => {
  return (
    (isMobileView.value && mobileMenuCollapsed.value) || menuCollapsed.value
  );
});

watch(
  () => varnameSelector.value,
  () => {
    // Reset user overrides when changing variable, so bounds return to auto.
    userBoundsLow.value = undefined;
    userBoundsHigh.value = undefined;
    pickedBounds.value = BOUND_MODES.AUTO;
    setDefaultBounds();
    setDefaultColormap();
    store.updateBounds(bounds.value as TBounds);
  }
);

watch(
  () => bounds.value,
  () => {
    store.updateBounds(bounds.value as TBounds);
  }
);

watch(
  () => autoColormap,
  () => {
    setDefaultColormap();
  }
);

watch(
  () => hasKelvinUnit.value,
  () => {
    if (hasKelvinUnit.value) {
      if (paramTempUnit.value === "k") {
        temperatureUnitCelsius.value = false;
      } else if (paramTempUnit.value === "c") {
        temperatureUnitCelsius.value = true;
      } else {
        // Default to Celsius display for Kelvin data.
        temperatureUnitCelsius.value = true;
      }
    } else {
      temperatureUnitCelsius.value = true;
    }
  },
  { immediate: true }
);

function setDefaultBounds() {
  const defaultConfig = props.modelInfo?.vars[varnameSelector.value];
  defaultBounds.value = defaultConfig?.default_range ?? {};
}

function toggleMenu() {
  menuCollapsed.value = !menuCollapsed.value;
}

function toggleMobileMenu() {
  mobileMenuCollapsed.value = !mobileMenuCollapsed.value;
}

const setDefaultColormap = () => {
  const defaultColormap =
    props.modelInfo?.vars[varnameSelector.value].default_colormap;
  if (autoColormap.value && defaultColormap !== undefined) {
    invertColormap.value = defaultColormap.inverted || false;
    colormap.value = defaultColormap.name;
  }
};

const MOBILE_VIEW_THRESHOLD = 769; // px

onMounted(() => {
  isMobileView.value = window.innerWidth < MOBILE_VIEW_THRESHOLD;
  window.addEventListener("resize", () => {
    isMobileView.value = window.innerWidth < MOBILE_VIEW_THRESHOLD;
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", () => {
    isMobileView.value = window.innerWidth < MOBILE_VIEW_THRESHOLD;
  });
  window.removeEventListener("mousemove", onRangeDrag);
  window.removeEventListener("mouseup", endRangeDrag);
});

// INITIALIZATION
if (paramMaskingUseTexture.value) {
  if (paramMaskingUseTexture.value === "false") {
    landSeaMaskUseTexture.value = false;
  } else if (paramMaskingUseTexture.value === "true") {
    landSeaMaskUseTexture.value = true;
  }
}

if (paramMaskMode.value) {
  landSeaMaskChoice.value =
    paramMaskMode.value as typeof landSeaMaskChoice.value;
}

setDefaultBounds();
store.updateBounds(bounds.value as TBounds); // ensure initial settings are published
if (paramColormap.value) {
  colormap.value = paramColormap.value;
}

if (paramInvertColormap.value) {
  // explicitely check for string values "true" and "false"
  if (paramInvertColormap.value === "false") {
    invertColormap.value = false;
  } else if (paramInvertColormap.value === "true") {
    invertColormap.value = true;
  }
}

if (paramTimeIndex.value) {
  timeIndexSlider.value = Number(paramTimeIndex.value);
  localTimeIndexSlider.value = Number(paramTimeIndex.value);
}
</script>

<template>
  <nav
    id="main_controls"
    class="panel gl_controls"
    :class="{ 'mobile-visible': !isHidden }"
  >
    <div
      class="panel-heading"
      style="display: flex; justify-content: space-between"
    >
      <button
        type="button"
        class="button is-primary is-hidden-tablet mr-1"
        @click="toggleMobileMenu"
      >
        <i class="fa-solid fa-bars"></i>
      </button>
      <div v-if="modelInfo" class="mobile-title text-wrap">
        {{ modelInfo.title }}
      </div>
      <div v-else>no data available</div>
      <button type="button" class="is-hidden-mobile">
        <i
          class="fa-solid"
          :class="{
            'fa-angle-down': menuCollapsed,
            'fa-angle-up': !menuCollapsed,
          }"
          @click="toggleMenu"
        ></i>
      </button>
    </div>

    <div v-if="modelInfo && !isHidden" class="panel-block">
      <div class="select is-fullwidth">
        <select v-model="varnameSelector" class="form-control">
          <option
            v-for="varname in Object.keys(modelInfo.vars)"
            :key="varname"
            :value="varname"
          >
            {{ varname }}
            <span v-if="modelInfo.vars[varname]?.attrs?.standard_name"
              >- {{ modelInfo.vars[varname].attrs.standard_name }}</span
            >
          </option>
        </select>
      </div>
    </div>
    <div v-if="modelInfo && !isHidden" class="panel-block">
      <div class="control">
        <div class="mb-2 w-100 is-flex is-justify-content-space-between">
          <div class="my-2">Time:</div>
          <div class="is-flex">
            <input
              v-model.number="localTimeIndexSlider"
              class="input"
              type="number"
              :min="timeRange.start"
              :max="timeRange.end"
              style="width: 8em"
            />
            <div class="my-2">/ {{ timeRange.end }}</div>
          </div>
        </div>
        <input
          v-model.number="localTimeIndexSlider"
          class="w-100"
          type="range"
          :min="timeRange.start"
          :max="timeRange.end"
        />
        <div class="w-100 is-flex is-justify-content-space-between">
          <div>
            Currently shown:<span
              :class="{ loader: store.loading === true }"
            ></span>
          </div>
          <div class="has-text-right">
            {{ currentVarName }} @ {{ store.timeIndexDisplay }}
            <br />
            <span v-if="currentTimeValue">
              {{ currentTimeValue.format() }}
            </span>
            <br />
          </div>
        </div>
        <div class="has-text-right">
          {{ currentVarLongname }} /
          <button
            v-if="hasKelvinUnit"
            type="button"
            class="button is-small unit-toggle"
            @click="temperatureUnitCelsius = !temperatureUnitCelsius"
          >
            <span
              class="unit-segment"
              :class="{ active: !temperatureUnitCelsius }"
              >K</span
            >
            <span
              class="unit-segment"
              :class="{ active: temperatureUnitCelsius }"
              >C</span
            >
          </button>
          <span v-else>{{ currentVarUnits }}</span>
        </div>
      </div>
    </div>
    <div v-if="modelInfo && !isHidden" class="panel-block is-block w-100">
      <div>
        <!-- Header -->
        <div class="columns has-text-weight-bold is-mobile compact-row">
          <div class="column">range</div>
          <div class="column">low</div>
          <div class="column has-text-right">high</div>
        </div>

        <!-- Auto Bounds -->
        <div class="columns is-mobile active-row compact-row">
          <div class="column">
            <input
              id="auto_bounds"
              v-model="pickedBounds"
              class="mb-3 mr-1"
              type="radio"
              value="auto"
            />
            <label for="auto_bounds">auto</label>
          </div>
          <div class="column"></div>
          <div class="column has-text-right"></div>
        </div>

        <!-- Data Bounds -->
        <div
          class="columns is-mobile active-row compact-row"
          :class="{ active: activeBoundsMode === BOUND_MODES.DATA }"
        >
          <div class="column">
            <input
              id="data_bounds"
              v-model="pickedBounds"
              class="mr-1"
              type="radio"
              value="data"
            />
            <label for="data_bounds">data</label>
          </div>
          <div class="column">
            {{ Number(dataBoundsDisplay.low).toPrecision(4) }}
          </div>
          <div class="column has-text-right">
            {{ Number(dataBoundsDisplay.high).toPrecision(4) }}
          </div>
        </div>

        <!-- Default Bounds -->
        <div
          class="columns is-mobile active-row compact-row"
          :class="{ active: activeBoundsMode === BOUND_MODES.DEFAULT }"
        >
          <div class="column">
            <input
              id="default_bounds"
              v-model="pickedBounds"
              :disabled="
                defaultBounds.low === undefined &&
                defaultBounds.high === undefined
              "
              type="radio"
              class="mr-1"
              value="default"
            />
            <label
              for="default_bounds"
              :class="{
                'has-text-grey-light':
                  defaultBounds.low === undefined &&
                  defaultBounds.high === undefined,
              }"
              >default</label
            >
          </div>
          <div
            class="column"
            :class="{
              'has-text-grey-light':
                defaultBounds.low === undefined &&
                defaultBounds.high === undefined,
            }"
          >
            {{ Number(defaultBoundsDisplay.low).toPrecision(4) }}
          </div>
          <div
            class="column has-text-right"
            :class="{
              'has-text-grey-light':
                defaultBounds.low === undefined &&
                defaultBounds.high === undefined,
            }"
          >
            {{ Number(defaultBoundsDisplay.high).toPrecision(4) }}
          </div>
        </div>

        <!-- User Bounds -->
        <div
          class="columns is-mobile active-row compact-row"
          :class="{ active: activeBoundsMode === BOUND_MODES.USER }"
        >
          <div class="column">
            <input
              id="user_bounds"
              v-model="pickedBounds"
              class="mr-1"
              type="radio"
              value="user"
            />
            <label for="user_bounds">user</label>
          </div>
          <div class="column">
            <input
              v-model.number="userBoundsLowDisplay"
              size="10"
              class="input"
              type="number"
              step="0.01"
            />
          </div>
          <div class="column has-text-right">
            <input
              v-model.number="userBoundsHighDisplay"
              size="10"
              class="input"
              type="number"
              step="0.01"
            />
          </div>
        </div>
        <div
          class="columns is-mobile active-row compact-row"
          :class="{ active: activeBoundsMode === BOUND_MODES.USER }"
        >
          <div class="column is-full user-range-column">
            <div class="distribution-plot-wrap">
              <svg
                class="distribution-plot"
                viewBox="0 0 100 30"
                preserveAspectRatio="none"
              >
                <rect
                  class="distribution-selection"
                  :x="selectedLowPct"
                  y="0"
                  :width="Math.max(0.5, selectedHighPct - selectedLowPct)"
                  height="30"
                />
                <path class="distribution-line" :d="distributionPath" />
              </svg>
              <div
                v-for="(marker, idx) in histogramMarkers"
                :key="`hist-marker-${idx}`"
                class="hist-marker"
                :style="{ left: `${marker.pct}%` }"
              >
                <div class="hist-marker-label">{{ marker.label }}</div>
              </div>
            </div>
            <div class="slider-stack">
              <input
                class="w-100"
                type="range"
                :min="sliderDomain.low"
                :max="sliderDomain.high"
                :step="sliderStep"
                :value="userLowBound"
                :disabled="!hasSliderDomain"
                @input="onUserLowSliderInput"
              />
              <input
                class="w-100"
                type="range"
                :min="sliderDomain.low"
                :max="sliderDomain.high"
                :step="sliderStep"
                :value="userHighBound"
                :disabled="!hasSliderDomain"
                @input="onUserHighSliderInput"
              />
            </div>
          </div>
        </div>

        <!-- ColorBar -->
        <div class="columns is-mobile compact-row">
          <div class="column is-full">
            <div ref="colorbarWrap" class="hcolormap-wrap">
              <div class="hcolormap-muted" />
              <div
                v-if="hoverMarkerPct !== undefined"
                class="cmap-hover-marker"
                :style="{ left: `${hoverMarkerPct}%` }"
              >
                <div class="cmap-hover-marker-label">{{ hoverMarkerLabel }}</div>
              </div>
              <div
                class="hcolormap-window"
                :style="{
                  left: `${selectedLowPct}%`,
                  width: `${selectedSpanPct}%`,
                }"
                @mousedown.prevent="beginRangeDrag"
              >
                <ColorBar
                  class="hcolormap"
                  :colormap="colormap"
                  :invert-colormap="invertColormap"
                />
              </div>
              <div
                class="cmap-end-label cmap-end-label-low"
                :style="{ left: `${selectedLowPct}%` }"
              >
                {{ userLowLabel }}
              </div>
              <div
                class="cmap-end-label cmap-end-label-high"
                :style="{ left: `${selectedHighPct}%` }"
              >
                {{ userHighLabel }}
              </div>
            </div>
          </div>
        </div>

        <!-- Colormap controls -->
        <div class="columns is-mobile compact-row">
          <div
            class="column py-2 is-flex is-align-items-center is-justify-content-space-between"
          >
            <div class="is-flex is-align-items-center">
              <input
                id="invert_colormap"
                v-model="invertColormap"
                type="checkbox"
              />
              <label for="invert_colormap" class="mr-3">invert</label>
              <div class="select is-small">
                <select v-model="colormap">
                  <option v-for="cm in modelInfo.colormaps" :key="cm" :value="cm">
                    {{ cm }}
                  </option>
                </select>
              </div>
            </div>
            <div class="is-flex is-align-items-center">
              <input id="auto_colormap" v-model="autoColormap" type="checkbox" />
              <label
                for="auto_colormap"
                title="When enabled, changing variable applies that variable's default colormap (and inversion if provided). When disabled, your current colormap settings are kept."
                >auto select</label
              >
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="modelInfo && !isHidden"
      class="panel-block is-justify-content-space-between"
    >
      <div>
        <input
          id="enable_coastlines"
          type="checkbox"
          :checked="store.showCoastLines"
          @change="store.toggleCoastLines"
        />
        <label for="enable_coastlines">coastlines</label>
      </div>
      <div>
        <button class="button" type="button" @click="() => $emit('onRotate')">
          <i class="fa-solid fa-rotate mr-1"></i>
          Toggle Rotation
        </button>
      </div>
    </div>
    <div
      v-if="modelInfo && !isHidden"
      class="panel-block is-justify-content-space-between"
    >
      <div class="select">
        <select id="land_sea_mask" v-model="landSeaMaskChoice">
          <option value="off">Mask: Off</option>
          <option value="land">Mask: Land</option>
          <option value="sea">Mask: Sea</option>
          <option value="globe">Mask: Globe</option>
        </select>
      </div>
      <div class="columns is-mobile compact-row">
        <div class="column py-2">
          <input
            id="use_texture"
            v-model="landSeaMaskUseTexture"
            :disabled="landSeaMaskChoice === 'off'"
            type="checkbox"
          />
          <label
            for="use_texture"
            :class="{
              'has-text-grey-light': landSeaMaskChoice === 'off',
            }"
            >Use Texture</label
          >
        </div>
      </div>
    </div>

    <div v-if="modelInfo && !isHidden" class="panel-block">
      <p class="control">
        <button
          class="button mb-2 mr-1"
          type="button"
          @click="() => $emit('onSnapshot')"
        >
          <i class="fa-solid fa-image mr-1"></i> Snapshot
        </button>
        <button class="button" type="button" @click="() => $emit('onExample')">
          <i class="fa-solid fa-clipboard mr-1"></i>
          Copy Python example to clipboard
        </button>
      </p>
    </div>
  </nav>
</template>

<style lang="scss">
@use "bulma/sass/utilities" as bulmaUt;

.gl_controls {
  position: fixed;
  top: 0;
  left: 0;
  width: 25rem;
  max-height: 100vh; // Full screen height limit
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 0 0 bulmaUt.$radius bulmaUt.$radius !important;
  // background-color: white;
  z-index: 9;

  .panel-block {
    background-color: white;
  }

  input {
    margin-right: 3px;
  }

  .panel-heading {
    border-radius: 0;
  }

  @media only screen and (max-width: bulmaUt.$tablet) {
    width: 100%;
    height: auto;
    right: 0;
    border-radius: 0 !important;
    animation: 0.45s ease-out 0s 1 slideInFromTop;

    @keyframes slideInFromTop {
      from {
        transform: translateY(-100%);
      }

      to {
        transform: translateY(0);
      }
    }

    &.panel {
      border-radius: 0 !important;
    }

    .panel-heading .mobile-title {
      float: right;
    }

    &.mobile-visible {
      max-height: 100vh;
      height: 100vh;
    }
  }

  @media (prefers-color-scheme: dark) {
    .panel-block {
      background-color: rgba(15, 15, 15, 0.8);
    }

    .panel-heading {
      background-color: rgb(15, 15, 15);
      color: white;
    }
  }
}

.compact-row {
  padding-top: 0.1rem;
  padding-bottom: 0.1rem;
  margin-bottom: 0.1rem;

  & > .column {
    padding-top: 0.1rem;
    padding-bottom: 0.1rem;
  }
}

.active-row.active {
  background-color: lightgreen;
  @media (prefers-color-scheme: dark) {
    background-color: #2e7d32;
  }
}

.hcolormap {
  max-height: 2.5em;
  overflow: hidden;
  border-radius: bulmaUt.$radius;
}

.hcolormap-wrap {
  position: relative;
  height: 2.5em;
}

.hcolormap-muted {
  position: absolute;
  inset: 0;
  border-radius: bulmaUt.$radius;
  background: rgba(0, 0, 0, 0.12);
}

.hcolormap-window {
  position: absolute;
  top: 0;
  bottom: 0;
  overflow: hidden;
  border-radius: bulmaUt.$radius;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  cursor: grab;
}

.hcolormap-window:active {
  cursor: grabbing;
}

.cmap-hover-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: #000;
  pointer-events: none;
  z-index: 2;
}

.cmap-hover-marker-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.68rem;
  line-height: 1.1;
  padding: 0.08rem 0.28rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.2);
  color: #111;
  white-space: nowrap;
}

.cmap-end-label {
  position: absolute;
  bottom: 2.62em;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.68rem;
  line-height: 1.1;
  padding: 0.08rem 0.28rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0, 0, 0, 0.18);
  color: #222;
  white-space: nowrap;
}

.user-range-column {
  width: 100%;
}

.distribution-plot-wrap {
  position: relative;
  height: 2.1rem;
  border-radius: bulmaUt.$radius;
  border: 1px solid rgba(0, 0, 0, 0.12);
  overflow: hidden;
  margin-bottom: 0.4rem;
}

.distribution-plot {
  width: 100%;
  height: 100%;
  display: block;
  background: rgba(33, 150, 243, 0.08);
}

.distribution-selection {
  fill: rgba(76, 175, 80, 0.24);
}

.distribution-line {
  fill: none;
  stroke: rgba(25, 118, 210, 0.95);
  stroke-width: 1.2;
}

.hist-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  transform: translateX(-50%);
  pointer-events: none;
}

.hist-marker::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
  background: rgba(0, 0, 0, 0.28);
}

.hist-marker-label {
  position: absolute;
  top: 0.08rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.62rem;
  line-height: 1;
  padding: 0.04rem 0.2rem;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.72);
  color: rgba(0, 0, 0, 0.75);
  white-space: nowrap;
}

.slider-stack {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.unit-toggle {
  padding: 0 !important;
  height: 1.9rem;
  vertical-align: baseline;
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  background: #d9d9d9;
}

.unit-segment {
  min-width: 2rem;
  flex: 1 1 50%;
  text-align: center;
  padding: 0 0.45rem;
  background: #d9d9d9;
  color: #2f2f2f;
  line-height: 1.75rem;
}

.unit-segment + .unit-segment {
  border-left: 1px solid bulmaUt.$border;
}

.unit-segment.active {
  background: #ffffff;
  color: #1f1f1f;
}
</style>
