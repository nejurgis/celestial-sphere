// ── stereographic.js ─────────────────────────────────────────────────────
// The real technique, per the user's own analysis of Stellarium's source
// (src/projections/proj_stereographic.c + src/core.c's project_to_win):
// warp the VIEW-SPACE position through a nonlinear stereographic formula,
// THEN feed it through an ordinary perspective projection matrix — not a
// screen-space post-process on the finished image (tried that first; it
// wobbles at the rectangular frame's corners because a circularly-symmetric
// warp doesn't map cleanly onto a rectangle, visible as the wavy border).
//
// Ported directly from proj_stereographic_project:
//   d = |v|; out = v/d
//   oneOverH = 1 / (0.5*(1-out.z))
//   out.x *= oneOverH; out.y *= oneOverH; out.z = -1
//   out *= d
// Three.js/GLSL view space already matches their convention (camera looks
// down -Z), so this ports with no axis juggling: a point straight ahead
// (0,0,-1) maps to itself; a point 90° off-axis (1,0,0) maps to (2,0,-1) —
// finite, unlike perspective's tan(90°)=infinity, which is the whole reason
// this projection can reach very wide fov without blowing up at the edges.
//
// uWarpActive is a SHARED uniform object (same reference passed to every
// material) so toggling center view flips every material at once via one
// assignment, no per-material iteration needed.
export const warpActiveUniform = { value: 0.0 };

export const STEREOGRAPHIC_GLSL = /* glsl */ `
vec3 stereographicWarp(vec3 v) {
  float d = length(v);
  if (d < 1e-8) return v;
  vec3 o = v / d;
  // Points behind (or near-behind) the camera. Stellarium detects this
  // discontinuity at the MESH level (PROJCONTINUITY, o.z==1.0 -> omit the
  // triangle) — not reproducible from a pure per-vertex shader port, since
  // by the time this runs the triangle already exists. A clamped
  // denominator alone isn't enough either: it avoids the NaN (o.z==1.0 ->
  // 1/0) but the formula still unconditionally forces o.z=-1, so a point
  // dead behind the camera gets pushed to dead CENTER of the screen, and
  // anything sweeping past it (day-rotation, looking around) tears across
  // the middle instead of exiting off-screen.
  //
  // First attempt rejected past o.z > 0.08 (~95° off-axis), reasoning from
  // the VERTICAL half-fov alone (92.5° at nominal 185°). Wrong: camera.fov
  // is vertical, and the frustum widens by aspect horizontally — at 16:9
  // and nominal 185° the horizontal edge is already ~123.5° off-axis and
  // the corner ~130° (o.z ≈ +0.64), both legitimately on screen. That
  // guard was clipping a real ring of content (95°-130°) and reading as
  // "the fisheye doesn't fill the frame."
  //
  // The guard is only needed for the exact antipode: as θ→180°, r=2·tan(θ/2)
  // already sends far-off-axis points off screen by itself (e.g. 179° off
  // maps to r≈229) with no help needed — the ONLY genuine singularity is
  // o.z==1.0 exactly (o.x=o.y=0, oneOverH=Inf, 0×Inf=NaN). Reject a small
  // margin around just that point, leaving o.z POSITIVE (the standard
  // "behind camera" convention — clip.w goes negative, the GPU's own
  // near-plane clipper discards it) rather than the whole rear hemisphere.
  if (o.z > 0.999) {
    o.z = 1.0;
    o.x = -o.x;
    return o * d;
  }
  float oneOverH = 1.0 / (0.5 * (1.0 - o.z));
  o.x *= oneOverH;
  o.y *= oneOverH;
  o.z = -1.0;
  // This app's own camera (Three.js/OrbitControls) and Stellarium's each
  // build their view basis from the same yaw/pitch independently — the
  // FORWARD direction was verified to match exactly (EXPECTED == ACTUAL
  // yaw/pitch, checked numerically many times), but the two engines'
  // "screen right" for that same forward direction turned out to be
  // opposite-handed: confirmed by direct comparison (Stellarium's real Sun
  // vs this app's own Sun marker mirror each other left/right while
  // panning, in both this app and the isolated test harness, even though
  // the warp formula above is a verbatim, unmodified port of
  // proj_stereographic_project — the mismatch is upstream of this
  // function, in camera-basis construction, not in the projection math
  // itself). Negating x here is the minimal, single-point fix: everything
  // that goes through this warp gets corrected at once, without touching
  // OrbitControls or Stellarium's own camera code.
  o.x = -o.x;
  return o * d;
}
`;

// Injects the warp into any standard (MeshBasicMaterial, SpriteMaterial,
// PointsMaterial, ...) material's built-in vertex shader, right before its
// normal projection step, via onBeforeCompile. Safe to call on a material
// more than once is NOT needed — call once, right after construction.
export function applyStereographicWarp(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWarpActive = warpActiveUniform;
    let vs = `uniform float uWarpActive;\n${STEREOGRAPHIC_GLSL}\n${shader.vertexShader}`;
    let patched;
    if (vs.includes('#include <project_vertex>')) {
      // Standard mesh/line materials (MeshBasicMaterial, LineBasicMaterial,
      // PointsMaterial, ...).
      patched = vs.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        mvPosition = modelViewMatrix * mvPosition;
        if (uWarpActive > 0.5) { mvPosition.xyz = stereographicWarp(mvPosition.xyz); }
        gl_Position = projectionMatrix * mvPosition;`
      );
    } else {
      // SpriteMaterial (labels/glows): warp the ANCHOR (the sprite's own
      // origin, modelViewMatrix's translation column), not the position
      // gl_Position is finally computed from — that already has the
      // billboard's screen-space corner offset added
      // (`mvPosition.xy += rotatedPosition;`, a few lines later in their
      // shader), and warping AFTER that scales the quad itself by
      // oneOverH too (2x at 90° off-axis, 8.5x at 140°) — every label
      // ballooning toward the edge of a wide center-view fov. Warping the
      // anchor first means only the ANCHOR'S position bends, same as every
      // other object, and the quad keeps its intended screen size.
      patched = vs.replace(
        'vec4 mvPosition = modelViewMatrix[ 3 ];',
        `vec4 mvPosition = modelViewMatrix[ 3 ];
        if (uWarpActive > 0.5) { mvPosition.xyz = stereographicWarp(mvPosition.xyz); }`
      );
    }
    if (patched === vs) {
      console.warn('stereographic warp injection found no match for', material.type, '— warp NOT applied to this material.');
    }
    shader.vertexShader = patched;
  };
  material.needsUpdate = true;
}

// Stellarium's own fov remap for this projection (proj_stereographic_init):
// fovy2 = 2*atan(2*tan(fovy/4)), fed into a standard perspective matrix —
// the underlying LINEAR perspective camera only needs to cover this
// (narrower) fovy2 to represent the full nominal fovy once the warp above
// expands it back out. Both args/return in degrees to match camera.fov.
export function stereographicFovRemap(nominalFovDeg) {
  const fovyRad = (nominalFovDeg * Math.PI) / 180;
  const remapped = 2 * Math.atan(2 * Math.tan(fovyRad / 4));
  return (remapped * 180) / Math.PI;
}
