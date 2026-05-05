import SwiftUI

struct ContentView: View {
    @StateObject private var location = LocationManager()
    @StateObject private var api = APIManager()
    @AppStorage("isLoggedIn") private var isLoggedIn = false
    @State private var username = ""
    @State private var password = ""
    @State private var error = ""
    @State private var showEmergency = false
    
    var body: some View {
        if !isLoggedIn {
            loginView
        } else {
            mainView
        }
    }
    
    var loginView: some View {
        VStack(spacing: 20) {
            Spacer()
            Text("🐵").font(.system(size: 60))
            Text("TrackMonk").font(.largeTitle).bold()
            Text("Tracking GPS para tu flota").font(.subheadline).foregroundColor(.secondary)
            
            VStack(spacing: 12) {
                TextField("Usuario", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                SecureField("Contraseña", text: $password)
                    .textFieldStyle(.roundedBorder)
                
                if !error.isEmpty {
                    Text(error).foregroundColor(.red).font(.caption)
                }
                
                Button(action: login) {
                    Text("Iniciar sesión")
                        .frame(maxWidth: .infinity).padding()
                        .background(Color.green).foregroundColor(.white)
                        .cornerRadius(10).bold()
                }
            }.padding(.horizontal, 30)
            
            Spacer()
            Text("by Monkey Phone").font(.caption2).foregroundColor(.secondary)
        }
    }
    
    var mainView: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    // Status
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 44)).foregroundColor(.green)
                        Text("Dispositivo activo").font(.headline)
                        Text(api.driverName).foregroundColor(.secondary)
                        if let loc = location.lastLocation {
                            Text("📍 \(loc.coordinate.latitude, specifier: "%.5f"), \(loc.coordinate.longitude, specifier: "%.5f")")
                                .font(.caption).foregroundColor(.secondary)
                        }
                        if let t = location.lastSentTime {
                            Text("Última: \(t, formatter: timeFmt)")
                                .font(.caption2).foregroundColor(.secondary)
                        }
                        HStack {
                            Circle().fill(Color.green).frame(width: 8, height: 8)
                            Text("Tracking activo en segundo plano").font(.caption2).foregroundColor(.green)
                        }
                    }
                    .padding().frame(maxWidth: .infinity)
                    .background(Color(.systemBackground))
                    .cornerRadius(16).shadow(radius: 3)
                    
                    // Enviar ubicación
                    Button(action: sendNow) {
                        Label("Enviar mi ubicación", systemImage: "location.fill")
                            .frame(maxWidth: .infinity).padding()
                            .background(Color.green).foregroundColor(.white)
                            .cornerRadius(12).bold()
                    }
                    
                    // Emergencia
                    Button(action: { showEmergency = true }) {
                        Label("EMERGENCIA", systemImage: "exclamationmark.triangle.fill")
                            .frame(maxWidth: .infinity).padding()
                            .background(Color.red).foregroundColor(.white)
                            .cornerRadius(12).bold().font(.title3)
                    }
                    
                    // Logout
                    Button("Cerrar sesión") { logout() }
                        .font(.caption).foregroundColor(.secondary).padding(.top, 20)
                }
                .padding()
            }
            .navigationTitle("🐵 TrackMonk")
            .sheet(isPresented: $showEmergency) {
                EmergencySheet(api: api, location: location, show: $showEmergency)
            }
        }
    }
    
    func login() {
        error = ""
        api.driverLogin(username: username, password: password) { ok, msg in
            if ok {
                isLoggedIn = true
                location.startTracking()
            } else { error = msg }
        }
    }
    
    func logout() {
        isLoggedIn = false
        location.stopTracking()
        api.logout()
        username = ""; password = ""
    }
    
    func sendNow() {
        guard let loc = location.lastLocation else { return }
        api.sendLocation(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, acc: loc.horizontalAccuracy)
        location.lastSentTime = Date()
    }
    
    var timeFmt: DateFormatter {
        let f = DateFormatter(); f.timeStyle = .short; return f
    }
}

// MARK: - Emergency Sheet

struct EmergencySheet: View {
    @ObservedObject var api: APIManager
    @ObservedObject var location: LocationManager
    @Binding var show: Bool
    @State private var message = ""
    
    let types: [(String, String, String)] = [
        ("accident", "🚗💥", "Accidente"),
        ("robbery", "🔫", "Robo"),
        ("breakdown", "🔧", "Avería"),
        ("help", "🆘", "Auxilio"),
    ]
    
    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                Text("🚨").font(.system(size: 40))
                Text("Tipo de emergencia").font(.headline).foregroundColor(.red)
                
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(types, id: \.0) { t in
                        Button { send(t.0) } label: {
                            VStack {
                                Text(t.1).font(.largeTitle)
                                Text(t.2).font(.caption).bold()
                            }
                            .frame(maxWidth: .infinity).padding()
                            .background(Color(.systemGray6)).cornerRadius(12)
                        }.foregroundColor(.primary)
                    }
                }
                
                TextField("Mensaje adicional", text: $message)
                    .textFieldStyle(.roundedBorder)
                Spacer()
            }
            .padding()
            .navigationTitle("Emergencia")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { show = false } } }
        }
    }
    
    func send(_ type: String) {
        let loc = location.lastLocation
        api.sendAlert(type: type, message: message, lat: loc?.coordinate.latitude, lng: loc?.coordinate.longitude, acc: loc?.horizontalAccuracy)
        show = false
    }
}
