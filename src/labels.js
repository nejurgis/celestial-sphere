// ── labels.js ─────────────────────────────────────────────────────────────
// Canvas-texture sprite labels — simplest way to get crisp, always-facing-
// camera text in a Three.js scene without adding a second (CSS2D) renderer.

import * as THREE from 'three';

export function makeTextSprite(text, { color = '#222', size = 48, weight = '600', scale = 0.28 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${weight} ${size}px -apple-system, system-ui, sans-serif`;
  ctx.font = font;
  const padding = size * 0.4;
  const width = Math.ceil(ctx.measureText(text).width + padding * 2);
  const height = Math.ceil(size * 1.5);
  canvas.width = width;
  canvas.height = height;

  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  const aspect = width / height;
  sprite.scale.set(scale * aspect, scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}
