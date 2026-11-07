#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr ULONGLONG DoubleTapWindowMs = 400;
// Poll interval. Fast enough that a normal 60-100 ms modifier tap is never
// missed, slow enough to be invisible in CPU usage.
constexpr DWORD PollIntervalMs = 8;

enum Modifier : unsigned int {
    Shift = 1u << 0,
    Alt = 1u << 1,
    Control = 1u << 2,
};

struct Event {
    const char* type;
    std::string mode;
    int x;
    int y;
};

class DragState {
public:
    DragState(int dragWidth, int dragHeight, std::string shiftMode,
              std::string altMode, std::string controlMode, std::string controlShiftMode)
        : thresholdX_(std::max(1, dragWidth / 2)),
          thresholdY_(std::max(1, dragHeight / 2)),
          shiftMode_(std::move(shiftMode)), altMode_(std::move(altMode)),
          controlMode_(std::move(controlMode)), controlShiftMode_(std::move(controlShiftMode)) {}

    void begin(int x, int y, unsigned int modifiers) {
        leftDown_ = true;
        startX_ = x;
        startY_ = y;
        dragging_ = false;
        visible_ = false;
        mode_.clear();
        lastReleased_ = 0;
        lastReleaseTick_ = 0;
        pressedDuringDrag_ = 0;
        (void)modifiers;
    }

    std::vector<Event> move(int x, int y, unsigned int modifiers) {
        if (!leftDown_) return {};
        if (!dragging_ && (std::abs(x - startX_) >= thresholdX_ ||
                           std::abs(y - startY_) >= thresholdY_)) {
            dragging_ = true;
        }
        (void)modifiers;
        return moveVisible(x, y);
    }

    std::vector<Event> modifierDown(int x, int y, unsigned int key, unsigned int modifiers, ULONGLONG tick) {
        if (!leftDown_ || !dragging_ || key == 0) return {};
        pressedDuringDrag_ |= key;
        pressedAt_[key == Shift ? 0 : key == Alt ? 1 : 2] = tick;
        if (key != lastReleased_ ||
            tick < lastReleaseTick_ || tick - lastReleaseTick_ > DoubleTapWindowMs) return {};
        lastReleased_ = 0;
        const char* selected = modeFor(modifiers);
        if (*selected == '\0') return {};
        mode_ = selected;
        visible_ = true;
        lastX_ = x;
        lastY_ = y;
        return {{"show", mode_, x, y}};
    }

    void modifierUp(unsigned int key, ULONGLONG tick) {
        if (!leftDown_ || !dragging_ || key == 0) return;
        const auto pressedAt = pressedAt_[key == Shift ? 0 : key == Alt ? 1 : 2];
        const bool completeTap = (pressedDuringDrag_ & key) != 0 && tick >= pressedAt &&
                                 tick - pressedAt <= DoubleTapWindowMs;
        pressedDuringDrag_ &= ~key;
        if (completeTap) {
            lastReleased_ = key;
            lastReleaseTick_ = tick;
        } else {
            lastReleased_ = 0;
        }
    }

    std::vector<Event> release(int x, int y) {
        auto events = hideIfVisible(x, y);
        leftDown_ = false;
        dragging_ = false;
        mode_.clear();
        lastReleased_ = 0;
        lastReleaseTick_ = 0;
        pressedDuringDrag_ = 0;
        return events;
    }

private:
    int thresholdX_;
    int thresholdY_;
    int startX_ = 0;
    int startY_ = 0;
    int lastX_ = 0;
    int lastY_ = 0;
    bool leftDown_ = false;
    bool dragging_ = false;
    bool visible_ = false;
    std::string mode_;
    std::string shiftMode_;
    std::string altMode_;
    std::string controlMode_;
    std::string controlShiftMode_;
    unsigned int lastReleased_ = 0;
    ULONGLONG lastReleaseTick_ = 0;
    unsigned int pressedDuringDrag_ = 0;
    std::array<ULONGLONG, 3> pressedAt_{};

    const char* modeFor(unsigned int modifiers) const {
        const std::string* selected = nullptr;
        if ((modifiers & (Control | Shift)) == (Control | Shift) && controlShiftMode_ != "none")
            selected = &controlShiftMode_;
        else if ((modifiers & Shift) != 0) selected = &shiftMode_;
        else if ((modifiers & Alt) != 0) selected = &altMode_;
        else if ((modifiers & Control) != 0) selected = &controlMode_;
        if (selected && *selected != "none") return selected->c_str();
        return "";
    }

    std::vector<Event> hideIfVisible(int x, int y) {
        if (!visible_) return {};
        visible_ = false;
        lastX_ = x;
        lastY_ = y;
        return {{"hide", mode_.c_str(), x, y}};
    }

