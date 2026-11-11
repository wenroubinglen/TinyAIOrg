"use client";

/**
 * /company/city 3D 城市视图。
 * 主体：形状×颜色 3D bot（avatarShape 映射）+ org 街区（orgId 哈希色）
 * + 阻尼运镜 + SSE 说话反馈（CHAT_MESSAGE_EVENT）+ snapshot 重拉。
 * 交互：点击 bot 相机飞向+信息卡（跳既有 /agents/[id]）；DOM 浮层
 * 分组胶囊（absolute inset-0 模式）点击飞街区；ESC/点空白回全景。
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { getAgents, getTeams, type AgentConfig, type TeamConfig } from "@/lib/api";
import { loadAiOrgFromEngine } from "@/lib/ai-org-engine";
import { usePolling } from "@/lib/hooks";
import {
  CHAT_MESSAGE_EVENT,
  SSE_RECONNECTED_EVENT,
} from "@/lib/live-events";
import { ROSTER_CHANGED_EVENT } from "@/lib/roster-events";
import { fallbackColorHex } from "@/components/agent/agent-avatar";

// ── 形状×几何体 ──────────────────────────────────────────────────────────

function HexGeometry() {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const x = Math.cos(a) * 0.42;
      const y = Math.sin(a) * 0.42;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.72,
      bevelEnabled: false,
    });
  }, []);
  return <primitive object={geo} attach="geometry" />;
}

function CapsuleGeo() {
  const geo = useMemo(() => new THREE.CapsuleGeometry(0.32, 0.42, 8, 24), []);
  return <primitive object={geo} attach="geometry" />;
}

// 天空 + 场景雾 + 色调映射。Sky scale 需小于相机 far(600)。
// 雾距与世界尺度联动（紧凑化后全景半径小，固定 60-220 会罩住全城）。
function Atmosphere({ fogNear, fogFar }: { fogNear: number; fogFar: number }) {
  const { scene, gl } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    // 0.75 曝光把 ACES 压暗（bot 显灰暗根因）——回调 1.05 恢复糖果色饱和
    gl.toneMappingExposure = 1.05;
    // 浮空岛观感：雾改淡蓝且更远（白雾+物理天空地平线=放平视角一片白的根因）
    scene.fog = new THREE.Fog("#b7d4f2", fogNear, fogFar);
    return () => {
      scene.fog = null;
    };
  }, [scene, gl, fogNear, fogFar]);
  const sky = useMemo(() => {
    const s = new Sky();
    s.scale.setScalar(450);
    const u = s.material.uniforms;
    // v6b：正午化+散射更低——地平线散射白压到最低，整圈饱和蓝天
    u.turbidity.value = 1.5;
    u.rayleigh.value = 0.7;
    u.mieCoefficient.value = 0.002;
    u.mieDirectionalG.value = 0.78;
    u.sunPosition.value.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(72),
      THREE.MathUtils.degToRad(120),
    );
    return s;
  }, []);
  return <primitive object={sky} />;
}

function BotMesh({
  shape,
  color,
  speaking,
  position,
  baseY,
  isChair,
  isLeader,
  name,
  onClick,
}: {
  shape: string | null;
  color: string;
  speaking: boolean;
  position: [number, number, number];
  /** 台面顶高度（组织台 0.22 / 团队台 0.46）——bot 站台面上 */
  baseY: number;
  isChair: boolean;
  isLeader: boolean;
  name: string;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const crowned = isChair || isLeader;
  useFrame((_, dt) => {
    if (!ref.current) return;
    // 待机呼吸浮动 + 说话弹跳（全员待机动画；浮动基于台面 baseY）
    const t = performance.now() / 1000;
    const bob = speaking
      ? baseY + 0.45 + Math.sin(t * 11) * 0.12
      : baseY + 0.16 + Math.sin(t * 1.4 + position[0] * 2.1 + position[2] * 1.3) * 0.05;
    ref.current.position.y +=
      (bob - ref.current.position.y) * (1 - Math.exp(-12 * dt));
    // 管理者/leader 尺寸放大 1.5x
    const s = (crowned ? 1.5 : 1) * (speaking ? 1.15 : 1);
    const cur = ref.current.scale.x;
    ref.current.scale.setScalar(cur + (s - cur) * (1 - Math.exp(-12 * dt)));
  });
  return (
    <group position={[position[0], baseY, position[2]]}>
      <mesh
        ref={ref}
        position={[0, 0, 0]}
        onClick={onClick}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        {shape === "hexagon" ? (
          <HexGeometry />
        ) : shape === "rounded" ? (
          <CapsuleGeo />
        ) : shape === "square" ? (
          <boxGeometry args={[0.62, 0.62, 0.62]} />
        ) : (
          <sphereGeometry args={[0.38, 32, 24]} />
        )}
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={speaking ? 0.9 : 0.35}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>
      {/* 名字标签（CanvasTexture Sprite，fog 豁免） */}
      <BotLabel name={name} color={color} />
      {/* chair=金色皇冠；团队 leader=蓝色星标（语言区分） */}
      {isChair && <Crown isChair={isChair} />}
      {!isChair && isLeader && <StarBadge />}
      {/* 脚下光环（chair 金 / leader 蓝） */}
      {crowned && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.75, 32]} />
          <meshBasicMaterial
            color={isChair ? "#fbbf24" : "#38bdf8"}
            transparent
            opacity={0.75}
          />
      </mesh>
      )}
    </group>
  );
}

