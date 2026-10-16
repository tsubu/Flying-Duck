import * as THREE from 'three';

// ============================================================
//  Flying-Duck：空飛ぶアヒル / 輪くぐりゲーム
//  - あくまで滑空。羽ばたいて上昇はできません。
//  - だいぶ上空から開始し、ピッチで降下をコントロールします。
// ============================================================

const STAGE_CONFIG = [
  {
    name: '川の上', desc: 'STAGE 1：川の上を滑空しよう', waterSide: 'center',
    waterColor: 0x3aa6c8, groundColor: 0x6cb34a, groundColor2: 0x4c9a3c, sandColor: 0xe9dba2,
    leafColors: [0x3d9c45, 0x2f8a3e, 0x58b84a],
    skyTop: 0x2a78e0, skyHorizon: 0xcfeeff, sunColor: 0xfff2c8, lightColor: 0xfff6e2,
    cloudColor: 0xffffff, sunDir: [-0.35, 0.55, 1],
  },
  {
    name: '湖の際', desc: 'STAGE 2：湖の際を滑空しよう', waterSide: 'left',
    waterColor: 0x2c8db4, groundColor: 0x8cc152, groundColor2: 0x6aa83e, sandColor: 0xeadcae,
    leafColors: [0x4a9c3a, 0xd9a43a, 0xc9663a],
    skyTop: 0x3b6cd2, skyHorizon: 0xffe4be, sunColor: 0xffdc96, lightColor: 0xffe9c8,
    cloudColor: 0xfff4e6, sunDir: [0.45, 0.35, 1],
  },
  {
    name: '海岸線', desc: 'STAGE 3：海岸線を滑空しよう', waterSide: 'left',
    waterColor: 0x1d7ea8, groundColor: 0xe6c288, groundColor2: 0xd2a868, sandColor: 0xf7e8bc,
    leafColors: [0x3f8c3a, 0x2f7a35, 0x5aa040],
    skyTop: 0x4a4aa6, skyHorizon: 0xffae7c, sunColor: 0xff9a5c, lightColor: 0xffc49a,
    cloudColor: 0xffd6c2, sunDir: [-0.2, 0.13, 1],
  },
];

const GAME = {
  stageDuration: 60,      // 各ステージ約1分
  chunkLength: 40,
  chunkCount: 14,
  chunkWidth: 160,
  waterWidth: 26,

  // 滑空パラメータ
  startAlt: 130,          // 開始高度（かなり上空）
  waterLevel: 0,
  crashAlt: 2.5,          // これより低いと水没
  floatY: 0.4,            // 時間切れで着水したときの浮かぶ高さ
  landDescent: 1.8,       // 着水までの降下時間（秒）
  landReact: 3.4,         // 着水後のリアクション時間（秒）
  pitchMax: 0.65,         // 最大ピッチ（ラジアン）
  pitchSpeed: 1.2,        // ピッチ変更速度
  baseSpeed: 28,          // 水平速度（m/s 相当）
  airFactor: 22,          // ピッチによる速度変化
  baseSink: 0.45,         // 基本降下速度
  glideFactor: 0.02,      // 速度に応じた降下
  climbFactor: 0.4,       // ピッチアップ時の上昇効果
  maxClimb: 3.0,          // 最大上昇速度（多少の上昇のみ）
  maxSink: 14.0,          // 最大降下速度
  bankSpeed: 12,          // 左右旋回速度
};

// フライトルートの横揺れ（蛇行）
function routeCurve(z) {
  return Math.sin(z * 0.03) * 10 + Math.sin(z * 0.07) * 3;
}

// 地形の起伏（チャンク境界で継ぎ目が出ないよう座標だけで決まる関数）
function terrainHeight(baseX, worldZ, side) {
  const shore = GAME.waterWidth / 2;
  const d = side === 'center' ? Math.abs(baseX) - shore : baseX - shore;
  if (d < 4) return 0;
  const k = Math.min(1, (d - 4) / 12);
  const hills = (d - 4) * 0.09 * (0.6 + 0.4 * Math.sin(worldZ * 0.045 + baseX * 0.08));
  const bumps = Math.sin(baseX * 0.31 + worldZ * 0.05) * Math.sin(worldZ * 0.21 - baseX * 0.13) * 1.4;
  return Math.max(0, hills + bumps * k);
}

function terrainTint(baseX, worldZ) {
  return 0.5 + 0.5 * Math.sin(baseX * 0.17 + worldZ * 0.11) * Math.cos(worldZ * 0.07 - baseX * 0.05);
}

// ============================================================
//  共有リソース
// ============================================================
function makeCanvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TEX = {
  glow: makeCanvasTexture(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }),
  star: makeCanvasTexture(64, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? c : c * 0.28;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }),
  shadow: makeCanvasTexture(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.6)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }),
};

const GEO = {
  trunk: new THREE.CylinderGeometry(0.25, 0.45, 2.4, 6),
  cone: new THREE.ConeGeometry(2.0, 4.6, 7),
  cone2: new THREE.ConeGeometry(1.5, 3.2, 7),
  round: new THREE.IcosahedronGeometry(2.0, 0),
  rock: new THREE.DodecahedronGeometry(1, 0),
  house: new THREE.BoxGeometry(3, 2.2, 3.6),
  roof: new THREE.ConeGeometry(2.9, 1.8, 4).rotateY(Math.PI / 4),
  hull: new THREE.BoxGeometry(1.4, 0.6, 3.6),
  sail: new THREE.ConeGeometry(1.1, 3.4, 3),
  puff: new THREE.IcosahedronGeometry(1, 1),
  torus: new THREE.TorusGeometry(2.6, 0.3, 14, 56),
  torusOuter: new THREE.TorusGeometry(3.1, 0.07, 6, 56),
  stud: new THREE.SphereGeometry(0.38, 10, 8),
  disc: new THREE.CircleGeometry(2.45, 40),
  speedLine: new THREE.BoxGeometry(0.03, 0.03, 5),
  ring: new THREE.RingGeometry(2.3, 2.9, 48),
};

const matCache = new Map();
function lambert(hex, opts = {}) {
  const key = hex + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...opts }));
  }
  return matCache.get(key);
}

const waterMatCache = new Map();
function waterMaterial(cfg) {
  if (!waterMatCache.has(cfg.waterColor)) {
    waterMatCache.set(cfg.waterColor, new THREE.MeshPhongMaterial({
      color: cfg.waterColor,
      specular: 0xbfd8e8,
      shininess: 90,
      flatShading: true,
    }));
  }
  return waterMatCache.get(cfg.waterColor);
}

const landMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// ============================================================
//  入力
// ============================================================
class Input {
  constructor() {
    this.keys = {};
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;   // 名前入力中はゲーム操作にしない
      this.keys[e.code] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }
  up()    { return this.keys['ArrowUp']    || this.keys['KeyW']; }
  down()  { return this.keys['ArrowDown']  || this.keys['KeyS']; }
  left()  { return this.keys['ArrowLeft']  || this.keys['KeyA']; }
  right() { return this.keys['ArrowRight'] || this.keys['KeyD']; }
}

// ============================================================
//  効果音
// ============================================================
class Sound {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 短い音を順番に鳴らす
  playNotes(notes, type = 'triangle', vol = 0.16) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    notes.forEach(([freq, at, len, to]) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + at);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + at + len);
      gain.gain.setValueAtTime(vol, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + len);
    });
  }

  playSplash() {
    this.playNotes([[420, 0, 0.35, 120]], 'sine', 0.2);
  }

  playReaction(kind) {
    if (kind === 'happy') {
      // 上がっていくファンファーレ
      this.playNotes([[784, 0, 0.16], [988, 0.12, 0.16], [1175, 0.24, 0.16], [1568, 0.36, 0.45]]);
    } else if (kind === 'dazed') {
      // 間の抜けた「ぽわ〜ん」
      this.playNotes([[440, 0, 0.5, 330], [392, 0.5, 0.7, 300]], 'sine', 0.18);
    } else {
      // 下がっていく「がーん」
      this.playNotes([[392, 0, 0.32, 370], [370, 0.3, 0.32, 349], [349, 0.6, 0.9, 220]], 'sawtooth', 0.07);
    }
  }

  playPass(combo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 880;
    const freq = base + Math.min(combo, 20) * 70;

    // チャリンチャリン風の音（2音を少しずらして重ねる）
    [0, 0.03].forEach((delay, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.6, t + delay + 0.18);

      const vol = idx === 0 ? 0.18 : 0.12;
      gain.gain.setValueAtTime(vol, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.35);

      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.35);
    });
  }
}

