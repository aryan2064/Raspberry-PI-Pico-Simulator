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


class PWM:
    # Duty-cycle only — no frequency simulation. freq() merely stores its
    # value (real hardware PWM timing is explicitly out of scope); only the
    # duty actually drives the engine. duty_u16 maps MicroPython's 0..65535
    # range onto the engine's analogValue channel (0..1) on the engine pin,
    # which the forwarding pin/listeners (e.g. a LED's anode) already read.
    # Creating a PWM configures the pin as an output, exactly like real
    # hardware: self._pin.mode is mirrored on the shim Pin and the bridge
    # tells the engine's pin the same so the net has an active OUT driver.
    def __init__(self, pin):
        self._pin = pin
        self._freq = None
        self._pin.mode = Pin.OUT
        _bridge.pwmSetup(self._pin._pin)

    def duty_u16(self, value=None):
        if value is None:
            return round((getattr(self._pin, "analog_value", None) or 0) * 65535)
        duty = value / 65535
        self._pin.analog_value = duty
        _bridge.pwmDuty(self._pin._pin, duty)
        return None

    def freq(self, value=None):
        if value is None:
            return self._freq
        self._freq = value
        return None

    def deinit(self):
        self._pin.analog_value = None
        _bridge.pwmDeinit(self._pin._pin)


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