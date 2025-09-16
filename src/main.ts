// @ts-ignore
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
// @ts-ignore
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import URDFLoader, { URDFRobot, URDFJoint } from 'urdf-loader';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
// @ts-ignore
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader';
// @ts-ignore
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// @ts-ignore
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new (THREE as any).Scene();
scene.background = new (THREE as any).Color(0x0b0e12);

const camera = new (THREE as any).PerspectiveCamera(60, 1, 0.01, 1000);
camera.position.set(2, 2, 2);
let orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
let trackball: any | null = null;

function setControlsMode(trackballMode: boolean) {
	if (trackballMode) {
		if (!trackball) {
			trackball = new TrackballControls(camera, renderer.domElement);
			trackball.rotateSpeed = 3.0;
			trackball.zoomSpeed = 1.2;
			trackball.panSpeed = 0.8;
			trackball.staticMoving = true;
			trackball.dynamicDampingFactor = 0.2;
		}
		(orbit as any).enabled = false;
		(trackball as any).enabled = true;
	} else {
		(orbit as any).enabled = true;
		if (trackball) (trackball as any).enabled = false;
	}
}

const ambient = new (THREE as any).AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const dir = new (THREE as any).DirectionalLight(0xffffff, 0.8);
dir.position.set(5, 10, 7);
dir.castShadow = true;
scene.add(dir);

const grid = new (THREE as any).GridHelper(10, 10, 0x334455, 0x223344);
(scene as any).add(grid);
grid.visible = false;

// Table-like ground (wood color) that aligns with up-axis
const tableThickness = 0.05;
const tableSize = 10;
const tableGeom = new (THREE as any).BoxGeometry(tableSize, tableSize, tableThickness);
const tableMat = new (THREE as any).MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, metalness: 0.0 });
const table = new (THREE as any).Mesh(tableGeom, tableMat);
table.receiveShadow = true;
scene.add(table);
table.visible = false;

function alignGroundToUpAxis() {
	// Default box is aligned with Z as thickness axis. Rotate to align thickness with scene.up
	const defaultNormal = new (THREE as any).Vector3(0, 0, 1);
	const targetNormal = (scene as any).up.clone().normalize();
	const q = new (THREE as any).Quaternion().setFromUnitVectors(defaultNormal, targetNormal);
	table.quaternion.copy(q);
	// Position so top surface is near origin along up-axis
	const offset = targetNormal.clone().multiplyScalar(-tableThickness * 0.5);
	table.position.set(offset.x, offset.y, offset.z);

	// Grid: orient on plane orthogonal to up-axis
	grid.rotation.set(0, 0, 0);
	if (targetNormal.equals(new (THREE as any).Vector3(0, 0, 1))) {
		grid.rotation.set(0, 0, 0);
	} else if (targetNormal.equals(new (THREE as any).Vector3(0, 0, -1))) {
		grid.rotation.set(Math.PI, 0, 0);
	} else if (targetNormal.equals(new (THREE as any).Vector3(0, 1, 0))) {
		grid.rotation.set(-Math.PI / 2, 0, 0);
	} else if (targetNormal.equals(new (THREE as any).Vector3(0, -1, 0))) {
		grid.rotation.set(Math.PI / 2, 0, 0);
	} else if (targetNormal.equals(new (THREE as any).Vector3(1, 0, 0))) {
		grid.rotation.set(0, 0, Math.PI / 2);
	} else if (targetNormal.equals(new (THREE as any).Vector3(-1, 0, 0))) {
		grid.rotation.set(0, 0, -Math.PI / 2);
	}
}

let loader = new URDFLoader();
let robot: URDFRobot | null = null;
let lastUrl: string | null = null;
let lastPackages: string | null = null;

// Local folder context
let localFS: Map<string, File> | null = null;
let localBlobURLByPath: Map<string, string> = new Map();
function revokeAllLocalBlobs() {
	for (const url of localBlobURLByPath.values()) URL.revokeObjectURL(url);
	localBlobURLByPath.clear();
}

function setUpAxis(code: string) {
	switch (code) {
		case 'X+': scene.up.set(1, 0, 0); break;
		case 'X-': scene.up.set(-1, 0, 0); break;
		case 'Y+': scene.up.set(0, 1, 0); break;
		case 'Y-': scene.up.set(0, -1, 0); break;
		case 'Z+': scene.up.set(0, 0, 1); break;
		case 'Z-': scene.up.set(0, 0, -1); break;
	}
	camera.up.copy((scene as any).up);
	alignGroundToUpAxis();
}