// ============================================================
//  アヒル（トゥーン調）
// ============================================================
function toonGradient() {
  const data = new Uint8Array([140, 140, 140, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

class Duck {
  constructor() {
    this.group = new THREE.Group();
    this.body = new THREE.Group();   // 操作による姿勢（ピッチ・バンク）を付ける
    this.group.add(this.body);
    // アヒルを直立姿勢で作り、前傾させてお腹を下に滑空させる
    this.model = new THREE.Group();
    this.model.rotation.x = 1.2;
    this.model.position.set(0, -0.2, 0.2);
    this.body.add(this.model);

    const grad = toonGradient();
    const toon = (color, e = 0.22) => new THREE.MeshToonMaterial({ color, gradientMap: grad, emissive: color, emissiveIntensity: e });
    const yellow = toon(0xffd43b);
    const bill   = toon(0xf9e6b0);
    const black  = new THREE.MeshBasicMaterial({ color: 0x1b1b24 });
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x2a1d10, side: THREE.BackSide });

    // 部品＋輪郭線（裏面を少し膨らませたメッシュ）
    const addPart = (geo, mat, parent, pos, scale = [1, 1, 1], rot = null, outline = 0.06) => {
      const holder = new THREE.Group();
      holder.position.set(...pos);
      if (rot) holder.rotation.set(...rot);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(...scale);
      holder.add(m);
      if (outline) {
        const o = new THREE.Mesh(geo, outlineMat);
        const ol = Array.isArray(outline) ? outline : [outline, outline, outline];
        o.scale.set(scale[0] + ol[0], scale[1] + ol[1], scale[2] + ol[2]);
        holder.add(o);
      }
      parent.add(holder);
      return holder;
    };

    const sphere = new THREE.SphereGeometry(1, 32, 24);

    // ---- 胴体：下ぶくれの洋梨型 ----
    const profile = [
      [0, -1.35], [0.5, -1.3], [0.82, -1.1], [0.97, -0.78], [1.0, -0.45],
      [0.92, -0.1], [0.78, 0.25], [0.64, 0.55], [0.5, 0.8], [0, 0.9],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const bodyGeo = new THREE.LatheGeometry(profile, 36);
    addPart(bodyGeo, yellow, this.model, [0, 0.1, 0], [1, 0.86, 0.9]);

    // しっぽ（お尻の短いとんがり）
    addPart(new THREE.ConeGeometry(0.28, 0.6, 14), yellow, this.model, [0, -0.85, -0.85], [1, 1, 1], [-Math.PI / 2 + 0.5, 0, 0], 0.08);

    // ---- 頭：体と同じくらい大きな丸 ----
    this.head = new THREE.Group();
    this.head.position.set(0, 1.3, 0.05);
    this.headBaseX = -1.05;            // 前傾を打ち消して顔を前に向ける
    // 着水後のリアクション用
    this.upright = 0;                  // 0：滑空姿勢 〜 1：水面で直立
    this.uprightCur = 0;
    this.reaction = null;              // 'happy' | 'dazed' | 'head' | null
    this.armZCur = 0;
    this.armYCur = 0;
    this.head.rotation.x = this.headBaseX;
    this.model.add(this.head);
    addPart(sphere, yellow, this.head, [0, 0, 0], [1.16, 1.04, 1.08]);

    // くちばし：顔の下半分から突き出る、幅広で平たいクリーム色
    // 上から見た輪郭（付け根から先端に向かって少し広がり、先が丸いへら形）を押し出して作る
    const billShape = new THREE.Shape();
    billShape.moveTo(-0.46, 0);
    billShape.quadraticCurveTo(-0.66, 0.25, -0.64, 0.6);
    billShape.absellipse(0, 0.6, 0.64, 0.42, Math.PI, 0, true);
    billShape.quadraticCurveTo(0.66, 0.25, 0.46, 0);
    billShape.closePath();
    const makeBillGeo = (depth, bend) => {
      const g = new THREE.ExtrudeGeometry(billShape, {
        depth, curveSegments: 32, bevelEnabled: true,
        bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 8,
      });
      g.translate(0, 0, -depth / 2);
      g.rotateX(Math.PI / 2);   // 輪郭の前方向を +z、厚みを上下方向に
      // 左右の端を下げてドーム状に反らせる（正面から見て角ばらないように）
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setY(i, pos.getY(i) - bend * x * x);
      }
      g.computeVertexNormals();
      return g;
    };
    // 上くちばし（大きく前に突き出る）と下くちばし（少し小さく内側）
    addPart(makeBillGeo(0.06, 0.2), bill, this.head, [0, -0.22, 0.6], [1, 1, 1.5], [-0.08, 0, 0], [0.06, 0.35, 0.05]);
    addPart(makeBillGeo(0.0, 0.16), bill, this.head, [0, -0.36, 0.55], [0.8, 0.6, 1.27], [0.02, 0, 0], [0.04, 0.2, 0.04]);
    // 鼻の穴
    [-1, 1].forEach(s => {
      addPart(sphere, black, this.head, [0.15 * s, -0.035, 1.24], [0.045, 0.022, 0.06], [-0.08, 0, 0], 0);
    });

    // 目：くちばしのすぐ上に寄った縦長の白目＋点のような黒目
    [-1, 1].forEach(s => {
      const dir = new THREE.Vector3(0.4 * s, 0.26, 0.88).normalize();
      const eye = new THREE.Group();
      eye.position.copy(dir).multiplyScalar(1.05);
      // 頭の上方向を保ったまま外向きに（ひねりが入らないように）
      eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
      // 横長の楕円（傾けずに真横）
      addPart(sphere, eyeWhite, eye, [0, 0, 0], [0.264, 0.18, 0.07], null, 0.04);
      addPart(sphere, black, eye, [0, 0, 0.065], [0.034, 0.036, 0.02], null, 0);
      this.head.add(eye);
    });

    // 頭のてっぺんの波打つ3本毛（真ん中が一番長い）
    const hairMat = new THREE.MeshBasicMaterial({ color: 0x1b1b24 });
    [-1, 0, 1].forEach(k => {
      const h = k === 0 ? 1.1 : 1;
      const pts = [
        [k * 0.08, 0.95, -0.02],
        [k * 0.11, 0.95 + 0.25 * h, -0.03],
        [k * 0.16, 0.95 + 0.46 * h, -0.04],
        [k * 0.24, 0.95 + 0.575 * h, -0.05],
      ].map(p => new THREE.Vector3(...p));
      const curve = new THREE.CatmullRomCurve3(pts);
      this.head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.035, 6), hairMat));
    });

    // ---- 腕：手首のない横長のヒレ。先が3つに分かれる（左右に広げて滑空）----
    const makeArm = (s) => {
      const arm = new THREE.Group();
      arm.position.set(0.72 * s, 0.4, 0.02);
      // 付け根から先へ平たくなりながら横に伸びるヒレ本体
      addPart(sphere, yellow, arm, [0.45 * s, 0, 0], [0.6, 0.27, 0.17], null, 0.045);
      // 先端の3つに分かれたヒレ（扇状に少し広がる）
      [-1, 0, 1].forEach(k => {
        addPart(sphere, yellow, arm,
          [(0.98 - Math.abs(k) * 0.08) * s, k * 0.16, 0],
          [0.22, 0.1, 0.1], [0, 0, k * 0.3 * s], 0.04);
      });
      this.model.add(arm);
      return arm;
    };
    this.lWing = makeArm(-1);
    this.rWing = makeArm(1);
    this.lTip = new THREE.Vector3(-1.15, 0, 0);
    this.rTip = new THREE.Vector3(1.15, 0, 0);

    // ---- 足：胴体に直接付いた平たい水かき。先が3つに分かれる（飛行中は後ろへ垂らす）----
    [-1, 1].forEach(s => {
      addPart(sphere, bill, this.model, [0.5 * s, -1.22, 0.05], [0.34, 0.36, 0.075], [0, 0, 0.06 * s], 0.045);
      [-1, 0, 1].forEach(t => {
        addPart(sphere, bill, this.model,
          [0.5 * s + t * 0.21, -1.52 - (t === 0 ? 0.06 : 0) + Math.abs(t) * 0.04, 0.05],
          [0.14, 0.19, 0.065], [0, 0, t * 0.4], 0.04);
      });
    });
  }

  update(dt, pitch, bank, speed, flap = 0) {
    const lerp = THREE.MathUtils.lerp;
    const k = Math.min(1, dt * 8);
    // ピッチとバンク（移動方向に合わせて傾ける）
    this.body.rotation.x = pitch;
    this.body.rotation.z = lerp(this.body.rotation.z, -bank * 0.4, k);
    this.body.rotation.y = lerp(this.body.rotation.y, bank * 0.15, k);

    // 滑空姿勢 ⇔ 水面で直立した姿勢
    this.uprightCur = lerp(this.uprightCur, this.upright, Math.min(1, dt * 4));
    const u = this.uprightCur;
    this.model.rotation.x = lerp(1.2, 0.06, u);
    const headBase = lerp(this.headBaseX, 0, u);

    const t = performance.now() * 0.001;
    // 滑空中の腕は微かな揺れのみ。flap が大きいときはパタパタ羽ばたく（上昇中）
    this.flapPhase = (this.flapPhase || 0) + dt * (9 + flap * 14);
    const w = (Math.sin(t * 3 + speed * 0.1) * 0.06 + Math.sin(this.flapPhase) * flap) * (1 - u);

    // リアクション（腕の上げ下げ・頭の動き・跳ね）
    let armZ = 0;      // 腕を上げる角度
    let armY = 0;      // 腕を前へ回す角度
    let headZ = Math.sin(t * 2.1) * 0.08;
    let headX = headBase + Math.sin(t * 1.3) * 0.05;
    let hop = 0;
    if (this.reaction === 'happy') {
      // 腕を斜め45度下に広げて、ぴょんぴょんジャンプ
      armZ = -0.78 + Math.sin(t * 10) * 0.06;
      hop = Math.abs(Math.sin(t * 5)) * 1.1;
      headZ = Math.sin(t * 5) * 0.06;
      headX = headBase - 0.08;
    } else if (this.reaction === 'dazed') {
      // 腕をだらんと下げ、頭をゆっくりフラフラ
      armZ = -0.85;
      headZ = Math.sin(t * 0.9) * 0.28;
      headX = headBase + 0.1 + Math.sin(t * 0.7) * 0.06;
    } else if (this.reaction === 'head') {
      // 両腕を前へ回して頭の横を抱え、小刻みに震える
      armZ = 0.85 + Math.sin(t * 30) * 0.03;
      armY = 0.75;
      headZ = Math.sin(t * 22) * 0.05;
      headX = headBase + 0.12;
    }
    this.armZCur = lerp(this.armZCur, armZ, Math.min(1, dt * 7));
    this.armYCur = lerp(this.armYCur, armY, Math.min(1, dt * 7));
    this.lWing.rotation.z = -this.armZCur;
    this.rWing.rotation.z = this.armZCur;
    this.lWing.rotation.y = w + this.armYCur;
    this.rWing.rotation.y = -w - this.armYCur;
    this.model.position.y = -0.2 + hop;

    this.head.rotation.z = headZ;
    this.head.rotation.x = headX;
  }

  wingTip(side, target) {
    target.copy(side < 0 ? this.lTip : this.rTip);
    (side < 0 ? this.lWing : this.rWing).localToWorld(target);
    return target;
  }
}

