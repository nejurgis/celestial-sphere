// ── labels.js ─────────────────────────────────────────────────────────────
// Canvas-texture sprite labels — simplest way to get crisp, always-facing-
// camera text in a Three.js scene without adding a second (CSS2D) renderer.

import * as THREE from 'three';
import { applyStereographicWarp } from './stereographic.js';

export function makeTextSprite(text, { color = '#222', size = 48, weight = '600', scale = 0.28, stroke = null, strokeWidth = 0, opacity = 1 } = {}) {
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
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // Optional stroke — for content that has to stay readable against a
  // BACKGROUND that varies wildly (e.g. the zodiac glyphs, which used to
  // always sit on this app's own light ribbon fill but now often sit
  // directly over Stellarium's real sky, anywhere from bright day to
  // near-black night).
  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, width / 2, height / 2);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, opacity });
  applyStereographicWarp(material);
  const sprite = new THREE.Sprite(material);
  const aspect = width / height;
  sprite.scale.set(scale * aspect, scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

// Redraws a sprite made by makeTextSprite in place (same canvas/texture/
// material/sprite object) — for text that changes often (e.g. every
// animation frame during playback), avoids allocating a whole new sprite
// each time.
export function updateTextSprite(sprite, text, { color = '#222', size = 48, weight = '600', scale = 0.28, stroke = null, strokeWidth = 0 } = {}) {
  const canvas = sprite.material.map.image;
  const ctx = canvas.getContext('2d');
  const font = `${weight} ${size}px -apple-system, system-ui, sans-serif`;
  ctx.font = font;
  const padding = size * 0.4;
  const width = Math.ceil(ctx.measureText(text).width + padding * 2);
  const height = Math.ceil(size * 1.5);
  canvas.width = width; // resizing a canvas clears it AND resets context state
  canvas.height = height;

  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, width / 2, height / 2);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);

  sprite.material.map.needsUpdate = true;
  const aspect = width / height;
  sprite.scale.set(scale * aspect, scale, 1);
}
