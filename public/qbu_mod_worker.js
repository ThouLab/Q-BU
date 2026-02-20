/* eslint-disable no-restricted-globals */

// Q-BU MOD worker (方式1): run Python in a WebWorker via Pyodide.
// - Loads Pyodide from CDN (jsDelivr)
// - Provides a tiny OOP-friendly helper module: qbu
// - Expects messages:
//   {type:'init'}
//   {type:'run', code:string, blocks:string[], colors:string[], defaultColor:string}
// - Returns:
//   {type:'ready'}
//   {type:'status', message:string}
//   {type:'result', ok:boolean, payload?:{blocks:string[],colors:string[]}, stdout?:string, stderr?:string, error?:string}

let _pyodide = null;
let _pyodideReady = null;

const PYODIDE_VERSION = "0.26.1";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const QBU_LIB_PY = `
import types, sys, math

qbu = types.ModuleType("qbu")

def key(x:int, y:int, z:int) -> str:
    return f"{int(x)},{int(y)},{int(z)}"

def parse_key(k:str):
    parts = str(k).split(",")
    if len(parts) != 3:
        raise ValueError(f"Invalid key: {k}")
    return (int(parts[0]), int(parts[1]), int(parts[2]))

def _norm_color(c, default):
    if isinstance(c, str) and len(c) > 0:
        return str(c)
    return str(default)


class Cube:
    def __init__(self, model: "Model", x:int, y:int, z:int):
        self._model = model
        self.x = int(x)
        self.y = int(y)
        self.z = int(z)

    @property
    def key(self) -> str:
        return key(self.x, self.y, self.z)

    def pos(self):
        return (self.x, self.y, self.z)

    @property
    def exists(self) -> bool:
        return (self.x, self.y, self.z) in self._model._voxels

    @property
    def color(self):
        return self._model._voxels.get((self.x, self.y, self.z))

    @color.setter
    def color(self, value):
        # If the cube doesn't exist yet, coloring it will create it.
        self._model._voxels[(self.x, self.y, self.z)] = _norm_color(value, self._model.default_color)

    def delete(self):
        self._model.remove(self.x, self.y, self.z)
        return self

    def neighbors6(self):
        d = [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
        return [Cube(self._model, self.x+dx, self.y+dy, self.z+dz) for dx,dy,dz in d]

    def __repr__(self):
        return f"Cube({self.x},{self.y},{self.z}, color={self.color})"


def _axis_value(val, axis: str):
    """Convert a plane/pivot value to an integer coordinate along the axis.

    Accepts:
      - int/float/str
      - Cube
      - (x,y,z) tuple/list
    """
    axis = (axis or "x").lower()
    if axis not in ("x", "y", "z"):
        raise ValueError("axis must be 'x', 'y', or 'z'")

    if isinstance(val, Cube):
        return int(getattr(val, axis))

    if isinstance(val, (tuple, list)) and len(val) >= 3:
        idx = {"x": 0, "y": 1, "z": 2}[axis]
        return int(val[idx])

    return int(val)


class Model:
    def __init__(self, default_color: str = "#9AA0A6"):
        self.default_color = str(default_color)
        self._voxels = {}  # (x,y,z) -> color
        # Ensure at least one cube exists as an entry point.
        self._voxels[(0, 0, 0)] = self.default_color

    @classmethod
    def from_arrays(cls, blocks, colors=None, default_color: str = "#9AA0A6"):
        m = cls(default_color=default_color)
        m._voxels = {}
        if blocks is None:
            blocks = []
        if colors is None:
            colors = []
        for i, k in enumerate(blocks):
            try:
                x, y, z = parse_key(k)
            except Exception:
                continue
            col = colors[i] if i < len(colors) else None
            m._voxels[(x, y, z)] = _norm_color(col, m.default_color)
        if len(m._voxels) == 0:
            m._voxels[(0, 0, 0)] = m.default_color
        return m

    def clone(self):
        b, c = self.to_arrays(sort=False)
        return Model.from_arrays(b, c, default_color=self.default_color)

    def cubes(self):
        for (x, y, z) in list(self._voxels.keys()):
            yield Cube(self, x, y, z)

    def cube(self, x:int, y:int, z:int) -> Cube:
        return Cube(self, x, y, z)

    def get(self, x:int, y:int, z:int):
        k = (int(x), int(y), int(z))
        if k in self._voxels:
            return Cube(self, x, y, z)
        return None

    def ensure(self, x:int, y:int, z:int, color=None) -> Cube:
        k = (int(x), int(y), int(z))
        if k not in self._voxels:
            self._voxels[k] = _norm_color(color, self.default_color)
        elif color is not None:
            self._voxels[k] = _norm_color(color, self.default_color)
        return Cube(self, x, y, z)

    def add(self, x:int, y:int, z:int, color=None) -> Cube:
        return self.ensure(x, y, z, color=color)

    def remove(self, x:int, y:int, z:int):
        self._voxels.pop((int(x), int(y), int(z)), None)
        if len(self._voxels) == 0:
            self._voxels[(0, 0, 0)] = self.default_color
        return self

    def clear(self, keep_origin: bool = True):
        self._voxels = {}
        if keep_origin:
            self._voxels[(0, 0, 0)] = self.default_color
        return self

    def set_color(self, x:int, y:int, z:int, color: str):
        k = (int(x), int(y), int(z))
        if k in self._voxels:
            self._voxels[k] = _norm_color(color, self.default_color)
        return self

    def mirror(self, axis: str = "x", plane=0, about=None):
        """Mirror (reflect-copy) all cubes across a plane.

        This operation keeps original cubes and adds their reflected copies.

        Args:
          axis: "x" | "y" | "z"
          plane: plane coordinate along the axis (e.g. x=0), or Cube, or (x,y,z) tuple/list.
          about: legacy alias for plane (kept for compatibility)
        """
        if about is not None:
            plane = about

        axis = (axis or "x").lower()
        if axis not in ("x", "y", "z"):
            raise ValueError("axis must be 'x', 'y', or 'z'")

        a = _axis_value(plane, axis)

        new_voxels = {}
        for (x, y, z), col in list(self._voxels.items()):
            if axis == "x":
                nx, ny, nz = (a + (a - x), y, z)
            elif axis == "y":
                nx, ny, nz = (x, a + (a - y), z)
            else:
                nx, ny, nz = (x, y, a + (a - z))

            kk = (int(nx), int(ny), int(nz))
            if kk not in self._voxels and kk not in new_voxels:
                new_voxels[kk] = col

        self._voxels.update(new_voxels)
        if len(self._voxels) == 0:
            self._voxels[(0, 0, 0)] = self.default_color
        return self

    def mirror_x(self, plane=0, about=None):
        return self.mirror(axis="x", plane=plane, about=about)

    def mirror_y(self, plane=0, about=None):
        return self.mirror(axis="y", plane=plane, about=about)

    def mirror_z(self, plane=0, about=None):
        return self.mirror(axis="z", plane=plane, about=about)

    def add_box(self, x0:int, y0:int, z0:int, x1:int, y1:int, z1:int, color=None, hollow: bool = False):
        x0, x1 = sorted([int(x0), int(x1)])
        y0, y1 = sorted([int(y0), int(y1)])
        z0, z1 = sorted([int(z0), int(z1)])
        col = _norm_color(color, self.default_color)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    if hollow:
                        on_surface = (x in (x0, x1)) or (y in (y0, y1)) or (z in (z0, z1))
                        if not on_surface:
                            continue
                    self._voxels[(x, y, z)] = col
        if len(self._voxels) == 0:
            self._voxels[(0, 0, 0)] = self.default_color
        return self

    def add_sphere(self, center=(0, 0, 0), radius: float = 5.0, color=None, hollow: bool = False):
        cx, cy, cz = (float(center[0]), float(center[1]), float(center[2]))
        r = float(radius)
        r2 = r * r
        col = _norm_color(color, self.default_color)

        x0 = math.floor(cx - r)
        x1 = math.ceil(cx + r)
        y0 = math.floor(cy - r)
        y1 = math.ceil(cy + r)
        z0 = math.floor(cz - r)
        z1 = math.ceil(cz + r)

        inner = max(0.0, r - 1.0)
        inner2 = inner * inner

        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
                    if d2 <= r2 + 1e-9:
                        if hollow and d2 < inner2 - 1e-9:
                            continue
                        self._voxels[(x, y, z)] = col
        if len(self._voxels) == 0:
            self._voxels[(0, 0, 0)] = self.default_color
        return self

    def paint_checker(self, color_a: str, color_b: str, period: int = 1, axes=("x", "z")):
        ca = str(color_a)
        cb = str(color_b)
        p = max(1, int(period))
        axes = tuple(str(a) for a in axes)
        for (x, y, z), _col in list(self._voxels.items()):
            acc = 0
            for ax in axes:
                if ax == "x":
                    acc += (x // p)
                elif ax == "y":
                    acc += (y // p)
                elif ax == "z":
                    acc += (z // p)
            self._voxels[(x, y, z)] = ca if (acc % 2 == 0) else cb
        return self

    def to_arrays(self, sort: bool = True):
        if len(self._voxels) == 0:
            self._voxels[(0, 0, 0)] = self.default_color
        coords = list(self._voxels.keys())
        if sort:
            coords.sort(key=lambda t: (t[0], t[1], t[2]))
        blocks = [key(x, y, z) for (x, y, z) in coords]
        colors = [self._voxels[(x, y, z)] for (x, y, z) in coords]
        return blocks, colors

    def to_payload(self, sort: bool = True):
        b, c = self.to_arrays(sort=sort)
        return {"blocks": b, "colors": c}


class World:
    def __init__(self, model: Model | None = None, default_color: str = "#9AA0A6"):
        if model is None:
            model = Model(default_color=default_color)
        self.model = model

    @classmethod
    def from_arrays(cls, blocks, colors=None, default_color: str = "#9AA0A6"):
        return cls(Model.from_arrays(blocks, colors, default_color=default_color), default_color=default_color)

    def clone(self):
        return World(self.model.clone(), default_color=self.model.default_color)

    def to_payload(self, sort: bool = True):
        return self.model.to_payload(sort=sort)


class Op:
    def apply(self, model: Model):
        raise NotImplementedError


class Mirror(Op):
    def __init__(self, axis: str = "x", plane=0, about=None):
        self.axis = str(axis)
        # about: legacy alias for plane
        self.plane = about if about is not None else plane

    def apply(self, model: Model):
        model.mirror(axis=self.axis, plane=self.plane)


class Box(Op):
    def __init__(self, x0:int, y0:int, z0:int, x1:int, y1:int, z1:int, color=None, hollow: bool = False):
        self.x0, self.y0, self.z0 = int(x0), int(y0), int(z0)
        self.x1, self.y1, self.z1 = int(x1), int(y1), int(z1)
        self.color = color
        self.hollow = bool(hollow)

    def apply(self, model: Model):
        model.add_box(self.x0, self.y0, self.z0, self.x1, self.y1, self.z1, color=self.color, hollow=self.hollow)


class Sphere(Op):
    def __init__(self, center=(0, 0, 0), radius: float = 5.0, color=None, hollow: bool = False):
        self.center = center
        self.radius = float(radius)
        self.color = color
        self.hollow = bool(hollow)

    def apply(self, model: Model):
        model.add_sphere(center=self.center, radius=self.radius, color=self.color, hollow=self.hollow)


class CheckerPaint(Op):
    def __init__(self, color_a: str, color_b: str, period: int = 1, axes=("x", "z")):
        self.color_a = str(color_a)
        self.color_b = str(color_b)
        self.period = max(1, int(period))
        self.axes = tuple(str(a) for a in axes)

    def apply(self, model: Model):
        model.paint_checker(self.color_a, self.color_b, period=self.period, axes=self.axes)


qbu.key = key
qbu.parse_key = parse_key
qbu.Cube = Cube
qbu.Model = Model
qbu.World = World
qbu.Op = Op
qbu.Mirror = Mirror
qbu.Box = Box
qbu.Sphere = Sphere
qbu.CheckerPaint = CheckerPaint

sys.modules["qbu"] = qbu
`;