/** bot 名字标签：白字+色点，Sprite 始终朝相机 */
function BotLabel({ name, color }: { name: string; color: string }) {
  const sprite = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 背景胶囊
    const text = name.slice(0, 8);
    const w = Math.min(240, ctx.measureText(text).width + 34);
    ctx.fillStyle = "rgba(10,15,30,0.68)";
    ctx.beginPath();
    ctx.roundRect(128 - w / 2, 14, w, 36, 18);
    ctx.fill();
    // 色点
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(128 - w / 2 + 18, 32, 5, 0, Math.PI * 2);
    ctx.fill();
    // 名字
    ctx.fillStyle = "#e8eefb";
    ctx.fillText(text, 128 + 10, 33);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }),
    );
    sp.scale.set(2.0, 0.5, 1);
    sp.position.y = 1.1;
    return sp;
  }, [name, color]);
  return <primitive object={sprite} />;
}

/** 皇冠 Sprite（chair 专用——组织管理者语言） */
function Crown({ isChair }: { isChair: boolean }) {
  const sprite = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(8, 46);
    ctx.lineTo(8, 22);
    ctx.lineTo(20, 32);
    ctx.lineTo(32, 12);
    ctx.lineTo(44, 32);
    ctx.lineTo(56, 22);
    ctx.lineTo(56, 46);
    ctx.closePath();
    ctx.fillStyle = isChair ? "#fde047" : "#fbbf24";
    ctx.fill();
    ctx.strokeStyle = "#b45309";
    ctx.lineWidth = 2;
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }),
    );
    sp.scale.set(0.55, 0.55, 1);
    // 高于名牌（名牌 y=1.1 高 0.5 → 顶 1.35）——皇冠坐 y=1.8 不重叠
    sp.position.y = 1.8;
    return sp;
  }, [isChair]);
  return <primitive object={sprite} />;
}

/** 星形徽标 Sprite（团队 leader 专用——与 chair 皇冠语言区分） */
function StarBadge() {
  const sprite = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    // 五角星路径
    const cx = 32, cy = 34, R = 20, r = 8.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = (Math.PI / 5) * i - Math.PI / 2;
      const rad2 = i % 2 === 0 ? R : r;
      const x = cx + Math.cos(rad) * rad2;
      const y = cy + Math.sin(rad) * rad2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 10, 0, 56);
    grad.addColorStop(0, "#7dd3fc");
    grad.addColorStop(1, "#0ea5e9");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#0369a1";
    ctx.lineWidth = 2;
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }),
    );
    sp.scale.set(0.5, 0.5, 1);
    sp.position.y = 1.8;
    return sp;
  }, []);
  return <primitive object={sprite} />;
}

/** 卡通白云：CanvasTexture 手绘蓬松云，Sprite 群绕岛缓慢漂移 */
function Clouds({ worldR }: { worldR: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    // 蓬松云=多个圆叠加
    const puffs: Array<[number, number, number]> = [
      [70, 80, 34],
      [110, 62, 44],
      [156, 74, 38],
      [190, 86, 26],
      [128, 92, 32],
    ];
    for (const [x, y, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 底部裁平（卡通云平底感）
    ctx.clearRect(0, 100, 256, 28);
    // 底缘淡影
    ctx.fillStyle = "rgba(190,215,240,0.55)";
    ctx.beginPath();
    ctx.ellipse(128, 98, 92, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    return new THREE.CanvasTexture(c);
  }, []);
  const clouds = useMemo(() => {
    const rand = seededRandom(20261109);
    const out: Array<{
      angle: number;
      dist: number;
      y: number;
      scale: number;
    }> = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      out.push({
        angle: rand() * Math.PI * 2,
        dist: worldR * (0.55 + rand() * 0.85),
        y: 6 + rand() * 14,
        scale: 2.6 + rand() * 3.4,
      });
    }
    return out;
  }, [worldR]);
  useFrame((_, dt) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * 0.012;
    }
  });
  return (
    <group ref={groupRef}>
      {clouds.map((cl, i) => (
        <sprite
          key={i}
          position={[
            Math.cos(cl.angle) * cl.dist,
            cl.y,
            Math.sin(cl.angle) * cl.dist,
          ]}
          scale={[cl.scale, cl.scale * 0.5, 1]}
        >
          <spriteMaterial map={tex} transparent fog={false} opacity={0.92} />
        </sprite>
      ))}
    </group>
  );
}

// ── 卡通树 + 小草（卡通地面点缀，确定性伪随机散布） ─────────

