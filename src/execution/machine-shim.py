# Pico Sim — minimal `machine` shim, evaluated into a Python module named
# `machine` inside the worker's Pyodide runtime.
#
# The bridge is a JS object (_bridge) installed by the worker via
# pyodide.globals.set("__pico_bridge", ...). It maps every call straight onto
# the live Circuit that lives in the same worker thread, so read-after-write is
# genuinely synchronous — no message passing, no serialization, no waiting.
from js import __pico_bridge as _bridge


class _PinMode:
    def __init__(self, value, name):
        self._value = value
        self._name = name

    def __repr__(self):
        return "machine.Pin." + self._name


class Pin:
    IN = _PinMode(0, "IN")
    OUT = _PinMode(1, "OUT")
    PULL_UP = _PinMode(2, "PULL_UP")
    PULL_DOWN = _PinMode(3, "PULL_DOWN")

    def __init__(self, pin_number, mode=IN, pull=None):
        self._pin = int(pin_number)
        _bridge.setup(
            self._pin,
            mode._value,
            None if pull is None else pull._value,
        )

    def value(self, value=None):
        if value is None:
            return _bridge.read(self._pin)
        _bridge.write(self._pin, int(value))
        return None

    def high(self):
        self.value(1)

    def low(self):
        self.value(0)

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    def toggle(self):
        self.value(0 if self.value() else 1)


# time.sleep has two implementations, chosen at call time by a flag the worker
# reports on the bridge (canRunSync == whether Pyodide's ffi.can_run_sync(), i.e.
# JS Promise Integration / stack switching, is available in this runtime):
#
#  * Where it is, `_jspi_sleep` runs asyncio.sleep through pyodide.ffi.run_sync.
#    The *Python* program blocks for the full duration, but the worker's JS
#    event loop stays free underneath (JSPI suspends the Python task instead of
#    busy-spinning), so this worker's ~60fps sim tick loop and the UI button
#    relay keep running while the script sleeps. No SharedArrayBuffer / Atomics
#    / cross-origin isolation is needed. This is only possible because user code
#    is run with pyodide.runPythonAsync, which is what gives run_sync a stack it
#    can switch out of.
#  * Where it isn't (browsers without stack switching — e.g. Firefox or older
#    webviews — or an absent ffi API), `_busy_sleep` below is the fallback, kept
#    exactly as it has always
#    been: a plain busy-wait spin over wall-clock time that blocks only this
#    worker's thread (Pyodide is single-threaded), never the main thread/UI.
import time as _time


def _busy_sleep(seconds):
    seconds = float(seconds)
    if seconds <= 0:
        return
    end = _time.monotonic() + seconds
    while _time.monotonic() < end:
        pass


def _jspi_sleep(seconds):
    seconds = float(seconds)
    if seconds <= 0:
        return
    import asyncio
    import pyodide

    pyodide.ffi.run_sync(asyncio.sleep(seconds))


def _sleep(seconds):
    if getattr(_bridge, "canRunSync", False):
        _jspi_sleep(seconds)
    else:
        _busy_sleep(seconds)


_time.sleep = _sleep