import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { latLongToXYZ } from "./sphereMath";

export type FocusParams = {
  camera?: THREE.PerspectiveCamera | null;
  orbit?: OrbitControls | null;
  redraw: () => void;
  lat: number;
  lon: number;
  span?: number;
};

export function focusCameraOnRegion({
  camera,
  orbit,
  redraw,
  lat,
  lon,
  span,
}: FocusParams) {
  if (!camera) {
    return;
  }
  const effectiveSpan = Math.max(span ?? 0, 5);
  if (effectiveSpan >= 120) {
    return;
  }
  const distance = THREE.MathUtils.clamp(
    2.5 + effectiveSpan / 20,
    3.0,
    8.0
  );
  const [x, y, z] = latLongToXYZ(lat, lon, 1);
  camera.position.set(x, y, z).normalize().multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  if (orbit) {
    orbit.target.set(0, 0, 0);
    orbit.update();
  }
  redraw();
}
