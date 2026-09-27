"""Execute trusted Python with an eager Bend-backed build123d compatibility module.

The model runs like ``python model.py``: as ``__main__``, with ``__file__`` and
``sys.argv`` set, and with its directory plus the nearest project root (the
closest ancestor holding a pyproject.toml) at the front of ``sys.path``. Every
module imported from outside the standard library (the model directory, the
project root or a directory the model adds to ``sys.path`` itself) is recorded
with its path and SHA-256, and is compiled from exactly the hashed bytes: a
__pycache__ .pyc is never executed for it (-B alone only stops writing them).
Python files the model loads by path (``importlib.util.spec_from_file_location``
plus ``exec_module``, ``runpy.run_path``, ``exec(open(...).read())``) are
recorded too, through an audit hook. Project modules named like a standard
library module that the runner or the shim imported first (json, colorsys,
...) replace it on the model's first import, as under ``python model.py``.
Python itself stays isolated (``-I -S``): no user site-packages, no PYTHON*
environment variables and no installed third-party packages. An installed
package is recognized by its location (site-packages, dist-packages, .egg,
including the interpreter's own lib/pythonX.Y/site-packages)
or by its installation record (``*.dist-info/RECORD``, ``*.egg-info/
installed-files.txt``), so ``pip install --target`` directories and package
caches stay closed as well. Besides the standard library and project modules,
only wonky-provided modules from this directory (build123d, ocp_vscode, ...)
are importable; any other package fails with a capability error at its import
line.
"""

import sys

# What the interpreter imported before the runner did (-I -S): these, builtin
# and frozen modules are already loaded under `python model.py` too, so a
# project module of the same name never replaces them.
STARTUP_MODULES = frozenset(sys.modules)

import builtins
import csv
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import traceback
import types

WONKY_DIR = Path(__file__).resolve().parent
IMPORTLIB_DIR = os.path.dirname(os.path.abspath(importlib.__file__))
EXTERNAL_GEOMETRY = ("OCP", "OCC", "cadquery")
RUNNER_ONLY = {"runner", "build123d"}
OS_ERRORS = ("OSError", "PermissionError", "FileNotFoundError", "IsADirectoryError", "NotADirectoryError")


class Channel:
    def __init__(self):
        self.incoming = os.fdopen(3, "r", encoding="utf-8")
        self.outgoing = os.fdopen(4, "w", encoding="utf-8", buffering=1)
        self.serial = 0

    def send(self, message):
        self.outgoing.write(json.dumps(message, allow_nan=False) + "\n")
        self.outgoing.flush()

    def request(self, op, **arguments):
        self.serial += 1
        self.send({"type": "request", "id": self.serial, "op": op, **arguments})
        line = self.incoming.readline()
        if not line:
            raise RuntimeError("Bend host closed the request pipe")
        response = json.loads(line)
        if response.get("id") != self.serial:
            raise RuntimeError("Bend response does not match the request")
        if not response["ok"]:
            error = response["error"]
            if error["type"] == "UnsupportedFeatureError":
                raise shim.UnsupportedFeatureError(error["message"])
            if error["type"] in OS_ERRORS:
                # A file the host could not or would not write (export_step/export_stl).
                raise getattr(builtins, error["type"])(error["message"])
            raise RuntimeError(error["message"])
        return response["value"]


def load(name, path, locations=None):
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=locations)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def installed_location(path):
    """True for a path inside a site-packages or dist-packages directory or an .egg."""
    return any(part in ("site-packages", "dist-packages") or part.endswith(".egg") for part in path.split(os.sep))


_RECORDED = {}


def recorded_files(directory):
    """{absolute file: installation record} for the installed distributions directly in ``directory``.

    pip, uv and setuptools list every installed file in ``<dist>.dist-info/RECORD``
    (paths relative to the directory holding the dist-info) or in
    ``<dist>.egg-info/installed-files.txt`` (relative to the egg-info). An
    editable checkout's own ``*.egg-info`` has no such listing and stays project code.
    """
    files = _RECORDED.get(directory)
    if files is not None:
        return files
    files = {}
    try:
        entries = os.listdir(directory)
    except OSError:
        entries = []
    for entry in sorted(entries):
        if entry.endswith(".dist-info"):
            listing, base = os.path.join(directory, entry, "RECORD"), directory
        elif entry.endswith(".egg-info"):
            listing, base = os.path.join(directory, entry, "installed-files.txt"), os.path.join(directory, entry)
        else:
            continue
        try:
            with open(listing, encoding="utf-8", newline="") as handle:
                rows = list(csv.reader(handle)) if listing.endswith("RECORD") else [[line.strip()] for line in handle]
        except (OSError, UnicodeDecodeError, csv.Error):
            continue
        for row in rows:
            if row and row[0]:
                files.setdefault(os.path.normpath(os.path.join(base, row[0])), os.path.relpath(listing, directory))
    _RECORDED[directory] = files
    return files


