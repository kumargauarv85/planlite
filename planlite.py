#!/usr/bin/env python3
"""PlanLite Viewer - Microsoft Project file viewer for Linux.

Starts a private local service (127.0.0.1 only) that serves the viewer and
converts .mpp and other schedule files to Project XML through the open-source
MPXJ library, then opens the viewer in an app window. Needs only the Python 3
standard library; Java and MPXJ are fetched once on request.
"""
import argparse
import glob
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.2.0"
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
DATA_DIR = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "planlite")
ENGINE_DIR = os.path.join(DATA_DIR, "engine")
JRE_DIR = os.path.join(ENGINE_DIR, "jre")
MPXJ_DIR = os.path.join(ENGINE_DIR, "mpxj")
PYPI_URL = os.environ.get("PLANLITE_PYPI_URL") or "https://pypi.org/pypi/mpxj/json"
JRE_URL = os.environ.get("PLANLITE_JRE_URL") or "https://api.adoptium.net/v3/binary/latest/21/ga/linux/{arch}/jre/hotspot/normal/eclipse"
MAX_UPLOAD = 1024 * 1024 * 1024
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}
CONVERTERS = ("org.mpxj.sample.MpxjConvert", "net.sf.mpxj.sample.MpxjConvert")


class ConvertError(Exception):
    pass


