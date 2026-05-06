import Foundation
import CoreLocation

class WatchLocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let mgr = CLLocationManager()
    @Published var lastLocation: CLLocation?
    
    override init() {
        super.init()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
    }
    
    func start() {
        mgr.requestWhenInUseAuthorization()
        mgr.startUpdatingLocation()
    }
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        lastLocation = locations.last
    }
}