def installation(origin):
    """Why ``origin`` belongs to an installed distribution, or None for project code.

    A site-packages, dist-packages or .egg location, or an installation record
    of an ancestor directory that lists this very file (``pip install --target
    .deps``, uv's archive cache, a copied site directory).
    """
    if installed_location(origin):
        return "a site-packages, dist-packages or .egg location"
    directory = os.path.dirname(origin)
    while True:
        record = recorded_files(directory).get(origin)
        if record is not None:
            return f"its installation record {os.path.join(directory, record)}"
        parent = os.path.dirname(directory)
        if parent == directory:
            return None
        directory = parent


def provided_modules():
    """Top-level modules wonky provides from this directory: name -> (path, is_package)."""
    found = {}
    for entry in WONKY_DIR.iterdir():
        if entry.name.startswith(("_", ".")):
            continue
        if entry.is_file() and entry.suffix == ".py" and entry.stem not in RUNNER_ONLY:
            found[entry.stem] = (entry, False)
        elif entry.is_dir() and (entry / "__init__.py").is_file() and entry.name not in RUNNER_ONLY:
            found[entry.name] = (entry / "__init__.py", True)
    return found


channel = Channel()
runtime = load("_wonky_runtime", WONKY_DIR / "_wonky_runtime.py")
runtime._channel = channel
# build123d may be a single-file shim or a package directory. A single file is
# a package with an empty submodule path ("'build123d' is not a package" never
# happens); the shim registers the build123d 0.13.0 submodules it knows, so an
# import that still reaches the finders names a submodule build123d lacks too.
if (WONKY_DIR / "build123d" / "__init__.py").is_file():
    shim = load("build123d", WONKY_DIR / "build123d" / "__init__.py", [str(WONKY_DIR / "build123d")])
else:
    shim = load("build123d", WONKY_DIR / "build123d.py", [])
shim._channel = channel
runtime._shim = shim
# export_step/export_stl are model outputs under the result contract. The shim
# delegates them to _wonky_runtime; a shim without them gets the runtime's.
for _name in ("export_step", "export_stl"):
    vars(shim).setdefault(_name, getattr(runtime, _name))
PROVIDED = provided_modules()
# Package-specific reasons for the unavailable-package error (python/_wonky_packages.py).
PACKAGES = load("_wonky_packages", WONKY_DIR / "_wonky_packages.py") \
    if (WONKY_DIR / "_wonky_packages.py").is_file() else None
# The interpreter's own search path before any project entry: with -I -S only
# the standard library (zip, lib/pythonX.Y, lib-dynload), never site-packages.
STDLIB_PATHS = [os.path.abspath(entry) for entry in sys.path if entry and not installed_location(entry)]


def stdlib_file(path):
    """True for a file of the interpreter's standard library.

    That is a file below a startup search-path entry, but not inside an
    installed-package directory there: lib/pythonX.Y holds the interpreter's
    own site-packages (pip, and whatever pip installed into a Homebrew or uv
    Python), which -S leaves off sys.path but a model can append.
    """
    for entry in STDLIB_PATHS:
        if under(path, entry):
            return not installed_location(path[len(entry):])
    return False


def package_policy():
    return getattr(PACKAGES, "POLICY", None) or "docs/python-frontend.md"


def package_reason(package):
    return PACKAGES.reason(package) if PACKAGES is not None else None


def unsupported(message, frame=None):
    return runtime.capability(message, frame)


def importer_frame():
    """The frame whose code triggered the current import (skipping importlib)."""
    frame = sys._getframe(2)
    while frame is not None:
        filename = frame.f_code.co_filename
        if not (filename.startswith("<frozen ") or filename.startswith(IMPORTLIB_DIR + os.sep)
                or filename == __file__):
            return frame
        frame = frame.f_back
    return None