/** 卡通树：圆柱树干 + 两层圆锥树冠 */
function Tree({ position, scale }: { position: [number, number]; scale: number }) {
  return (
    <group position={[position[0], 0, position[1]]} scale={scale}>
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.09, 0.13, 0.56, 8]} />
        <meshStandardMaterial color="#8a5a35" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <coneGeometry args={[0.62, 1.0, 10]} />
        <meshStandardMaterial color="#3fae5a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <coneGeometry args={[0.44, 0.78, 10]} />
        <meshStandardMaterial color="#4cc46a" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 小草：三片交叉的细锥 */
function Grass({ position, scale }: { position: [number, number]; scale: number }) {
  return (
    <group position={[position[0], 0, position[1]]} scale={scale}>
      {[0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => (
        <mesh key={a} position={[0, 0.12, 0]} rotation={[0, a, 0.22]}>
          <coneGeometry args={[0.05, 0.3, 4]} />
          <meshStandardMaterial color="#5dbd6e" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** 确定性伪随机（mulberry32）——散布位置稳定，不随刷新跳动 */
function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在区块间的空地上散布树/草：拒绝采样——落在任一区块半径内则丢弃 */
function ScatterNature({
  blocks,
  worldR,
}: {
  blocks: CityWorld["blocks"];
  worldR: number;
}) {
  const items = useMemo(() => {
    const rand = seededRandom(20261109);
    const out: Array<
      { kind: "tree"; pos: [number, number]; scale: number } | {
        kind: "grass";
        pos: [number, number];
        scale: number;
      }
    > = [];
    let tries = 0;
    const wantTrees = Math.min(26, Math.max(10, Math.round(worldR * 1.2)));
    // 草原感：草量 = 树×18（密铺加强）——v6c 树×3 荒漠 → v6d 树×12 → v6e 树×18
    const wantGrass = wantTrees * 18;
    const inBlock = (x: number, z: number) =>
      blocks.some(
        (b) =>
          (x - b.x) ** 2 + (z - b.z) ** 2 < (b.size / 2 + 0.9) ** 2,
      );
    while (out.filter((o) => o.kind === "tree").length < wantTrees && tries < 400) {
      tries++;
      const a = rand() * Math.PI * 2;
      const d = rand() * worldR * 0.92;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (inBlock(x, z)) continue;
      out.push({ kind: "tree", pos: [x, z], scale: 0.75 + rand() * 0.6 });
    }
    tries = 0;
    while (out.filter((o) => o.kind === "grass").length < wantGrass && tries < 3800) {
      tries++;
      const a = rand() * Math.PI * 2;
      const d = rand() * worldR * 0.92;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (inBlock(x, z)) continue;
      out.push({ kind: "grass", pos: [x, z], scale: 0.7 + rand() * 0.7 });
    }
    return out;
  }, [blocks, worldR]);
  return (
    <group>
      {items.map((it, i) =>
        it.kind === "tree" ? (
          <Tree key={`t${i}`} position={it.pos} scale={it.scale} />
        ) : (
          <Grass key={`g${i}`} position={it.pos} scale={it.scale} />
        ),
      )}
    </group>
  );
}

// ── 街区地台 + 名牌 ─────────────────────────────────────────────────────

function BlockLabel({
  label,
  color,
  y,
}: {
  label: string;
  color: string;
  y: number;
}) {
  const sprite = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(label.slice(0, 10), 128, 32);
    const tex = new THREE.CanvasTexture(c);
    // 场景加雾后 Sprite 会被雾吞——名牌显式豁免
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }),
    );
    sp.scale.set(2.4, 0.6, 1);
    sp.position.y = y;
    return sp;
  }, [label, color, y]);
  return <primitive object={sprite} />;
}