async function initPyodide() {
  if (_pyodideReady) return _pyodideReady;

  _pyodideReady = (async () => {
    self.postMessage({ type: "status", message: "Pyodide を読み込んでいます..." });
    // Load loader script
    // eslint-disable-next-line no-undef
    importScripts(PYODIDE_BASE + "pyodide.js");

    self.postMessage({ type: "status", message: "Pyodide を初期化しています..." });
    // eslint-disable-next-line no-undef
    _pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    self.postMessage({ type: "status", message: "qbu ライブラリを準備しています..." });
    await _pyodide.runPythonAsync(QBU_LIB_PY);

    self.postMessage({ type: "ready" });
  })();

  return _pyodideReady;
}

async function runUserCode({ code, blocks, colors, defaultColor }) {
  await initPyodide();

  // Build python runner.
  // NOTE: keep all communication as JSON to avoid proxy objects.
  _pyodide.globals.set("__blocks", Array.isArray(blocks) ? blocks : []);
  _pyodide.globals.set("__colors", Array.isArray(colors) ? colors : []);
  _pyodide.globals.set("__default_color", typeof defaultColor === "string" ? defaultColor : "#9AA0A6");
  _pyodide.globals.set("__user_code", typeof code === "string" ? code : "");

  const runner = `
import json, traceback, io, sys
import qbu

def _run():
    world = qbu.World.from_arrays(__blocks, __colors, default_color=__default_color)
    model = world.model

    _stdout = io.StringIO()
    _stderr = io.StringIO()
    _old_out, _old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _stdout, _stderr
    try:
        # provide globals for user code
        g = {"qbu": qbu, "world": world, "model": model}
        exec(__user_code, g, g)

        # allow user code to rebind world/model
        world_out = g.get("world", world)
        model_out = getattr(world_out, "model", None) or g.get("model", model)
        if hasattr(world_out, "to_payload"):
            payload = world_out.to_payload(sort=True)
        else:
            payload = model_out.to_payload(sort=True)
        return {"ok": True, "payload": payload, "stdout": _stdout.getvalue(), "stderr": _stderr.getvalue()}
    except Exception:
        return {"ok": False, "error": traceback.format_exc(), "stdout": _stdout.getvalue(), "stderr": _stderr.getvalue()}
    finally:
        sys.stdout, sys.stderr = _old_out, _old_err

json.dumps(_run())
`;

  const out = await _pyodide.runPythonAsync(runner);
  return JSON.parse(out);
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === "init") {
      await initPyodide();
      return;
    }

    if (msg.type === "run") {
      self.postMessage({ type: "status", message: "Python を実行しています..." });
      const res = await runUserCode(msg);
      self.postMessage({ type: "result", ...res });
      return;
    }
  } catch (e) {
    self.postMessage({ type: "result", ok: false, error: String(e?.stack || e?.message || e) });
  }
};