def under(path, directory):
    return path == directory or path.startswith(directory + os.sep)


class NoExternalGeometry:
    """First finder: refuse external B-rep kernels, even when a project ships a module of that name."""

    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in EXTERNAL_GEOMETRY:
            unsupported(f"External geometry import '{fullname}' is disabled; production geometry must be constructed in Bend")
        return None


class ProvidedModules:
    """Wonky-provided top-level modules take precedence over project and stdlib names."""

    def find_spec(self, fullname, path=None, target=None):
        if path is None and fullname in PROVIDED:
            location, package = PROVIDED[fullname]
            return importlib.util.spec_from_file_location(
                fullname, location, submodule_search_locations=[str(location.parent)] if package else None)
        return None


class ProjectModules:
    """Resolve path-based imports exactly like CPython's PathFinder and record every non-stdlib module.

    The search is CPython's own (``sys.path`` in order, or the parent package's
    ``__path__``), so a model that extends ``sys.path`` itself keeps working as
    under ``python model.py``. Whatever resolves outside the interpreter's
    standard library is project code and is recorded with its SHA-256, whether
    it came from the model directory, the project root or a directory the model
    added. A module of an installed distribution (site-packages, or listed by an
    installation record, see ``installation``) stays unavailable, even when the
    model puts its directory on ``sys.path``.
    """

    def __init__(self, roots):
        self.roots = roots
        self.loaded = []
        self.seen = set()
        self.executed = {}  # real path -> SHA-256 of the source bytes compiled for it

    def owns(self, origin):
        return os.path.realpath(origin) in self.seen or any(under(origin, root) for root in self.roots)

    def find_spec(self, fullname, path=None, target=None):
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        # Namespace portions (directories without __init__.py) have no file of
        # their own; the real PathFinder builds them and their submodules come
        # back here with the portion's path.
        if spec is None or not spec.has_location or not spec.origin:
            return None
        origin = os.path.abspath(spec.origin)
        if under(origin, str(WONKY_DIR)):
            return None
        if stdlib_file(origin):
            return spec
        refuse_installed(fullname, origin, importer_frame())
        self.record(origin, fullname)
        return spec

    def record(self, origin, module, **extra):
        """Record one project file (real path + SHA-256) once; returns its provenance entry.

        A later load of the same file (read first, then executed) fills in what
        the first record lacked: the module name and the stronger loader kind.
        """
        path = os.path.realpath(origin)
        if path in self.seen:
            entry = next((entry for entry in self.loaded if entry["path"] == path), None)
            if entry is not None:
                if entry.get("module") is None and module is not None:
                    entry["module"] = module
                if entry.get("loader") == "open" and extra.get("loader") == "exec":
                    entry["loader"] = "exec"
            return entry
        self.seen.add(path)
        digest = self.executed.get(path)
        if digest is None:
            with open(path, "rb") as handle:
                digest = hashlib.sha256(handle.read()).hexdigest()
        entry = {"module": module, "path": path, "sha256": digest, **extra}
        shadowed = shadows.replaced.get(module) if module else None
        if shadowed:
            entry["shadows"] = shadowed
        self.loaded.append(entry)
        return entry

    def known(self, origin):
        return os.path.realpath(origin) in self.seen

    def compiled(self, origin, data):
        """Note the exact source bytes compiled for ``origin``; its record then hashes those bytes."""
        path = os.path.realpath(origin)
        digest = hashlib.sha256(data).hexdigest()
        self.executed[path] = digest
        for entry in self.loaded:
            if entry["path"] == path:
                entry["sha256"] = digest


_source_get_code = importlib.machinery.SourceFileLoader.get_code


def fresh_get_code(loader, fullname):
    """``SourceFileLoader.get_code`` for model-side files: compile the source, never a cached .pyc.

    -B only stops Python from writing bytecode. CPython still executes a
    __pycache__ .pyc whose recorded source mtime and size match (an edit of the
    same size within the same second) or whose hash it is told not to check
    (unchecked-hash pycs), so the code that ran could differ from the file
    whose SHA-256 the provenance records. Project modules, and files the model
    loads by path through importlib, are therefore compiled from the very bytes
    that are hashed. The standard library and wonky's own modules keep
    CPython's cache.
    """
    path = loader.get_filename(fullname)
    absolute = os.path.abspath(path)
    if stdlib_file(absolute) or wonky_file(absolute):
        return _source_get_code(loader, fullname)
    data = loader.get_data(path)
    project.compiled(absolute, data)
    return loader.source_to_code(data, path)


