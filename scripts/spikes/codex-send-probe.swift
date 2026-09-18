// macOS/Codex-only experiment. Selects a named test conversation and sends
// a fixed no-tools echo request. Never accepts arbitrary remote commands.
import AppKit
import ApplicationServices

func get(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name as CFString, &value) == .success ? value : nil
}
func label(_ e: AXUIElement) -> String {
    (get(e, kAXDescriptionAttribute) as? String) ?? (get(e, kAXTitleAttribute) as? String) ?? ""
}
func tree(_ root: AXUIElement) -> [AXUIElement] {
    var found: [AXUIElement] = []
    func walk(_ e: AXUIElement, _ depth: Int) {
        guard depth < 60, found.count < 6000 else { return }
        found.append(e)
        for child in get(e, kAXChildrenAttribute) as? [AXUIElement] ?? [] { walk(child, depth + 1) }
    }
    walk(root, 0)
    return found
}
var cleanup: (() -> Void)?
func fail(_ message: String) -> Never { cleanup?(); print(message); exit(1) }
func click(_ element: AXUIElement, _ app: NSRunningApplication, directed: Bool = false) {
    let beforePID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let beforeMouse = CGEvent(source: nil)?.location
    if !directed { app.activate(options: []); Thread.sleep(forTimeInterval: 0.3) }
    guard (directed || NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier),
          let p = get(element, kAXPositionAttribute), let s = get(element, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { fail("Cannot verify target geometry/focus") }
    var origin = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(p, to: AXValue.self), .cgPoint, &origin),
          AXValueGetValue(unsafeBitCast(s, to: AXValue.self), .cgSize, &size), size.width > 0, size.height > 0 else { fail("Invalid target geometry") }
    let point = CGPoint(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
    var targetWindow: Int64?
    if directed {
        for window in CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? [] {
            guard window[kCGWindowOwnerPID as String] as? Int32 == app.processIdentifier,
                  let bounds = window[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bounds), rect.contains(point),
                  let number = window[kCGWindowNumber as String] as? Int64 else { continue }
            targetWindow = number; break
        }
        guard targetWindow != nil else { fail("No target window at control position") }
    }
    for type: CGEventType in [.leftMouseDown, .leftMouseUp] {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { fail("Cannot allocate event") }
        if directed {
            event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(app.processIdentifier))
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: targetWindow!)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: targetWindow!)
            event.postToPid(app.processIdentifier)
        } else { event.post(tap: .cghidEventTap) }
    }
    if directed {
        Thread.sleep(forTimeInterval: 0.3)
        print("Directed event: background=\(beforePID != app.processIdentifier), foregroundUnchanged=\(beforePID == NSWorkspace.shared.frontmostApplication?.processIdentifier), cursorUnchanged=\(beforeMouse == CGEvent(source: nil)?.location)")
    }
}
guard AXIsProcessTrusted() else { fail("Accessibility permission unavailable") }
let args = CommandLine.arguments
guard args.count == 3, ["--select", "--send", "--select-click", "--send-click", "--stream-draft-click", "--select-directed", "--send-directed", "--stream-draft-directed", "--send-key-directed", "--send-key-directed-preserve-draft"].contains(args[1]) else {
    fail("Usage: swift codex-send-probe.swift --select|--send|--select-click|--send-click|--stream-draft-click <exact-test-thread-title>")
}
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
guard apps.count == 1 else { fail("Expected one Codex application") }
let root = AXUIElementCreateApplication(apps[0].processIdentifier)
AXUIElementSetMessagingTimeout(root, 1)
guard (get(root, kAXWindowsAttribute) as? [AXUIElement])?.count == 1 else { fail("Experiment requires exactly one app window") }
let matches = tree(root).filter { (get($0, kAXRoleAttribute) as? String) == kAXButtonRole && label($0) == args[2] }
guard matches.count == 1 else { fail("Test conversation button missing or ambiguous") }
if args[1].hasPrefix("--send-key-directed") { /* Test setup selects the conversation; do not change it here. */ }
else if args[1].hasSuffix("-directed") { click(matches[0], apps[0], directed: true) }
else if args[1].hasSuffix("-click") { click(matches[0], apps[0]) }
else { guard AXUIElementPerformAction(matches[0], kAXPressAction as CFString) == .success else { fail("Could not select test conversation") } }
Thread.sleep(forTimeInterval: 0.8)
if args[1].hasPrefix("--select") { print("Selection action dispatched; verify visible conversation before sending"); exit(0) }

