import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const $ = (id) => document.getElementById(id);
const main = document.querySelector('main');
const sidebar = main.querySelector('aside');
const splitter = $('splitter');
const viewport = $('viewport');
const autoRotate = $('auto-rotate');
const animationButton = $('animation-play');
const copyModelUrl = $('copy-model-url');
const copyUrlFeedback = $('copy-url-feedback');
let copyFeedbackTimer;
function hideCopyFeedback() {
  clearTimeout(copyFeedbackTimer);
  copyUrlFeedback.hidden = true;
}
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
viewport.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
let controls = new OrbitControls(camera, renderer.domElement);
controls.addEventListener('change', render);

let entries = [];
let model = null;
let selected = null;
let request = 0;
let sourceRequest = 0;
let frame = 0;
let lastFrameTime = 0;
let autoRotating = false;
let animationMixer = null;
let animationAction = null;
let animationPlaying = false;
let disposed = false;
let radius = 1;
let selectedOverlay = null;
const regionCache = new WeakMap();
const raycaster = new THREE.Raycaster();
const viewDirection = new THREE.Vector3(0.7, 0.5, 1).normalize();
const rotationAxis = new THREE.Vector3(0, 1, 0);
const urls = new Set();
const openFolders = new Set();
const thumbnailEntries = new WeakMap();
const thumbnailObserver = new IntersectionObserver((items) => {
  for (const item of items) if (item.isIntersecting) {
    thumbnailObserver.unobserve(item.target);
    const { entry, image } = thumbnailEntries.get(item.target);
    loadThumbnail(entry, image);
  }
}, { root: $('file-list'), rootMargin: '80px' });
let thumbnailQueue = Promise.resolve();
let thumbnailRenderer = null;

function render() {
  if (!frame && !disposed) frame = requestAnimationFrame((time) => {
    frame = 0;
    if (model && (autoRotating || animationPlaying)) {
      const delta = lastFrameTime ? (time - lastFrameTime) / 1000 : 0;
      if (autoRotating && delta) model.rotateOnWorldAxis(rotationAxis, -Math.min(delta, 0.05) * Math.PI / 6);
      if (animationPlaying && delta) animationMixer.update(delta);
      lastFrameTime = time;
    } else lastFrameTime = 0;
    renderer.render(scene, camera);
    if (model && (autoRotating || animationPlaying)) render();
  });
}

function resetAnimation() {
  if (animationMixer) {
    animationMixer.stopAllAction();
    animationMixer.uncacheRoot(animationMixer.getRoot());
  }
  animationMixer = null;
  animationAction = null;
  animationPlaying = false;
  animationButton.hidden = true;
  animationButton.setAttribute('aria-pressed', 'false');
  animationButton.setAttribute('aria-label', '播放动画');
  animationButton.title = '播放动画';
  $('animation-icon').setAttribute('d', 'M8 5v14l11-7z');
  lastFrameTime = 0;
}