def refuse_installed(fullname, origin, frame):
    """Capability error when ``origin`` is part of an installed distribution (decisions 1 and 3)."""
    evidence = installation(origin)
    if evidence is None:
        return
    top = fullname.split(".")[0]
    site = f" (imported at {os.path.basename(frame.f_code.co_filename)}:{frame.f_lineno})" if frame else ""
    why = package_reason(top) if top not in PROVIDED else None
    unsupported(
        f"Python package '{top}' resolves to an installed package at {origin}{site}. "
        f"Policy: installed third-party packages are not importable, also not from a site-packages "
        f"(including the interpreter's own), --target or cache directory the model adds to sys.path "
        f"(recognized by {evidence})"
        f"{f'; wonky does not provide {top}: {why}' if why else ''}. See {package_policy()}.", frame)


class UnavailablePackages:
    """Last finder: an import from model code that nothing resolved is a capability error."""

    def find_spec(self, fullname, path=None, target=None):
        frame = importer_frame()
        origin = os.path.abspath(frame.f_code.co_filename) if frame is not None else ""
        # The standard library probes optional modules (_winapi, _scproxy, ...);
        # those keep CPython's ordinary ModuleNotFoundError.
        if not origin or (stdlib_file(origin) and not under(origin, str(WONKY_DIR))):
            return None
        top = fullname.split(".")[0]
        # The shim owns the build123d namespace: a submodule it did not register
        # does not exist in build123d 0.13.0 either (ModuleNotFoundError, as there).
        if top == "build123d":
            return None
        what = f"module '{fullname}'" if top in PROVIDED else f"package '{top}'"
        site = f"{os.path.basename(origin)}:{frame.f_lineno}"
        roots = ", ".join(project.roots) or "disabled"
        provided = ", ".join(sorted({"build123d", *PROVIDED}))
        why = package_reason(top) if top not in PROVIDED else None
        unsupported(
            f"Python {what} is not available to wonky models (imported at {site}). Policy: models import the "
            f"standard library, project-local modules (project path: {roots}) and wonky-provided modules "
            f"({provided}); installed third-party packages are not importable"
            f"{f', and wonky does not provide {top}: {why}' if why else ''}. See {package_policy()}.",
            frame)
        return None


def wonky_file(filename):
    return filename == __file__ or under(os.path.abspath(filename), str(WONKY_DIR))


def model_driven(frame):
    """True when the innermost frame outside the standard library is model or project code, not wonky's."""
    while frame is not None:
        filename = frame.f_code.co_filename
        if filename == globals().get("filename", "<python>"):
            return True
        if not filename.startswith("<"):
            path = os.path.abspath(filename)
            if wonky_file(path):
                return False
            if not stdlib_file(path):
                return True
        frame = frame.f_back
    return False


class StdlibShadows:
    """Let project modules replace standard-library modules the runner imported first.

    Under ``python model.py`` a project ``json.py`` or ``colorsys.py`` next to
    the model wins over the standard library, unless the interpreter already
    imported that module at startup (builtin, frozen or ``encodings``). The
    runner and the shim import many more (json, enum, inspect, ...). On the
    model's first import of such a name, this looks it up on the current
    ``sys.path`` exactly as CPython would; when a project file answers, the
    preloaded copy leaves ``sys.modules`` (wonky keeps its own references) and
    the project module loads and is recorded with ``shadows`` naming the
    standard-library file it replaces. Imports made by wonky's own code keep the
    standard library.
    """

    def __init__(self):
        self.pending = set()
        self.replaced = {}

    def arm(self):
        import _imp
        for name, module in list(sys.modules.items()):
            origin = getattr(module, "__file__", None)
            if "." in name or name in STARTUP_MODULES or name in sys.builtin_module_names or _imp.is_frozen(name) \
                    or not origin or wonky_file(origin):
                continue
            if stdlib_file(os.path.abspath(origin)):
                self.pending.add(name)

    def check(self, name, frame):
        top = name.partition(".")[0]
        if top not in self.pending or not model_driven(frame):
            return
        self.pending.discard(top)  # like CPython, the first import decides
        try:
            spec = importlib.machinery.PathFinder.find_spec(top)
        except (ImportError, ValueError):
            return
        preloaded = sys.modules.get(top)
        current = os.path.abspath(preloaded.__file__) if getattr(preloaded, "__file__", None) else None
        if spec is None or not spec.origin or not spec.has_location:
            return
        origin = os.path.abspath(spec.origin)
        if origin == current or stdlib_file(origin):
            return
        for key in [key for key in sys.modules if key == top or key.startswith(top + ".")]:
            del sys.modules[key]
        self.replaced[top] = current