function Block({
  x,
  z,
  size,
  color,
  label,
  platform,
  onPlatformClick,
}: {
  x: number;
  z: number;
  size: number;
  color: string;
  label: string;
  platform: boolean;
  onPlatformClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  // 抬升地块（凸台式）——pastel 化彩色平台（bot 糖果色当主角）。
  // platform=false（自由区/独立团队）：无台面，只留名牌（草地即地盘）。
  // 台面可点击=胶囊同款 focusBlock（stopPropagation 防 onPointerMissed 回全景）。
  const r = size / 2;
  return (
    <group position={[x, 0, z]}>
      {platform && (
        <>
          {/* 台体（侧面 pastel 深一档） */}
          <mesh
            position={[0, 0.11, 0]}
            onClick={onPlatformClick}
            onPointerOver={() => (document.body.style.cursor = "pointer")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <cylinderGeometry args={[r, r * 1.04, 0.22, 56]} />
            <meshStandardMaterial color={pastel(color, 0.6)} roughness={0.85} />
          </mesh>
          {/* 台顶亮面（pastel 浅一档，区分顶/侧） */}
          <mesh
            position={[0, 0.225, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={onPlatformClick}
            onPointerOver={() => (document.body.style.cursor = "pointer")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <circleGeometry args={[r, 56]} />
            <meshStandardMaterial color={pastel(color, 0.72)} roughness={0.7} />
          </mesh>
        </>
      )}
      <BlockLabel label={label} color={color} y={platform ? r + 1.0 : 1.4} />
    </group>
  );
}

// ── 相机阻尼（支持焦点飞越 + 全景复位） ────────────────────────────

interface CameraFocus {
  /** 注视点 */
  point: [number, number, number];
  /** 相机到注视点距离 */
  distance: number;
}

function DampedOrbit({
  overviewRadius,
  focus,
}: {
  overviewRadius: number;
  focus: CameraFocus | null;
}) {
  // target/current 球坐标围绕动态注视点
  const target = useRef(
    new THREE.Spherical(overviewRadius, Math.PI / 3.2, Math.PI / 4),
  );
  const current = useRef(
    new THREE.Spherical(overviewRadius, Math.PI / 3.2, Math.PI / 4),
  );
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const lookCurrent = useRef(new THREE.Vector3(0, 0, 0));
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 缩放上限随世界尺度（紧凑化后全景半径小，固定 160 太远）
  const maxRadius = useRef(160);

  // focus 变化 → 更新 target 球坐标与注视点（全景=原点+全景半径）
  useEffect(() => {
    maxRadius.current = Math.max(overviewRadius * 2.2, 20);
    if (focus) {
      target.current.radius = focus.distance;
      lookTarget.current.set(...focus.point);
    } else {
      target.current.radius = overviewRadius;
      lookTarget.current.set(0, 0, 0);
    }
  }, [focus, overviewRadius]);

  useEffect(() => {
    const canvas = (() => {
      const holder = document.querySelector("[data-city-canvas]");
      return holder?.querySelector("canvas") ?? null;
    })();
    if (!canvas) return;
    canvasRef.current = canvas as HTMLCanvasElement;

    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      target.current.theta -= dx * 0.006;
      target.current.phi = THREE.MathUtils.clamp(
        target.current.phi - dy * 0.005,
        0.15,
        Math.PI / 2.05,
      );
    };
    const onUp = () => {
      dragging.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      target.current.radius = THREE.MathUtils.clamp(
        target.current.radius * (1 + e.deltaY * 0.001),
        2,
        maxRadius.current,
      );
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  useFrame(({ camera }, dt) => {
    // 指数阻尼 1-exp(-k·dt)
    const k = 3.5;
    const c = current.current;
    const t = target.current;
    c.radius += (t.radius - c.radius) * (1 - Math.exp(-k * dt));
    c.theta += (t.theta - c.theta) * (1 - Math.exp(-k * dt));
    c.phi += (t.phi - c.phi) * (1 - Math.exp(-k * dt));
    lookCurrent.current.lerp(lookTarget.current, 1 - Math.exp(-k * dt));
    const pos = new THREE.Vector3().setFromSpherical(c).add(lookCurrent.current);
    camera.position.copy(pos);
    camera.lookAt(lookCurrent.current);
  });

  return null;
}

// ── 布局计算：org 街区 → 街区内 bot 网格 ────────────────────────────────

interface PlacedBot {
  agentId: string;
  name: string;
  shape: string | null;
  color: string;
  position: [number, number, number];
  /** 站位台面高度（组织台 0.22 / 挂靠团队台 0.46 / 自由区草地 0） */
  baseY: number;
  /** 组织管理者（chair）——金色皇冠+光环+放大 */
  isChair: boolean;
  /** 团队 leader——皇冠+光环+放大（样式与 chair 同款语言） */
  isLeader: boolean;
  /** 所属团队子地块 id（无团队=null） */
  teamId: string | null;
}

interface TeamPlot {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  radius: number;
  count: number;
  /** 团队小台面：挂靠=true（组织台上层，台面顶 0.46）；独立=true（草地上自起小台，台面顶 0.22）。容器不渲染台面。 */
  platform: boolean;
  /** 台面顶高度（挂靠 0.46 / 独立 0.22） */
  topY: number;
}

const FREE_BLOCK_ID = "__free__";
const FREE_TEAMS_BLOCK_ID = "__free_teams__";
/** 紧凑间距体系：容器近乎贴边（颜色/描边区分），成员步距小 */
const BLOCK_GAP = 1;
const GRID = 7;
const STEP = 1.4; // 成员网格步距（近贴：bot 直径 ~0.8-1.1）
const PAD = 1.2; // 网格外沿余量

/** 台面 pastel 化——组织色混白淡化，bot 糖果色当主角，地块不抢色 */
function pastel(hex: string, white: number): string {
  return "#" + new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), white).getHexString();
}

interface CityWorld {
  bots: PlacedBot[];
  blocks: Array<{
    id: string;
    name: string;
    color: string;
    x: number;
    z: number;
    size: number;
    count: number;
    depth: number;
    /** 有子组织时的整棵子树半径（虚线边界环） */
    subtreeR?: number;
    /** 台面标志：组织=true；自由区/独立团队=false（直接草地，无凸台） */
    platform: boolean;
  }>;
  teams: TeamPlot[];
  radius: number;
}

/** 顶层组织一块大台面，整棵子树成员平铺网格。
 * - 每个顶层父组织仅一层台面：子组织/挂靠团队不再有独立台面或站位圈
 * - 子树全部成员（子组织直挂+挂靠团队成员，去重）统一网格站位
 * - chair 皇冠不变；团队 leader 换星形徽标（与皇冠语言区分）
 * - 独立团队（无组织）保留各自小台面；自由成员草地
 */
function layoutCity(
  agents: Record<string, AgentConfig>,
  folders: Array<{ id: string; name: string; parentId: string | null }>,
  agentOrg: Record<string, string>,
  teams: Record<string, TeamConfig>,
  managers: Record<string, string>,
): CityWorld {
  const active = Object.entries(agents).filter(
    ([, a]) => a.status !== "deleted",
  );

  // 组织树
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const f of folders) {
    if (f.parentId && folders.some((x) => x.id === f.parentId)) {
      const arr = childrenOf.get(f.parentId) ?? [];
      arr.push(f.id);
      childrenOf.set(f.parentId, arr);
    } else {
      roots.push(f.id);
    }
  }
  // 收集整棵子树的 orgId 集合
  const subtreeOrgs = (rootId: string): Set<string> => {
    const out = new Set<string>();
    const walk = (id: string) => {
      out.add(id);
      for (const k of childrenOf.get(id) ?? []) walk(k);
    };
    walk(rootId);
    return out;
  };

  // 团队归属：挂靠组织（记挂哪个根）vs 独立
  const teamLeaders = new Map<string, string>();
  const orgTeamRoot = new Map<string, string>(); // teamId → 顶层 rootId
  const freeTeams: string[] = [];
  const rootSet = new Set(roots);
  const resolveRoot = (orgId: string): string | null => {
    let cur: string | undefined = orgId;
    const seen = new Set<string>();
    while (cur && folders.some((f) => f.id === cur) && !seen.has(cur)) {
      seen.add(cur);
      const f = folders.find((x) => x.id === cur)!;
      if (!f.parentId || !folders.some((x) => x.id === f.parentId)) return cur;
      cur = f.parentId;
    }
    return null;
  };
  for (const [teamId, t] of Object.entries(teams)) {
    const leader = t.leader_agent || t.leader_agent_org || "";
    if (leader) teamLeaders.set(teamId, leader);
    const fid = t.folder_id ?? "";
    if (fid && folders.some((f) => f.id === fid)) {
      const r = resolveRoot(fid);
      if (r && rootSet.has(r)) orgTeamRoot.set(teamId, r);
      else freeTeams.push(teamId);
    } else {
      freeTeams.push(teamId);
    }
  }

  // 每个顶层组织的成员集合（子树全部 agent，去重）+ chair/leader 标记
  const rootMembers = new Map<string, string[]>();
  const rootByOrg = new Map<string, string>(); // orgId → rootId
  for (const r of roots) for (const o of subtreeOrgs(r)) rootByOrg.set(o, r);
  const memberRoot = new Map<string, string>(); // agentId → root（首见定根）
  for (const [agentId] of active) {
    const orgId = agentOrg[agentId] ?? "";
    const r = orgId ? (rootByOrg.get(orgId) ?? null) : null;
    if (r) memberRoot.set(agentId, r);
  }
  // 挂靠团队成员无组织直挂者，也进其团队挂靠的根
  for (const [teamId, r] of orgTeamRoot) {
    for (const m of teams[teamId]?.agents ?? []) {
      if (!memberRoot.has(m)) memberRoot.set(m, r);
    }
  }
  for (const [agentId, r] of memberRoot) {
    const arr = rootMembers.get(r) ?? [];
    arr.push(agentId);
    rootMembers.set(r, arr);
  }

  // leader 标记：agent 是任一挂靠团队的 leader
  const leaderAgents = new Set<string>();
  for (const [teamId] of orgTeamRoot) {
    const l = teamLeaders.get(teamId);
    if (l) leaderAgents.add(l);
  }
  // 独立团队 leader 也标
  for (const tid of freeTeams) {
    const l = teamLeaders.get(tid);
    if (l) leaderAgents.add(l);
  }

  const bots: PlacedBot[] = [];
  const blocks: CityWorld["blocks"] = [];
  const teamPlots: TeamPlot[] = [];

  // 团队圈半径（独立团队台面用）
  const teamR = (n: number): number => {
    const k = Math.max(1, n);
    if (k <= 1) return 0.75;
    return Math.max(0.7, 1.15 / (2 * Math.sin(Math.PI / k)));
  };

  const placeGrid = (
    agentIds: string[],
    cx: number,
    cz: number,
    baseY: number,
    chairOrgs: Set<string> | null,
  ) => {
    const cols = Math.min(GRID, Math.ceil(Math.sqrt(agentIds.length || 1)));
    agentIds.forEach((agentId, j) => {
      const a = agents[agentId];
      if (!a) return;
      bots.push({
        agentId,
        name: a.name,
        shape: a.avatar_shape ?? null,
        color: a.avatar_color || fallbackColorHex(agentId),
        position: [
          cx + ((j % cols) - (cols - 1) / 2) * STEP,
          0,
          cz +
            (Math.floor(j / cols) -
              (Math.ceil(agentIds.length / cols) - 1) / 2) *
              STEP,
        ],
        baseY,
        isChair:
          chairOrgs !== null &&
          [...chairOrgs].some((o) => managers[o] === agentId),
        isLeader: leaderAgents.has(agentId),
        teamId: null,
      });
    });
  };

  const placeTeamStandalone = (
    teamId: string,
    px: number,
    pz: number,
    topY: number,
  ) => {
    const team = teams[teamId];
    if (!team) return;
    const members = team.agents ?? [];
    const tColor = fallbackColorHex(teamId);
    const r = teamR(members.length);
    const leader = teamLeaders.get(teamId);
    teamPlots.push({
      id: teamId,
      name: team.name,
      color: tColor,
      x: px,
      z: pz,
      radius: r,
      count: members.length,
      platform: true,
      topY,
    });
    members.forEach((agentId, j) => {
      const a = agents[agentId];
      if (!a) return;
      const ma =
        (j / Math.max(1, members.length)) * Math.PI * 2 + Math.PI / 4;
      bots.push({
        agentId,
        name: a.name,
        shape: a.avatar_shape ?? null,
        color: a.avatar_color || fallbackColorHex(agentId),
        position: [px + Math.cos(ma) * r, 0, pz + Math.sin(ma) * r],
        baseY: topY,
        isChair: false,
        isLeader: leader === agentId,
        teamId,
      });
    });
  };

  // ── 顶层槽位：根组织（一块大台面）+ 独立团队区 + 自由区 ──
  const topSlots: Array<{
    id: string;
    r: number;
    place: (cx: number, cz: number) => void;
  }> = [];

  for (const rootId of roots) {
    const orgSet = subtreeOrgs(rootId);
    const members = rootMembers.get(rootId) ?? [];
    const name = folders.find((f) => f.id === rootId)?.name ?? "组织";
    const cols = Math.min(GRID, Math.ceil(Math.sqrt(members.length || 1)));
    const rows = Math.ceil(members.length / cols);
    const r =
      Math.max(((cols - 1) / 2) * STEP, ((rows - 1) / 2) * STEP) + PAD + 0.4;
    topSlots.push({
      id: rootId,
      r,
      place: (cx, cz) => {
        placeGrid(members, cx, cz, 0.22, orgSet);
        blocks.push({
          id: rootId,
          name,
          color: fallbackColorHex(rootId),
          x: cx,
          z: cz,
          size: r * 2,
          count: members.length,
          depth: 0,
          platform: true,
        });
      },
    });
  }

  // 独立团队区：容器无台面，每个团队草地上自起小台
  if (freeTeams.length) {
    let maxTR = 0;
    for (const tid of freeTeams) {
      const n = teams[tid]?.agents?.length ?? 1;
      maxTR = Math.max(maxTR, teamR(n));
    }
    const cols = Math.min(GRID, Math.ceil(Math.sqrt(freeTeams.length)));
    const rows = Math.ceil(freeTeams.length / cols);
    const step = maxTR * 2 + PAD;
    const effR = Math.max(
      ((cols - 1) / 2) * step + maxTR + PAD * 0.6,
      ((rows - 1) / 2) * step + maxTR + PAD * 0.6,
      4,
    );
    topSlots.push({
      id: FREE_TEAMS_BLOCK_ID,
      r: effR,
      place: (cx, cz) => {
        freeTeams.forEach((tid, i) => {
          const gx = i % cols;
          const gz = Math.floor(i / cols);
          placeTeamStandalone(
            tid,
            cx + (gx - (cols - 1) / 2) * step,
            cz + (gz - (rows - 1) / 2) * step,
            0.22,
          );
        });
        blocks.push({
          id: FREE_TEAMS_BLOCK_ID,
          name: "独立团队",
          color: "#7c8da6",
          x: cx,
          z: cz,
          size: effR * 2,
          count: freeTeams.length,
          depth: 0,
          platform: false,
        });
      },
    });
  }

  // 自由区：无组织且不属于任何团队
  const freeAgents = active
    .map(([id]) => id)
    .filter(
      (id) =>
        !memberRoot.has(id) &&
        !Object.values(teams).some((t) => (t.agents ?? []).includes(id)),
    );
  if (freeAgents.length) {
    const cols = Math.min(GRID, Math.ceil(Math.sqrt(freeAgents.length)));
    const r = Math.max(2.6, ((cols - 1) / 2) * STEP + PAD);
    topSlots.push({
      id: FREE_BLOCK_ID,
      r,
      place: (cx, cz) => {
        placeGrid(freeAgents, cx, cz, 0, null);
        blocks.push({
          id: FREE_BLOCK_ID,
          name: "自由区",
          color: "#64748b",
          x: cx,
          z: cz,
          size: r * 2,
          count: freeAgents.length,
          depth: 0,
          platform: false,
        });
      },
    });
  }

  // 顶层容器环形分布：环半径=最差相邻对 (ri+rj+GAP)/(2·sin(π/n))——近乎贴边
  const n = topSlots.length || 1;
  let topR = 0;
  if (n > 1) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const a = topSlots[i].r;
      const b = topSlots[(i + 1) % n].r;
      worst = Math.max(worst, a + b + BLOCK_GAP);
    }
    topR = worst / (2 * Math.sin(Math.PI / n));
    topR = Math.max(topR, ...topSlots.map((s) => s.r));
  }
  topSlots.forEach((s, i) => {
    const a = (i / n) * Math.PI * 2;
    s.place(Math.cos(a) * topR, Math.sin(a) * topR);
  });

  const maxExt = Math.max(
    ...blocks.map((b) => Math.abs(b.x) + b.size / 2),
    0,
  );
  return {
    bots,
    blocks,
    teams: teamPlots,
    radius: maxExt + 14,
  };
}

// ── 页面 ────────────────────────────────────────────────────────────────

export default function CityPage() {
  const { data: agents, refresh: refreshAgents } = usePolling(getAgents, 0, []);
  const { data: aiOrg, refresh: refreshOrg } = usePolling(
    loadAiOrgFromEngine,
    0,
    [],
  );
  const { data: teams, refresh: refreshTeams } = usePolling(getTeams, 0, []);
  const [speaking, setSpeaking] = useState<Map<string, number>>(new Map());
  // 焦点态（null=全景）
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const [selectedBot, setSelectedBot] = useState<PlacedBot | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  // SSE 事件 → 数据重拉（snapshot 语义）
  useEffect(() => {
    const onRefresh = (e: Event) => {
      const kind = (e as CustomEvent).detail?.kind;
      if (kind === "agents" || kind === "orgs" || kind === "teams" || kind === "all" || !kind) {
        refreshAgents();
        refreshOrg();
        refreshTeams();
      }
      if (e.type === SSE_RECONNECTED_EVENT) {
        refreshAgents();
        refreshOrg();
        refreshTeams();
      }
    };
    const onChat = (e: Event) => {
      const d = (e as CustomEvent).detail as { agentId?: string };
      const who = d?.agentId;
      if (!who) return;
      setSpeaking((prev) => new Map(prev).set(who, Date.now()));
    };
    window.addEventListener(ROSTER_CHANGED_EVENT, onRefresh);
    window.addEventListener(SSE_RECONNECTED_EVENT, onRefresh);
    window.addEventListener(CHAT_MESSAGE_EVENT, onChat);
    return () => {
      window.removeEventListener(ROSTER_CHANGED_EVENT, onRefresh);
      window.removeEventListener(SSE_RECONNECTED_EVENT, onRefresh);
      window.removeEventListener(CHAT_MESSAGE_EVENT, onChat);
    };
  }, [refreshAgents, refreshOrg, refreshTeams]);

  const world = useMemo(() => {
    if (!agents) return null;
    return layoutCity(
      agents,
      aiOrg?.folders ?? [],
      aiOrg?.agentOrg ?? {},
      teams ?? {},
      aiOrg?.managers ?? {},
    );
  }, [agents, aiOrg, teams]);

  // ESC 回全景
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocus(null);
        setSelectedBot(null);
        setActiveBlockId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 说话态 2.5s 衰减
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setSpeaking((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map<string, number>();
        for (const [k, t] of prev) {
          if (now - t < 2500) next.set(k, t);
          else changed = true;
        }
        return changed ? next : prev;
      });
      forceTick((n) => n + 1);
    }, 300);
    return () => clearInterval(id);
  }, []);

  const exitFocus = () => {
    setFocus(null);
    setSelectedBot(null);
    setActiveBlockId(null);
  };

  const focusBlock = (blockId: string) => {
    const b = world?.blocks.find((x) => x.id === blockId);
    if (!b) return;
    setActiveBlockId(blockId);
    setSelectedBot(null);
    setFocus({ point: [b.x, 0, b.z], distance: Math.max(10, b.size * 1.4) });
  };

  // 团队台面点击=飞向该团队（与组织台同款语言）
  const focusTeamPlot = (teamId: string) => {
    const t = world?.teams.find((x) => x.id === teamId);
    if (!t) return;
    setActiveBlockId(null);
    setSelectedBot(null);
    setFocus({
      point: [t.x, 0, t.z],
      distance: Math.max(6, t.radius * 3),
    });
  };

  const focusBot = (bot: PlacedBot) => {
    setSelectedBot(bot);
    setFocus({ point: bot.position, distance: 5 });
  };

  // 点击空白（canvas 非 bot 区）回全景——onPointerMissed
  const selectedAgentFull = selectedBot && agents?.[selectedBot.agentId];

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div data-city-canvas className="h-full w-full">
        {world && (
          <Canvas
            camera={{ position: [30, 22, 30], fov: 50, far: 600 }}
            onCreated={({ gl }) => gl.setClearColor("#0f172a")}
            onPointerMissed={exitFocus}
          >
            <Atmosphere
              fogNear={world.radius * 3.5}
              fogFar={world.radius * 8}
            />
            <ambientLight intensity={0.75} />
            <directionalLight position={[20, 30, 10]} intensity={1.3} />
            <DampedOrbit overviewRadius={world.radius} focus={focus} />
            {world.blocks.map((b) => (
              <Block
                key={b.id}
                x={b.x}
                z={b.z}
                size={b.size}
                color={b.color}
                label={b.name}
                platform={b.platform}
                onPlatformClick={(e) => {
                  e.stopPropagation();
                  if (b.platform) focusBlock(b.id);
                }}
              />
            ))}
            {/* 团队小台面可点击=飞向该团队 */}
            {world.teams.map((t) => (
              <group key={t.id} position={[t.x, 0, t.z]}>
                <mesh
                  position={[0, t.topY - 0.12, 0]}
                  onClick={(e) => {
                    e.stopPropagation();
                    focusTeamPlot(t.id);
                  }}
                  onPointerOver={() => (document.body.style.cursor = "pointer")}
                  onPointerOut={() => (document.body.style.cursor = "")}
                >
                  <cylinderGeometry args={[t.radius, t.radius * 1.05, 0.24, 40]} />
                  <meshStandardMaterial color={pastel(t.color, 0.66)} roughness={0.8} />
                </mesh>
                <BlockLabel
                  label={t.name}
                  color={t.color}
                  y={t.topY + t.radius * 0.5 + 0.7}
                />
              </group>
            ))}
            {world.bots.map((b, i) => (
              <BotMesh
                key={`${b.agentId}-${b.teamId ?? "org"}-${i}`}
                shape={b.shape}
                color={b.color}
                speaking={speaking.has(b.agentId)}
                position={b.position}
                baseY={b.baseY}
                isChair={b.isChair}
                isLeader={b.isLeader}
                name={b.name}
                onClick={(e) => {
                  e.stopPropagation();
                  focusBot(b);
                }}
              />
            ))}
            {/* 浮空岛——草顶+土侧锥（悬于天空，非无限地面） */}
            <group>
              <mesh position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[world.radius * 1.15, 96]} />
                <meshStandardMaterial color="#a8d8a0" roughness={1} />
              </mesh>
              <mesh position={[0, -2.6, 0]}>
                <cylinderGeometry
                  args={[world.radius * 1.15, world.radius * 0.22, 5.2, 96]}
                />
                <meshStandardMaterial color="#9c7a52" roughness={1} />
              </mesh>
            </group>
            <ScatterNature blocks={world.blocks} worldR={world.radius} />
            {/* 卡通白云：绕岛漂移（Sprite 恒朝相机，fog 豁免） */}
            <Clouds worldR={world.radius} />
          </Canvas>
        )}
      </div>

      {/* DOM 浮层分组胶囊（容器铺满
          pointer-events-none，胶囊自身 auto） */}
      {world && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-14 z-10 flex max-w-[80vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2">
            {/* 胶囊只留无台面入口（独立团队/自由区）——组织/团队台面已可点击直达 */}
            {world.blocks
              .filter((b) => !b.platform)
              .map((b) => (
              <button
                key={b.id}
                onClick={() =>
                  activeBlockId === b.id ? exitFocus() : focusBlock(b.id)
                }
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors"
                style={{
                  borderColor: `${b.color}55`,
                  backgroundColor:
                    activeBlockId === b.id ? b.color : "rgba(15,23,42,0.72)",
                  color: activeBlockId === b.id ? "#fff" : b.color,
                }}
                title={`飞向 ${b.name}`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: b.color }}
                />
                {b.name}
                <span className="opacity-60">{b.count}</span>
              </button>
              ))}
          </div>
        </div>
      )}

      {/* 顶部信息栏（返回画布走左侧 island 切换钮——toggle 语义，原「← 画布」钮已删） */}
      <div className="absolute left-0 top-0 z-10 flex items-center gap-3 bg-slate-950/70 px-4 py-2.5 backdrop-blur">
        <span className="text-sm font-semibold text-slate-300">Bot City</span>
        <span className="text-xs text-slate-500">
          {world
            ? `${world.bots.length} bots · ${world.blocks.length} 街区 · ${world.teams.length} 团队`
            : "加载中…"}
        </span>
      </div>

      {/* 选中 bot 信息卡（右侧悬浮卡，城市语言） */}
      {selectedBot && (
        <div className="absolute bottom-6 right-6 z-10 w-64 rounded-2xl border border-white/10 bg-slate-900/85 p-4 shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: selectedBot.color, borderRadius: "50%" }}
            >
              {selectedBot.name.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-100">
                {selectedBot.name}
              </div>
              <div className="truncate text-xs text-slate-400">
                {selectedAgentFull?.title || selectedBot.agentId.slice(0, 14)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Link
              href={`/agents/${encodeURIComponent(selectedBot.agentId)}`}
              className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-center text-xs text-slate-200 transition hover:bg-white/20"
            >
              详情页
            </Link>
            <button
              onClick={exitFocus}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/10"
            >
              ESC 返回
            </button>
          </div>
        </div>
      )}

      {/* 焦点态提示 */}
      {focus && (
        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-xs text-slate-500">
          ESC 或点空白处返回全景
        </div>
      )}
    </div>
  );
}
