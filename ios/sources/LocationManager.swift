import Foundation
import CoreLocation
import UserNotifications
import UIKit

class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let mgr = CLLocationManager()
    @Published var lastLocation: CLLocation?
    @Published var lastSentTime: Date?
    @Published var isTracking = false
    private var timer: Timer?
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    
    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        mgr.allowsBackgroundLocationUpdates = true
        mgr.pausesLocationUpdatesAutomatically = false
        mgr.showsBackgroundLocationIndicator = true
        mgr.distanceFilter = kCLDistanceFilterNone
    }
    
    func startTracking() {
        mgr.requestAlwaysAuthorization()
        mgr.startUpdatingLocation()
        // Significant location changes — sobrevive aunque iOS mate la app
        mgr.startMonitoringSignificantLocationChanges()
        isTracking = true
        
        // Enviar cada 5 minutos
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.autoSend()
        }
        // Enviar ahora
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.autoSend()
        }
        
        // Observar cuando la app vuelve a foreground para reiniciar
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }
    
    func stopTracking() {
        mgr.stopUpdatingLocation()
        mgr.stopMonitoringSignificantLocationChanges()
        timer?.invalidate()
        timer = nil
        isTracking = false
    }
    
    @objc private func appDidBecomeActive() {
        // Reiniciar tracking preciso cuando vuelve a foreground
        if isTracking {
            mgr.startUpdatingLocation()
            if timer == nil {
                timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
                    self?.autoSend()
                }
            }
            autoSend()
        }
    }
    
    @objc private func appDidEnterBackground() {
        // Iniciar background task para ganar tiempo
        if isTracking {
            beginBackgroundTask()
        }
    }
    
    private func beginBackgroundTask() {
        bgTask = UIApplication.shared.beginBackgroundTask { [weak self] in
            self?.endBackgroundTask()
        }
    }
    
    private func endBackgroundTask() {
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
    }
    
    // MARK: - CLLocationManagerDelegate
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        lastLocation = loc
        
        // Si viene de significant location change (app fue relanzada), enviar inmediatamente
        if UIApplication.shared.applicationState != .active {
            sendLocationNow(loc)
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("Location error: \(error)")
    }
    
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            manager.startUpdatingLocation()
            if manager.authorizationStatus == .authorizedAlways {
                manager.startMonitoringSignificantLocationChanges()
            }
        }
    }
    
    // MARK: - Envío de ubicación
    
    private func autoSend() {
        guard let loc = lastLocation else { return }
        sendLocationNow(loc)
        
        // Revisar mensajes nuevos
        APIManager.shared.checkMessages()
        APIManager.shared.loadChatUnread()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if APIManager.shared.unreadCount > 0 {
                self.showLocalNotification(count: APIManager.shared.unreadCount)
            }
            let chatTotal = APIManager.shared.chatUnread.values.reduce(0, +)
            if chatTotal > 0 {
                self.showChatNotification(count: chatTotal)
            }
        }
    }
    
    private func sendLocationNow(_ loc: CLLocation) {
        APIManager.shared.sendLocation(
            lat: loc.coordinate.latitude,
            lng: loc.coordinate.longitude,
            acc: loc.horizontalAccuracy
        )
        DispatchQueue.main.async { self.lastSentTime = Date() }
    }
    
    private func showLocalNotification(count: Int) {
        let content = UNMutableNotificationContent()
        content.title = "🐵 TrackMonk"
        content.body = "Tienes \(count) mensaje\(count > 1 ? "s" : "") nuevo\(count > 1 ? "s" : "")"
        content.sound = .default
        content.badge = NSNumber(value: count)
        
        let request = UNNotificationRequest(identifier: "msg-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
    
    private func showChatNotification(count: Int) {
        let content = UNMutableNotificationContent()
        content.title = "💬 Chat de compañeros"
        content.body = "Tienes \(count) mensaje\(count > 1 ? "s" : "") de tus compañeros"
        content.sound = UNNotificationSound.defaultCritical
        content.interruptionLevel = .timeSensitive
        content.badge = NSNumber(value: count)
        
        let request = UNNotificationRequest(identifier: "chat-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
