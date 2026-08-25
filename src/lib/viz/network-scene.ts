/**
 * The Folester visualisation: an autonomous agent network, rendered in WebGL.
 *
 * Every element in the scene stands for something in the product, and the scroll
 * position moves the camera through them in the order the product introduces them:
 *
 *   agent structures      octahedral frames — one per agent
 *   identity nodes        a solid core inside each frame, ringed on primaries
 *   memory structures     stacked plates suspended beneath an agent
 *   communication paths   lines between agents, mostly forward through depth
 *   data packets          solid bodies travelling those lines
 *   computational layers  sparse wireframe planes at each depth step
 *
 * Built as six draw calls rather than thousands of objects: each group is one merged
 * geometry or one InstancedMesh, so the whole scene costs about as much as a handful
 * of meshes. The only per-frame CPU work is advancing the packets.
 *
 * There are no stars, no drifting particle fields, and nothing random-looking: the
 * layout comes from a fixed seed, so the network is the same structure on every load.
 */

import * as THREE from "three";

/* -------------------------------------------------------------------------- */
/* Deterministic layout                                                        */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, fast, and identical across runs, which is the point. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Node {
  readonly position: THREE.Vector3;
  readonly layer: number;
  readonly scale: number;
  /** Primaries carry an identity ring and a memory stack. */
  readonly primary: boolean;
}

interface Edge {
  readonly from: number;
  readonly to: number;
  /** Forward edges run into depth (execution); lateral ones are agent-to-agent. */
  readonly lateral: boolean;
}

interface Topology {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly layerDepth: number;
  readonly layers: number;
}

function buildTopology(layers: number, perLayer: readonly number[], seed = 0x0f01e5): Topology {
  const random = seeded(seed);
  const layerDepth = 46;
  const nodes: Node[] = [];
  const layerRanges: [number, number][] = [];

  for (let layer = 0; layer < layers; layer += 1) {
    const start = nodes.length;
    const count = perLayer[layer] ?? 6;
    // Nodes sit on a jittered ring-and-grid so the structure reads as engineered
    // rather than scattered: a fixed radius per layer, with an offset per index.
    const radius = 11 + layer * 5.5;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + layer * 0.7;
      const wobble = 0.72 + random() * 0.56;
      nodes.push({
        position: new THREE.Vector3(
          Math.cos(angle) * radius * wobble,
          Math.sin(angle) * radius * 0.52 * wobble + (random() - 0.5) * 5,
          -layer * layerDepth - random() * 7,
        ),
        layer,
        scale: 0.85 + random() * 1.5,
        primary: index % 3 === 0,
      });
    }
    layerRanges.push([start, nodes.length]);
  }

  const edges: Edge[] = [];
  for (let layer = 0; layer < layers - 1; layer += 1) {
    const [start, end] = layerRanges[layer];
    const [nextStart, nextEnd] = layerRanges[layer + 1];
    for (let index = start; index < end; index += 1) {
      // Each agent reaches one or two agents deeper in the pipeline.
      const fanout = random() < 0.45 ? 2 : 1;
      for (let hop = 0; hop < fanout; hop += 1) {
        const target = nextStart + Math.floor(random() * (nextEnd - nextStart));
        edges.push({ from: index, to: target, lateral: false });
      }
    }
  }
  // A few sideways links inside each layer: peers talking to peers.
  for (const [start, end] of layerRanges) {
    const span = end - start;
    if (span < 3) continue;
    for (let index = 0; index < Math.ceil(span / 3); index += 1) {
      const a = start + Math.floor(random() * span);
      const b = start + Math.floor(random() * span);
      if (a !== b) edges.push({ from: a, to: b, lateral: true });
    }
  }

  return { nodes, edges, layerDepth, layers };
}

/* -------------------------------------------------------------------------- */
/* Stages                                                                      */
/* -------------------------------------------------------------------------- */

export const STAGES = ["agent", "identity", "memory", "communication", "execution"] as const;
export type Stage = (typeof STAGES)[number];

interface StageView {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  /** Per-group emphasis, 0..1. The camera alone would not explain the product. */
  readonly emphasis: {
    readonly structures: number;
    readonly identity: number;
    readonly memory: number;
    readonly paths: number;
    readonly packets: number;
    readonly grid: number;
  };
}