function release(object) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    for (const material of child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function clearPartSelection() {
  if (selectedOverlay) {
    selectedOverlay.removeFromParent();
    selectedOverlay.geometry.dispose();
    selectedOverlay.material.dispose();
    selectedOverlay = null;
  }
  $('part-info').textContent = '';
  render();
}

function regionGeometry(hit) {
  const geometry = hit.object.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const faceCount = Math.floor((index?.count ?? position.count) / 3);
  let regions = regionCache.get(geometry);
  if (!regions) {
    const parent = Int32Array.from({ length: faceCount }, (_, i) => i);
    const materials = new Int32Array(faceCount);
    for (const group of geometry.groups) {
      for (let i = Math.floor(group.start / 3); i < Math.min(faceCount, (group.start + group.count) / 3); i++) materials[i] = group.materialIndex;
    }
    const vertices = new Map();
    const vertexIds = new Map();
    const vertexId = (indexValue) => {
      if (vertexIds.has(indexValue)) return vertexIds.get(indexValue);
      const key = `${position.getX(indexValue)},${position.getY(indexValue)},${position.getZ(indexValue)}`;
      if (!vertices.has(key)) vertices.set(key, vertices.size);
      const id = vertices.get(key);
      vertexIds.set(indexValue, id);
      return id;
    };
    const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edges = new Map();
    for (let i = 0; i < faceCount; i++) {
      const ids = [0, 1, 2].map((corner) => vertexId(index ? index.getX(i * 3 + corner) : i * 3 + corner));
      for (let edge = 0; edge < 3; edge++) {
        const a = ids[edge];
        const b = ids[(edge + 1) % 3];
        const key = `${materials[i]}:${Math.min(a, b)}:${Math.max(a, b)}`;
        if (edges.has(key)) parent[root(i)] = root(edges.get(key));
        else edges.set(key, i);
      }
    }
    regions = { parent, root };
    regionCache.set(geometry, regions);
  }
  const target = regions.root(hit.faceIndex);
  const coordinates = [];
  for (let i = 0; i < faceCount; i++) {
    if (regions.root(i) !== target) continue;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index ? index.getX(i * 3 + corner) : i * 3 + corner;
      coordinates.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  return result;
}

function selectPart(hit) {
  clearPartSelection();
  if (!hit) return;
  selectedOverlay = new THREE.Mesh(regionGeometry(hit), new THREE.MeshBasicMaterial({
    color: 0xffdd55, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  selectedOverlay.raycast = () => {};
  hit.object.add(selectedOverlay);
  const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
  $('part-info').textContent = `已选区域：${material?.name || hit.object.name || '未命名区域'}`;
  render();
}

function fitDistance() {
  const halfAngle = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
  return radius / Math.sin(halfAngle) * 1.15;
}

function fit(direction = viewDirection) {
  if (!model) return;
  const distance = fitDistance();
  controls.target.set(0, 0, 0);
  camera.position.copy(direction).normalize().multiplyScalar(distance);
  camera.near = Math.max(radius / 1000, 0.000001);
  camera.far = Math.max(distance * 100, radius * 1000);
  camera.updateProjectionMatrix();
  controls.minDistance = radius * 0.05;
  controls.maxDistance = distance * 20;
  controls.update();
  render();
}

function setCameraUp(up) {
  if (camera.up.equals(up)) return;
  controls.dispose();
  camera.up.copy(up);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener('change', render);
}

function frontView(size) {
  const direction = new THREE.Vector3(0.7, 0.5, 1);
  const up = new THREE.Vector3(0, 1, 0);
  if (size.y < Math.min(size.x, size.z) * 0.3) {
    direction.set(0.2, 1, 0.25);
    up.set(0, 0, -1);
  } else if (size.z < Math.min(size.x, size.y) * 0.3) direction.set(0, 0, 1);
  else if (size.x < Math.min(size.y, size.z) * 0.3) direction.set(1, 0, 0);
  return { direction: direction.normalize(), up };
}

async function renderThumbnail(entry) {
  if (!entries.includes(entry) || disposed) return null;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const file = entry.handle ? await entry.handle.getFile() : entry.file;
  const gltf = entry.remote ? await loader.loadAsync(entry.url) : await loader.parseAsync(await file.arrayBuffer(), '');
  const object = gltf.scene;
  try {
    if (!entries.includes(entry) || disposed) return null;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return null;
    const size = bounds.getSize(new THREE.Vector3());
    const radius = size.length() / 2;
    if (!Number.isFinite(radius) || radius <= 0) return null;
    if (!thumbnailRenderer) {
      thumbnailRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbnailRenderer.setSize(96, 96, false);
      thumbnailRenderer.setClearColor(0x000000, 0);
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const centered = new THREE.Group();
    centered.add(object);
    centered.position.copy(bounds.getCenter(new THREE.Vector3())).negate();
    scene.add(centered);
    const camera = new THREE.PerspectiveCamera(40, 1, Math.max(radius / 1000, 0.000001), radius * 1000);
    const { direction, up } = frontView(size);
    camera.up.copy(up);
    camera.position.copy(direction).multiplyScalar(radius / Math.sin(camera.fov * Math.PI / 360) * 1.15);
    camera.lookAt(0, 0, 0);
    thumbnailRenderer.render(scene, camera);
    return thumbnailRenderer.domElement.toDataURL('image/png');
  } finally {
    release(object);
  }
}

function queueThumbnail(entry) {
  const job = thumbnailQueue.then(() => renderThumbnail(entry)).catch(() => null);
  thumbnailQueue = job;
  return job;
}

async function hasGlbAnimation(entry) {
  const file = entry.handle ? await entry.handle.getFile() : entry.file;
  const header = new DataView(await file.slice(0, 20).arrayBuffer());
  if (header.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 ||
      header.getUint32(4, true) !== 2 || header.getUint32(16, true) !== 0x4e4f534a) return false;
  const jsonLength = header.getUint32(12, true);
  if (jsonLength > file.size - 20) return false;
  const json = JSON.parse(await file.slice(20, 20 + jsonLength).text());
  return Array.isArray(json.animations) && json.animations.length > 0;
}

function updateAnimationBadge(entry) {
  if (!entry.animationBadge?.isConnected) return;
  entry.animationBadge.hidden = !entry.hasAnimation;
  const label = entry.remote ? entry.url : entry.path;
  entry.listButton.setAttribute('aria-label', entry.hasAnimation ? `${label}，含动画` : label);
}

async function loadThumbnail(entry, image) {
  if (!entry) return;
  if (entry.hasAnimation === undefined && !entry.remote) {
    entry.animationPromise ??= hasGlbAnimation(entry).catch(() => false);
    entry.animationPromise.then((hasAnimation) => {
      if (entry.hasAnimation === undefined) entry.hasAnimation = hasAnimation;
      updateAnimationBadge(entry);
    });
  }
  if (entry.thumbnailUrl) return;
  if (!entry.thumbnailPromise) entry.thumbnailPromise = entry.thumbnailHandle
    ? entry.thumbnailHandle.getFile().then((file) => {
      if (!entries.includes(entry) || disposed) return null;
      const url = URL.createObjectURL(file);
      urls.add(url);
      return url;
    }).catch(() => queueThumbnail(entry))
    : queueThumbnail(entry);
  const url = await entry.thumbnailPromise;
  if (url && image.isConnected) {
    entry.thumbnailUrl = url;
    image.src = url;
    image.hidden = false;
  }
}

function showList() {
  thumbnailObserver.disconnect();
  const search = $('search').value.trim().toLowerCase();
  const matches = entries.filter((entry) => entry.path.toLowerCase().includes(search));
  $('file-count').textContent = search ? `${matches.length} / ${entries.length} 个` : `${entries.length} 个`;
  $('clear-list').disabled = !entries.length;
  $('list-empty').hidden = matches.length > 0;
  $('list-empty').textContent = entries.length ? '没有匹配的 GLB 文件。' : '没有 GLB 文件，请重新选择来源。';
  const root = { folders: new Map(), files: [] };
  for (const entry of matches) {
    const parts = entry.path.split('/');
    let folder = root;
    let path = '';
    for (const name of parts.slice(0, -1)) {
      path += `${name}/`;
      if (!folder.folders.has(name)) folder.folders.set(name, { name, path, count: 0, folders: new Map(), files: [] });
      folder = folder.folders.get(name);
      folder.count++;
    }
    folder.files.push(entry);
  }
  let firstEntry = null;
  const fileButton = (entry) => {
    firstEntry ??= entry;
    const row = document.createElement('div');
    row.className = 'file-entry';
    const button = document.createElement('button');
    button.className = 'file';
    button.setAttribute('aria-pressed', String(entry === selected));
    button.setAttribute('aria-label', `${entry.remote ? entry.url : entry.path}${entry.hasAnimation ? '，含动画' : ''}`);
    button.title = entry.remote ? entry.url : entry.path;
    const thumbnail = document.createElement('span');
    thumbnail.className = 'thumbnail';
    const image = document.createElement('img');
    image.alt = '';
    image.hidden = true;
    const badge = document.createElement('span');
    badge.className = 'animation-badge';
    badge.textContent = '▶';
    badge.hidden = !entry.hasAnimation;
    thumbnail.append(image, badge);
    entry.animationBadge = badge;
    entry.listButton = button;
    const name = document.createElement('span');
    name.textContent = entry.name;
    button.append(thumbnail, name);
    if (entry.thumbnailUrl) { image.src = entry.thumbnailUrl; image.hidden = false; }
    if (!entry.thumbnailUrl || entry.hasAnimation === undefined) {
      thumbnailEntries.set(thumbnail, { entry, image });
      thumbnailObserver.observe(thumbnail);
    }
    button.addEventListener('click', () => select(entry));
    const remove = document.createElement('button');
    remove.className = 'remove-file';
    remove.type = 'button';
    remove.setAttribute('aria-label', `从列表移除 ${entry.name}`);
    remove.title = '仅从列表移除';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M9 6V4h6v2M7 6l1 14h8l1-14M10 10v6M14 10v6" /></svg>';
    remove.addEventListener('click', () => removeEntry(entry));
    row.append(button, remove);
    return row;
  };
  const contents = (folder) => [
    ...[...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })).map((child) => {
      const details = document.createElement('details');
      details.className = 'folder';
      details.open = !!search || openFolders.has(child.path);
      const summary = document.createElement('summary');
      summary.textContent = `${child.name} (${child.count})`;
      const children = document.createElement('div');
      children.className = 'folder-children';
      children.append(...contents(child));
      details.append(summary, children);
      details.addEventListener('toggle', () => {
        if (search) return;
        if (details.open) openFolders.add(child.path);
        else openFolders.delete(child.path);
      });
      return details;
    }),
    ...folder.files.map(fileButton),
  ];
  $('file-list').replaceChildren(...contents(root));
  return firstEntry;
}

function removeEntry(entry) {
  const index = entries.indexOf(entry);
  if (index < 0) return;
  entries.splice(index, 1);
  if (selected === entry) {
    ++request;
    selected = null;
    clearPartSelection();
    resetAnimation();
    if (model) { scene.remove(model); release(model); model = null; }
    $('model-name').textContent = '尚未选择模型';
    $('model-path').textContent = '';
    copyModelUrl.hidden = true;
    hideCopyFeedback();
    $('model-info').textContent = '';
    $('reset-view').disabled = true;
    autoRotate.disabled = true;
    autoRotating = false;
    autoRotate.setAttribute('aria-pressed', 'false');
    lastFrameTime = 0;
    $('status').className = '';
    $('status').textContent = entries.length ? '选择左侧文件，预览模型形状与材质' : '选择文件夹、文件或在线链接，开始预览';
    render();
  }
  for (const url of [entry.url, entry.thumbnailUrl]) if (urls.delete(url)) URL.revokeObjectURL(url);
  showList();
}

async function select(entry) {
  const current = ++request;
  const pendingRemote = entry.remote && !entries.includes(entry);
  selected = entry;
  clearPartSelection();
  resetAnimation();
  const parts = entry.path.split('/');
  let folder = '';
  for (const name of parts.slice(0, -1)) { folder += `${name}/`; openFolders.add(folder); }
  showList();
  if (pendingRemote && !entries.length) $('list-empty').textContent = '正在加载在线模型…';
  $('model-name').textContent = entry.name;
  $('model-path').textContent = entry.remote ? entry.url : entry.path;
  copyModelUrl.hidden = !entry.remote;
  hideCopyFeedback();
  delete copyModelUrl.dataset.copied;
  copyModelUrl.setAttribute('aria-label', '复制在线地址');
  copyModelUrl.title = '复制在线地址';
  $('model-info').textContent = '';
  $('status').className = '';
  $('status').textContent = entry.remote ? '正在下载模型…' : '正在加载模型…';
  $('reset-view').disabled = true;
  autoRotate.disabled = true;
  autoRotating = false;
  autoRotate.setAttribute('aria-pressed', 'false');
  lastFrameTime = 0;
  if (model) { scene.remove(model); release(model); model = null; render(); }
  try {
    if ((entry.handle || entry.file) && !entry.url) {
      const file = entry.handle ? await entry.handle.getFile() : entry.file;
      if (current !== request || disposed) return;
      entry.url = URL.createObjectURL(file);
      urls.add(entry.url);
    }
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(entry.url, (progress) => {
      if (!entry.remote || current !== request || disposed) return;
      $('status').textContent = progress.lengthComputable && progress.total
        ? progress.loaded >= progress.total ? '正在解析模型…' : `正在下载模型：${Math.floor(progress.loaded / progress.total * 100)}%`
        : `正在下载模型：${(progress.loaded / 1048576).toFixed(1)} MB`;
    });
    const object = gltf.scene;
    if (current !== request || disposed) { release(object); return; }
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) { release(object); throw new Error('模型中没有可预览的几何体'); }
    const size = bounds.getSize(new THREE.Vector3());
    radius = size.length() / 2;
    if (!Number.isFinite(radius) || radius <= 0) { release(object); throw new Error('模型尺寸无效'); }
    const { direction, up } = frontView(size);
    setCameraUp(up);
    viewDirection.copy(direction);
    rotationAxis.copy(up);
    // Center through a parent, preserving the model's original transforms.
    model = new THREE.Group();
    const centered = new THREE.Group();
    centered.add(object);
    centered.position.copy(bounds.getCenter(new THREE.Vector3())).negate();
    model.add(centered);
    scene.add(model);
    entry.hasAnimation = !!gltf.animations?.length;
    updateAnimationBadge(entry);
    if (gltf.animations?.length) {
      animationMixer = new THREE.AnimationMixer(object);
      animationAction = animationMixer.clipAction(gltf.animations[0]);
      animationButton.hidden = false;
      animationButton.title = `播放动画：${gltf.animations[0].name || '动画 1'}`;
    }
    let triangles = 0;
    object.traverse((child) => {
      if (child.isMesh) triangles += (child.geometry.index?.count ?? child.geometry.attributes.position?.count ?? 0) / 3;
    });
    const cm = (value) => (value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    $('model-info').textContent = `X ${cm(size.x)} · Y ${cm(size.y)} · Z ${cm(size.z)} cm | ${Math.round(triangles).toLocaleString()} 三角形`;
    $('status').textContent = '';
    $('reset-view').disabled = false;
    autoRotate.disabled = false;
    fit();
    if (pendingRemote) {
      entries.push(entry);
      entries.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
      showList();
    }
    if (entry.remote) rememberUrl(entry.url);
  } catch (error) {
    if (current !== request || disposed) return;
    if (pendingRemote) {
      selected = null;
      $('model-name').textContent = '尚未选择模型';
      $('model-path').textContent = '';
      copyModelUrl.hidden = true;
      hideCopyFeedback();
      $('model-info').textContent = '';
      showList();
    }
    $('status').className = 'error';
    $('status').textContent = `加载失败：${error.message || '请检查文件或路径'}。可选择其他模型继续预览。`;
    if (entry.remote) {
      if (!$('url-dialog').open) $('url-dialog').showModal();
      $('url-error').textContent = `加载失败：${error.message || '请检查地址或跨域设置'}。`;
      $('url-error').hidden = false;
      $('model-url').focus();
    }
  }
}

function setEntries(next, previewFirst = false) {
  ++sourceRequest;
  ++request;
  selected = null;
  clearPartSelection();
  resetAnimation();
  if (model) { scene.remove(model); release(model); model = null; }
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  openFolders.clear();
  entries = next.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
  $('search').value = '';
  $('model-name').textContent = '尚未选择模型';
  $('model-path').textContent = '';
  copyModelUrl.hidden = true;
  hideCopyFeedback();
  $('model-info').textContent = '';
  $('reset-view').disabled = true;
  autoRotate.disabled = true;
  autoRotating = false;
  autoRotate.setAttribute('aria-pressed', 'false');
  lastFrameTime = 0;
  $('status').className = '';
  $('status').textContent = entries.length ? '选择左侧文件，预览模型形状与材质' : '未找到 GLB 文件';
  const first = showList();
  render();
  if (previewFirst && first) select(first);
}

$('folder-picker').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    $('status').className = 'error';
    $('status').textContent = '当前浏览器不支持读取文件夹，请使用 Chrome 或 Edge，或选择单个文件。';
    return;
  }
  const current = ++sourceRequest;
  try {
    const directory = await window.showDirectoryPicker({ mode: 'read' });
    const next = [];
    async function scan(folder, parent = '') {
      const models = [];
      const previews = new Map();
      const directories = [];
      for await (const handle of folder.values()) {
        if (handle.kind === 'directory') directories.push(handle);
        else if (/\.glb$/i.test(handle.name)) models.push(handle);
        else if (/\.(png|jpe?g|webp)$/i.test(handle.name)) previews.set(handle.name.toLowerCase(), handle);
      }
      for (const handle of models) {
        const stem = handle.name.slice(0, -4).toLowerCase();
        const names = [`${stem}.png`, `${stem}.webp`, `${stem}.jpg`, `${stem}_thumb.png`];
        if (models.length === 1) names.push('thumbnail.png', 'preview-96.png');
        const thumbnailHandle = names.map((name) => previews.get(name)).find(Boolean);
        next.push({ name: handle.name, path: `${parent}${handle.name}`, handle, thumbnailHandle });
      }
      for (const handle of directories) await scan(handle, `${parent}${handle.name}/`);
    }
    await scan(directory);
    if (current !== sourceRequest || disposed) return;
    setEntries(next);
  } catch (error) {
    if (current !== sourceRequest || disposed || error.name === 'AbortError') return;
    $('status').className = 'error';
    $('status').textContent = `读取文件夹失败：${error.message}`;
  }
});

$('file-input').addEventListener('change', (event) => {
  const files = [...event.target.files].filter((file) => /\.glb$/i.test(file.name));
  setEntries(files.map((file) => ({ name: file.name, path: file.webkitRelativePath || file.name, file })), true);
  event.target.value = '';
});

const dropViewer = document.querySelector('.viewer');
let dragOutlineTimer;
function clearDragOutline() {
  clearTimeout(dragOutlineTimer);
  dropViewer.classList.remove('drop-target');
}
window.addEventListener('dragover', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  const fileItems = [...event.dataTransfer.items].filter((item) => item.kind === 'file');
  const accepted = !fileItems.length || fileItems.some((item) => !item.type ||
    item.type === 'application/octet-stream' || /gltf|glb/i.test(item.type));
  event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
  dropViewer.classList.toggle('drop-target', accepted);
  clearTimeout(dragOutlineTimer);
  dragOutlineTimer = setTimeout(clearDragOutline, 250);
});
window.addEventListener('drop', async (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  clearDragOutline();
  const files = [...event.dataTransfer.files].filter((file) => /\.glb$/i.test(file.name));
  if (!files.length) {
    $('status').className = 'error';
    $('status').textContent = '请拖入 GLB 文件。';
    return;
  }
  const current = ++sourceRequest;
  const currentEntries = entries;
  const names = new Set(files.map((file) => file.name));
  const known = await Promise.all(entries.filter((entry) => !entry.remote && names.has(entry.name)).map(async (entry) => {
    try { return { entry, file: entry.file || await entry.handle.getFile() }; }
    catch { return null; }
  }));
  if (entries !== currentEntries || disposed) return;
  for (const entry of entries) if (entry.file && names.has(entry.name) && !known.some((item) => item?.entry === entry)) {
    known.push({ entry, file: entry.file });
  }
  let first = null;
  for (const file of files) {
    const match = known.find((item) => item && item.file.name === file.name &&
      item.file.size === file.size && item.file.lastModified === file.lastModified);
    if (match) { first ??= match.entry; continue; }
    const entry = { name: file.name, path: file.webkitRelativePath || file.name, file };
    entries.push(entry);
    known.push({ entry, file });
    first ??= entry;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
  $('search').value = '';
  if (current === sourceRequest) select(first);
  else showList();
});

$('clear-list').addEventListener('click', () => {
  setEntries([]);
  $('status').textContent = '选择文件夹、文件或在线链接，开始预览';
});

const recentUrlKey = 'glbviewer.recentUrls';
let recentUrls = [];
try {
  const saved = JSON.parse(localStorage.getItem(recentUrlKey) || '[]');
  if (Array.isArray(saved)) recentUrls = [...new Set(saved.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))].slice(0, 10);
} catch { /* Recent URLs remain available for this session if storage is blocked. */ }
function openRemoteUrl(href) {
  const url = new URL(href);
  const name = url.pathname.split('/').pop() || 'online.glb';
  $('url-dialog').close();
  ++sourceRequest;
  const entry = entries.find((item) => item.remote && item.url === url.href) || { name, path: name, url: url.href, remote: true };
  $('search').value = '';
  select(entry);
}
function renderRecentUrls() {
  $('recent-urls').hidden = !recentUrls.length;
  $('recent-url-list').replaceChildren(...recentUrls.map((url) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-url';
    button.textContent = url;
    button.title = url;
    button.addEventListener('click', () => openRemoteUrl(url));
    item.append(button);
    return item;
  }));
}
function rememberUrl(url) {
  recentUrls = [url, ...recentUrls.filter((item) => item !== url)].slice(0, 10);
  try { localStorage.setItem(recentUrlKey, JSON.stringify(recentUrls)); }
  catch { /* The current session still keeps the recent list. */ }
  renderRecentUrls();
}
renderRecentUrls();