shadows = StdlibShadows()
_original_import = builtins.__import__
_original_import_module = importlib.import_module


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    if level == 0 and isinstance(name, str) and name.partition(".")[0] in shadows.pending:
        shadows.check(name, sys._getframe(1))
    return _original_import(name, globals, locals, fromlist, level)


def _import_module(name, package=None):
    if isinstance(name, str) and not name.startswith(".") and name.partition(".")[0] in shadows.pending:
        shadows.check(name, sys._getframe(1))
    return _original_import_module(name, package)


class PathLoads:
    """Audit hook: record Python files the model loads by path, outside the import system.

    ``exec`` events carry the code object (spec_from_file_location +
    exec_module, runpy.run_path, exec(compile(text, path, "exec"))); ``open``
    events carry the path of a ``.py`` file read as text or bytes
    (exec(open(path).read())). Standard-library, wonky and main-model files are
    not project modules. A file of an installed distribution is refused like an
    import of it.
    """

    def __init__(self):
        self.active = False

    def candidate(self, path):
        if not isinstance(path, str) or path.startswith("<") or path == filename:
            return None
        path = os.path.abspath(path)
        if path == filename or wonky_file(path):
            return None
        if stdlib_file(path) or not os.path.isfile(path):
            return None
        return path

    def __call__(self, event, arguments):
        if not self.active or event not in ("exec", "open"):
            return
        self.active = False  # no re-entry while hashing or reporting
        try:
            if event == "exec":
                code = arguments[0]
                path = self.candidate(getattr(code, "co_filename", None))
                if path is not None:
                    name = loaded_name(sys._getframe(1))
                    stem = os.path.splitext(os.path.basename(path))[0]
                    refuse_installed(name or (os.path.basename(os.path.dirname(path)) if stem == "__init__" else stem),
                                     path, importer_frame())
                    project.record(path, name, loader="exec")
            else:
                target, mode = arguments[0], arguments[1]
                try:
                    target = os.fsdecode(os.fspath(target)) if not isinstance(target, int) else None
                except TypeError:
                    target = None
                if target and isinstance(mode, str) and not set(mode) & set("wax+") \
                        and target.endswith((".py", ".pyw")):
                    path = self.candidate(os.path.abspath(target))
                    if path is not None and not project.known(path):
                        project.record(path, None, loader="open")
        finally:
            self.active = True


path_loads = PathLoads()


def loaded_name(frame):
    """``__name__`` of the namespace an exec() call runs a file in, when importlib or runpy made the call."""
    try:
        while frame is not None:
            local = frame.f_locals
            if frame.f_code.co_name == "_call_with_frames_removed":
                arguments = local.get("args") or ()
                if len(arguments) > 1 and isinstance(arguments[1], dict):
                    return arguments[1].get("__name__")
            if frame.f_code.co_name == "_run_code" and isinstance(local.get("run_globals"), dict):
                return local["run_globals"].get("__name__")
            if not frame.f_code.co_filename.startswith("<frozen") and not wonky_file(frame.f_code.co_filename):
                return None
            frame = frame.f_back
    finally:
        del frame
    return None


def project_roots(filename, enabled):
    """The model directory, then the nearest ancestor with a pyproject.toml."""
    if not enabled or not os.path.isabs(filename) or not os.path.isfile(filename):
        return []
    model_dir = os.path.dirname(os.path.realpath(filename))
    roots = [model_dir]
    directory = model_dir
    while True:
        if os.path.isfile(os.path.join(directory, "pyproject.toml")):
            if directory not in roots:
                roots.append(directory)
            break
        parent = os.path.dirname(directory)
        if parent == directory:
            break
        directory = parent
    return roots