def _java_ok(path):
    """True if path is a runnable Java 11 or newer."""
    try:
        out = subprocess.run([path, "-version"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return False
    m = re.search(rb'version "(\d+)(?:\.(\d+))?', out)
    if not m:
        return False
    major = int(m.group(1))
    if major == 1 and m.group(2):
        major = int(m.group(2))
    return major >= 11


_java_cache = {}


def find_java():
    candidates = [os.environ.get("PLANLITE_JAVA"), os.path.join(JRE_DIR, "bin", "java")]
    if not os.environ.get("PLANLITE_NO_SYSTEM_JAVA"):
        candidates.append(shutil.which("java"))
    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            if c not in _java_cache:
                _java_cache[c] = _java_ok(c)
            if _java_cache[c]:
                return c
    return None


def find_mpxj():
    return MPXJ_DIR if glob.glob(os.path.join(MPXJ_DIR, "mpxj*.jar")) else None


def engine_ready():
    return bool(find_java() and find_mpxj())


class Engine:
    """One-time download of a Java runtime (if needed) and the MPXJ library."""
    lock = threading.Lock()
    status = {"state": "idle", "pct": 0, "msg": ""}

    @classmethod
    def start(cls):
        with cls.lock:
            if cls.status["state"] == "running":
                return
            cls.status = {"state": "running", "pct": 0, "msg": "Starting"}
        threading.Thread(target=cls._work, daemon=True).start()

    @staticmethod
    def _open(url):
        req = urllib.request.Request(url, headers={"User-Agent": "PlanLite/" + VERSION, "Accept": "*/*"})
        return urllib.request.urlopen(req, timeout=60)

    @classmethod
    def _download(cls, url, dest, label, lo, hi):
        with cls._open(url) as r, open(dest, "wb") as out:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            while True:
                chunk = r.read(262144)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if total:
                    cls.status["pct"] = lo + int((hi - lo) * done / total)
                cls.status["msg"] = "%s (%d MB)" % (label, done // 1048576)
        if total and done < total:
            raise ConvertError("The download was cut off. Check your connection and try again.")

    @classmethod
    def _work(cls):
        tmp = None
        try:
            os.makedirs(ENGINE_DIR, exist_ok=True)
            tmp = tempfile.mkdtemp(prefix="dl-", dir=ENGINE_DIR)
            if not find_java():
                arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "aarch64", "arm64": "aarch64"}.get(os.uname().machine)
                if not arch:
                    raise ConvertError("No Java runtime is published for this kind of processor. Install Java 11 or newer yourself.")
                tgz = os.path.join(tmp, "jre.tar.gz")
                cls._download(JRE_URL.format(arch=arch), tgz, "Downloading Java runtime", 0, 60)
                cls.status["msg"] = "Unpacking Java runtime"
                unpack = os.path.join(tmp, "jre")
                os.mkdir(unpack)
                with tarfile.open(tgz) as tf:
                    root = os.path.realpath(unpack)
                    for m in tf.getmembers():
                        target = os.path.realpath(os.path.join(unpack, m.name))
                        if not (target == root or target.startswith(root + os.sep)) or m.isdev():
                            raise ConvertError("The Java download looks unsafe and was rejected.")
                        if (m.issym() or m.islnk()) and (os.path.isabs(m.linkname) or ".." in m.linkname.split("/")):
                            continue
                    try:
                        tf.extractall(unpack, filter="tar")
                    except TypeError:
                        tf.extractall(unpack)
                javas = glob.glob(os.path.join(unpack, "*", "bin", "java")) + glob.glob(os.path.join(unpack, "bin", "java"))
                if not javas:
                    raise ConvertError("The Java download did not contain a runtime.")
                shutil.rmtree(JRE_DIR, ignore_errors=True)
                os.replace(os.path.dirname(os.path.dirname(javas[0])), JRE_DIR)
                _java_cache.clear()
                if not find_java():
                    raise ConvertError("The downloaded Java runtime does not start on this system.")
            cls.status.update(pct=60, msg="Looking up the MPXJ library")
            with cls._open(PYPI_URL) as r:
                meta = json.loads(r.read(20000000).decode("utf-8"))
            wheels = [u["url"] for u in meta.get("urls", []) if u.get("packagetype") == "bdist_wheel"]
            if not wheels:
                raise ConvertError("Could not find the MPXJ package on pypi.org.")
            whl = os.path.join(tmp, "mpxj.whl")
            cls._download(wheels[0], whl, "Downloading MPXJ library", 60, 97)
            cls.status["msg"] = "Unpacking MPXJ library"
            stage = os.path.join(tmp, "mpxj")
            os.mkdir(stage)
            with zipfile.ZipFile(whl) as zf:
                for info in zf.infolist():
                    name = os.path.basename(info.filename)
                    if info.filename.replace("\\", "/").startswith("mpxj/lib/") and name.endswith(".jar"):
                        with zf.open(info) as src, open(os.path.join(stage, name), "wb") as dst:
                            shutil.copyfileobj(src, dst)
            if not glob.glob(os.path.join(stage, "mpxj*.jar")):
                raise ConvertError("The MPXJ package did not contain the expected library files.")
            shutil.rmtree(MPXJ_DIR, ignore_errors=True)
            os.replace(stage, MPXJ_DIR)
            cls.status = {"state": "done", "pct": 100, "msg": "MPP support is ready"}
        except Exception as exc:
            msg = str(exc) if isinstance(exc, ConvertError) else "Download failed (%s). Check your internet connection." % exc
            cls.status = {"state": "error", "pct": 0, "msg": msg}
        finally:
            if tmp:
                shutil.rmtree(tmp, ignore_errors=True)


def to_xml(data, name):
    """Convert any schedule file MPXJ understands (.mpp, .mpt, .mpx, .xer, P6 XML ...) to Microsoft Project XML."""
    java, lib = find_java(), find_mpxj()
    if not (java and lib):
        raise ConvertError("MPP support is not set up yet. Click 'Set up MPP support' (one-time download).")
    ext = os.path.splitext(name)[1].lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
        ext = ".mpp"
    with tempfile.TemporaryDirectory(prefix="planlite-") as tmp:
        src, out = os.path.join(tmp, "input" + ext), os.path.join(tmp, "output.xml")
        with open(src, "wb") as fh:
            fh.write(data)
        log = b""
        env = {k: v for k, v in os.environ.items() if k not in ("JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS")}
        for cls_name in CONVERTERS:
            cmd = [java, "-Xmx2g", "-Djava.awt.headless=true", "-cp", os.path.join(lib, "*"), cls_name, src, out]
            try:
                log = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600, env=env).stdout
            except subprocess.TimeoutExpired:
                raise ConvertError("Reading the file took too long and was stopped.")
            except OSError as exc:
                raise ConvertError("Could not start Java: %s" % exc)
            if os.path.isfile(out) and os.path.getsize(out) > 0:
                with open(out, "rb") as fh:
                    return fh.read()
            if b"ClassNotFoundException" not in log and b"Could not find or load main class" not in log:
                break
        text = log.decode("utf-8", "replace")
        if "password" in text.lower():
            raise ConvertError("%s is password-protected and cannot be opened." % name)
        lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("at ")]
        raise ConvertError(("Could not read %s. " % name) + " ".join(lines[-3:])[:500])