const STAGE_VIEWS: Record<Stage, StageView> = {
  agent: {
    position: [0.5, 3.4, 30],
    target: [0, 0.5, -14],
    emphasis: { structures: 1, identity: 0.12, memory: 0.05, paths: 0.22, packets: 0.1, grid: 0.3 },
  },
  identity: {
    position: [13, 5.5, 24],
    target: [-1, 0, -26],
    emphasis: { structures: 0.8, identity: 1, memory: 0.12, paths: 0.3, packets: 0.14, grid: 0.4 },
  },
  memory: {
    position: [-15, 11, 33],
    target: [1, -4.5, -46],
    emphasis: { structures: 0.65, identity: 0.45, memory: 1, paths: 0.42, packets: 0.2, grid: 0.55 },
  },
  communication: {
    position: [2, 20, 50],
    target: [0, 0, -74],
    emphasis: { structures: 0.6, identity: 0.3, memory: 0.4, paths: 1, packets: 0.7, grid: 0.7 },
  },
  execution: {
    position: [24, 7, 30],
    target: [4, -1, -120],
    emphasis: { structures: 0.55, identity: 0.22, memory: 0.3, paths: 0.85, packets: 1, grid: 0.9 },
  },
};

/* Greys on black, matching the achromatic token scale in globals.css. The
   structures stay dark so they never compete with the white type sitting over
   them; only the packets approach near-white, and they are small and moving. */
const PALETTE = {
  background: 0x000000,
  structure: 0x2b4a6b,
  structureBright: 0x4a86c2,
  core: 0x8fc2f0,
  ring: 0x5b9bd5,
  memory: 0x1f3550,
  path: 0x16283c,
  pathLateral: 0x1d3550,
  packet: 0xc3e2ff,
  grid: 0x0d1826,
} as const;

/* -------------------------------------------------------------------------- */
/* Geometry builders                                                           */
/* -------------------------------------------------------------------------- */

const OCTA_VERTICES: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** All 12 edges of an octahedron: every vertex pair except the three opposites. */
const OCTA_EDGES: readonly [number, number][] = (() => {
  const opposite = new Set(["0-1", "2-3", "4-5"]);
  const edges: [number, number][] = [];
  for (let a = 0; a < 6; a += 1) {
    for (let b = a + 1; b < 6; b += 1) {
      if (!opposite.has(`${a}-${b}`)) edges.push([a, b]);
    }
  }
  return edges;
})();

/**
 * One BufferGeometry holding every agent frame, pre-transformed. Static, so it costs
 * a single draw call and no per-frame work — the whole reason the scene can hold
 * dozens of structures without turning into dozens of objects.
 */