$('url-picker').addEventListener('click', () => {
  $('model-url').value = '';
  $('url-error').hidden = true;
  $('url-dialog').showModal();
  $('model-url').focus();
});
$('cancel-url').addEventListener('click', () => $('url-dialog').close());
$('model-url').addEventListener('input', () => { $('url-error').hidden = true; });
$('url-source').addEventListener('submit', (event) => {
  event.preventDefault();
  let url;
  try { url = new URL($('model-url').value.trim()); }
  catch {
    $('url-error').textContent = '请输入有效的在线 GLB 地址。';
    $('url-error').hidden = false;
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    $('url-error').textContent = '请输入 HTTP 或 HTTPS 的 GLB 地址。';
    $('url-error').hidden = false;
    return;
  }
  openRemoteUrl(url.href);
});
copyModelUrl.addEventListener('click', async () => {
  if (!selected?.remote) return;
  const url = selected.url;
  try {
    await navigator.clipboard.writeText(url);
    if (selected?.url !== url) return;
    copyModelUrl.dataset.copied = 'true';
    copyModelUrl.setAttribute('aria-label', '已复制在线地址');
    copyModelUrl.title = '已复制在线地址';
    hideCopyFeedback();
    copyUrlFeedback.textContent = '已复制';
    copyUrlFeedback.hidden = false;
    copyFeedbackTimer = setTimeout(hideCopyFeedback, 2000);
  } catch {
    if (selected?.url !== url) return;
    copyModelUrl.setAttribute('aria-label', '复制失败');
    copyModelUrl.title = '复制失败';
  }
});