class State:
    token = ""
    initial = None
    last_ping = 0.0
    ever_pinged = False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PlanLite/" + VERSION

    def log_message(self, fmt, *args):
        if os.environ.get("PLANLITE_DEBUG"):
            sys.stderr.write("planlite: " + (fmt % args) + "\n")

    def _send(self, code, body, ctype="application/octet-stream"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def _route(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            self._json({"error": "forbidden"}, 403)
            return None
        parsed = urllib.parse.urlsplit(self.path)
        parts = parsed.path.split("/", 2)
        if len(parts) < 3 or not secrets.compare_digest(parts[1], State.token):
            self._json({"error": "forbidden"}, 403)
            return None
        return parts[2], urllib.parse.parse_qs(parsed.query)

    def do_GET(self):
        r = self._route()
        if r is None:
            return
        path, _query = r
        State.last_ping = time.time()
        if path == "api/engine":
            self._json(Engine.status)
            return
        if path == "api/info":
            self._json({"version": VERSION, "engine": engine_ready(), "java": find_java(), "mpxj": find_mpxj(),
                        "initial": os.path.basename(State.initial) if State.initial else None})
            return
        if path == "api/initial":
            try:
                with open(State.initial, "rb") as fh:
                    self._send(200, fh.read())
            except (OSError, TypeError) as exc:
                self._json({"error": "Cannot read the file: %s" % exc}, 404)
            return
        if path == "":
            path = "index.html"
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", path) or path.startswith("."):
            self._json({"error": "not found"}, 404)
            return
        full = os.path.join(WEB, path)
        if not os.path.isfile(full):
            self._json({"error": "not found"}, 404)
            return
        with open(full, "rb") as fh:
            self._send(200, fh.read(), MIME.get(os.path.splitext(path)[1], "application/octet-stream"))

    do_HEAD = do_GET

    def do_POST(self):
        r = self._route()
        if r is None:
            return
        path, query = r
        State.last_ping = time.time()
        State.ever_pinged = True
        try:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length < 0 or length > MAX_UPLOAD:
                raise ConvertError("File is too large.")
            body = self.rfile.read(length)
            name = (query.get("name") or ["project.mpp"])[0]
            if path == "api/ping":
                self._json({"ok": True})
            elif path == "api/engine":
                Engine.start()
                self._json(Engine.status)
            elif path == "api/toxml":
                self._send(200, to_xml(body, name), "application/xml")
            else:
                self._json({"error": "not found"}, 404)
        except ConvertError as exc:
            self._json({"error": str(exc)}, 422)
        except Exception as exc:  # keep the service alive whatever a request does
            self._json({"error": "Unexpected error: %s" % exc}, 500)


def run_webview(url, title, prg):
    """Show the viewer in a small native window (GTK + WebKitGTK). Returns 3 if those libraries are not available."""
    os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")  # avoids blank windows with some NVIDIA drivers
    try:
        import gi
        try:
            gi.require_version("Gtk", "4.0")
            gi.require_version("WebKit", "6.0")
            from gi.repository import GLib, Gtk, WebKit
            gtk4 = True
        except (ValueError, ImportError):
            gi.require_version("Gtk", "3.0")
            try:
                gi.require_version("WebKit2", "4.1")
            except ValueError:
                gi.require_version("WebKit2", "4.0")
            from gi.repository import GLib, Gtk, WebKit2 as WebKit
            gtk4 = False
    except Exception as exc:  # no PyGObject / WebKitGTK on this system
        sys.stderr.write("%s: native window not available (%s); using a browser instead\n" % (prg, exc))
        return 3
    GLib.set_prgname(prg)
    GLib.set_application_name(title)
    try:
        if gtk4:
            Gtk.init()
        else:
            Gtk.init(None)
    except Exception as exc:
        sys.stderr.write("%s: cannot open a window (%s)\n" % (prg, exc))
        return 3
    loop = GLib.MainLoop()
    win = Gtk.Window()
    win.set_title(title)
    win.set_default_size(1500, 900)
    view = WebKit.WebView()

    def decide(download, suggested):
        folder = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) or os.path.expanduser("~/Downloads")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, os.path.basename(suggested) or "download")
        download.set_allow_overwrite(True)
        download.set_destination(path if gtk4 else GLib.filename_to_uri(path, None))
        return True

    def on_download(_src, download):
        download.connect("decide-destination", decide)

    try:
        (view.get_network_session() if gtk4 else view.get_context()).connect("download-started", on_download)
    except Exception:
        pass
    view.connect("notify::title", lambda v, _p: win.set_title(v.get_title() or title))
    view.connect("close", lambda _v: loop.quit())

    def closing(*_a):
        view.try_close()  # lets the page warn about unsaved changes
        return True

    if gtk4:
        win.set_child(view)
        win.connect("close-request", closing)
        view.load_uri(url)
        win.present()
    else:
        win.add(view)
        win.connect("delete-event", closing)
        view.load_uri(url)
        win.show_all()
    loop.run()
    return 0


