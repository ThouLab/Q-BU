/*
  Minimal type shim for three.js.

  Why:
  - This repository uses `three` but does NOT ship TypeScript declaration files in `node_modules/three`.
  - A placeholder like `declare module "three";` makes the module exist but exports NOTHING,
    which breaks `THREE.WebGLRenderer`, named imports, etc.

  Policy:
  - Keep this shim SMALL and permissive (mostly `any`) so production builds never fail due to typings.
  - If you want strict typing, install `@types/three` and DELETE this file.

  NOTE:
  - Only the symbols used in this repo are declared here.
  - Add more exports when you introduce new three.js APIs.
*/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

declare module "three" {
  export const SRGBColorSpace: Any;
  export const NearestFilter: Any;
  export const DoubleSide: Any;

  export class WebGLRenderer {
    constructor(params?: Any);
    domElement: Any;
    outputColorSpace: Any;
    setClearColor(color: Any, alpha?: number): void;
    setPixelRatio(r: number): void;
    setSize(w: number, h: number, updateStyle?: boolean): void;
    render(scene: Any, camera: Any): void;
    dispose(): void;
    [key: string]: Any;
  }

  export class Scene {
    constructor();
    background: Any;
    add(...args: Any[]): void;
    remove(...args: Any[]): void;
    traverse(fn: (obj: Any) => void): void;
    lookAt(...args: Any[]): void;
    [key: string]: Any;
  }

  export class PerspectiveCamera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    position: Any;
    quaternion: Any;
    lookAt(...args: Any[]): void;
    updateProjectionMatrix(): void;
    [key: string]: Any;
  }

  export class OrthographicCamera {
    constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number);
    position: Any;
    quaternion: Any;
    lookAt(...args: Any[]): void;
    updateProjectionMatrix(): void;
    [key: string]: Any;
  }

  export class Raycaster {
    constructor();
    setFromCamera(mouse: Any, camera: Any): void;
    intersectObjects(objects: Any, recursive?: boolean): Any[];
    intersectObject(object: Any, recursive?: boolean): Any[];
    [key: string]: Any;
  }

  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): this;
    [key: string]: Any;
  }

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    clone(): Vector3;
    subVectors(a: Any, b: Any): this;
    crossVectors(a: Any, b: Any): this;
    normalize(): this;
    applyQuaternion(q: Any): this;
    applyMatrix3(m: Any): this;
    lerp(v: Any, alpha: number): this;
    [key: string]: Any;
  }

  export class Euler {
    constructor(x?: number, y?: number, z?: number, order?: string);
    x: number;
    y: number;
    z: number;
    [key: string]: Any;
  }

  export class Quaternion {
    constructor(x?: number, y?: number, z?: number, w?: number);
    setFromUnitVectors(vFrom: Any, vTo: Any): this;
    [key: string]: Any;
  }

  export class Matrix3 {
    constructor();
    getNormalMatrix(m: Any): this;
    [key: string]: Any;
  }

  export class Matrix4 {
    constructor();
    [key: string]: Any;
  }

  export class Color {
    constructor(color?: Any);
    set(color: Any): this;
    [key: string]: Any;
  }

  export class Object3D {
    constructor();
    position: Any;
    rotation: Any;
    quaternion: Any;
    scale: Any;
    matrixWorld: Any;
    children: Any[];
    add(...args: Any[]): void;
    remove(...args: Any[]): void;
    traverse(fn: (obj: Any) => void): void;
    lookAt(...args: Any[]): void;
    dispose?: () => void;
    [key: string]: Any;
  }

  export class Group extends Object3D {
    constructor();
    [key: string]: Any;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: Any, material?: Any);
    geometry: Any;
    material: Any;
    [key: string]: Any;
  }

  export class InstancedMesh extends Mesh {
    constructor(geometry: Any, material: Any, count: number);
    count: number;
    instanceMatrix: Any;
    setMatrixAt(index: number, matrix: Any): void;
    [key: string]: Any;
  }

  export class LineSegments extends Object3D {
    constructor(geometry: Any, material: Any);
    geometry: Any;
    material: Any;
    [key: string]: Any;
  }

  export class GridHelper extends Object3D {
    constructor(size: number, divisions: number, color1?: Any, color2?: Any);
    [key: string]: Any;
  }

  export class BoxGeometry {
    constructor(w: number, h: number, d: number);
    dispose(): void;
    [key: string]: Any;
  }

  export class PlaneGeometry {
    constructor(w: number, h: number);
    dispose(): void;
    [key: string]: Any;
  }

  export class EdgesGeometry {
    constructor(geometry: Any);
    dispose(): void;
    [key: string]: Any;
  }

  export class TextureLoader {
    constructor();
    load(url: string): Any;
    [key: string]: Any;
  }

  export class MeshStandardMaterial {
    constructor(params?: Any);
    dispose(): void;
    [key: string]: Any;
  }

  export class MeshBasicMaterial {
    constructor(params?: Any);
    dispose(): void;
    [key: string]: Any;
  }

  export class LineBasicMaterial {
    constructor(params?: Any);
    dispose(): void;
    [key: string]: Any;
  }

  export class AmbientLight extends Object3D {
    constructor(color: Any, intensity?: number);
    [key: string]: Any;
  }

  export class DirectionalLight extends Object3D {
    constructor(color: Any, intensity?: number);
    [key: string]: Any;
  }

  export class HemisphereLight extends Object3D {
    constructor(skyColor: Any, groundColor: Any, intensity?: number);
    [key: string]: Any;
  }
}

declare module "three/examples/jsm/exporters/STLExporter.js" {
  export class STLExporter {
    constructor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse(scene: any, options?: any): any;
  }
}
