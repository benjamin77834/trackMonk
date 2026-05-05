import SwiftUI

struct ContentView: View {
    @StateObject private var locationManager = LocationManager()
    @StateObject private var api = APIManager()
    @State private var isLoggedIn = false
    @State private var username = ""
    @State private var password = ""
    @State private var statusMessage = ""
    
    var body: some View {
        NavigationView {
            if !isLoggedIn {
                LoginView(username: $username, password: $password, statusMessage: $statusMessage, onLogin: login)
            } else {
                MainView(locationManager: locationManager, api: api, onLogout: logout)
            }
        }
    }
    
    func login() {
        api.driverLogin(username: username, password: password) { success, message in
            if success {
                isLoggedIn = true
                locationManager.startTracking()
            } else {
                statusMessage = message
            }
        }
    }
    
    func logout() {
        isLoggedIn = false
        locationManager.stopTracking()
        api.logout()
        username = ""
        password = ""
    }
}

struct LoginView: View {
    @Binding var username: String
    @Binding var password: String
    @Binding var statusMessage: String
    var onLogin: () -> Void
    
    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Text("🐵").font(.system(size: 60))
            Text("TrackMonk").font(.title).bold()
            Text("Tracking GPS").font(.subheadline).foregroundColor(.gray)
            
            VStack(spacing: 12) {
                TextField("Usuario", text: $username)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .autocapitalization(.none)
                SecureField("Contraseña", text: $password)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                
                if !statusMessage.isEmpty {
                    Text(statusMessage).foregroundColor(.red).font(.caption)
                }
                
                Button(action: onLogin) {
                    Text("Iniciar sesión")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                        .bold()
                }
            }
            .padding(.horizontal, 30)
            Spacer()
            Text("by Monkey Phone").font(.caption).foregroundColor(.gray)
        }
    }
}

struct MainView: View {
    @ObservedObject var locationManager: LocationManager
    @ObservedObject var api: APIManager
    var onLogout: () -> Void
    @State private var showEmergency = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Status card
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.green)
                    Text("Dispositivo activo").font(.headline)
                    Text(api.driverName).font(.subheadline).foregroundColor(.gray)
                    if let loc = locationManager.lastLocation {
                        Text("📍 \(loc.coordinate.latitude, specifier: "%.5f"), \(loc.coordinate.longitude, specifier: "%.5f")")
                            .font(.caption).foregroundColor(.gray)
                    }
                    if let time = locationManager.lastSentTime {
                        Text("Última: \(time, formatter: timeFormatter)")
                            .font(.caption2).foregroundColor(.gray)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(radius: 2)
                
                // Send location button
                Button(action: sendLocation) {
                    Label("Enviar mi ubicación", systemImage: "location.fill")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                        .bold()
                }
                
                // Emergency button
                Button(action: { showEmergency = true }) {
                    Label("EMERGENCIA", systemImage: "exclamationmark.triangle.fill")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.red)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                        .bold()
                        .font(.title3)
                }
                
                // Logout
                Button("Cerrar sesión", action: onLogout)
                    .font(.caption).foregroundColor(.gray)
            }
            .padding()
        }
        .navigationTitle("TrackMonk")
        .sheet(isPresented: $showEmergency) {
            EmergencyView(api: api, locationManager: locationManager, isPresented: $showEmergency)
        }
    }
    
    func sendLocation() {
        guard let loc = locationManager.lastLocation else { return }
        api.sendLocation(latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude, accuracy: loc.horizontalAccuracy)
    }
    
    private var timeFormatter: DateFormatter {
        let f = DateFormatter()
        f.timeStyle = .short
        return f
    }
}

struct EmergencyView: View {
    @ObservedObject var api: APIManager
    @ObservedObject var locationManager: LocationManager
    @Binding var isPresented: Bool
    @State private var message = ""
    
    let emergencyTypes = [
        ("accident", "🚗💥", "Accidente"),
        ("robbery", "🔫", "Robo / Asalto"),
        ("breakdown", "🔧", "Avería"),
        ("help", "🆘", "Auxilio"),
    ]
    
    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                Text("🚨 Tipo de emergencia").font(.headline).foregroundColor(.red)
                
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(emergencyTypes, id: \.0) { type in
                        Button(action: { sendAlert(type: type.0) }) {
                            VStack {
                                Text(type.1).font(.title)
                                Text(type.2).font(.caption).bold()
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                        }
                        .foregroundColor(.primary)
                    }
                }
                
                TextField("Mensaje adicional (opcional)", text: $message)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                
                Spacer()
            }
            .padding()
            .navigationTitle("Emergencia")
            .navigationBarItems(trailing: Button("Cancelar") { isPresented = false })
        }
    }
    
    func sendAlert(type: String) {
        let loc = locationManager.lastLocation
        api.sendAlert(type: type, message: message, latitude: loc?.coordinate.latitude, longitude: loc?.coordinate.longitude, accuracy: loc?.horizontalAccuracy)
        isPresented = false
    }
}
