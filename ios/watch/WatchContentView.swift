import SwiftUI
import CoreLocation

struct WatchContentView: View {
    @StateObject private var location = WatchLocationManager()
    @State private var alertSent = false
    @State private var locationSent = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text("🐵").font(.title)
                Text("TrackMonk").font(.headline)
                
                if let loc = location.lastLocation {
                    Text("📍 Activo")
                        .foregroundColor(.green)
                        .font(.caption)
                }
                
                // Enviar ubicación
                Button(action: sendLocation) {
                    Label("Ubicación", systemImage: "location.fill")
                }
                .tint(.green)
                
                if locationSent {
                    Text("✓ Enviada").font(.caption2).foregroundColor(.green)
                }
                
                Divider()
                
                // Emergencia
                Text("🚨 Emergencia").font(.caption).foregroundColor(.red)
                
                HStack {
                    Button("🚗💥") { sendAlert(type: "accident") }
                        .tint(.red)
                    Button("🔫") { sendAlert(type: "robbery") }
                        .tint(.orange)
                }
                HStack {
                    Button("🔧") { sendAlert(type: "breakdown") }
                        .tint(.blue)
                    Button("🆘") { sendAlert(type: "help") }
                        .tint(.pink)
                }
                
                if alertSent {
                    Text("🚨 Alerta enviada").font(.caption2).foregroundColor(.red)
                }
            }
            .padding()
        }
        .onAppear { location.start() }
    }
    
    func sendLocation() {
        guard let loc = location.lastLocation else { return }
        let deviceId = UserDefaults.standard.string(forKey: "deviceId") ?? ""
        guard !deviceId.isEmpty else { return }
        
        WatchAPI.sendLocation(deviceId: deviceId, lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, acc: loc.horizontalAccuracy)
        locationSent = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { locationSent = false }
    }
    
    func sendAlert(type: String) {
        let deviceId = UserDefaults.standard.string(forKey: "deviceId") ?? ""
        guard !deviceId.isEmpty else { return }
        let loc = location.lastLocation
        
        WatchAPI.sendAlert(deviceId: deviceId, type: type, lat: loc?.coordinate.latitude, lng: loc?.coordinate.longitude, acc: loc?.horizontalAccuracy)
        alertSent = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { alertSent = false }
    }
}