$('search').addEventListener('input', showList);
$('list-view').addEventListener('click', () => {
  $('file-list').classList.remove('grid');
  $('list-view').setAttribute('aria-pressed', 'true');
  $('grid-view').setAttribute('aria-pressed', 'false');
});
$('grid-view').addEventListener('click', () => {
  $('file-list').classList.add('grid');
  $('list-view').setAttribute('aria-pressed', 'false');
  $('grid-view').setAttribute('aria-pressed', 'true');
});
$('reset-view').addEventListener('click', () => {
  if (!model) return;
  autoRotating = false;
  autoRotate.setAttribute('aria-pressed', 'false');
  lastFrameTime = 0;
  model.quaternion.identity();
  fit();
});
animationButton.addEventListener('click', () => {
  if (!animationAction) return;
  animationPlaying = !animationPlaying;
  animationAction.play();
  animationAction.paused = !animationPlaying;
  animationButton.setAttribute('aria-pressed', String(animationPlaying));
  animationButton.setAttribute('aria-label', animationPlaying ? '暂停动画' : '播放动画');
  animationButton.title = `${animationPlaying ? '暂停动画' : '播放动画'}：${animationAction.getClip().name || '动画 1'}`;
  $('animation-icon').setAttribute('d', animationPlaying ? 'M7 5h3v14H7zM14 5h3v14h-3z' : 'M8 5v14l11-7z');
  lastFrameTime = 0;
  render();
});
let pickStart = null;
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button === 0) pickStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pickStart || event.pointerId !== pickStart.id) return;
  const moved = Math.hypot(event.clientX - pickStart.x, event.clientY - pickStart.y);
  pickStart = null;
  if (!model || event.button !== 0 || moved > 4) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  const point = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  model.updateMatrixWorld(true);
  raycaster.setFromCamera(point, camera);
  selectPart(raycaster.intersectObject(model, true).find((hit) => hit.object.isMesh && Number.isInteger(hit.faceIndex)));
});
renderer.domElement.addEventListener('pointercancel', () => { pickStart = null; });
autoRotate.addEventListener('click', () => {
  if (!model) return;
  autoRotating = !autoRotating;
  autoRotate.setAttribute('aria-pressed', String(autoRotating));
  lastFrameTime = 0;
  render();
});
function setSidebarWidth(width) {
  const max = Math.max(240, main.clientWidth - 328);
  const next = Math.min(max, Math.max(240, Math.round(width)));
  main.style.setProperty('--sidebar-width', `${next}px`);
  splitter.setAttribute('aria-valuemax', String(max));
  splitter.setAttribute('aria-valuenow', String(next));
}
let dragStartX = 0;
let dragStartWidth = 0;
splitter.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragStartX = event.clientX;
  dragStartWidth = sidebar.getBoundingClientRect().width;
  splitter.setPointerCapture(event.pointerId);
  splitter.classList.add('dragging');
});
splitter.addEventListener('pointermove', (event) => {
  if (splitter.hasPointerCapture(event.pointerId)) setSidebarWidth(dragStartWidth + event.clientX - dragStartX);
});
splitter.addEventListener('lostpointercapture', () => splitter.classList.remove('dragging'));
splitter.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setSidebarWidth(sidebar.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 24 : -24));
});
const layoutResize = new ResizeObserver(() => {
  if (!splitter.offsetWidth) return;
  splitter.setAttribute('aria-valuemax', String(Math.max(240, main.clientWidth - 328)));
  splitter.setAttribute('aria-valuenow', String(Math.round(sidebar.getBoundingClientRect().width)));
});
layoutResize.observe(main);
const resize = new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  if (model) fit(camera.position.clone().sub(controls.target));
  else render();
});
resize.observe(viewport);

function cleanup() {
  disposed = true;
  ++request;
  clearPartSelection();
  resetAnimation();
  cancelAnimationFrame(frame);
  thumbnailObserver.disconnect();
  layoutResize.disconnect();
  resize.disconnect();
  controls.dispose();
  if (model) release(model);
  for (const url of urls) URL.revokeObjectURL(url);
  thumbnailRenderer?.dispose();
  renderer.dispose();
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) cleanup(); }, { once: true });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
render();
