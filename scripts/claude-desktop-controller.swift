// Experimental, macOS-only. JSON over stdin/stdout; no global input events.
import AppKit
import ApplicationServices

func attr(_ e: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, key as CFString, &value) == .success ? value : nil
}
func label(_ e: AXUIElement) -> String { attr(e, kAXDescriptionAttribute) as? String ?? "" }
var mutationStarted = false
func fail(_ reason: String, recoverable: Bool = false) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["error": reason, "code": recoverable && !mutationStarted ? "target_unavailable" : "binding_invalid"])
    print(String(data: data, encoding: .utf8)!); exit(1)
}
func tree(_ root: AXUIElement) -> [AXUIElement] {
    var result: [AXUIElement] = []
    var visited: [CFHashCode: [AXUIElement]] = [:]
    func visit(_ e: AXUIElement, _ depth: Int) {
        let hash = CFHash(e)
        if (visited[hash] ?? []).contains(where: { CFEqual($0, e) }) { return }
        visited[hash, default: []].append(e)
        guard depth < 128, result.count < 12000 else { fail("无法完整检查当前界面，已停止控制") }
        result.append(e)
        for child in attr(e, kAXChildrenAttribute) as? [AXUIElement] ?? [] { visit(child, depth + 1) }
    }
    visit(root, 0); return result
}
func sessionURL(_ raw: String) -> String? {
    guard let url = URL(string: raw), url.scheme == "app", url.host == "localhost", url.query == nil, url.fragment == nil,
          url.path.range(of: "^/epitaxy/local_[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$", options: .regularExpression) != nil else { return nil }
    return raw
}
if CommandLine.arguments.contains("--self-test") {
    assert(sessionURL("app://localhost/epitaxy/local_12345678-1234-1234-1234-123456789012") != nil)
    for url in ["app://localhost/epitaxy", "https://evil.test/epitaxy/local_12345678-1234-1234-1234-123456789012", "app://localhost/epitaxy/local_invalid", "app://localhost/epitaxy/local_12345678-1234-1234-1234-123456789012?other=1"] { assert(sessionURL(url) == nil) }
    print("Claude App session identity checks passed"); exit(0)
}
guard let request = try? JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as? [String: Any],
      let action = request["action"] as? String, ["inspect", "write", "send"].contains(action) else { fail("控制请求无效") }
if let session = CGSessionCopyCurrentDictionary() as? [String: Any], (session["CGSSessionScreenIsLocked"] as? Bool) == true { fail("电脑已锁屏，请先解锁", recoverable: true) }
guard AXIsProcessTrusted() else { fail("请在电脑上授予 Connector 辅助功能权限") }
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.anthropic.claudefordesktop")
guard apps.count == 1 else { fail("请打开一个 Claude App 实例", recoverable: true) }
let app = apps[0], root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root, 1)
guard (attr(root, kAXWindowsAttribute) as? [AXUIElement])?.count == 1 else { fail("当前只支持一个 Claude App 窗口", recoverable: true) }
func page() -> (AXUIElement, String) {
    let pages = tree(root).compactMap { e -> (AXUIElement, String)? in
        guard attr(e, kAXRoleAttribute) as? String == "AXWebArea", let raw = attr(e, "AXURL") else { return nil }
        let value = (raw as? URL)?.absoluteString ?? (raw as? String) ?? ""
        guard let url = sessionURL(value) else { return nil }
        return (e, url)
    }
    guard pages.count == 1 else { fail("请在 Claude App 的 Code 中打开一个现有会话；首页和其他模式暂不支持绑定", recoverable: true) }
    return pages[0]
}
func fingerprint() -> String { "claude-app-v1:\(app.processIdentifier):\(page().1)" }
func composer() -> AXUIElement {
    let fields = tree(page().0).filter { attr($0, kAXRoleAttribute) as? String == kAXTextAreaRole && label($0) == "Prompt" }
    guard fields.count == 1 else { fail("无法唯一识别 Claude App 输入框", recoverable: true) }
    return fields[0]
}
func sendButtons() -> [AXUIElement] { tree(page().0).filter { attr($0, kAXRoleAttribute) as? String == kAXButtonRole && label($0) == "Send" } }
func text(_ field: AXUIElement) -> String {
    guard let value = attr(field, kAXValueAttribute) as? String else { fail("Claude App 输入框不可读") }
    let sends = sendButtons()
    if value == "Type / for commands\n", sends.count == 1, attr(sends[0], kAXEnabledAttribute) as? Bool == false { return "" }
    return value
}
let initialPage = page(), identity = fingerprint()
let title = "Claude App · " + String(URL(string: initialPage.1)!.lastPathComponent.dropFirst(6).prefix(8))
if let expectedTitle = request["title"] as? String, !expectedTitle.isEmpty, expectedTitle != title { fail("Claude App 目标会话已切换，请切回原会话", recoverable: true) }
let field = composer()
if action != "inspect" {
    guard request["fingerprint"] as? String == identity else { fail("Claude App 目标会话已变化，请重新绑定") }
    guard request["expectedText"] as? String == text(field) else { fail("电脑草稿已变化，已保留你的编辑") }
}
var response: [String: Any] = ["title": title, "fingerprint": identity, "text": text(field), "foreground": NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier]
if action == "write" {
    guard let value = request["text"] as? String, value.utf8.count <= 16000 else { fail("草稿过长") }
    let current = composer()
    guard fingerprint() == identity, request["expectedText"] as? String == text(current) else { fail("目标或草稿已变化") }
    mutationStarted = true
    guard AXUIElementSetAttributeValue(current, kAXValueAttribute as CFString, value as CFString) == .success else { fail("Claude App 草稿写入失败") }
    Thread.sleep(forTimeInterval: 0.15)
    guard fingerprint() == identity, text(composer()) == value else { fail("Claude App 草稿读回失败，请在电脑检查") }
    response["text"] = value
} else if action == "send" {
    let sends = sendButtons(), current = composer()
    guard !text(current).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          sends.count == 1, attr(sends[0], kAXEnabledAttribute) as? Bool == true,
          attr(current, kAXFocusedAttribute) as? Bool == true else { fail("请等 Claude App 就绪，并在电脑点击输入框后重试", recoverable: true) }
    guard fingerprint() == identity, request["expectedText"] as? String == text(current) else { fail("目标或草稿已变化") }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: true), let up = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: false) else { fail("无法创建发送事件") }
    mutationStarted = true
    down.postToPid(app.processIdentifier); up.postToPid(app.processIdentifier)
    var cleared = false
    for _ in 0..<20 {
        Thread.sleep(forTimeInterval: 0.15)
        guard fingerprint() == identity else { break }
        if text(composer()).isEmpty { cleared = true; break }
    }
    response = ["dispatched": true, "composerCleared": cleared]
}
print(String(data: try! JSONSerialization.data(withJSONObject: response), encoding: .utf8)!)
