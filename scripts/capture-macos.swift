import AppKit
import CoreGraphics
import Foundation

struct CaptureFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

@MainActor
func capture() throws {
  let arguments = Array(CommandLine.arguments.dropFirst())
  guard arguments.count >= 5, let settle = Double(arguments[2]), settle >= 0 else {
    throw CaptureFailure(message: "Use capture-macos.swift APP OUTPUT SETTLE_MS ENV_JSON READY_JSON [APP_ARGUMENTS]")
  }
  let bundle = URL(fileURLWithPath: arguments[0]).standardizedFileURL
  let output = arguments[1]
  let previous = Set(NSWorkspace.shared.runningApplications.map(\.processIdentifier))
  let launcher = Process()
  launcher.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  let environment = try JSONDecoder().decode([String: String].self, from: Data(arguments[3].utf8))
  let variables = environment.sorted { $0.key < $1.key }.flatMap { ["--env", "\($0.key)=\($0.value)"] }
  launcher.arguments = ["-n"] + variables + [bundle.path]
    + (arguments.count > 5 ? ["--args"] + Array(arguments.dropFirst(5)) : [])
  try launcher.run()
  launcher.waitUntilExit()
  guard launcher.terminationStatus == 0 else { throw CaptureFailure(message: "Native app launch failed") }
  var launched: NSRunningApplication?
  for _ in 0..<100 {
    launched = NSWorkspace.shared.runningApplications.first {
      !previous.contains($0.processIdentifier) && $0.bundleURL?.standardizedFileURL == bundle
    }
    if launched != nil { break }
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  }
  guard let app = launched else { throw CaptureFailure(message: "Cannot identify the launched native app") }
  defer { app.terminate() }
  app.activate(options: [])
  RunLoop.current.run(until: Date().addingTimeInterval(settle / 1000))
  var readiness: [String: Any] = ["status": "unverified", "reason": "No native readiness signal"]
  if let spec = try JSONSerialization.jsonObject(with: Data(arguments[4].utf8)) as? [String: Any],
     let file = spec["file"] as? String, let request = spec["request"] as? [String: Any] {
    readiness = ["status": "failed", "method": "native-signal", "reason": "Native readiness signal timed out"]
    let deadline = Date().addingTimeInterval((spec["timeoutMs"] as? Double ?? 15000) / 1000)
    while Date() < deadline {
      if let data = FileManager.default.contents(atPath: file),
         let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         state["version"] as? Int == 1,
         state["requestId"] as? String == request["requestId"] as? String,
         state["screen"] as? String == request["screen"] as? String,
         (request["fixture"] as? String == nil || state["fixture"] as? String == request["fixture"] as? String) {
        if state["state"] as? String == "error" {
          readiness = ["status": "failed", "method": "native-signal", "reason": state["error"] as? String ?? "Native app reported an error"]
          break
        }
        if state["state"] as? String == "ready", state["pending"] as? Int == 0 {
          readiness = ["status": "passed", "method": "native-signal"]
          break
        }
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
  }
  var identifier: NSNumber?
  for _ in 0..<100 {
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    identifier = windows.first {
      ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier
        && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
        && (($0[kCGWindowBounds as String] as? [String: NSNumber])?["Width"]?.doubleValue ?? 0) > 100
    }?[kCGWindowNumber as String] as? NSNumber
    if identifier != nil { break }
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  }
  guard let identifier else { throw CaptureFailure(message: "No visible app window; check the app state and screen-recording access") }
  let screenshot = Process()
  screenshot.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  screenshot.arguments = ["-x", "-t", "png", "-l", identifier.stringValue, output]
  try screenshot.run()
  screenshot.waitUntilExit()
  guard screenshot.terminationStatus == 0 else { throw CaptureFailure(message: "Native window capture failed; screen-recording access may be required") }
  let result = try JSONSerialization.data(withJSONObject: ["readiness": readiness])
  FileHandle.standardOutput.write(result)
}

do { try MainActor.assumeIsolated { try capture() } }
catch {
  FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
  exit(1)
}