function buildStructureGeometry(nodes: readonly Node[]): THREE.BufferGeometry {
  const positions = new Float32Array(nodes.length * OCTA_EDGES.length * 6);
  let cursor = 0;
  for (const node of nodes) {
    const size = node.scale * 1.55;
    for (const [a, b] of OCTA_EDGES) {
      const va = OCTA_VERTICES[a];
      const vb = OCTA_VERTICES[b];
      positions[cursor++] = node.position.x + va[0] * size;
      positions[cursor++] = node.position.y + va[1] * size;
      positions[cursor++] = node.position.z + va[2] * size;
      positions[cursor++] = node.position.x + vb[0] * size;
      positions[cursor++] = node.position.y + vb[1] * size;
      positions[cursor++] = node.position.z + vb[2] * size;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** Every pathway as one LineSegments geometry, with per-vertex colour by edge kind. */
function buildPathGeometry(nodes: readonly Node[], edges: readonly Edge[]): THREE.BufferGeometry {
  const positions = new Float32Array(edges.length * 6);
  const colors = new Float32Array(edges.length * 6);
  const forward = new THREE.Color(PALETTE.path);
  const lateral = new THREE.Color(PALETTE.pathLateral);

  edges.forEach((edge, index) => {
    const a = nodes[edge.from].position;
    const b = nodes[edge.to].position;
    const offset = index * 6;
    positions[offset] = a.x;
    positions[offset + 1] = a.y;
    positions[offset + 2] = a.z;
    positions[offset + 3] = b.x;
    positions[offset + 4] = b.y;
    positions[offset + 5] = b.z;

    const tint = edge.lateral ? lateral : forward;
    for (let vertex = 0; vertex < 2; vertex += 1) {
      colors[offset + vertex * 3] = tint.r;
      colors[offset + vertex * 3 + 1] = tint.g;
      colors[offset + vertex * 3 + 2] = tint.b;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** The computational layers: sparse wireframe planes marking each depth step. */
function buildGridGeometry(layers: number, layerDepth: number): THREE.BufferGeometry {
  const half = 58;
  const step = 14.5;
  const lines: number[] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const z = -layer * layerDepth - 12;
    const extent = half + layer * 6;
    for (let offset = -extent; offset <= extent; offset += step) {
      lines.push(-extent, offset * 0.5, z, extent, offset * 0.5, z);
      lines.push(offset, -extent * 0.5, z, offset, extent * 0.5, z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  return geometry;
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

export interface SceneOptions {
  readonly canvas: HTMLCanvasElement;
  /** Fewer layers, fewer packets, lower pixel ratio. Set from a media query. */
  readonly compact?: boolean;
  /** No animation loop, no drift. One static frame per progress change. */
  readonly reducedMotion?: boolean;
}

const PACKET_COUNT_FULL = 96;
const PACKET_COUNT_COMPACT = 34;

interface Packet {
  edge: number;
  t: number;
  speed: number;
}

export class AgentNetworkScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly topology: Topology;
  private readonly reducedMotion: boolean;
  private readonly compact: boolean;

  private readonly structures: THREE.LineSegments;
  private readonly paths: THREE.LineSegments;
  private readonly grid: THREE.LineSegments;
  private readonly cores: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly plates: THREE.InstancedMesh;
  private readonly packets: THREE.InstancedMesh;

  private readonly packetState: Packet[] = [];
  private readonly scratch = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();

  private progress = 0;
  private frame = 0;
  private elapsed = 0;
  private lastTime = 0;
  private running = false;
  private disposed = false;

  constructor(options: SceneOptions) {
    this.compact = options.compact ?? false;
    this.reducedMotion = options.reducedMotion ?? false;

    this.topology = this.compact
      ? buildTopology(3, [5, 7, 9])
      : buildTopology(5, [6, 9, 11, 13, 15]);

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      alpha: true,
      antialias: !this.compact,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.compact ? 1.25 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // Exponential fog does the depth work: structures deeper in the pipeline fall
    // away into the page background instead of being drawn and then hidden.
    this.scene.fog = new THREE.FogExp2(PALETTE.background, this.compact ? 0.0095 : 0.0062);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 620);
    const opening = STAGE_VIEWS.agent;
    this.camera.position.set(...opening.position);
    this.lookTarget.set(...opening.target);
    this.camera.lookAt(this.lookTarget);

    const { nodes, edges } = this.topology;

    this.grid = new THREE.LineSegments(
      buildGridGeometry(this.topology.layers, this.topology.layerDepth),
      new THREE.LineBasicMaterial({ color: PALETTE.grid, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(this.grid);

    this.paths = new THREE.LineSegments(
      buildPathGeometry(nodes, edges),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 }),
    );
    this.scene.add(this.paths);

    this.structures = new THREE.LineSegments(
      buildStructureGeometry(nodes),
      new THREE.LineBasicMaterial({ color: PALETTE.structure, transparent: true, opacity: 0.9 }),
    );
    this.scene.add(this.structures);

    this.cores = this.buildCores(nodes);
    this.scene.add(this.cores);

    this.rings = this.buildRings(nodes);
    this.scene.add(this.rings);

    this.plates = this.buildPlates(nodes);
    this.scene.add(this.plates);

    this.packets = this.buildPackets(edges);
    this.scene.add(this.packets);

    this.applyEmphasis(0);
  }

  /* ---------------------------------------------------------------- builders */

  private buildCores(nodes: readonly Node[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshBasicMaterial({ color: PALETTE.core, transparent: true, opacity: 0.9 }),
      nodes.length,
    );
    nodes.forEach((node, index) => {
      const size = 0.7 + node.scale * 0.42;
      this.scratch.compose(
        node.position,
        this.scratchQuat.identity(),
        this.scratchScale.setScalar(size),
      );
      mesh.setMatrixAt(index, this.scratch);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private buildRings(nodes: readonly Node[]): THREE.InstancedMesh {
    const primaries = nodes.filter((node) => node.primary);
    const mesh = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.035, 3, 44),
      new THREE.MeshBasicMaterial({ color: PALETTE.ring, transparent: true, opacity: 0 }),
      Math.max(primaries.length, 1),
    );
    primaries.forEach((node, index) => {
      // Tilted, so the ring reads as an object in space rather than a flat circle.
      this.scratchQuat.setFromEuler(new THREE.Euler(1.02, node.position.x * 0.05, 0.34));
      this.scratch.compose(
        node.position,
        this.scratchQuat,
        this.scratchScale.setScalar(node.scale * 2.75),
      );
      mesh.setMatrixAt(index, this.scratch);
    });
    mesh.count = primaries.length;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private buildPlates(nodes: readonly Node[]): THREE.InstancedMesh {
    const stacks = nodes.filter((node) => node.primary);
    const perStack = 4;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.05, 1),
      new THREE.MeshBasicMaterial({ color: PALETTE.memory, transparent: true, opacity: 0 }),
      Math.max(stacks.length * perStack, 1),
    );
    let index = 0;
    for (const node of stacks) {
      for (let plate = 0; plate < perStack; plate += 1) {
        const width = node.scale * (3.1 - plate * 0.42);
        this.scratchQuat.setFromEuler(new THREE.Euler(0, node.position.x * 0.04, 0));
        this.scratch.compose(
          this.from.set(node.position.x, node.position.y - 3.1 - plate * 0.72, node.position.z),
          this.scratchQuat,
          this.scratchScale.set(width, 1, width),
        );
        mesh.setMatrixAt(index++, this.scratch);
      }
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private buildPackets(edges: readonly Edge[]): THREE.InstancedMesh {
    const count = Math.min(this.compact ? PACKET_COUNT_COMPACT : PACKET_COUNT_FULL, edges.length);
    const mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshBasicMaterial({ color: PALETTE.packet, transparent: true, opacity: 0 }),
      Math.max(count, 1),
    );
    const random = seeded(0x9a11c);
    for (let index = 0; index < count; index += 1) {
      this.packetState.push({
        edge: Math.floor((index / count) * edges.length),
        t: random(),
        // Slow. A packet takes several seconds to cross a hop, which is what keeps
        // the scene from reading as an animated background.
        speed: 0.055 + random() * 0.085,
      });
    }
    mesh.count = count;
    return mesh;
  }

  /* ------------------------------------------------------------------ update */

  /** `value` is 0..1 across the whole scroll narrative. */
  setProgress(value: number): void {
    this.progress = Math.min(Math.max(value, 0), 1);
    if (this.reducedMotion) this.renderStatic();
  }

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.reducedMotion) this.renderStatic();
  }

  start(): void {
    if (this.running || this.disposed) return;
    if (this.reducedMotion) {
      this.renderStatic();
      return;
    }
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    // Clamped so a backgrounded tab returning does not jump the packets forward.
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += delta;

    this.updateCamera(delta);
    this.updatePackets(delta);
    this.applyEmphasis(this.progress);
    this.renderer.render(this.scene, this.camera);

    this.frame = requestAnimationFrame(this.tick);
  };

  private renderStatic(): void {
    if (this.disposed) return;
    const { view } = this.stageAt(this.progress);
    this.camera.position.set(...view.position);
    this.lookTarget.set(...view.target);
    this.camera.lookAt(this.lookTarget);
    this.applyEmphasis(this.progress);
    // Packets are placed once at their initial offsets and left there: with motion
    // reduced they are structure, not movement.
    this.updatePackets(0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Interpolate between the two stage views the progress value falls between. */
  private stageAt(progress: number): { view: StageView; blend: number; index: number } {
    const span = (STAGES.length - 1) * progress;
    const index = Math.min(Math.floor(span), STAGES.length - 2);
    const blend = STAGES.length > 1 ? span - index : 0;
    const a = STAGE_VIEWS[STAGES[index]];
    const b = STAGE_VIEWS[STAGES[index + 1]];
    // Smoothstep between stages so the camera settles at each one.
    const eased = blend * blend * (3 - 2 * blend);
    const mix = (x: number, y: number) => x + (y - x) * eased;

    return {
      index,
      blend: eased,
      view: {
        position: [
          mix(a.position[0], b.position[0]),
          mix(a.position[1], b.position[1]),
          mix(a.position[2], b.position[2]),
        ],
        target: [
          mix(a.target[0], b.target[0]),
          mix(a.target[1], b.target[1]),
          mix(a.target[2], b.target[2]),
        ],
        emphasis: {
          structures: mix(a.emphasis.structures, b.emphasis.structures),
          identity: mix(a.emphasis.identity, b.emphasis.identity),
          memory: mix(a.emphasis.memory, b.emphasis.memory),
          paths: mix(a.emphasis.paths, b.emphasis.paths),
          packets: mix(a.emphasis.packets, b.emphasis.packets),
          grid: mix(a.emphasis.grid, b.emphasis.grid),
        },
      },
    };
  }

  private updateCamera(delta: number): void {
    const { view } = this.stageAt(this.progress);
    // A slow orbital drift on top of the scroll position, so the scene is alive even
    // when the page is not moving. Long periods and small amplitudes only.
    const drift = this.elapsed * 0.085;
    this.desiredPosition.set(
      view.position[0] + Math.sin(drift) * 2.6,
      view.position[1] + Math.sin(drift * 0.73) * 1.5,
      view.position[2] + Math.cos(drift * 0.61) * 1.9,
    );
    this.desiredTarget.set(...view.target);

    // Critically-damped follow: framerate-independent and never overshoots.
    const damping = 1 - Math.exp(-delta * 2.4);
    this.camera.position.lerp(this.desiredPosition, damping);
    this.lookTarget.lerp(this.desiredTarget, damping);
    this.camera.lookAt(this.lookTarget);
  }

  private updatePackets(delta: number): void {
    const { edges, nodes } = this.topology;
    for (let index = 0; index < this.packetState.length; index += 1) {
      const packet = this.packetState[index];
      packet.t += packet.speed * delta;
      if (packet.t > 1) {
        packet.t -= 1;
        // Hand the packet to the next pathway rather than resetting it in place: the
        // motion should read as traffic through a network, not as looping sprites.
        packet.edge = (packet.edge + 7) % edges.length;
      }

      const edge = edges[packet.edge];
      this.from.copy(nodes[edge.from].position);
      this.to.copy(nodes[edge.to].position);
      this.from.lerp(this.to, packet.t);

      // Packets shrink as they approach a node, so arrival reads as absorption.
      const arrival = 1 - Math.abs(packet.t - 0.5) * 2;
      this.scratch.compose(
        this.from,
        this.scratchQuat.identity(),
        this.scratchScale.setScalar(0.55 + arrival * 0.85),
      );
      this.packets.setMatrixAt(index, this.scratch);
    }
    this.packets.instanceMatrix.needsUpdate = true;
  }

  private applyEmphasis(progress: number): void {
    const { emphasis } = this.stageAt(progress).view;
    const structure = this.structures.material as THREE.LineBasicMaterial;
    structure.opacity = 0.32 + emphasis.structures * 0.62;
    structure.color.lerpColors(
      new THREE.Color(PALETTE.structure),
      new THREE.Color(PALETTE.structureBright),
      emphasis.structures * 0.55,
    );

    (this.cores.material as THREE.MeshBasicMaterial).opacity =
      0.3 + Math.max(emphasis.structures, emphasis.identity) * 0.65;
    (this.rings.material as THREE.MeshBasicMaterial).opacity = emphasis.identity * 0.72;
    (this.plates.material as THREE.MeshBasicMaterial).opacity = emphasis.memory * 0.8;
    (this.paths.material as THREE.LineBasicMaterial).opacity = 0.22 + emphasis.paths * 0.72;
    (this.packets.material as THREE.MeshBasicMaterial).opacity = 0.12 + emphasis.packets * 0.85;
    (this.grid.material as THREE.LineBasicMaterial).opacity = 0.14 + emphasis.grid * 0.5;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh | THREE.LineSegments;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    this.renderer.dispose();
  }
}
