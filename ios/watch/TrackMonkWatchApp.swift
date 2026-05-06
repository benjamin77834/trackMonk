import SwiftUI
import WatchConnectivity

@main
struct TrackMonkWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) var delegate
    
    var body: some Scene {
        WindowGroup {
            WatchContentView()
        }
    }
}

class WatchAppDelegate: NSObject, WKApplicationDelegate, WCSessionDelegate {
    func applicationDidFinishLaunching() {
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }
    
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let deviceId = applicationContext["deviceId"] as? String {
            UserDefaults.standard.set(deviceId, forKey: "deviceId")
        }
    }
}