// ============================================================
//  地形チャンク
// ============================================================
class Chunk {
  constructor(scene, length, width) {
    this.scene = scene;
    this.length = length;
    this.width = width;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.owned = [];
    this.water = null;
  }

  // posZ: 現在の表示位置 / routeZ: ルート上の通算距離（蛇行・起伏はこちらで計算し、隣のチャンクと継ぎ目なく繋げる）
  reset(stageIdx, posZ, routeZ = posZ) {
    const cfg = STAGE_CONFIG[stageIdx];
    this.stageIdx = stageIdx;
    this.group.position.set(0, 0, posZ);
    this.routeZ = routeZ;
    const z = routeZ;

    // ルートの蛇行による横シフト
    const cx = routeCurve(z);

    this.items.forEach(m => this.group.remove(m));
    this.owned.forEach(g => g.dispose());
    this.items = [];
    this.owned = [];

    // 水（ルートに沿って曲げる・波打たせる）
    const waterGeo = new THREE.PlaneGeometry(this.width, this.length, 20, 10);
    this.applyRouteCurve(waterGeo, z);
    this.waterBase = Float32Array.from(waterGeo.attributes.position.array);
    const water = new THREE.Mesh(waterGeo, waterMaterial(cfg));
    water.rotation.x = -Math.PI / 2;
    water.position.y = GAME.waterLevel - 0.3;
    this.addItem(water, waterGeo);
    this.water = water;

    // 地面（ルートに沿って曲げる・起伏と砂浜を付ける）
    const sideW = (this.width - GAME.waterWidth) / 2;
    const landX = (GAME.waterWidth + sideW) / 2;
    if (cfg.waterSide === 'center') {
      this.addLand(cfg, z, -landX, sideW);
    }
    this.addLand(cfg, z, landX, sideW);

    this.addDecorations(cfg, z);
  }

  addItem(mesh, ownedGeo) {
    this.group.add(mesh);
    this.items.push(mesh);
    if (ownedGeo) this.owned.push(ownedGeo);
  }

  addLand(cfg, z, xCenter, w) {
    const geo = new THREE.PlaneGeometry(w, this.length, 28, 10);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(cfg.groundColor);
    const c2 = new THREE.Color(cfg.groundColor2);
    const sand = new THREE.Color(cfg.sandColor);
    const col = new THREE.Color();
    const shore = GAME.waterWidth / 2;

    for (let i = 0; i < pos.count; i++) {
      const baseX = pos.getX(i) + xCenter;
      const worldZ = z - pos.getY(i);
      pos.setX(i, baseX + routeCurve(worldZ));
      pos.setZ(i, terrainHeight(baseX, worldZ, cfg.waterSide));

      const d = Math.abs(baseX) - shore;
      col.copy(c1).lerp(c2, terrainTint(baseX, worldZ));
      if (d < 3.5) col.copy(sand);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const land = new THREE.Mesh(geo, landMat);
    land.rotation.x = -Math.PI / 2;
    this.addItem(land, geo);
  }

  // 平面上の各行（z方向）をルート曲線に合わせて横にシフトする
  applyRouteCurve(geometry, z, xOffset = 0) {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const localY = pos.getY(i);
      const worldZ = z - localY;
      const cx = routeCurve(worldZ);
      pos.setX(i, pos.getX(i) + cx + xOffset);
    }
    pos.needsUpdate = true;
  }

  updateWater(t) {
    if (!this.water) return;
    const pos = this.water.geometry.attributes.position;
    const base = this.waterBase;
    const gz = this.group.position.z;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const wz = gz - base[i * 3 + 1];
      pos.array[i * 3 + 2] = Math.sin(x * 0.35 + t * 1.6) * 0.18 + Math.sin(wz * 0.25 - t * 1.2) * 0.22;
    }
    pos.needsUpdate = true;
  }

  addDecorations(cfg, z) {
    const shore = GAME.waterWidth / 2;
    const maxD = this.width / 2 - 4;
    const count = 10 + Math.floor(Math.random() * 8);

    for (let i = 0; i < count; i++) {
      const localZ = (Math.random() - 0.5) * this.length * 0.9;
      const worldZ = z + localZ;
      const side = cfg.waterSide === 'center' && Math.random() < 0.5 ? -1 : 1;
      // 岸の近くに多めに配置
      const d = shore + 5 + Math.pow(Math.random(), 1.6) * (maxD - shore - 5);
      const baseX = side * d;
      const x = baseX + routeCurve(worldZ);
      const y = terrainHeight(baseX, worldZ, cfg.waterSide);
      const s = 0.8 + Math.random() * 0.7;
      const type = Math.random();

      let obj;
      if (type < 0.36) {
        // 針葉樹（2段）
        obj = new THREE.Group();
        const trunk = new THREE.Mesh(GEO.trunk, lambert(0x8b5a2b));
        trunk.position.y = 1.2;
        const leafMat = lambert(cfg.leafColors[0]);
        const l1 = new THREE.Mesh(GEO.cone, leafMat);
        l1.position.y = 3.6;
        const l2 = new THREE.Mesh(GEO.cone2, leafMat);
        l2.position.y = 5.4;
        obj.add(trunk, l1, l2);
      } else if (type < 0.66) {
        // 広葉樹
        obj = new THREE.Group();
        const trunk = new THREE.Mesh(GEO.trunk, lambert(0x8b5a2b));
        trunk.position.y = 1.2;
        const leaf = new THREE.Mesh(GEO.round, lambert(cfg.leafColors[Math.floor(Math.random() * cfg.leafColors.length)]));
        leaf.position.y = 3.6;
        leaf.rotation.set(Math.random(), Math.random(), 0);
        obj.add(trunk, leaf);
      } else if (type < 0.82) {
        obj = new THREE.Mesh(GEO.rock, lambert(0x9a9a9a));
        obj.scale.set(1 + Math.random(), 0.7 + Math.random() * 0.6, 1 + Math.random());
        obj.rotation.set(Math.random(), Math.random(), Math.random());
      } else {
        // 小さな家
        obj = new THREE.Group();
        const wallColors = [0xfff4e0, 0xf6d6b8, 0xdfe9f5];
        const roofColors = [0xd9534f, 0x3b6ea5, 0x5aa55a, 0xe08a2c];
        const house = new THREE.Mesh(GEO.house, lambert(wallColors[Math.floor(Math.random() * wallColors.length)]));
        house.position.y = 1.1;
        const roof = new THREE.Mesh(GEO.roof, lambert(roofColors[Math.floor(Math.random() * roofColors.length)]));
        roof.position.y = 3.1;
        roof.scale.set(1, 1, 1.24);
        obj.add(house, roof);
        obj.rotation.y = Math.random() * Math.PI;
      }
      obj.position.set(x, y, localZ);
      if (type < 0.66) obj.scale.setScalar(s);
      this.addItem(obj);
    }

    // ボート
    if (Math.random() < 0.4) {
      const localZ = (Math.random() - 0.5) * this.length * 0.8;
      const worldZ = z + localZ;
      const baseX = cfg.waterSide === 'center'
        ? (Math.random() - 0.5) * (GAME.waterWidth - 8)
        : -(6 + Math.random() * 50);
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(GEO.hull, lambert([0xffffff, 0xd9534f, 0x3b6ea5][Math.floor(Math.random() * 3)]));
      hull.position.y = 0.1;
      const sail = new THREE.Mesh(GEO.sail, lambert(0xfffaf0));
      sail.position.set(0, 2.1, 0.2);
      sail.scale.set(1, 1, 0.12);
      boat.add(hull, sail);
      boat.position.set(baseX + routeCurve(worldZ), 0, localZ);
      boat.rotation.y = (Math.random() - 0.5) * 0.8;
      boat.userData.bob = Math.random() * 10;
      this.addItem(boat);
      this.boat = boat;
    } else {
      this.boat = null;
    }
  }

  move(ds) {
    this.group.position.z -= ds;
  }

  isBehind() {
    return this.group.position.z < -this.length - 30;
  }
}

// ============================================================
//  雲
// ============================================================
class CloudField {
  constructor(scene) {
    this.mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5,
      flatShading: true, transparent: true, opacity: 0.45, depthWrite: false,
    });
    this.clouds = [];
    for (let i = 0; i < 46; i++) {
      const c = new THREE.Group();
      const n = 4 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(GEO.puff, this.mat);
        const r = 2 + Math.random() * 2.8;
        puff.scale.set(r, r * 0.8, r);
        puff.position.set((k - n / 2) * 2.6 + Math.random(), Math.random() * 1.5 - (k === 0 || k === n - 1 ? 0.8 : 0), (Math.random() - 0.5) * 3);
        c.add(puff);
      }
      this.place(c, true);
      scene.add(c);
      this.clouds.push(c);
    }
  }

  place(c, initial) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = Math.random() < 0.15 ? (Math.random() - 0.5) * 20 : side * (14 + Math.random() * 150);
    c.position.set(x, 30 + Math.random() * 160, initial ? Math.random() * 760 - 40 : 620 + Math.random() * 160);
    c.scale.setScalar(1 + Math.random() * 1.8);
    c.rotation.y = Math.random() * Math.PI;
  }

  setColor(hex) {
    this.mat.color.setHex(hex);
    this.mat.emissive.setHex(hex);
  }

  update(dt, speed) {
    const ds = speed * dt;
    this.clouds.forEach(c => {
      c.position.z -= ds;
      if (c.position.z < -60) this.place(c, false);
    });
  }
}

// ============================================================
//  空（グラデーション＋太陽）
// ============================================================
class Sky {
  constructor(scene) {
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      bottomColor: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 0.5, 1).normalize() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor, horizonColor, bottomColor, sunColor, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0
            ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
            : mix(horizonColor, bottomColor, pow(clamp(-h, 0.0, 1.0), 0.35));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (smoothstep(0.9985, 0.9993, s) * 1.6 + pow(s, 64.0) * 0.5 + pow(s, 6.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), mat);
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  set(cfg) {
    this.uniforms.topColor.value.setHex(cfg.skyTop);
    this.uniforms.horizonColor.value.setHex(cfg.skyHorizon);
    this.uniforms.bottomColor.value.setHex(cfg.skyHorizon);
    this.uniforms.sunColor.value.setHex(cfg.sunColor);
    this.uniforms.sunDir.value.set(...cfg.sunDir).normalize();
  }
}