function resize() {
	const el = renderer.domElement;
	const parent = el.parentElement!;
	const w = parent.clientWidth;
	const h = parent.clientHeight;
	if ((el as any).width !== w || (el as any).height !== h) {
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
}
window.addEventListener('resize', resize);

function recenterTo(object: any) {
	const box = new (THREE as any).Box3().setFromObject(object);
	const size = box.getSize(new (THREE as any).Vector3());
	const center = box.getCenter(new (THREE as any).Vector3());
	const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
	orbit.target.copy(center);
	const dist = radius * 3;
	camera.position.copy(center.clone().add(new (THREE as any).Vector3(dist, dist, dist)));
	camera.lookAt(center);
	orbit.update();
}

function clearRobot() {
	if (robot) {
		scene.remove(robot as any);
		robot = null;
	}
}

function setJointUI(jointName: string, j: URDFJoint, radians: boolean) {
	const slider = document.getElementById('jointSlider') as HTMLInputElement;
	const info = document.getElementById('jointInfo') as HTMLDivElement;
	const jt = (j as any).jointType ?? 'unknown';
	const lim = (j as any).limit ?? { lower: 0, upper: 0 };
	let lowerR = Number.isFinite(lim.lower) ? lim.lower : 0;
	let upperR = Number.isFinite(lim.upper) ? lim.upper : 0;
	let span = Math.max(Math.abs(lowerR), Math.abs(upperR));
	// For continuous joints or missing/zero-span limits, choose a symmetric default span
	if (jt === 'continuous' || span === 0) span = Math.PI;
	const lower = radians ? -span : (THREE as any).MathUtils.radToDeg(-span);
	const upper = radians ? span : (THREE as any).MathUtils.radToDeg(span);
	slider.min = String(lower);
	slider.max = String(upper);
	slider.step = String(radians ? 0.001 : 0.1);
	slider.value = '0';
	const dispLower = radians ? -span : (THREE as any).MathUtils.radToDeg(-span);
	const dispUpper = radians ? span : (THREE as any).MathUtils.radToDeg(span);
	info.textContent = `${jointName} [${jt}] range: ${dispLower.toFixed(3)}..${dispUpper.toFixed(3)}`;
}

function getJointNamesFiltered(hideFixed: boolean): string[] {
	if (!robot) return [];
	const all = Object.keys(robot.joints);
	if (!hideFixed) return all;
	return all.filter(n => (robot as any).joints[n].jointType !== 'fixed');
}

function populateJointsUI(radians: boolean, hideFixed: boolean) {
	const select = document.getElementById('jointSelect') as HTMLSelectElement;
	const prev = select.value;
	select.innerHTML = '';
	if (!robot) return;
	const names = getJointNamesFiltered(hideFixed);
	names.forEach(name => {
		const opt = document.createElement('option');
		opt.value = name;
		opt.textContent = name;
		select.appendChild(opt);
	});
	if (select.options.length > 0) {
		const idx = names.indexOf(prev);
		select.selectedIndex = idx >= 0 ? idx : 0;
		setJointUI(select.value, (robot as any).joints[select.value], radians);
	}
}

async function loadURDF(url: string, packagesBase: string) {
	clearRobot();
	revokeAllLocalBlobs();
	loader = new URDFLoader();
	if (packagesBase) {
		loader.packages = packagesBase;
	}
	const showCollision = (document.getElementById('showCollision') as HTMLInputElement).checked;
	loader.parseCollision = showCollision;

	if (localFS) {
		// Override loader mesh using local FS
		loader.loadMeshCb = async (path, manager, onComplete) => {
			try {
				const blobUrl = await resolveLocalPathToBlobURL(path);
				if (!blobUrl) return onComplete(null as any, new Error('Not found: ' + path));
				const ext = (path.split('.').pop() || '').toLowerCase();
				if (ext === 'gltf' || ext === 'glb') {
					const gltf = new GLTFLoader(manager);
					gltf.load(blobUrl, (res: any) => onComplete(res.scene), undefined, (err: any) => onComplete(null as any, err as any));
				} else if (ext === 'dae') {
					const collada = new ColladaLoader(manager);
					collada.load(blobUrl, (res: any) => onComplete(res.scene), undefined, (err: any) => onComplete(null as any, err as any));
				} else if (ext === 'stl') {
					const stl = new STLLoader(manager);
					stl.load(blobUrl, (geom: any) => {
						const mat = new (THREE as any).MeshStandardMaterial({ color: 0x888888 });
						const mesh = new (THREE as any).Mesh(geom, mat);
						onComplete(mesh);
					}, undefined, (err: any) => onComplete(null as any, err as any));
				} else if (ext === 'obj') {
					const obj = new OBJLoader(manager);
					obj.load(blobUrl, (res: any) => onComplete(res), undefined, (err: any) => onComplete(null as any, err as any));
				} else {
					// Fallback: try GLTF
					const gltf = new GLTFLoader(manager);
					gltf.load(blobUrl, (res: any) => onComplete(res.scene), undefined, (err: any) => onComplete(null as any, err as any));
				}
			} catch (e: any) {
				onComplete(null as any, e);
			}
		};
	}

	try {
		if (localFS && !/^https?:\/\//i.test(url) && !/^\//.test(url)) {
			// URDF from local FS only
			const urdfBlob = await resolveLocalPathToBlob(url);
			if (!urdfBlob) throw new Error('URDF not found in selected folder: ' + url);
			const text = await urdfBlob.text();
			robot = loader.parse(text);
		} else {
			robot = await loader.loadAsync(url);
		}

		renderer.shadowMap.enabled = true;
		(robot as any).traverse((obj: any) => {
			const anyObj = obj as any;
			if ('castShadow' in anyObj) anyObj.castShadow = true;
			if ('receiveShadow' in anyObj) anyObj.receiveShadow = true;
		});
		scene.add(robot as any);
		if ((document.getElementById('autoCenter') as HTMLInputElement).checked) recenterTo(robot as any);
		const useRadians = (document.getElementById('useRadians') as HTMLInputElement).checked;
		const hideFixed = (document.getElementById('hideFixed') as HTMLInputElement).checked;
		populateJointsUI(useRadians, hideFixed);
		lastUrl = url;
		lastPackages = packagesBase || null;
	} catch (e) {
		console.error(e);
		alert('Failed to load URDF. Check console for details.');
	}
}

function animate() {
	requestAnimationFrame(animate);
	orbit.update();
	if (trackball && (trackball as any).enabled) (trackball as any).update();
	renderer.render(scene, camera);
}

async function resolveLocalPathToBlob(path: string): Promise<Blob | null> {
	if (!localFS) return null;
	let normalized = path;
	// Handle ROS-style $(find pkg)/... patterns
	normalized = normalized.replace(/\$\(find [^)]+\)\/?/g, '');
	// Handle package:// prefixes
	normalized = normalized.replace(/^package:\/\//, '');
	if (normalized.startsWith('/')) normalized = normalized.slice(1);
	for (const [p, f] of localFS.entries()) {
		if (p.endsWith(normalized)) return f;
	}
	normalized = normalized.replace(/^\.\//, '');
	for (const [p, f] of localFS.entries()) {
		if (p.endsWith(normalized)) return f;
	}
	return null;
}

async function resolveLocalPathToBlobURL(path: string): Promise<string | null> {
	const blob = await resolveLocalPathToBlob(path);
	if (!blob) return null;
	if (localBlobURLByPath.has(path)) return localBlobURLByPath.get(path)!;
	const url = URL.createObjectURL(blob);
	localBlobURLByPath.set(path, url);
	return url;
}

function initUI() {
	const upAxis = document.getElementById('upAxis') as HTMLSelectElement;
	upAxis.addEventListener('change', () => setUpAxis(upAxis.value));
	setUpAxis(upAxis.value);

	const freeRotate = document.getElementById('freeRotate') as HTMLInputElement;
	freeRotate.addEventListener('change', () => setControlsMode(freeRotate.checked));
	setControlsMode(freeRotate.checked);

	const loadBtn = document.getElementById('loadBtn') as HTMLButtonElement;
	const urdfUrl = document.getElementById('urdfUrl') as HTMLInputElement;
	const pkgBase = document.getElementById('pkgBase') as HTMLInputElement;
	loadBtn.addEventListener('click', () => {
		if (!urdfUrl.value) {
			alert('Enter URDF URL');
			return;
		}
		localFS = null; // network mode
		loadURDF(urdfUrl.value, pkgBase.value);
	});

	const pickFolderBtn = document.getElementById('pickFolderBtn') as HTMLButtonElement;
	const folderInput = document.getElementById('folderInput') as HTMLInputElement;
	const localUrdfSelect = document.getElementById('localUrdfSelect') as HTMLSelectElement;
	const folderInfo = document.getElementById('folderInfo') as HTMLDivElement;
	const loadLocalBtn = document.getElementById('loadLocalBtn') as HTMLButtonElement;

	pickFolderBtn.addEventListener('click', () => folderInput.click());
	folderInput.addEventListener('change', async () => {
		if (!folderInput.files || folderInput.files.length === 0) return;
		localFS = new Map();
		revokeAllLocalBlobs();
		for (const f of Array.from(folderInput.files)) {
			localFS.set((f as any).webkitRelativePath || f.name, f);
		}
		const urdfs = Array.from(localFS.keys()).filter(p => p.toLowerCase().endsWith('.urdf'));
		localUrdfSelect.innerHTML = '';
		urdfs.forEach(p => {
			const opt = document.createElement('option');
			opt.value = p;
			opt.textContent = p;
			localUrdfSelect.appendChild(opt);
		});
		folderInfo.textContent = `${localFS.size} files indexed; ${urdfs.length} URDF found`;
	});

	loadLocalBtn.addEventListener('click', async () => {
		if (!localFS) { alert('Pick a folder first.'); return; }
		const choice = localUrdfSelect.value;
		if (!choice) { alert('Select a URDF in the dropdown.'); return; }
		lastUrl = choice;
		lastPackages = null;
		await loadURDF(choice, '');
	});

	const jointSelect = document.getElementById('jointSelect') as HTMLSelectElement;
	const jointSlider = document.getElementById('jointSlider') as HTMLInputElement;
	const useRadians = document.getElementById('useRadians') as HTMLInputElement;
	const ignoreLimits = document.getElementById('ignoreLimits') as HTMLInputElement;
	const hideFixed = document.getElementById('hideFixed') as HTMLInputElement;
	const showCollision = document.getElementById('showCollision') as HTMLInputElement;

	jointSelect.addEventListener('change', () => {
		if (!robot) return;
		const name = jointSelect.value;
		setJointUI(name, (robot as any).joints[name], useRadians.checked);
	});

	jointSlider.addEventListener('input', () => {
		if (!robot) return;
		const name = jointSelect.value;
		const j: URDFJoint | undefined = (robot as any).joints[name];
		if (!j) return;
		const radians = useRadians.checked;
		const val = parseFloat(jointSlider.value);
		(j as any).ignoreLimits = ignoreLimits.checked;
		(j as any).setJointValue(radians ? val : (THREE as any).MathUtils.degToRad(val));
	});

	useRadians.addEventListener('change', () => {
		if (!robot) return;
		const name = jointSelect.value;
		setJointUI(name, (robot as any).joints[name], useRadians.checked);
	});

	hideFixed.addEventListener('change', () => {
		const radians = useRadians.checked;
		populateJointsUI(radians, hideFixed.checked);
	});

	showCollision.addEventListener('change', async () => {
		if (!lastUrl) return;
		await loadURDF(lastUrl, lastPackages || '');
	});

	const animateJoints = document.getElementById('animateJoints') as HTMLInputElement;
	let t = 0;
	async function animateJointValues() {
		if (!robot || !animateJoints.checked) return;
		const names = Object.keys((robot as any).joints);
		for (let i = 0; i < names.length; i++) {
			const j: any = (robot as any).joints[names[i]];
			if (j.jointType === 'revolute' || j.jointType === 'continuous') {
				j.setJointValue(Math.sin(t + i * 0.2) * 0.5);
			}
		}
		t += 0.02;
		requestAnimationFrame(animateJointValues);
	}
	animateJoints.addEventListener('change', () => {
		if (animateJoints.checked) animateJointValues();
	});
}

function bootstrap() {
	resize();
	initUI();
	animate();
}

bootstrap(); 