    std::vector<Event> moveVisible(int x, int y) {
        if (!leftDown_ || !dragging_ || !visible_) return {};
        if (x != lastX_ || y != lastY_) {
            lastX_ = x;
            lastY_ = y;
            return {{"move", mode_.c_str(), x, y}};
        }
        return {};
    }
};

struct Config {
    std::string shiftMode = "convert";
    std::string altMode = "tools";
    std::string controlMode = "actions";
    std::string controlShiftMode = "none";
};

DWORD watcherThreadId = 0;
Config config;

void emit(const Event& event) {
    std::printf("{\"type\":\"%s\",\"mode\":\"%s\",\"x\":%d,\"y\":%d}\n",
                event.type, event.mode.c_str(), event.x, event.y);
    std::fflush(stdout);
}

// Events are written from the polling thread itself, so no hook callback is
// ever delayed by stdout backpressure.
void emitAll(const std::vector<Event>& events) {
    for (const auto& event : events) emit(event);
}

unsigned int polledModifiers() {
    unsigned int result = 0;
    if ((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0) result |= Shift;
    if ((GetAsyncKeyState(VK_MENU) & 0x8000) != 0) result |= Alt;
    if ((GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) result |= Control;
    return result;
}

// Passive polling instead of global low-level hooks. WH_MOUSE_LL and
// WH_KEYBOARD_LL callbacks run inside every mouse and keyboard event on the
// desktop; that adds latency to precision-touchpad gestures, can drop taps on
// loaded machines, and is a lot of surface area for a drag gesture.
class InputPoller {
public:
    explicit InputPoller(DragState& state)
        : state_(state), modifiers_(polledModifiers()),
          leftDown_((GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0) {}

    void tick() {
        POINT cursor{};
        GetCursorPos(&cursor);
        const bool leftDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
        const unsigned int modifiers = polledModifiers();

        if (leftDown != leftDown_) {
            leftDown_ = leftDown;
            if (leftDown) {
                state_.begin(cursor.x, cursor.y, modifiers);
                modifiers_ = modifiers;
            } else {
                emitAll(state_.release(cursor.x, cursor.y));
                modifiers_ = modifiers;
                return;
            }
        }
        if (leftDown) {
            emitAll(state_.move(cursor.x, cursor.y, modifiers));
            applyModifierEdges(cursor, modifiers);
        } else {
            modifiers_ = modifiers;
        }
    }

private:
    void applyModifierEdges(const POINT& cursor, unsigned int modifiers) {
        constexpr unsigned int keys[] = {Shift, Alt, Control};
        const ULONGLONG tick = GetTickCount64();
        for (const unsigned int key : keys) {
            const bool down = (modifiers & key) != 0;
            const bool wasDown = (modifiers_ & key) != 0;
            if (down == wasDown) continue;
            if (down) {
                emitAll(state_.modifierDown(cursor.x, cursor.y, key, modifiers, tick));
            } else {
                state_.modifierUp(key, tick);
            }
        }
        modifiers_ = modifiers;
    }

    DragState& state_;
    unsigned int modifiers_;
    bool leftDown_;
};

BOOL WINAPI consoleHandler(DWORD signal) {
    if (signal == CTRL_C_EVENT || signal == CTRL_BREAK_EVENT ||
        signal == CTRL_CLOSE_EVENT || signal == CTRL_SHUTDOWN_EVENT) {
        PostThreadMessageW(watcherThreadId, WM_QUIT, 0, 0);
        return TRUE;
    }
    return FALSE;
}

bool validMode(const char* value) {
    return std::strcmp(value, "convert") == 0 ||
           std::strcmp(value, "tools") == 0 ||
           std::strcmp(value, "actions") == 0 ||
           std::strcmp(value, "none") == 0;
}

bool parseArguments(int argc, char** argv, bool* selfTest) {
    for (int index = 1; index < argc; ++index) {
        if (std::strcmp(argv[index], "--help") == 0) {
            std::puts("Usage: santra-drag-watcher.exe [--shift-mode MODE] [--alt-mode MODE] [--control-mode MODE] [--ctrl-shift-mode MODE] [--self-test]; MODE=convert|tools|actions|none");
            return false;
        }
        if (std::strcmp(argv[index], "--self-test") == 0) {
            *selfTest = true;
            continue;
        }
        if (index + 1 >= argc) return false;
        const char* key = argv[index];
        const char* value = argv[++index];
        if (!validMode(value)) return false;
        if (std::strcmp(key, "--shift-mode") == 0) config.shiftMode = value;
        else if (std::strcmp(key, "--alt-mode") == 0) config.altMode = value;
        else if (std::strcmp(key, "--control-mode") == 0) config.controlMode = value;
        else if (std::strcmp(key, "--ctrl-shift-mode") == 0) config.controlShiftMode = value;
        else return false;
    }
    return true;
}

bool runSelfTest() {
    for (const auto key : {Shift, Alt, Control}) {
        DragState held(8, 8, "convert", "tools", "actions", "none");
        held.begin(0, 0, key);
        held.move(4, 0, key);
        held.modifierUp(key, 100);
        if (!held.modifierDown(4, 0, key, key, 150).empty()) return false;
        held.modifierUp(key, 200);
        if (held.modifierDown(4, 0, key, key, 250).size() != 1) return false;
        DragState longPress(8, 8, "convert", "tools", "actions", "none");
        longPress.begin(0, 0, 0);
        longPress.move(4, 0, 0);
        longPress.modifierDown(4, 0, key, key, 100);
        longPress.modifierUp(key, 600);
        if (!longPress.modifierDown(4, 0, key, key, 650).empty()) return false;
    }
    DragState state(8, 8, "convert", "tools", "actions", "none");
    state.begin(100, 100, 0);
    if (!state.move(102, 102, Shift).empty()) return false;
    auto events = state.move(104, 100, Shift);
    if (!events.empty()) return false;
    if (!state.modifierDown(104, 100, Shift, Shift, 100).empty()) return false;
    state.modifierUp(Shift, 150);
    events = state.modifierDown(104, 100, Shift, Shift, 300);
    if (events.size() != 1 || std::strcmp(events[0].type, "show") != 0 || events[0].mode != "convert") return false;
    events = state.move(108, 100, Shift);
    if (events.size() != 1 || std::strcmp(events[0].type, "move") != 0) return false;
    state.modifierUp(Shift, 350);
    if (!state.modifierDown(108, 100, Alt, Alt, 500).empty()) return false;
    state.modifierUp(Alt, 550);
    events = state.modifierDown(108, 100, Alt, Alt, 700);
    if (events.size() != 1 || events[0].mode != "tools") return false;
    events = state.move(112, 104, 0);
    if (events.size() != 1 || std::strcmp(events[0].type, "move") != 0 ||
        events[0].mode != "tools") return false;
    state.modifierUp(Alt, 750);
    if (!state.modifierDown(112, 104, Control, Control, 1200).empty()) return false;
    state.modifierUp(Control, 1250);
    events = state.modifierDown(112, 104, Control, Control, 1700);
    if (!events.empty()) return false;
    state.modifierUp(Control, 1750);
    events = state.modifierDown(112, 104, Control, Control, 1850);
    if (events.size() != 1 || events[0].mode != "actions") return false;
    events = state.release(120, 100);
    if (events.size() != 1 || std::strcmp(events[0].type, "hide") != 0) return false;
    state.begin(200, 200, 0);
    state.move(205, 200, Control);
    events = state.release(205, 200);
    if (!events.empty()) return false;
    DragState custom(8, 8, "convert", "none", "actions", "tools");
    custom.begin(0, 0, 0);
    if (!custom.move(4, 0, Control | Shift).empty()) return false;
    custom.modifierDown(4, 0, Shift, Control | Shift, 100);
    custom.modifierUp(Shift, 150);
    events = custom.modifierDown(4, 0, Shift, Control | Shift, 250);
    return events.size() == 1 && events[0].mode == "tools";
}

} // namespace

int main(int argc, char** argv) {
    bool selfTest = false;
    if (!parseArguments(argc, argv, &selfTest)) return 2;
    if (selfTest) {
        if (!runSelfTest()) {
            std::fprintf(stderr, "drag watcher state self-test failed\n");
            return 1;
        }
        std::puts("drag watcher state self-test passed");
        return 0;
    }

    const int dragWidth = std::max(1, GetSystemMetrics(SM_CXDRAG));
    const int dragHeight = std::max(1, GetSystemMetrics(SM_CYDRAG));
    DragState state(dragWidth, dragHeight, config.shiftMode,
                    config.altMode, config.controlMode, config.controlShiftMode);
    InputPoller poller(state);

    // Create this thread's message queue so the console handler can post WM_QUIT.
    MSG initialMessage{};
    PeekMessageW(&initialMessage, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
    watcherThreadId = GetCurrentThreadId();
    if (!SetConsoleCtrlHandler(consoleHandler, TRUE)) {
        std::fprintf(stderr, "failed to install console cleanup handler\n");
        return 1;
    }

    std::fprintf(stderr, "Santra drag watcher running (passive polling); Ctrl+C to stop.\n");
    bool running = true;
    while (running) {
        MSG message{};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            if (message.message == WM_QUIT) {
                running = false;
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if (!running) break;
        poller.tick();
        // Wait for the next input message or the poll interval, whichever
        // comes first, without installing a single global hook.
        MsgWaitForMultipleObjectsEx(0, nullptr, PollIntervalMs, QS_ALLINPUT,
                                    MWMO_INPUTAVAILABLE);
    }

    SetConsoleCtrlHandler(consoleHandler, FALSE);
    return 0;
}