def open_window(url, mode):
    """Open the viewer. Prefer a Chromium-family app window (native or Flatpak), then Firefox, then the default browser."""
    if mode == "none":
        return None
    if mode == "app" and not os.environ.get("PLANLITE_NO_NATIVE"):
        try:
            child = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--webview", url], start_new_session=True)
            try:
                if child.wait(timeout=4) == 0:
                    return child  # opened and already closed again
            except subprocess.TimeoutExpired:
                return child  # the native window is up
        except OSError:
            pass
    quiet = dict(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    args = ["--app=" + url, "--new-window", "--class=planlite", "--window-size=1500,900"]
    if mode != "browser":
        for exe in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "brave",
                    "microsoft-edge", "microsoft-edge-stable", "vivaldi", "vivaldi-stable"):
            path = shutil.which(exe)
            if path:
                try:
                    subprocess.Popen([path] + args, **quiet)
                    return
                except OSError:
                    pass
        flatpak = shutil.which("flatpak")
        if flatpak:
            roots = ("/var/lib/flatpak/app", os.path.expanduser("~/.local/share/flatpak/app"))
            for app in ("com.brave.Browser", "com.google.Chrome", "org.chromium.Chromium", "com.microsoft.Edge",
                        "com.vivaldi.Vivaldi", "io.github.ungoogled_software.ungoogled_chromium"):
                if any(os.path.isdir(os.path.join(r, app)) for r in roots):
                    try:
                        subprocess.Popen([flatpak, "run", app] + args, **quiet)
                        return
                    except OSError:
                        pass
        path = shutil.which("firefox")
        if path:
            try:
                subprocess.Popen([path, "--new-window", url], **quiet)
                return
            except OSError:
                pass
    if not webbrowser.open(url):
        print("Open this address in your browser:\n  " + url)


def watchdog(server, idle):
    while True:
        time.sleep(5)
        limit = idle if State.ever_pinged else max(idle, 600)
        if time.time() - State.last_ping > limit:
            threading.Thread(target=server.shutdown, daemon=True).start()
            return


def main(argv=None):
    ap = argparse.ArgumentParser(prog="planlite", description="PlanLite Viewer - view Microsoft Project schedules on Linux.")
    ap.add_argument("file", nargs="?", help=".mpp, .mpt, .mpx, .xer or Project .xml file to open")
    ap.add_argument("--browser", action="store_true", help="open in the default browser instead of an app window")
    ap.add_argument("--webview", metavar="URL", help=argparse.SUPPRESS)
    ap.add_argument("--no-window", action="store_true", help="only start the service and print its address")
    ap.add_argument("--port", type=int, default=0, help="port to listen on (default: a free one)")
    ap.add_argument("--setup-mpp", action="store_true", help="download the MPP reading engine and exit")
    ap.add_argument("--to-xml", metavar="OUT", help="convert FILE to Microsoft Project XML without opening a window")
    ap.add_argument("--version", action="version", version="PlanLite Viewer " + VERSION)
    args = ap.parse_args(argv)
    if args.webview:
        return run_webview(args.webview, "PlanLite Viewer", "planlite")

    if args.setup_mpp:
        Engine.start()
        while Engine.status["state"] == "running":
            print("\r%-64s" % ("%s %d%%" % (Engine.status["msg"], Engine.status["pct"])), end="", flush=True)
            time.sleep(0.5)
        print("\r%-64s" % Engine.status["msg"])
        return 0 if Engine.status["state"] == "done" else 1
    if args.file and not os.path.isfile(args.file):
        ap.error("no such file: %s" % args.file)
    if args.to_xml:
        if not args.file:
            ap.error("--to-xml needs an input file")
        try:
            with open(args.file, "rb") as fh:
                result = to_xml(fh.read(), os.path.basename(args.file))
        except ConvertError as exc:
            sys.exit("planlite: " + str(exc))
        with open(args.to_xml, "wb") as fh:
            fh.write(result)
        print("Wrote " + args.to_xml)
        return 0

    State.token = secrets.token_urlsafe(18)
    State.initial = os.path.abspath(args.file) if args.file else None
    State.last_ping = time.time()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    url = "http://127.0.0.1:%d/%s/" % (server.server_address[1], State.token)
    if args.no_window:
        print(url, flush=True)
    child = open_window(url, "none" if args.no_window else "browser" if args.browser else "app")
    threading.Thread(target=watchdog, args=(server, 150), daemon=True).start()
    if child is not None:  # native window: stop the service as soon as it is closed
        def reap():
            child.wait()
            server.shutdown()
        threading.Thread(target=reap, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
