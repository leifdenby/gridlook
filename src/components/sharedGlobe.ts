import { storeToRefs } from "pinia";
import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Ref,
  type ShallowRef,
} from "vue";
import {
  COASTLINE_RESOLUTIONS,
  LAND_SEA_MASK_MODES,
  type TCoastlineResolution,
  useGlobeControlStore,
} from "./store/store";
import { geojson2geometry } from "./utils/geojson.ts";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { handleKeyDown } from "./utils/OrbitControlsAddOn.ts";
import { useLog } from "./utils/logging";
import * as zarr from "zarrita";
import type { TSources } from "@/types/GlobeTypes.ts";
import { useUrlParameterStore } from "./store/paramStore.ts";
import { getLandSeaMask, loadJSON } from "./utils/landSeaMask.ts";
import debounce from "lodash.debounce";
import { isWindSpeedDerived } from "./utils/derivedVars.ts";

// Drag mode switch:
// - true: keep picked Earth surface point under cursor while dragging
// - false: use default OrbitControls left-drag rotation
const USE_SPHERE_LOCKED_DRAG = true;

export function useSharedGlobeLogic(
  canvas: Ref<HTMLCanvasElement | undefined>,
  box: Ref<HTMLDivElement | undefined>
) {
  const store = useGlobeControlStore();
  const { coastlineResolution, landSeaMaskChoice, landSeaMaskUseTexture } =
    storeToRefs(store);

  const urlParameterStore = useUrlParameterStore();
  const { paramCameraState } = storeToRefs(urlParameterStore);

  const { logError } = useLog();
  const datavars: ShallowRef<
    Record<string, zarr.Array<zarr.DataType, zarr.FetchStore>>
  > = shallowRef({});
  const coastByResolution: Partial<
    Record<TCoastlineResolution, THREE.LineSegments>
  > = {};
  let activeCoastResolution: TCoastlineResolution | undefined = undefined;
  let landSeaMask: THREE.Mesh | undefined = undefined;
  let scene: THREE.Scene | undefined = undefined;
  let camera: THREE.PerspectiveCamera | undefined = undefined;
  let renderer: THREE.WebGLRenderer | undefined = undefined;
  let orbitControls: OrbitControls | undefined = undefined;
  let resizeObserver: ResizeObserver | undefined = undefined;
  const width: Ref<number | undefined> = ref(undefined);
  const height: Ref<number | undefined> = ref(undefined);
  let updateLOD: (() => void) | undefined = undefined;
  let mouseDown = false;
  const frameId = ref(0);
  const raycaster = new THREE.Raycaster();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.0);
  let draggingSurface = false;
  let draggedPoint = new THREE.Vector3();

  watch(
    () => coastlineResolution.value,
    () => {
      updateCoastlines();
    }
  );

  watch(
    [() => landSeaMaskChoice.value, () => landSeaMaskUseTexture.value],
    () => {
      console.log("updating landseamask");
      updateLandSeaMask();
    }
  );

  function registerUpdateLOD(func: () => void) {
    updateLOD = func;
  }

  function getScene() {
    return scene;
  }

  function getCamera() {
    return camera;
  }

  function getRenderer() {
    return renderer;
  }

  function getOrbitControls() {
    return orbitControls;
  }

  function getResizeObserver() {
    return resizeObserver;
  }

  function resetDataVars() {
    datavars.value = {};
  }

  function setResizeObserver(observer: ResizeObserver) {
    resizeObserver = observer;
  }
  function redraw() {
    if (getOrbitControls()?.autoRotate) {
      return;
    }
    render();
  }

  function render() {
    if (updateLOD) {
      updateLOD();
    }
    getOrbitControls()?.update();
    getRenderer()?.render(getScene()!, getCamera()!);
  }

  function coastlinePathForResolution(resolution: TCoastlineResolution) {
    if (resolution === COASTLINE_RESOLUTIONS.HIGH) {
      return "static/ne_10m_coastline.geojson";
    }
    if (resolution === COASTLINE_RESOLUTIONS.LOW) {
      return "static/ne_110m_coastline.geojson";
    }
    return "static/ne_50m_coastline.geojson";
  }

  async function getCoastlines(resolution: TCoastlineResolution) {
    if (resolution === COASTLINE_RESOLUTIONS.OFF) {
      return undefined;
    }
    if (!coastByResolution[resolution]) {
      const coastlines = await loadJSON(coastlinePathForResolution(resolution));
      const geometry = geojson2geometry(coastlines, 1.002);
      const material = new THREE.LineBasicMaterial({
        color: "#ffffff",
      });
      const coast = new THREE.LineSegments(geometry, material);
      coast.name = `coastlines-${resolution}`;
      coastByResolution[resolution] = coast;
    }
    return coastByResolution[resolution];
  }

  async function updateCoastlines() {
    if (activeCoastResolution) {
      const activeCoast = coastByResolution[activeCoastResolution];
      if (activeCoast) {
        scene?.remove(activeCoast);
      }
      activeCoastResolution = undefined;
    }
    if (coastlineResolution.value !== COASTLINE_RESOLUTIONS.OFF) {
      const nextCoast = await getCoastlines(coastlineResolution.value);
      if (nextCoast) {
        scene?.add(nextCoast);
        activeCoastResolution = coastlineResolution.value;
      }
    }
    redraw();
  }

  async function updateLandSeaMask() {
    const choice = landSeaMaskChoice.value ?? LAND_SEA_MASK_MODES.OFF;
    if (landSeaMask) {
      scene?.remove(landSeaMask);
      landSeaMask = undefined;
    }
    if (choice === LAND_SEA_MASK_MODES.OFF) {
      redraw();
      return;
    }

    const mask = await getLandSeaMask(
      landSeaMaskChoice.value!,
      landSeaMaskUseTexture.value!
    );
    landSeaMask = mask;
    if (landSeaMask) {
      scene?.add(landSeaMask);
    }
    redraw();
  }

  function initEssentials() {
    // from: https://stackoverflow.com/a/65732553
    scene = new THREE.Scene();
    const center = new THREE.Vector3();
    camera = new THREE.PerspectiveCamera(
      7.5,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value });

    if (paramCameraState.value === undefined) {
      camera.up = new THREE.Vector3(0, 0, 1);
      camera.position.x = 30;
      camera.lookAt(center);
    } else {
      camera.up = new THREE.Vector3(0, 0, 1);
      camera.position.x = 30;
      camera.lookAt(center);
      const state = decodeCameraFromURL();
      if (state) {
        applyCameraState(camera, state);
      }
    }

    orbitControls = new OrbitControls(camera, renderer.domElement);
    // smaller minDistances than 1.1 will reveal the naked mesh
    // under the texture when zoomed in
    orbitControls.minDistance = 1.1;
    orbitControls.enablePan = false;
    orbitControls.enableDamping = false;
    if (USE_SPHERE_LOCKED_DRAG) {
      // Left-drag is handled manually to lock a picked surface point under cursor.
      orbitControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      orbitControls.touches.ONE = THREE.TOUCH.PAN;
    }
    updateRotateSpeed();
    updateCoastlines();
  }

  function updateRotateSpeed() {
    if (!orbitControls) {
      return;
    }
    const viewportHeight = box.value?.clientHeight ?? window.innerHeight;
    const clampedScale = Math.min(Math.max(viewportHeight / 1200, 0.55), 1);
    orbitControls.rotateSpeed = 0.18 * clampedScale;
  }

  function onCanvasResize() {
    if (!box.value) {
      return;
    }
    const { width: boxWidth, height: boxHeight } =
      box.value.getBoundingClientRect();
    if (boxWidth !== width.value || boxHeight !== height.value) {
      getResizeObserver()?.unobserve(box.value);
      const aspect = boxWidth / boxHeight;
      getCamera()!.aspect = aspect;
      getCamera()!.updateProjectionMatrix();
      width.value = boxWidth;
      height.value = boxHeight;
      const myRenderer = getRenderer() as THREE.WebGLRenderer;
      if (width.value !== undefined && height.value !== undefined) {
        myRenderer.setSize(width.value, height.value);
      }
      updateRotateSpeed();
      redraw();
      if (box.value) {
        getResizeObserver()!.observe(box.value);
      }
    }
  }

  function pointOnEarthFromPointer(
    event: PointerEvent | MouseEvent | Touch
  ): THREE.Vector3 | undefined {
    const myRenderer = getRenderer();
    const myCamera = getCamera();
    if (!myRenderer || !myCamera) {
      return undefined;
    }

    const rect = myRenderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(x, y), myCamera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectSphere(unitSphere, hit)) {
      return undefined;
    }
    return hit.normalize();
  }

  function toggleRotate() {
    getOrbitControls()!.autoRotate = !getOrbitControls()!.autoRotate;
    animationLoop();
  }

  function animationLoop() {
    cancelAnimationFrame(frameId.value);
    if (!mouseDown && !getOrbitControls()?.autoRotate) {
      render();
      debouncedEncodeCameraToURL(getCamera()!);
      return;
    }
    render();
    frameId.value = requestAnimationFrame(animationLoop);
  }

  onMounted(() => {
    const canvasValue = canvas.value as HTMLCanvasElement;

    mouseDown = false;

    canvasValue.addEventListener("wheel", () => {
      mouseDown = true;
      animationLoop();
      mouseDown = false;
    });

    canvasValue.addEventListener("mouseup", () => {
      mouseDown = false;
      if (USE_SPHERE_LOCKED_DRAG) {
        draggingSurface = false;
      }
    });

    canvasValue.addEventListener("mousedown", (event: MouseEvent) => {
      mouseDown = true;
      if (USE_SPHERE_LOCKED_DRAG && event.button === 0) {
        const picked = pointOnEarthFromPointer(event);
        if (picked) {
          draggedPoint.copy(picked);
          draggingSurface = true;
        } else {
          draggingSurface = false;
        }
      }
      animationLoop();
    });

    canvasValue.addEventListener("mousemove", (event: MouseEvent) => {
      if (!USE_SPHERE_LOCKED_DRAG || !draggingSurface || event.buttons !== 1) {
        return;
      }
      const current = pointOnEarthFromPointer(event);
      if (!current) {
        return;
      }
      const myCamera = getCamera();
      if (!myCamera) {
        return;
      }
      // Rotate camera so the currently hovered point maps back to the picked one.
      const delta = new THREE.Quaternion().setFromUnitVectors(
        current,
        draggedPoint
      );
      myCamera.position.applyQuaternion(delta);
      myCamera.up.applyQuaternion(delta);
      myCamera.lookAt(0, 0, 0);
      getOrbitControls()?.update();
      render();
      debouncedEncodeCameraToURL(myCamera);
    });

    canvasValue.addEventListener(
      "touchstart",
      () => {
        mouseDown = true;
        animationLoop();
      },
      {
        passive: true,
      }
    );

    canvasValue.addEventListener(
      "touchend",
      () => {
        mouseDown = false;
        if (USE_SPHERE_LOCKED_DRAG) {
          draggingSurface = false;
        }
      },
      {
        passive: true,
      }
    );

    box.value!.addEventListener("keydown", (e: KeyboardEvent) => {
      if (
        e.key === "ArrowRight" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "+" ||
        e.key === "-"
      ) {
        mouseDown = true;
        handleKeyDown(e, getOrbitControls()!);
        animationLoop();
        mouseDown = false;
      }
    });

    initEssentials();
    setResizeObserver(new ResizeObserver(onCanvasResize));
    getResizeObserver()?.observe(box.value!);
    onCanvasResize();
  });

  onBeforeUnmount(() => {
    getResizeObserver()?.unobserve(box.value!);
  });

  function makeSnapshot() {
    render();
    canvas.value?.toBlob((blob) => {
      const link = document.createElement("a");
      link.download = "gridlook.png";

      link.href = URL.createObjectURL(blob!);
      link.click();

      // delete the internal blob reference, to let the browser clear memory from it
      URL.revokeObjectURL(link.href);
    }, "image/png");
  }

  async function getDataVar(myVarname: string, datasources: TSources) {
    const isDerivedWind = isWindSpeedDerived(datasources, myVarname);
    const cacheKey = myVarname;
    if (!datavars.value[cacheKey]) {
      let myDatasource;
      let sourceVarname = myVarname;
      if (myVarname === "time") {
        myDatasource = datasources.levels[0].time;
      } else if (isDerivedWind) {
        const derived = datasources.levels[0].datasources[myVarname].derived!;
        sourceVarname = derived.components.eastward;
        myDatasource = datasources.levels[0].datasources[sourceVarname];
      } else {
        myDatasource = datasources.levels[0].datasources[myVarname];
      }
      try {
        const root = zarr.root(new zarr.FetchStore(myDatasource.store));
        const datavar = await zarr.open(
          root.resolve(myDatasource.dataset + "/" + sourceVarname),
          {
            kind: "array",
          }
        );
        datavars.value[cacheKey] = datavar;
      } catch (error) {
        logError(
          error,
          `Couldn't fetch variable ${sourceVarname} from store: ${myDatasource.store} and dataset: ${myDatasource.dataset}`
        );
        return undefined;
      }
    }
    return datavars.value[cacheKey];
  }

  async function getVariableSliceAtTime(
    myVarname: string,
    datasources: TSources,
    timeIndex: number
  ): Promise<
    | {
        data: ArrayLike<number>;
        attrs: zarr.Attributes;
        timeLength: number;
      }
    | undefined
  > {
    if (!isWindSpeedDerived(datasources, myVarname)) {
      const datavar = await getDataVar(myVarname, datasources);
      if (!datavar) return undefined;
      const rawData = await zarr.get(datavar, [
        timeIndex,
        ...Array(datavar.shape.length - 1).fill(null),
      ]);
      return {
        data: rawData.data as ArrayLike<number>,
        attrs: datavar.attrs ?? {},
        timeLength: datavar.shape[0],
      };
    }

    const datasource = datasources.levels[0].datasources[myVarname];
    const components = datasource.derived!.components;
    const [eastVar, northVar] = await Promise.all([
      getDataVar(components.eastward, datasources),
      getDataVar(components.northward, datasources),
    ]);
    if (!eastVar || !northVar) return undefined;

    const [eastData, northData] = await Promise.all([
      zarr.get(eastVar, [timeIndex, ...Array(eastVar.shape.length - 1).fill(null)]),
      zarr.get(northVar, [
        timeIndex,
        ...Array(northVar.shape.length - 1).fill(null),
      ]),
    ]);

    const east = eastData.data as ArrayLike<number>;
    const north = northData.data as ArrayLike<number>;
    const out = new Float32Array(Math.min(east.length, north.length));

    const eastFill = new Set(
      [eastVar.attrs?._FillValue, eastVar.attrs?.missing_value]
        .flat()
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
    );
    const northFill = new Set(
      [northVar.attrs?._FillValue, northVar.attrs?.missing_value]
        .flat()
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
    );

    for (let i = 0; i < out.length; i++) {
      const u = Number(east[i]);
      const v = Number(north[i]);
      if (
        Number.isNaN(u) ||
        Number.isNaN(v) ||
        eastFill.has(u) ||
        northFill.has(v)
      ) {
        out[i] = Number.NaN;
      } else {
        out[i] = Math.hypot(u, v);
      }
    }

    const eastUnits = eastVar.attrs?.units;
    const northUnits = northVar.attrs?.units;
    const units =
      typeof eastUnits === "string" && eastUnits === northUnits
        ? eastUnits
        : undefined;

    return {
      data: out,
      attrs: {
        ...eastVar.attrs,
        ...(units ? { units } : {}),
        standard_name: "wind_speed",
        long_name: `wind speed (${components.eastward} ${components.northward})`,
      },
      timeLength: eastVar.shape[0],
    };
  }

  async function getTimeVar(datasources: TSources) {
    return await getDataVar("time", datasources);
  }

  type TCameraState = {
    position: number[];
    quaternion: number[];
    fov: number;
    aspect: number;
    near: number;
    far: number;
  };

  const debouncedEncodeCameraToURL = debounce(
    (camera: THREE.PerspectiveCamera) => {
      encodeCameraToURL(camera);
    },
    300
  );

  function encodeCameraToURL(camera: THREE.PerspectiveCamera) {
    // Encodes the camera state to the URL parameters.
    // This function is getting called at the end of each render loop.
    const state: TCameraState = {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
    };

    // Stringify and Base64-encode (URL-safe)
    const json = JSON.stringify(state);
    const encoded = btoa(json)
      .replace(/\+/g, "-") // URL-safe base64
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    paramCameraState.value = encoded;
  }

  function decodeCameraFromURL(): TCameraState | null {
    // Decodes the camera state from the URL parameters.
    // This function is getting called during initialization of the globe,
    // when a camera state is found in the URL parameters.
    const encoded = paramCameraState.value;
    if (!encoded) return null;

    try {
      const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (ignore) {
      return null;
    }
  }

  function applyCameraState(
    camera: THREE.PerspectiveCamera,
    data: TCameraState
  ) {
    // Applies a camera state to the camera.
    // This function is getting called during initialization of the globe,
    // when a camera state is found in the URL parameters.
    if (!data) return;

    if (data.position && data.position.length === 3) {
      camera.position.fromArray(data.position);
    }

    if (data.quaternion && data.quaternion.length === 4) {
      camera.quaternion.fromArray(data.quaternion);
    }

    if (typeof data.fov === "number") {
      camera.fov = data.fov;
    }

    if (typeof data.aspect === "number") {
      camera.aspect = data.aspect;
    }

    if (typeof data.near === "number") {
      camera.near = data.near;
    }

    if (typeof data.far === "number") {
      camera.far = data.far;
    }

    camera.updateProjectionMatrix();
  }

  return {
    getScene,
    getCamera,
    getRenderer,
    getOrbitControls,
    getResizeObserver,
    redraw,
    toggleRotate,
    makeSnapshot,
    resetDataVars,
    getDataVar,
    getVariableSliceAtTime,
    getTimeVar,
    registerUpdateLOD,
    updateLandSeaMask,
  };
}
