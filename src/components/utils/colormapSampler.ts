import * as THREE from "three";
import type { TColorMap } from "@/types/GlobeTypes";
import { makeLutMaterial } from "./colormapShaders";

type SamplerCacheEntry = {
  pixels: Uint8Array;
};

const samplerCache = new Map<TColorMap, SamplerCacheEntry>();

export function sampleColormapColor(
  renderer: THREE.WebGLRenderer | undefined,
  colormap: TColorMap,
  normalizedValue: number
): string | undefined {
  if (!renderer) {
    return undefined;
  }
  const clamped = THREE.MathUtils.clamp(normalizedValue, 0, 1);
  let entry = samplerCache.get(colormap);
  if (!entry) {
    entry = { pixels: renderColormapGradient(renderer, colormap) };
    samplerCache.set(colormap, entry);
  }
  const idx = Math.min(
    entry.pixels.length / 4 - 1,
    Math.max(0, Math.round(clamped * 255))
  );
  const offset = idx * 4;
  const r = entry.pixels[offset];
  const g = entry.pixels[offset + 1];
  const b = entry.pixels[offset + 2];
  return `rgb(${r}, ${g}, ${b})`;
}

function renderColormapGradient(
  renderer: THREE.WebGLRenderer,
  colormap: TColorMap
) {
  const width = 256;
  const height = 1;
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    -1, 1, 0,
    1, -1, 0,
    1, 1, 0,
  ]);
  const dataValues = new Float32Array([0, 1, 0, 0, 1, 1]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("data_value", new THREE.BufferAttribute(dataValues, 1));
  const material = makeLutMaterial(colormap, 0, 1);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(previous);

  geometry.dispose();
  material.dispose();
  target.dispose();

  return pixels;
}
