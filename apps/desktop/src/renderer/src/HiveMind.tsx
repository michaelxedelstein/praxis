/**
 * HiveMind — the holographic constellation of your projects.
 *
 * A force-laid 3D graph rendered with react-three-fiber. Each project is a
 * glowing node (brightness by recency, ring for active tasks/dirty state);
 * links are the language/owner constellations. Clicking a node flies the camera
 * in and selects it. The whole field slowly rotates when idle, Stark-table style.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";
import type { ProjectGraph, ProjectNode, TaskRecord } from "../../shared/ipc.js";

interface Positioned {
  node: ProjectNode;
  pos: THREE.Vector3;
}

/**
 * Deterministic layout: distribute nodes on a sphere (golden-spiral) then nudge
 * by recency so fresh work floats toward the viewer. Cheap, stable, no physics
 * loop needed — good enough for a few hundred repos and keeps frames light.
 */
function layout(nodes: ProjectNode[]): Positioned[] {
  const n = Math.max(nodes.length, 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const radius = 6 + Math.sqrt(n) * 0.9;
  const now = Date.now();
  return nodes.map((node, i) => {
    const y = 1 - (i / Math.max(n - 1, 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const ageDays = node.lastActivity ? (now - node.lastActivity) / 86_400_000 : 400;
    const pull = Math.max(0.75, 1.15 - Math.min(ageDays, 365) / 365); // recent = closer/larger sphere
    const pos = new THREE.Vector3(
      Math.cos(theta) * r * radius * pull,
      y * radius * pull,
      Math.sin(theta) * r * radius * pull,
    );
    return { node, pos };
  });
}

function nodeColor(node: ProjectNode): string {
  if (node.kind === "github" && !node.path) return "#8a7bff"; // remote-only: violet
  if (node.dirty) return "#ffb454"; // uncommitted: amber
  return "#41e0ff"; // local & clean: cyan
}

function brightness(node: ProjectNode): number {
  if (!node.lastActivity) return 0.35;
  const ageDays = (Date.now() - node.lastActivity) / 86_400_000;
  return Math.max(0.35, 1 - Math.min(ageDays, 180) / 180);
}

function NodeMesh({
  item,
  selected,
  active,
  onSelect,
}: {
  item: Positioned;
  selected: boolean;
  active: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const ref = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = nodeColor(item.node);
  const glow = brightness(item.node);
  const size = 0.28 + glow * 0.28 + (selected ? 0.18 : 0);

  useFrame((_, dt) => {
    if (ringRef.current && active) ringRef.current.rotation.z += dt * 2;
    if (ref.current) {
      const target = hovered || selected ? 1.25 : 1;
      ref.current.scale.lerp(new THREE.Vector3(target, target, target), 0.2);
    }
  });

  return (
    <group position={item.pos}>
      <mesh
        ref={ref}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(item.node.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 2.2 : 0.8 + glow}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>

      {(active || item.node.dirty) && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[size + 0.22, 0.03, 8, 40]} />
          <meshBasicMaterial color={active ? "#ffb454" : color} transparent opacity={0.8} />
        </mesh>
      )}

      {(hovered || selected) && (
        <Html center distanceFactor={16} zIndexRange={[10, 0]} occlude={false}>
          <div className="node-label">{item.node.name}</div>
        </Html>
      )}
    </group>
  );
}

function Constellation({
  graph,
  activeIds,
  selectedId,
  onSelect,
}: {
  graph: ProjectGraph;
  activeIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const positioned = useMemo(() => layout(graph.nodes), [graph.nodes]);
  const posById = useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const p of positioned) m.set(p.node.id, p.pos);
    return m;
  }, [positioned]);

  // Idle auto-rotation, paused while something is selected.
  useFrame((_, dt) => {
    if (groupRef.current && !selectedId) groupRef.current.rotation.y += dt * 0.05;
  });

  return (
    <group ref={groupRef}>
      {graph.links.map((link, i) => {
        const a = posById.get(link.source);
        const b = posById.get(link.target);
        if (!a || !b) return null;
        return (
          <Line
            key={i}
            points={[a, b]}
            color="#1c3a55"
            lineWidth={1}
            transparent
            opacity={0.5}
          />
        );
      })}
      {positioned.map((item) => (
        <NodeMesh
          key={item.node.id}
          item={item}
          selected={item.node.id === selectedId}
          active={activeIds.has(item.node.id)}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

/** Smoothly flies the camera toward the selected node, or back out when cleared. */
function CameraRig({ target }: { target: THREE.Vector3 | null }): null {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3(0, 0, 26));
  useEffect(() => {
    if (target) {
      const dir = target.clone().normalize();
      desired.current = target.clone().add(dir.multiplyScalar(6));
    } else {
      desired.current = new THREE.Vector3(0, 0, 26);
    }
  }, [target]);
  useFrame(() => {
    camera.position.lerp(desired.current, 0.06);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export function HiveMind({
  graph,
  tasks,
  selectedId,
  onSelect,
}: {
  graph: ProjectGraph;
  tasks: TaskRecord[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}): JSX.Element {
  // Map running tasks → the project nodes they belong to (by short name).
  const activeIds = useMemo(() => {
    const running = tasks.filter((t) => t.status === "dispatched" || t.status === "running");
    const ids = new Set<string>();
    for (const t of running) {
      const match = graph.nodes.find(
        (n) => n.name.toLowerCase() === t.project.toLowerCase(),
      );
      if (match) ids.add(match.id);
    }
    return ids;
  }, [tasks, graph.nodes]);

  const selectedPos = useMemo(() => {
    if (!selectedId) return null;
    const positioned = layout(graph.nodes);
    return positioned.find((p) => p.node.id === selectedId)?.pos ?? null;
  }, [selectedId, graph.nodes]);

  return (
    <Canvas
      camera={{ position: [0, 0, 26], fov: 55 }}
      onPointerMissed={() => onSelect(null)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#05070d"]} />
      <fog attach="fog" args={["#05070d", 22, 55]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1.2} color="#41e0ff" />
      <pointLight position={[-12, -6, -8]} intensity={0.8} color="#8a7bff" />
      <Constellation
        graph={graph}
        activeIds={activeIds}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <CameraRig target={selectedPos} />
    </Canvas>
  );
}