// ============================================================
//  輪（フープ）
// ============================================================
class HoopManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 16; i++) this.pool.push(this.createHoop());
  }

  createHoop() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff69b4,
      emissive: 0xaa0044,
      emissiveIntensity: 0.5,
      metalness: 0.25,
      roughness: 0.25,
      transparent: true,
      opacity: 1,
    });
    // 画面正面（+z方向）を向いて円として見える輪
    const torus = new THREE.Mesh(GEO.torus, mat);
    group.add(torus);

    const outerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const outer = new THREE.Mesh(GEO.torusOuter, outerMat);
    group.add(outer);

    // 回転する飾り玉
    const studMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const studs = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const st = new THREE.Mesh(GEO.stud, studMat);
      st.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
      studs.add(st);
    }
    group.add(studs);

    // 内側の薄い膜（くぐる目標がわかりやすいように）
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
    });
    group.add(new THREE.Mesh(GEO.disc, discMat));

    // 発光ハロー
    const haloMat = new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff69b4, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(10, 10, 1);
    group.add(halo);

    group.userData = {
      evaluated: false, popping: false, popTimer: 0,
      mat, outerMat, studMat, discMat, haloMat, halo, studs,
      color: new THREE.Color(), phase: 0,
    };
    group.visible = false;
    this.scene.add(group);
    return group;
  }

  spawn(duckY, stageIdx, speed) {
    const available = this.pool.filter(h => !this.active.includes(h));
    if (available.length === 0) return;

    const side = STAGE_CONFIG[stageIdx].waterSide;
    const isChain = Math.random() < 0.55;
    const count = isChain ? 3 + Math.floor(Math.random() * 8) : 1; // 3〜10連続 or 1個
    if (available.length < count) return;

    // 連続して潜れるように、降下する軌道上に一直線に並べる
    const spacing = 26 + Math.random() * 8;
    const startZ = 150 + Math.random() * 40;

    // 到達時の予測高度より下に生成し、上昇しなくても取れるようにする
    const travelTime = startZ / Math.max(8, speed);
    const predictedY = duckY - travelTime * 1.2;
    const startY = Math.max(GAME.crashAlt + 5, predictedY - 4 - Math.random() * 5);

    let x = (Math.random() - 0.5) * 12;
    if (side !== 'center') {
      x = -2 + (Math.random() - 0.5) * 10;
    }

    const hue = Math.random();
    for (let i = 0; i < count; i++) {
      const hoop = available[i];
      const z = startZ + i * spacing;
      // だんだん下に降りる軌道（上昇は不要）
      const y = Math.max(GAME.crashAlt + 4, startY - i * (1.2 + Math.random() * 1.5));
      x += (Math.random() - 0.5) * 3;
      x = THREE.MathUtils.clamp(x, -11, 11);

      hoop.position.set(x, y, z);
      hoop.scale.set(1, 1, 1);

      // 連続する輪は虹色に少しずつ色を変える
      const u = hoop.userData;
      u.color.setHSL((hue + i * 0.07) % 1, 0.9, 0.62);
      u.mat.color.copy(u.color);
      u.mat.emissive.copy(u.color).multiplyScalar(0.55);
      u.haloMat.color.copy(u.color);
      u.discMat.color.copy(u.color);
      u.phase = i * 0.5;

      u.mat.opacity = 1;
      u.outerMat.opacity = 0.5;
      u.studMat.opacity = 1;
      u.discMat.opacity = 0.12;
      u.haloMat.opacity = 0.55;
      u.popping = false;
      u.popTimer = 0;
      u.evaluated = false;
      hoop.visible = true;
      this.active.push(hoop);
    }
  }

  update(dt, speed, duckX, duckY, onPass, onMiss) {
    const ds = speed * dt;
    const t = performance.now() * 0.001;

    // 次にくぐる輪を強調
    let next = null;
    this.active.forEach(h => {
      if (!h.userData.evaluated && h.position.z > 0 && (!next || h.position.z < next.position.z)) next = h;
    });

    for (let i = this.active.length - 1; i >= 0; i--) {
      const h = this.active[i];
      const u = h.userData;
      h.position.z -= ds;
      // 輪は画面正面を向いたまま（回転させずに近づく）
      h.rotation.set(0, 0, 0);
      u.studs.rotation.z += dt * 1.5;

      if (!u.popping) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5 + u.phase);
        const isNext = h === next;
        u.mat.emissiveIntensity = isNext ? 0.9 + pulse * 0.6 : 0.45;
        const hs = isNext ? 11 + pulse * 3 : 8;
        u.halo.scale.set(hs, hs, 1);
        u.haloMat.opacity = isNext ? 0.75 : 0.4;
        u.discMat.opacity = isNext ? 0.14 + pulse * 0.1 : 0.08;
      }

      if (!u.evaluated && h.position.z < 0) {
        const dx = h.position.x - duckX;
        const dy = h.position.y - duckY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        u.evaluated = true;
        if (dist < 2.6) {
          onPass(h);
          u.popping = true;
          u.popTimer = 0.28;
        } else {
          onMiss(h);
        }
      }

      // くぐった輪は弾けるように拡大＆フェードアウト
      if (u.popping) {
        u.popTimer -= dt;
        const progress = Math.min(1, 1 - u.popTimer / 0.28);
        const s = 1 + progress * 0.9;
        h.scale.set(s, s, s);
        const f = Math.max(0, 1 - progress);
        u.mat.opacity = f;
        u.outerMat.opacity = 0.5 * f;
        u.studMat.opacity = f;
        u.discMat.opacity = 0.3 * f;
        u.haloMat.opacity = f;
        if (u.popTimer <= 0) {
          h.visible = false;
          u.popping = false;
          this.active.splice(i, 1);
          continue;
        }
      }

      if (h.position.z < -10) {
        h.visible = false;
        this.active.splice(i, 1);
      }
    }
  }

  clear() {
    this.active.forEach(h => { h.visible = false; });
    this.active = [];
  }
}