def environment():
    return {"isolation": "-I -S -B", "executable": sys.executable, "prefix": sys.prefix,
            "projectPath": project.roots, "provided": sorted({"build123d", *PROVIDED})}


def deepest_user_frame(error, filename):
    """(file, line) of the innermost traceback frame in the model or a project module."""
    found = None
    for frame in traceback.extract_tb(error.__traceback__):
        path = os.path.abspath(frame.filename) if not frame.filename.startswith("<") else frame.filename
        if path == filename or (not path.startswith("<") and project.owns(path)):
            found = (frame.filename, frame.lineno)
    # A syntax error in a project module has no frame of its own.
    if isinstance(error, SyntaxError) and error.filename and not error.filename.startswith("<") \
            and project.owns(os.path.abspath(error.filename)):
        found = (error.filename, error.lineno)
    return found


filename = "<python>"
project = ProjectModules([])
main = None
try:
    initial = json.loads(channel.incoming.readline())
    filename = initial["filename"]
    shim._source_filename = filename
    runtime._main_filename = filename
    project.roots = project_roots(filename, initial.get("projectPath", True))
    sys.path[0:0] = project.roots
    sys.argv = [filename]
    # Order as in `python model.py`: builtin and frozen modules first, then the
    # project path, then the standard library. Wonky-provided modules and the
    # external-geometry guard precede everything.
    sys.meta_path.insert(sys.meta_path.index(importlib.machinery.PathFinder), project)
    sys.meta_path[0:0] = [NoExternalGeometry(), ProvidedModules()]
    sys.meta_path.append(UnavailablePackages())
    importlib.machinery.SourceFileLoader.get_code = fresh_get_code
    # Standard-library modules imported so far by the runner and the shim, not
    # by `python model.py`: a project module of the same name wins on the
    # model's first import. Files loaded by path are recorded by the audit hook.
    shadows.arm()
    builtins.__import__ = _import
    importlib.import_module = _import_module
    sys.addaudithook(path_loads)
    path_loads.active = True
    # Like runpy: the model is the real __main__ module (dataclasses, pickle and
    # sys.modules[__name__] look it up there). Keep the runner module alive.
    _runner_module = sys.modules["__main__"]
    main = types.ModuleType("__main__")
    main.__file__ = filename
    main.__builtins__ = __builtins__
    sys.modules["__main__"] = main
    try:
        exec(compile(initial["source"], filename, "exec"), main.__dict__)
    except SystemExit as exit_request:
        # `sys.exit()` / `sys.exit(0)` ends a model normally, as with `python model.py`.
        if exit_request.code not in (None, 0):
            raise
    provided = [module for name, module in sys.modules.items()
                if name in PROVIDED or name == "build123d"]
    binding, outputs, ignored, metadata = runtime.resolve(main.__dict__, provided)
    leaked = sorted(name for name in sys.modules if name.split(".")[0] in EXTERNAL_GEOMETRY)
    if leaked:
        unsupported(f"External geometry modules were loaded ({', '.join(leaked)}); production geometry must be constructed in Bend")
    # "handle" is the pre-contract single-result field; src/lang/dataflow/py-trace.mjs
    # still reads it. Sent only when the result is exactly one handle; drop it once
    # that tracer reads "outputs".
    handles = list(dict.fromkeys(output["handle"] for output in outputs))
    channel.send({"type": "complete", "binding": binding, "outputs": outputs, "ignoredCaptures": ignored,
                  **({"handle": handles[0]} if len(handles) == 1 else {}),
                  **({"assembly": metadata} if metadata is not None else {}),
                  "modules": project.loaded, "environment": environment(),
                  "pythonVersion": sys.version.split()[0]})
except BaseException as error:
    line = getattr(error, "lineno", None) if getattr(error, "filename", None) == filename else None
    for frame in traceback.extract_tb(error.__traceback__):
        if frame.filename == filename:
            line = frame.lineno
    inner = deepest_user_frame(error, filename)
    channel.send({"type": "failure", "error": {
        "type": type(error).__name__, "message": str(error), "line": line,
        "sourceFile": inner[0] if inner and inner[0] != filename else None,
        "sourceLine": inner[1] if inner and inner[0] != filename else None,
        "traceback": traceback.format_exc()},
        "modules": project.loaded, "environment": environment()})
    sys.exit(1)
