// Capability probe. Never prints conversation text or submits input.
// Optional web accessibility toggle is restored after inspection.
import AppKit
import ApplicationServices

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

// Observed on this Codex build after the user opened an empty test conversation.
// Keep this opt-in: AX does not expose a semantic placeholder attribute here.
func emptyValue(_ value: String, _ field: AXUIElement) -> Bool {
    value.isEmpty || (CommandLine.arguments.contains("--confirmed-empty-codex") &&
        value == "\nDo anything" && (attribute(field, kAXDescriptionAttribute) as? String) == "Do anything")
}

let trusted = AXIsProcessTrusted()
var apps: [[String: Any]] = []
for bundle in ["com.openai.codex", "com.anthropic.claudefordesktop"] {
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundle)
    var report: [String: Any] = ["bundleId": bundle, "running": !running.isEmpty]
    if let app = running.first, trusted {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 1)
        let manualKey = "AXManualAccessibility" as CFString
        let originalManual = attribute(root, "AXManualAccessibility")
        let enableWeb = CommandLine.arguments.contains("--enable-web-accessibility")
        if enableWeb {
            let result = AXUIElementSetAttributeValue(root, manualKey, kCFBooleanTrue)
            report["manualAccessibilityResult"] = result.rawValue
            Thread.sleep(forTimeInterval: 0.5)
        }
        defer {
            if enableWeb { AXUIElementSetAttributeValue(root, manualKey, originalManual ?? kCFBooleanFalse) }
        }
        var roles: [String: Int] = [:]
        var editable = 0
        var textElements: [AXUIElement] = []
        var visited = 0
        func visit(_ element: AXUIElement, _ depth: Int) {
            guard depth < 60, visited < 6000 else { return }
            visited += 1
            let role = attribute(element, kAXRoleAttribute) as? String ?? "unknown"
            roles[role, default: 0] += 1
            if role == kAXTextAreaRole || role == kAXTextFieldRole {
                var settable = DarwinBoolean(false)
                if AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue {
                    editable += 1
                    textElements.append(element)
                }
            }
            for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] { visit(child, depth + 1) }
        }
        visit(root, 0)
        report["roles"] = roles
        report["settableTextElements"] = editable
        report["visited"] = visited
        report["frontmost"] = app.isActive
        report["textMetadata"] = textElements.map { field -> [String: Any] in
            let value = attribute(field, kAXValueAttribute)
            let string = value as? String
            var ancestorRoles: [String] = []
            var current = field
            for _ in 0..<12 {
                guard let parent = attribute(current, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
                current = unsafeBitCast(parent, to: AXUIElement.self)
                ancestorRoles.append(attribute(current, kAXRoleAttribute) as? String ?? "unknown")
            }
            return ["valueReadable": value != nil, "valueIsString": string != nil,
                    "identifier": (attribute(field, kAXIdentifierAttribute) as? String) ?? "",
                    "description": (attribute(field, kAXDescriptionAttribute) as? String) ?? "",
                    "ancestorRoles": ancestorRoles,
                    "matchesPlaceholder": string != nil && string == (attribute(field, "AXPlaceholderValue") as? String),
                    "placeholderLength": (attribute(field, "AXPlaceholderValue") as? String)?.count ?? -1,
                    "characterCount": string?.count ?? -1,
                    "whitespaceOnly": string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? false,
                    "focused": (attribute(field, kAXFocusedAttribute) as? Bool) ?? false]
        }
        if CommandLine.arguments.contains("--draft-roundtrip"), bundle == "com.openai.codex" {
            // Only an unambiguous, empty field in the allowlisted app may be used.
            // Never focus a window, synthesize a key, press Send, or overwrite a draft.
            if textElements.count == 1, let field = textElements.first,
               let initial = attribute(field, kAXValueAttribute) as? String, emptyValue(initial, field) {
                let marker = "VIBE_PANEL_DRAFT_PROBE_" + UUID().uuidString
                let result = AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, marker as CFString)
                Thread.sleep(forTimeInterval: 0.2)
                let observed = attribute(field, kAXValueAttribute) as? String
                report["draftWriteResult"] = result.rawValue
                report["draftReadbackMatched"] = observed == marker
                if observed == marker {
                    report["draftRestoreResult"] = AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, "" as CFString).rawValue
                    Thread.sleep(forTimeInterval: 0.2)
                    report["draftRestored"] = (attribute(field, kAXValueAttribute) as? String).map { emptyValue($0, field) } ?? false
                } else {
                    report["draftRestored"] = observed == initial
                }
            } else { report["draftProbeSkipped"] = "requires exactly one empty editable text element" }
        }
    }
    apps.append(report)
}
let output: [String: Any] = ["accessibilityTrusted": trusted, "readOnly": !CommandLine.arguments.contains("--enable-web-accessibility") && !CommandLine.arguments.contains("--draft-roundtrip"), "apps": apps]
print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