// ============================================================
//  パーティクル
// ============================================================
class Particles {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.rings = [];
    this.matCache = new Map();
  }

  spriteMat(hex) {
    if (!this.matCache.has(hex)) {
      this.matCache.set(hex, new THREE.SpriteMaterial({
        map: TEX.star, color: hex, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    }
    return this.matCache.get(hex);
  }

  burst(x, y, z, color, ring = true) {
    const colors = [0xffd23f, 0xffffff, 0x7fe9ff, color ? color.getHex() : 0xff69b4];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Sprite(this.spriteMat(colors[Math.floor(Math.random() * colors.length)]));
      m.position.set(x, y, z);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const s = 4 + Math.random() * 7;
      const size = 0.5 + Math.random() * 0.9;
      m.scale.set(size, size, 1);
      m.userData = {
        vx: Math.sin(phi) * Math.cos(theta) * s,
        vy: Math.sin(phi) * Math.sin(theta) * s,
        vz: Math.cos(phi) * s,
        g: 0, drag: 2.2, size, spin: (Math.random() - 0.5) * 8,
        life: 1.0, decay: 1.3 + Math.random() * 0.5,
      };
      this.scene.add(m);
      this.items.push(m);
    }
    if (ring) this.ring(x, y, z, color || new THREE.Color(0xffffff));
  }

  splash(x, y, z) {
    for (let i = 0; i < 50; i++) {
      const m = new THREE.Sprite(this.spriteMat(Math.random() < 0.6 ? 0xffffff : 0x8fdcff));
      m.position.set(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5));
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      const size = 0.6 + Math.random() * 0.8;
      m.scale.set(size, size, 1);
      m.userData = {
        vx: Math.cos(a) * r, vy: 6 + Math.random() * 10, vz: Math.sin(a) * r,
        g: 22, drag: 0.4, size, spin: 0, life: 1.0, decay: 0.7 + Math.random() * 0.4,
      };
      this.scene.add(m);
      this.items.push(m);
    }
  }

  ring(x, y, z, color) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(GEO.ring, mat);
    m.position.set(x, y, z);
    m.userData.life = 1;
    this.scene.add(m);
    this.rings.push(m);
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      const u = p.userData;
      u.life -= dt * u.decay;
      const k = Math.max(0, 1 - u.drag * dt);
      u.vx *= k; u.vy *= k; u.vz *= k;
      u.vy -= u.g * dt;
      p.position.x += u.vx * dt;
      p.position.y += u.vy * dt;
      p.position.z += u.vz * dt;
      p.material.rotation += u.spin * dt;
      const s = u.size * Math.max(0, u.life);
      p.scale.set(s, s, 1);
      if (u.life <= 0) {
        this.scene.remove(p);
        this.items.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.userData.life -= dt * 2.2;
      const p = 1 - r.userData.life;
      const s = 1 + p * 1.4;
      r.scale.set(s, s, s);
      r.material.opacity = Math.max(0, r.userData.life) * 0.6;
      if (r.userData.life <= 0) {
        this.scene.remove(r);
        r.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}

// ============================================================
//  翼端の飛行機雲
// ============================================================
class Trail {
  constructor(scene, n = 16) {
    this.n = n;
    this.points = [];
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(n * 2 * 3);
    this.colors = new Float32Array(n * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(head, ds, intensity) {
    this.points.forEach(p => { p.z -= ds; });
    this.points.unshift(head.clone());
    if (this.points.length > this.n) this.points.pop();

    for (let i = 0; i < this.n; i++) {
      const p = this.points[Math.min(i, this.points.length - 1)];
      const f = 1 - i / this.n;
      const w = 0.09 * f + 0.02;
      const o = i * 6;
      this.positions[o] = p.x;     this.positions[o + 1] = p.y + w; this.positions[o + 2] = p.z;
      this.positions[o + 3] = p.x; this.positions[o + 4] = p.y - w; this.positions[o + 5] = p.z;
      const c = f * f * intensity * 0.8;
      for (let k = 0; k < 6; k++) this.colors[o + k] = c;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  reset() {
    this.points = [];
  }
}

// ============================================================
//  スピード線
// ============================================================
class SpeedLines {
  constructor(scene) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.lines = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(GEO.speedLine, this.mat);
      this.lines.push(m);
      scene.add(m);
    }
    this.cx = 0;
    this.cy = 0;
  }

  respawn(m, initial) {
    let dx, dy;
    do {
      dx = (Math.random() - 0.5) * 34;
      dy = (Math.random() - 0.5) * 22 + 4;
    } while (Math.abs(dx) < 7 && Math.abs(dy - 2) < 6);
    m.position.set(this.cx + dx, this.cy + dy, initial ? Math.random() * 90 : 70 + Math.random() * 30);
  }

  update(dt, speed, cx, cy) {
    this.cx = cx;
    this.cy = cy;
    this.lines.forEach(m => {
      if (m.position.z === 0 && m.position.x === 0) this.respawn(m, true);
      m.position.z -= speed * 1.8 * dt;
      if (m.position.z < -8 || Math.abs(m.position.y - cy) > 16) this.respawn(m, false);
    });
    const target = THREE.MathUtils.clamp((speed - 24) / 24, 0, 1) * 0.35;
    this.mat.opacity = THREE.MathUtils.lerp(this.mat.opacity, target, Math.min(1, dt * 4));
  }
}

// ============================================================
//  メインゲーム
// ============================================================
class Game {
  constructor() {
    this.input = new Input();
    this.sound = new Sound();
    this.setupRenderer();
    this.setupLights();
    this.sky = new Sky(this.scene);
    this.duck = new Duck();
    this.scene.add(this.duck.group);
    this.createShadow();
    this.createBasePlanes();

    this.chunks = [];
    for (let i = 0; i < GAME.chunkCount; i++) {
      this.chunks.push(new Chunk(this.scene, GAME.chunkLength, GAME.chunkWidth));
    }

    this.clouds = new CloudField(this.scene);
    this.hoops = new HoopManager(this.scene);
    this.particles = new Particles(this.scene);
    this.trails = [new Trail(this.scene), new Trail(this.scene)];
    this.speedLines = new SpeedLines(this.scene);
    this.tmpVec = new THREE.Vector3();

    this.score = 0;
    this.combo = 0;
    this.stageIdx = 0;
    this.stageTimer = GAME.stageDuration;
    this.speed = GAME.baseSpeed;
    this.duckY = GAME.startAlt;
    this.duckX = 0;
    this.pitch = 0;     //  nose down positive
    this.bank = 0;
    this.state = 'start';
    this.lastTime = performance.now();
    this.introTimer = 0;
    this.shake = 0;
    this.lastCombo = 0;
    this.flap = 0;
    this.hoopsPassed = 0;
    this.maxCombo = 0;
    this.stagePassed = 0;
    this.stageMissed = 0;
    this.landT = 0;

    // リザルト用（キャプチャ・スコア画像）
    this.lastResult = null;
    this.captureReq = false;
    this.cardPending = false;
    this.lastCapture = null;
    this.cardBlob = null;
    this.cardURL = null;
    this.toastTimer = 0;
    this.memRank = [];
    this.rankFrom = 'title';
    this.paused = false;

    this.bindUI();
    this.createLabels();
    this.applyStage(0);
    this.chunks.forEach((c, i) => c.reset(0, i * GAME.chunkLength - 80));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupRenderer() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(STAGE_CONFIG[0].skyHorizon, 120, 560);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 3000);
    this.camera.position.set(0, GAME.startAlt + 8, -18);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xdff2ff, 0x4a6a3a, 0.95);
    this.scene.add(this.hemi);
    // 太陽（前方から）
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.scene.add(this.sun);
    // 後方からの補助光（カメラ側のアヒルの背中が暗くならないように）
    this.fill = new THREE.DirectionalLight(0xfff0d8, 0.75);
    this.fill.position.set(-20, 60, -80);
    this.scene.add(this.fill);
  }

  createShadow() {
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.shadow,
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.4), mat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, 0.08, 0);
    this.shadow.renderOrder = 1;
    this.scene.add(this.shadow);
  }

  // チャンクの外側を埋める広い地面・水面（細い帯が浮いて見えないように）
  createBasePlanes() {
    const geo = new THREE.PlaneGeometry(4000, 4000);
    this.baseLand = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x5c9e40 }));
    this.baseLand.rotation.x = -Math.PI / 2;
    this.baseWater = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x3d8ea8, specular: 0x666666, shininess: 60 }));
    this.baseWater.rotation.x = -Math.PI / 2;
    this.baseWater.position.y = -0.8;
    this.scene.add(this.baseLand, this.baseWater);
  }

  applyStage(idx) {
    const cfg = STAGE_CONFIG[idx];
    this.sky.set(cfg);
    this.scene.fog.color.setHex(cfg.skyHorizon);
    this.renderer.setClearColor(cfg.skyHorizon);
    this.scene.background = null;

    this.sun.color.setHex(cfg.lightColor);
    this.sun.position.set(...cfg.sunDir).multiplyScalar(100);
    this.hemi.color.setHex(cfg.skyTop).lerp(new THREE.Color(0xffffff), 0.7);
    this.hemi.groundColor.setHex(cfg.groundColor2).multiplyScalar(0.7);
    this.clouds.setColor(cfg.cloudColor);

    this.baseLand.material.color.setHex(cfg.groundColor2);
    this.baseWater.material.color.setHex(cfg.waterColor);
    // 広い地面と水面は重ならないように配置（遠景のちらつき防止）
    const edge = GAME.chunkWidth / 2 - 14;
    if (cfg.waterSide === 'center') {
      this.baseLand.position.set(0, -0.6, 0);
      this.baseWater.visible = false;
    } else {
      // 右側だけが陸地、左側は広い水面
      this.baseLand.position.set(2000 + edge, -0.6, 0);
      this.baseWater.position.set(-2000 + edge, -0.8, 0);
      this.baseWater.visible = true;
    }
  }

  bindUI() {
    this.elScore = document.getElementById('scoreTop');
    this.elCombo = document.getElementById('comboNumber');
    this.elComboBox = document.getElementById('comboDisplay');
    this.elStage = document.getElementById('stageBottom');
    this.elStageNum = document.getElementById('stageNum');
    this.elTime = document.getElementById('timeTop');
    this.elAltBar = document.getElementById('altBar');
    this.elAltMarker = document.getElementById('altMarker');
    this.elFlash = document.getElementById('flash');
    this.elPopups = document.getElementById('popups');
    this.overlay = document.getElementById('overlay');
    this.stageOverlay = document.getElementById('stageOverlay');
    this.stageTitle = document.getElementById('stageTitle');
    this.stageDesc = document.getElementById('stageDesc');

    const $ = (id) => document.getElementById(id);
    this.elResult = $('result');
    this.elRanking = $('ranking');
    this.elToast = $('toast');
    this.elNameIn = $('nameIn');

    $('startBtn').addEventListener('click', () => this.startGame());
    $('rankBtn').addEventListener('click', () => this.showRanking(null, 'title'));
    $('rRetry').addEventListener('click', () => this.startGame());
    $('rTitleBtn').addEventListener('click', () => this.goTitle());
    $('rRank').addEventListener('click', () => this.showRanking(this.lastResult?.id || null, 'result'));
    $('rkBack').addEventListener('click', () => {
      if (this.rankFrom === 'result') this.showScreen('result');
      else this.showScreen('title');
    });
    $('rkClear').addEventListener('click', () => {
      if (confirm('ランキングをすべて削除しますか？')) {
        this.saveRank([]);
        this.showRanking(null, this.rankFrom);
      }
    });
    $('nameOk').addEventListener('click', () => this.register());
    this.elNameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.register(); }
    });
    $('btnX').addEventListener('click', () => this.postToX());
    $('btnSave').addEventListener('click', () => this.saveCard());

    // ポーズ（Esc キー / P キー）。タブを切り替えたときも自動でポーズ
    this.elPause = $('pause');
    $('pResume').addEventListener('click', () => this.togglePause(false));
    $('pTitle').addEventListener('click', () => {
      this.togglePause(false);
      this.goTitle();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        this.togglePause();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.togglePause(true);
    });
    this.updateTitleHi();
  }

  canPause() {
    return this.state === 'playing' || this.state === 'intro' || this.state === 'landing';
  }

  togglePause(force) {
    const next = force ?? !this.paused;
    if (next && !this.canPause()) return;
    if (next === this.paused) return;
    this.paused = next;
    this.elPause.classList.toggle('hidden', !next);
    document.body.classList.toggle('paused', next);
    if (next) {
      this.input.keys = {};           // 押しっぱなしのキーを解除
      document.body.classList.remove('danger');
    }
  }

  createLabels() {
    this.duckAltLabel = document.createElement('div');
    this.duckAltLabel.className = 'alt-label';
    document.body.appendChild(this.duckAltLabel);

    this.ringAltLabel = document.createElement('div');
    this.ringAltLabel.className = 'alt-label ring';
    document.body.appendChild(this.ringAltLabel);
  }

  toScreen(pos) {
    const v = pos.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      visible: v.z < 1 && v.z > -1,
    };
  }

  updateLabels() {
    const show = this.state === 'playing' || this.state === 'intro';

    // アヒルの現在高度（画面右横にオフセット）
    const duckPos = new THREE.Vector3(this.duckX, this.duckY + 0.5, 0);
    const d = this.toScreen(duckPos);
    this.duckAltLabel.textContent = `${Math.round(this.duckY)}m`;
    this.duckAltLabel.style.left = `${d.x + 48}px`;
    this.duckAltLabel.style.top = `${d.y}px`;
    this.duckAltLabel.style.display = show && d.visible ? 'block' : 'none';

    // 最も近い輪の高度
    let nearest = null;
    let minZ = Infinity;
    this.hoops.active.forEach(h => {
      if (!h.userData.evaluated && h.position.z > -5 && h.position.z < minZ) {
        minZ = h.position.z;
        nearest = h;
      }
    });

    if (show && nearest) {
      const r = this.toScreen(nearest.position);
      this.ringAltLabel.textContent = `${Math.round(nearest.position.y)}m`;
      this.ringAltLabel.style.left = `${r.x}px`;
      this.ringAltLabel.style.top = `${r.y}px`;
      this.ringAltLabel.style.transform = 'translate(-50%, -50%)';
      this.ringAltLabel.style.display = r.visible ? 'block' : 'none';
    } else {
      this.ringAltLabel.style.display = 'none';
    }
  }

  showPopup(worldPos, html, cls = '', ms = 1000) {
    const p = this.toScreen(worldPos);
    if (!p.visible) return;
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.innerHTML = html;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    this.elPopups.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  startGame() {
    this.sound.init();
    this.showScreen(null);
    this.lastCapture = null;
    this.lastResult = null;
    this.resetGame();
    this.startStage(0);
  }

  resetGame() {
    this.score = 0;
    this.combo = 0;
    this.hoopsPassed = 0;
    this.maxCombo = 0;
    this.stageIdx = 0;
    this.duckY = GAME.startAlt;
    this.duckX = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = GAME.baseSpeed;
    this.hoops.clear();
    this.updateUI();
  }

  startStage(idx) {
    this.stageIdx = idx;
    this.stageTimer = GAME.stageDuration;
    this.duckY = GAME.startAlt;       // 各ステージで再び上空から
    this.duckX = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = GAME.baseSpeed;
    this.state = 'intro';
    this.introTimer = 2.2;
    this.stagePassed = 0;
    this.stageMissed = 0;
    this.duck.upright = 0;
    this.duck.reaction = null;

    const cfg = STAGE_CONFIG[idx];
    this.elStage.textContent = cfg.name;
    this.elStageNum.textContent = idx + 1;
    this.stageTitle.textContent = `STAGE ${idx + 1}`;
    this.stageDesc.textContent = cfg.desc;
    this.stageOverlay.classList.add('hidden');
    void this.stageOverlay.offsetWidth;   // アニメーションを再生し直す
    this.stageOverlay.classList.remove('hidden');

    this.applyStage(idx);
    this.chunks.forEach((c, i) => c.reset(idx, i * GAME.chunkLength - 80));
    this.hoops.clear();
    this.trails.forEach(t => t.reset());
  }

  updatePhysics(dt) {
    // ピッチ操作（飛行機・滑空機のように下キーで上昇、上キーで下降）
    let targetPitch = 0;
    if (this.input.up()) targetPitch += GAME.pitchMax;   // 鼻下げ → 下降
    if (this.input.down()) targetPitch -= GAME.pitchMax; // 鼻上げ → 上昇
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, dt * GAME.pitchSpeed * 3);

    // 左右バンク（旋回）— 表示に合わせて左右を入れ替え
    let targetBank = 0;
    if (this.input.left()) targetBank += 1;
    if (this.input.right()) targetBank -= 1;
    this.bank = THREE.MathUtils.lerp(this.bank, targetBank, dt * 6);

    this.duckX += this.bank * GAME.bankSpeed * dt;
    this.duckX = THREE.MathUtils.clamp(this.duckX, -12, 12);

    // 滑空速度：ピッチダウンで加速、ピッチアップで減速
    this.speed = GAME.baseSpeed + Math.sin(this.pitch) * GAME.airFactor;
    this.speed = Math.max(8, this.speed);

    // 降下速度：ピッチアップで緩やかになり、強く上げると多少上昇する
    let sink = GAME.baseSink
             + this.speed * GAME.glideFactor
             + this.speed * Math.sin(this.pitch) * GAME.climbFactor;
    sink = THREE.MathUtils.clamp(sink, -GAME.maxClimb, GAME.maxSink);
    this.duckY -= sink * dt;

    // 水没判定
    if (this.duckY <= GAME.crashAlt) {
      this.duckY = GAME.crashAlt;
      this.gameOver();
      return;
    }

    // 上昇操作中は腕をパタパタさせる（見た目だけ）
    this.flap = THREE.MathUtils.lerp(this.flap, this.input.down() ? 0.6 : 0, Math.min(1, dt * 8));
    this.updateDuckVisual(dt, this.flap);

    // カメラはアヒルの真後ろから追従（左右の逆転を防ぐため X は完全に同期）
    const t = performance.now() * 0.001;
    const camY = this.duckY + 8 + Math.sin(t * 1.5) * 0.3;
    const camZ = -14 - this.speed * 0.12;
    const k = Math.min(1, dt * 10);
    this.camera.position.set(
      this.duckX,
      THREE.MathUtils.lerp(this.camera.position.y, camY, k),
      THREE.MathUtils.lerp(this.camera.position.z, camZ, k)
    );
    this.camera.lookAt(this.duckX, this.duckY, 12);
    this.camera.rotateZ(this.bank * 0.05);
    this.applyCameraFx(dt);
  }

  updateDuckVisual(dt, flap = 0) {
    this.duck.group.position.set(this.duckX, this.duckY, 0);
    this.duck.update(dt, this.pitch, this.bank, this.speed, flap);

    // 影：高度が低いほど濃く小さく、高いほど薄く大きく
    const altRatio = THREE.MathUtils.clamp(this.duckY / GAME.startAlt, 0, 1);
    const shadowScale = 0.6 + 1.2 * (1 - altRatio);
    this.shadow.scale.set(shadowScale, shadowScale, 1);
    this.shadow.material.opacity = 0.12 + 0.6 * (1 - altRatio);
    this.shadow.position.set(this.duckX, 0.08, 0);
  }

  applyCameraFx(dt) {
    // 速度に応じて画角を広げる＋輪をくぐった時の揺れ
    const targetFov = 68 + (this.speed - GAME.baseSpeed) * 0.45;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 3));
    this.camera.updateProjectionMatrix();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
  }

  // タイトル・ゲームオーバー時：アヒルの周りをゆっくり回るカメラ
  updateIdle(dt) {
    const t = performance.now() * 0.001;
    if (this.state === 'ended') {
      // 全面クリア後は水面に浮いてリアクションを続ける
      this.duckY = GAME.floatY + Math.sin(t * 2.4) * 0.12;
      this.pitch = 0;
      this.bank = 0;
      this.speed = 0;
    } else if (this.state === 'start') {
      this.duckY = GAME.startAlt + Math.sin(t * 0.8) * 1.2;
      this.pitch = Math.sin(t * 0.6) * 0.08;
      this.bank = Math.sin(t * 0.4) * 0.5;
      this.speed = 18;
    } else {
      this.speed = 4;
    }
    this.updateDuckVisual(dt, this.state === 'gameover' ? 0 : 0.03);

    const a = t * 0.18;
    const dist = this.state === 'gameover' ? 18 : this.state === 'ended' ? 10 : 13;
    const target = new THREE.Vector3(
      this.duckX + Math.sin(a) * dist,
      this.duckY + 4 + Math.sin(t * 0.3) * 1.5,
      -Math.cos(a) * dist
    );
    this.camera.position.lerp(target, Math.min(1, dt * 2));
    this.camera.lookAt(this.duckX, this.duckY + 0.5, 0);
    this.applyCameraFx(dt);
  }

  // ステージ開始演出：上空から寄っていく
  updateIntro(dt) {
    const t = performance.now() * 0.001;
    this.duckY = GAME.startAlt;
    this.pitch = 0;
    this.bank = 0;
    this.updateDuckVisual(dt, 0.04);
    const p = 1 - Math.max(0, this.introTimer) / 2.2;
    const e = 1 - Math.pow(1 - p, 3);
    const a = (1 - e) * 1.4;
    const dist = THREE.MathUtils.lerp(9, 14 + GAME.baseSpeed * 0.12, e);
    const target = new THREE.Vector3(
      this.duckX + Math.sin(a) * dist,
      this.duckY + THREE.MathUtils.lerp(2, 8, e) + Math.sin(t * 1.5) * 0.3,
      -Math.cos(a) * dist
    );
    this.camera.position.lerp(target, Math.min(1, dt * 5));
    this.camera.lookAt(this.duckX, this.duckY, THREE.MathUtils.lerp(0, 12, e));
    this.applyCameraFx(dt);
  }

  scrollWorld(dt) {
    const ds = this.speed * dt;
    this.chunks.forEach(c => c.move(ds));
    if (this.chunks[0].isBehind()) {
      const first = this.chunks.shift();
      const last = this.chunks[this.chunks.length - 1];
      first.reset(this.stageIdx, last.group.position.z + GAME.chunkLength, last.routeZ + GAME.chunkLength);
      this.chunks.push(first);
    }
    this.clouds.update(dt, this.speed);
  }

  updateWorld(dt) {
    this.scrollWorld(dt);

    if (this.hoops.active.length < 2 && Math.random() < dt * 1.2) {
      this.hoops.spawn(this.duckY, this.stageIdx, this.speed);
    }

    this.hoops.update(dt, this.speed, this.duckX, this.duckY,
      (h) => this.onPassHoop(h),
      (h) => this.onMissHoop(h)
    );
  }

  updateEffects(dt) {
    const t = performance.now() * 0.001;
    this.chunks.forEach(c => {
      c.updateWater(t);
      if (c.boat) {
        c.boat.position.y = Math.sin(t * 1.5 + c.boat.userData.bob) * 0.15;
        c.boat.rotation.z = Math.sin(t * 1.2 + c.boat.userData.bob) * 0.06;
      }
    });

    const flying = this.state === 'playing' || this.state === 'intro' || this.state === 'start' || this.state === 'ended';
    const ds = this.speed * dt;
    const intensity = flying ? THREE.MathUtils.clamp(0.35 + (this.speed - 20) / 30, 0.2, 1) : 0;
    [-1, 1].forEach((s, i) => {
      this.duck.wingTip(s, this.tmpVec);
      this.trails[i].update(this.tmpVec, ds, intensity);
    });

    this.speedLines.update(dt, this.state === 'playing' ? this.speed : 0, this.duckX, this.duckY);
    this.particles.update(dt);

    // 空は常にカメラ中心
    this.sky.mesh.position.copy(this.camera.position);

    document.body.classList.toggle('danger', this.state === 'playing' && this.duckY < 18);
  }

  onPassHoop(hoop) {
    this.combo++;
    this.hoopsPassed++;
    this.stagePassed++;
    // 最大コンボを更新した瞬間をスコア画像用に撮っておく
    if (this.combo > this.maxCombo) {
      this.maxCombo = this.combo;
      this.captureReq = true;
    }
    const gained = 100 + this.combo * 50;
    this.score += gained;
    this.particles.burst(hoop.position.x, hoop.position.y, 0, hoop.userData.color);
    this.sound.playPass(this.combo);

    const praise = this.combo >= 10 ? 'AMAZING!' : this.combo >= 5 ? 'GREAT!' : this.combo >= 3 ? 'NICE!' : '';
    this.showPopup(
      new THREE.Vector3(hoop.position.x, hoop.position.y + 2, 0),
      `+${gained}${praise ? `<small>${praise}</small>` : ''}`
    );
    this.retrigger(this.elComboBox, 'pop');
    this.retrigger(this.elFlash, 'on');
    this.shake = Math.min(1, 0.4 + this.combo * 0.05);
  }

  onMissHoop(hoop) {
    this.stageMissed++;
    if (this.combo > 0) {
      this.retrigger(this.elComboBox, 'break');
      this.showPopup(new THREE.Vector3(hoop.position.x, hoop.position.y, 0), 'MISS', 'miss');
    }
    this.combo = 0;
  }

  updateStageTimer(dt) {
    this.stageTimer -= dt;
    if (this.stageTimer <= 0) {
      this.stageTimer = 0;
      this.startLanding();
    }
  }

  // ================================================================
  //  時間切れ：着水して、そのステージの成績に応じてリアクション
  // ================================================================
  startLanding() {
    this.state = 'landing';
    this.landT = 0;
    this.landFromY = this.duckY;
    this.landSpeed0 = this.speed;
    this.landSplashed = false;
    this.landReacted = false;
    this.flap = 0;
    this.hoops.clear();

    const tried = this.stagePassed + this.stageMissed;
    const ratio = tried ? this.stagePassed / tried : 0;
    this.reaction = tried === 0 ? 'dazed' : ratio >= 0.7 ? 'happy' : ratio >= 0.35 ? 'dazed' : 'head';

    this.stageTitle.textContent = 'TIME UP!';
    this.stageDesc.textContent = tried
      ? `このステージ：輪 ${this.stagePassed} / ${tried} 個くぐった`
      : 'このステージ：輪をくぐれなかった';
    this.stageOverlay.classList.add('hidden');
    void this.stageOverlay.offsetWidth;
    this.stageOverlay.classList.remove('hidden');
  }

  // アヒルの真下（z=0）にある水面の中央付近の x 座標
  waterXAtDuck() {
    const c = this.chunks.find(ch => Math.abs(ch.group.position.z) <= GAME.chunkLength / 2) || this.chunks[0];
    const cx = routeCurve(c.routeZ - c.group.position.z);
    return STAGE_CONFIG[this.stageIdx].waterSide === 'center' ? cx : cx - 8;
  }

  updateLanding(dt) {
    const lerp = THREE.MathUtils.lerp;
    this.landT += dt;
    const t = this.landT;
    const D = GAME.landDescent;
    const now = performance.now() * 0.001;

    if (t < D) {
      // 水面へ降下し、最後に機首を上げてふわっと着水
      const p = t / D;
      const e = 1 - Math.pow(1 - p, 2.2);
      this.duckY = lerp(this.landFromY, GAME.floatY, e);
      // 陸に降りないよう、真下の水面の中央へ寄っていく
      this.duckX = lerp(this.duckX, this.waterXAtDuck(), Math.min(1, dt * 2.5));
      this.pitch = p < 0.7 ? lerp(this.pitch, 0.35, Math.min(1, dt * 4)) : lerp(0.35, -0.35, (p - 0.7) / 0.3);
      this.speed = lerp(this.landSpeed0, 8, p);
    } else {
      if (!this.landSplashed) {
        this.landSplashed = true;
        this.particles.splash(this.duckX, GAME.waterLevel, 0);
        this.sound.playSplash();
        this.shake = 0.4;
        this.duck.upright = 1;
      }
      this.speed = Math.max(0, this.speed - dt * 14);
      this.pitch = lerp(this.pitch, 0, Math.min(1, dt * 5));
      this.duckY = GAME.floatY + Math.sin(now * 2.4) * 0.12;
      this.duckX = lerp(this.duckX, this.waterXAtDuck(), Math.min(1, dt * 2));

      if (!this.landReacted && t > D + 0.5) {
        this.landReacted = true;
        this.duck.reaction = this.reaction;
        this.sound.playReaction(this.reaction);
        const label = { happy: 'やったー！', dazed: '…？', head: 'うぅ…' }[this.reaction];
        this.showPopup(new THREE.Vector3(this.duckX, this.duckY + 3.6, 0), label, `react ${this.reaction}`, 2400);
      }
      if (this.reaction === 'happy' && this.landReacted && Math.random() < dt * 3) {
        this.particles.burst(this.duckX + (Math.random() - 0.5) * 4, this.duckY + 2 + Math.random() * 2, 0, null, false);
      }
    }
    this.bank = lerp(this.bank, 0, Math.min(1, dt * 4));
    this.updateDuckVisual(dt);

    if (t < D) {
      // 降下中はいつもの後ろからのカメラ
      const k = Math.min(1, dt * 6);
      this.camera.position.set(
        this.duckX,
        lerp(this.camera.position.y, this.duckY + 8, k),
        lerp(this.camera.position.z, -14 - this.speed * 0.12, k)
      );
      this.camera.lookAt(this.duckX, this.duckY, 12);
    } else {
      // 着水後は正面へ回り込んで表情を見せる
      const target = new THREE.Vector3(this.duckX + 3.2, this.duckY + 3.2, 13);
      this.camera.position.lerp(target, Math.min(1, dt * 2.5));
      this.camera.lookAt(this.duckX, this.duckY + 1.6, 0);
    }
    this.applyCameraFx(dt);

    if (t > D + GAME.landReact) {
      if (this.stageIdx < STAGE_CONFIG.length - 1) {
        this.startStage(this.stageIdx + 1);
      } else {
        this.endGame();
      }
    }
  }

  gameOver() {
    this.state = 'gameover';
    this.particles.splash(this.duckX, GAME.waterLevel, 0);
    this.hoops.clear();
    this.shake = 1;
    this.stageOverlay.classList.add('hidden');
    // 水しぶきを少し見せてからリザルトへ
    setTimeout(() => { if (this.state === 'gameover') this.showResult(false); }, 1200);
  }

  endGame() {
    this.state = 'ended';
    this.hoops.clear();
    this.showResult(true);
  }

  // ================================================================
  //  リザルト
  // ================================================================
  showResult(win) {
    const cfg = STAGE_CONFIG[this.stageIdx];
    const stageLabel = win ? 'ALL CLEAR' : `STAGE ${this.stageIdx + 1}`;
    this.lastResult = {
      score: this.score, win, stageLabel, stageName: win ? '全3面クリア' : cfg.name,
      hoops: this.hoopsPassed, maxCombo: this.maxCombo,
      name: null, saved: false, id: null, date: new Date(),
    };

    document.getElementById('rSubTitle').textContent = win ? 'CONGRATULATIONS' : 'SPLASH!';
    const title = document.getElementById('rTitle');
    title.textContent = win ? 'GAME CLEAR!' : 'GAME OVER';
    title.classList.toggle('clear', win);
    document.getElementById('rMsg').textContent = win
      ? '全3面を飛び切りました！ 見事なフライト！'
      : `${cfg.name}で水に落ちてしまいました…`;

    const rows = [
      ['到達ステージ', win ? 'ALL CLEAR' : `${stageLabel}　${cfg.name}`],
      ['くぐった輪', `${this.hoopsPassed} 個`],
      ['最大コンボ', `${this.maxCombo}`],
    ];
    const tb = document.getElementById('rStats');
    tb.innerHTML = '';
    rows.forEach(([a, b]) => {
      const tr = document.createElement('tr');
      const t1 = document.createElement('td'); t1.textContent = a;
      const t2 = document.createElement('td'); t2.className = 'n'; t2.textContent = b;
      tr.append(t1, t2);
      tb.append(tr);
    });
    document.getElementById('rScore').textContent = this.score.toLocaleString();

    // スコア画像：キャプチャが無ければ今の画面を撮ってから作る
    document.getElementById('shareBox').classList.add('hidden');
    if (!this.lastCapture) this.captureReq = true;
    this.cardPending = true;

    const q = this.qualifies(this.score);
    document.getElementById('entry').classList.toggle('hidden', !q);
    this.showScreen('result');
    if (q) {
      let last = 'DUCK';
      try { last = localStorage.getItem('flyingDuck.lastName') || 'DUCK'; } catch (e) {}
      this.elNameIn.value = last;
      setTimeout(() => { this.elNameIn.focus(); this.elNameIn.select(); }, 50);
    }
  }

  register() {
    const r = this.lastResult;
    if (!r || r.saved) return;
    const name = (this.elNameIn.value || 'DUCK').trim().slice(0, 10).toUpperCase() || 'DUCK';
    try { localStorage.setItem('flyingDuck.lastName', name); } catch (e) {}
    r.id = this.addRank(name, r.score, r.stageLabel);
    r.saved = true;
    r.name = name;
    this.buildCard();
    document.getElementById('entry').classList.add('hidden');
    this.sound.playPass(10);
    this.showRanking(r.id, 'result');
  }

  goTitle() {
    this.state = 'start';
    this.stageOverlay.classList.add('hidden');
    this.duck.upright = 0;
    this.duck.reaction = null;
    this.stageIdx = 0;
    this.score = 0;
    this.combo = 0;
    this.duckX = 0;
    this.duckY = GAME.startAlt;
    this.stageTimer = GAME.stageDuration;
    this.hoops.clear();
    this.applyStage(0);
    this.chunks.forEach((c, i) => c.reset(0, i * GAME.chunkLength - 80));
    this.elStage.textContent = STAGE_CONFIG[0].name;
    this.elStageNum.textContent = 1;
    this.showScreen('title');
  }

  showScreen(id) {
    this.overlay.classList.toggle('hidden', id !== 'title');
    this.elResult.classList.toggle('hidden', id !== 'result');
    this.elRanking.classList.toggle('hidden', id !== 'ranking');
    if (id === 'title') this.updateTitleHi();
  }

  updateTitleHi() {
    document.getElementById('titleHi').textContent = this.topScore().toLocaleString();
  }

  // ================================================================
  //  スコア画像 / X へのポスト
  // ================================================================
  // WebGL の描画直後に 2D キャンバスへ写し取る（preserveDrawingBuffer 不要）
  grabFrame() {
    const src = this.renderer.domElement;
    const w = 1200, h = Math.round(w * src.height / src.width);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    this.lastCapture = c;
  }

  async buildCard() {
    const r = this.lastResult;
    if (!r) return;
    try {
      await document.fonts.load('700 80px Fredoka');
      await document.fonts.load('800 24px "M PLUS Rounded 1c"');
    } catch (e) {}
    const W = 1200, H = 630;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#87ceeb';
    g.fillRect(0, 0, W, H);
    if (this.lastCapture) {
      const cap = this.lastCapture;
      const k = Math.max(W / cap.width, H / cap.height);
      const dw = cap.width * k, dh = cap.height * k;
      g.drawImage(cap, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    // 左側を暗くして文字を読みやすく
    const gr = g.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, 'rgba(20,32,60,.9)');
    gr.addColorStop(0.52, 'rgba(20,32,60,.55)');
    gr.addColorStop(1, 'rgba(20,32,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,210,63,.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(18, 18, W - 36, H - 36, 26);
    g.stroke();

    // 縁取り付きの文字
    const text = (str, x, y, font, fill, stroke = '#1b2a4a', lw = 8) => {
      g.font = font;
      g.lineJoin = 'round';
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeText(str, x, y); }
      g.fillStyle = fill;
      g.fillText(str, x, y);
    };
    text('Flying-Duck', 60, 118, '700 76px Fredoka, sans-serif', '#ffffff', '#1b2a4a', 12);
    text('空飛ぶアヒルの輪くぐり', 64, 166, '800 26px "M PLUS Rounded 1c", sans-serif', '#ffd23f', '#1b2a4a', 6);
    text(r.win ? 'GAME CLEAR!' : 'GAME OVER', 60, 250, '700 46px Fredoka, sans-serif', r.win ? '#ffd23f' : '#ffffff', '#1b2a4a', 8);
    text('FINAL SCORE', 64, 312, '600 22px Fredoka, sans-serif', '#ffd23f', null);
    text(r.score.toLocaleString(), 56, 410, '700 104px Fredoka, sans-serif', '#ffffff', '#1b2a4a', 12);
    text(`到達: ${r.win ? 'ALL CLEAR' : `${r.stageLabel} ${r.stageName}`}`, 64, 466, '800 26px "M PLUS Rounded 1c", sans-serif', '#eef4ff', null);
    text(`輪: ${r.hoops}個　最大コンボ: ${r.maxCombo}`, 64, 506, '800 26px "M PLUS Rounded 1c", sans-serif', '#eef4ff', null);
    if (r.name) text(`PLAYER: ${r.name}`, 64, 546, '700 24px Fredoka, "M PLUS Rounded 1c", sans-serif', '#ffd23f', null);
    const d = r.date;
    const ds = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    text(`#FlyingDuck　${ds}`, W - 330, H - 44, '600 22px Fredoka, "M PLUS Rounded 1c", sans-serif', 'rgba(255,255,255,.95)', '#1b2a4a', 5);

    c.toBlob((b) => {
      if (!b) return;
      this.cardBlob = b;
      if (this.cardURL) URL.revokeObjectURL(this.cardURL);
      this.cardURL = URL.createObjectURL(b);
      document.getElementById('cardImg').src = this.cardURL;
      document.getElementById('shareBox').classList.remove('hidden');
    }, 'image/png');
  }

  shareText() {
    const r = this.lastResult;
    let t = `Flying-Duck（空飛ぶアヒルの輪くぐり）で ${r.score.toLocaleString()} 点！`
      + ` 到達: ${r.win ? 'ALL CLEAR' : r.stageLabel} / 輪 ${r.hoops}個 / 最大${r.maxCombo}コンボ`
      + `${r.win ? ' 全3面クリア！' : ''}\n#FlyingDuck`;
    if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      t += '\n' + location.origin + location.pathname;
    }
    return t;
  }

  toast(msg, ms = 5000) {
    this.elToast.textContent = msg;
    this.elToast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.elToast.classList.remove('on'), ms);
  }

  saveCard() {
    if (!this.cardURL) return;
    const a = document.createElement('a');
    a.href = this.cardURL;
    a.download = `flying-duck-${this.lastResult.score}.png`;
    document.body.append(a);
    a.click();
    a.remove();
  }

  async postToX() {
    if (!this.lastResult) return;
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(this.shareText());
    // 1) 画像をクリップボードへコピー（タブが切り替わる前に完了させる）
    let copied = false;
    if (this.cardBlob && navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(this.cardBlob) })]);
        copied = true;
      } catch (e) {}
    }
    if (!copied) this.saveCard();
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.toast(copied
      ? (isTouch
        ? 'スコア画像をコピーしました。X の投稿画面で本文を長押し →「ペースト」で画像を添付してください。'
        : 'スコア画像をコピーしました。X の投稿画面で貼り付け（⌘V / Ctrl+V）してください。')
      : '画像をクリップボードにコピーできなかったため、保存しました。X の投稿画面で画像を添付してください。', 9000);
    // 2) コピー済みの状態で X の投稿画面を開く
    window.open(url, '_blank', 'noopener');
  }

  // ================================================================
  //  ランキング（ブラウザ内 localStorage・上位10件）
  // ================================================================
  loadRank() {
    try {
      const a = JSON.parse(localStorage.getItem('flyingDuck.ranking.v1') || '[]');
      return Array.isArray(a) ? a : this.memRank;
    } catch (e) {
      return this.memRank;
    }
  }

  saveRank(a) {
    this.memRank = a;
    try { localStorage.setItem('flyingDuck.ranking.v1', JSON.stringify(a)); } catch (e) {}
  }

  topScore() {
    const a = this.loadRank();
    return a.length ? a[0].score : 0;
  }

  qualifies(score) {
    const a = this.loadRank();
    return score > 0 && (a.length < 10 || score > a[a.length - 1].score);
  }

  addRank(name, score, stage) {
    const a = this.loadRank();
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const d = new Date();
    const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    a.push({ id, name, score, stage, date });
    a.sort((x, y) => y.score - x.score);
    this.saveRank(a.slice(0, 10));
    return id;
  }

  showRanking(highlight = null, from = 'title') {
    this.rankFrom = from;
    const a = this.loadRank();
    const tb = document.getElementById('rankTable');
    tb.innerHTML = '';
    const hr = document.createElement('tr');
    ['#', 'NAME', 'SCORE', 'STAGE', 'DATE'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      hr.append(th);
    });
    tb.append(hr);
    if (!a.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.textAlign = 'center';
      td.style.color = '#b8c4dc';
      td.textContent = 'まだ記録がありません';
      tr.append(td);
      tb.append(tr);
    }
    a.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.id === highlight) tr.className = 'me';
      [[i + 1, ''], [r.name, ''], [r.score.toLocaleString(), 'n'], [r.stage, ''], [r.date, '']].forEach(([v, cls]) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (cls) td.className = cls;
        tr.append(td);
      });
      tb.append(tr);
    });
    this.showScreen('ranking');
  }

  updateUI() {
    this.elScore.textContent = this.score.toLocaleString();
    this.elCombo.textContent = this.combo;
    if (this.combo !== this.lastCombo) {
      this.elCombo.style.color = this.combo >= 10 ? '#ff7ac0' : this.combo >= 5 ? '#ffd23f' : '#fff';
      this.lastCombo = this.combo;
    }
    const m = Math.floor(this.stageTimer / 60);
    const s = Math.floor(this.stageTimer % 60).toString().padStart(2, '0');
    this.elTime.textContent = `${m}:${s}`;
    this.elTime.classList.toggle('warn', this.state === 'playing' && this.stageTimer <= 10);

    const altRatio = THREE.MathUtils.clamp(this.duckY / GAME.startAlt, 0, 1);
    this.elAltBar.style.height = `${altRatio * 100}%`;
    this.elAltMarker.style.bottom = `${altRatio * 100}%`;
  }

  loop(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // ポーズ中は時間を止めて描画だけ続ける
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.loop);
      return;
    }

    if (this.state === 'intro') {
      this.introTimer -= dt;
      this.updateIntro(dt);
      this.scrollWorld(dt);
      if (this.introTimer <= 0) {
        this.stageOverlay.classList.add('hidden');
        this.state = 'playing';
      }
    } else if (this.state === 'landing') {
      this.updateLanding(dt);
      this.scrollWorld(dt);
    } else if (this.state === 'playing') {
      this.updatePhysics(dt);
      if (this.state !== 'gameover') {
        this.updateWorld(dt);
        this.updateStageTimer(dt);
      }
    } else {
      this.updateIdle(dt);
      this.scrollWorld(dt);
    }

    this.updateEffects(dt);
    this.updateUI();
    this.renderer.render(this.scene, this.camera);
    if (this.captureReq) { this.captureReq = false; this.grabFrame(); }
    if (this.cardPending && !this.captureReq) { this.cardPending = false; this.buildCard(); }
    this.updateLabels();

    requestAnimationFrame(this.loop);
  }
}

new Game();