let elements = tree(root)
// Build-specific selection evidence; reject unknown layouts. This is not a
// durable session identifier and must not be used as production session binding.
func selectedTestThread() -> Bool {
    let targets = tree(root).filter { (get($0, kAXRoleAttribute) as? String) == kAXButtonRole && label($0) == args[2] }
    guard targets.count == 1 else { return false }
    let classes = get(targets[0], "AXDOMClassList") as? [String] ?? []
    return classes.contains("sidebar-item") && classes.contains("bg-primary-ghost-hover")
}
guard selectedTestThread() else { fail("Test conversation selection not confirmed; not writing") }
let fields = elements.filter { (get($0, kAXRoleAttribute) as? String) == kAXTextAreaRole && label($0) == "Do anything" }
guard fields.count == 1, let field = fields.first,
      let initial = get(field, kAXValueAttribute) as? String,
      initial.isEmpty || initial == "\nDo anything" || args[1] == "--send-key-directed-preserve-draft" else { fail("Expected one empty test composer") }
if args[1].hasPrefix("--stream-draft-") {
    let revisions = ["测试", "测试实时", "测试实时语音", "测试实时语音修订"]
    for revision in revisions {
        guard selectedTestThread() else { fail("Target changed; draft updates stopped") }
        guard AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, revision as CFString) == .success else { fail("Revision write failed") }
        Thread.sleep(forTimeInterval: 0.3)
        guard (get(field, kAXValueAttribute) as? String) == revision else { fail("Revision mismatch; stopped without overwriting") }
    }
    guard selectedTestThread(), (get(field, kAXValueAttribute) as? String) == revisions.last else { fail("Draft changed; not clearing") }
    AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, "" as CFString)
    Thread.sleep(forTimeInterval: 0.2)
    let restored = get(field, kAXValueAttribute) as? String
    guard restored == "" || restored == "\nDo anything" else { fail("Draft clear could not be verified") }
    print("Four synthetic transcript revisions read back successfully; draft cleared; nothing sent")
    exit(0)
}
let marker = "VIBE_PANEL_OK_" + UUID().uuidString.prefix(8)
let prompt = "这是 Vibe Panel 桌面输入通路技术验证。不要调用工具，不修改文件，不执行其他任务。请仅回复：" + marker
if args[1].hasPrefix("--send-key-directed") {
    guard (get(field, kAXFocusedAttribute) as? Bool) == true else { fail("Composer must already have app-local focus") }
    cleanup = {
        // Sending can replace the composer AX node. Reacquire it rather than
        // treating a stale handle as user-edited content.
        let currentFields = tree(root).filter { (get($0, kAXRoleAttribute) as? String) == kAXTextAreaRole && label($0) == "Do anything" }
        guard currentFields.count == 1 else { print("Cannot reacquire composer; restoration skipped"); return }
        let currentField = currentFields[0]
        let current = get(currentField, kAXValueAttribute) as? String
        guard selectedTestThread(), current == prompt || current == "" || current == "\nDo anything" else {
            print("Draft changed or target changed; automatic restoration skipped"); return
        }
        let restore = initial == "\nDo anything" ? "" : initial
        AXUIElementSetAttributeValue(currentField, kAXValueAttribute as CFString, restore as CFString)
        Thread.sleep(forTimeInterval: 0.2)
        let actual = get(currentField, kAXValueAttribute) as? String
        print("Original draft restored=\(actual == restore || (restore.isEmpty && actual == "\nDo anything"))")
    }
}
guard selectedTestThread(), (get(field, kAXValueAttribute) as? String) == initial else { fail("Draft changed before write") }
guard AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, prompt as CFString) == .success else { fail("Draft write rejected") }
Thread.sleep(forTimeInterval: 0.3)
guard (get(field, kAXValueAttribute) as? String) == prompt else { fail("Draft readback differs; not sending") }
let buttons = tree(root).filter { (get($0, kAXRoleAttribute) as? String) == kAXButtonRole && label($0) == "Send" && (get($0, kAXEnabledAttribute) as? Bool) == true }
guard buttons.count == 1 else { fail("Expected one enabled Send button; probe draft retained") }
guard selectedTestThread(), (get(field, kAXValueAttribute) as? String) == prompt else { fail("Target or draft changed; not sending") }
if args[1].hasPrefix("--send-key-directed") {
    guard (get(field, kAXFocusedAttribute) as? Bool) == true else { fail("Composer must already have app-local focus") }
    let beforePID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let beforeMouse = CGEvent(source: nil)?.location
    for down in [true, false] {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: down) else { fail("Cannot create Return event") }
        event.postToPid(apps[0].processIdentifier)
    }
    Thread.sleep(forTimeInterval: 0.3)
    print("Directed Return: background=\(beforePID != apps[0].processIdentifier), foregroundUnchanged=\(beforePID == NSWorkspace.shared.frontmostApplication?.processIdentifier), cursorUnchanged=\(beforeMouse == CGEvent(source: nil)?.location)")
}
else if args[1].hasSuffix("-directed") { click(buttons[0], apps[0], directed: true) }
else if args[1].hasSuffix("-click") { click(buttons[0], apps[0]) }
else { guard AXUIElementPerformAction(buttons[0], kAXPressAction as CFString) == .success else { fail("Send action rejected; probe draft retained") } }
print("Send action dispatched (" + args[1] + "); expected response: " + marker)
print("Delivery and correct target must be verified independently in conversation history.")
cleanup?()
