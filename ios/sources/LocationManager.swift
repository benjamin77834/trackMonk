import Foundation
import CoreLocation
import UserNotifications

class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let mgr = CLLocationManager()
    @Published var lastLocation: CLLocation?
    @Published var lastSentTime: Date?
    private var timer: Timer?
    
    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        mgr.allowsBackgroundLocationUpdates = true
        mgr.pausesLocationUpdatesAutomatically = false
        mgr.showsBackgroundLocationIndicator = true
    }
    
    func startTracking() {
        mgr.requestAlwaysAuthorization()
        mgr.startUpdatingLocation()
        // Enviar cada 5 minutos
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.autoSend()
        }
        // Enviar ahora
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.autoSend()
        }
    }
    
    func stopTracking() {
        mgr.stopUpdatingLocation()
        timer?.invalidate()
        timer = nil
    }
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        lastLocation = locations.last
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("Location error: \(error)")
    }
    
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            manager.startUpdatingLocation()
        }
    }
    
    private func autoSend() {
        guard let loc = lastLocation else { return }
        APIManager.shared.sendLocation(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, acc: loc.horizontalAccuracy)
        DispatchQueue.main.async { self.lastSentTime = Date() }
        
        // Revisar mensajes nuevos y mostrar notificación con sonido
        APIManager.shared.checkMessages()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if APIManager.shared.unreadCount > 0 {
                self.showLocalNotification(count: APIManager.shared.unreadCount)
            }
        }
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
}
