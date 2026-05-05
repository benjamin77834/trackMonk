import Foundation
import CoreLocation

class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    @Published var lastLocation: CLLocation?
    @Published var lastSentTime: Date?
    private var sendTimer: Timer?
    
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
    }
    
    func startTracking() {
        manager.requestAlwaysAuthorization()
        manager.startUpdatingLocation()
        // Enviar ubicación cada 5 minutos
        sendTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.sendCurrentLocation()
        }
    }
    
    func stopTracking() {
        manager.stopUpdatingLocation()
        sendTimer?.invalidate()
        sendTimer = nil
    }
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        lastLocation = locations.last
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("Location error: \(error.localizedDescription)")
    }
    
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.startUpdatingLocation()
        default:
            break
        }
    }
    
    func sendCurrentLocation() {
        guard let loc = lastLocation else { return }
        let deviceId = UserDefaults.standard.string(forKey: "deviceId") ?? ""
        guard !deviceId.isEmpty else { return }
        
        APIManager.shared.sendLocation(latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude, accuracy: loc.horizontalAccuracy)
        lastSentTime = Date()
    }
}
