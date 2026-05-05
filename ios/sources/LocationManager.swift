import Foundation
import CoreLocation

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
    }
}
