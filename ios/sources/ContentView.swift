import SwiftUI

struct ContentView: View {
    @StateObject private var location = LocationManager()
    @ObservedObject private var api = APIManager.shared
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
                    
                    // Chat con compañeros
                    DriverChatSection(api: api)
                    
                    // Mensajes del admin
                    MessagesSection(api: api)
                    
                    // Emergencia
                    Button(action: { showEmergency = true }) {
                        Label("EMERGENCIA", systemImage: "exclamationmark.triangle.fill")
                            .frame(maxWidth: .infinity).padding()
                            .background(Color.red).foregroundColor(.white)
                            .cornerRadius(12).bold().font(.title3)
                    }
                    
                    // Viaje activo
                    if api.activeTrip != nil {
                        TripSection(api: api)
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
            .onAppear {
                if !location.isTracking {
                    location.startTracking()
                }
                api.startPolling()
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


// MARK: - Messages Section

struct MessagesSection: View {
    @ObservedObject var api: APIManager
    @State private var expanded = false
    @State private var replyText: [Int: String] = [:]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: { expanded.toggle(); if expanded { api.checkMessages() } }) {
                HStack {
                    Text("🔔 Notificaciones").font(.headline)
                    if api.unreadCount > 0 {
                        Text("\(api.unreadCount)")
                            .font(.caption).bold()
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Color.red).foregroundColor(.white)
                            .cornerRadius(10)
                    }
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").foregroundColor(.secondary)
                }
            }.foregroundColor(.primary)
            
            if expanded {
                if api.messages.isEmpty {
                    Text("Sin notificaciones").font(.caption).foregroundColor(.secondary)
                } else {
                    ForEach(api.messages.indices, id: \.self) { i in
                        let msg = api.messages[i]
                        let msgId = msg["id"] as? Int ?? 0
                        let isUnread = (msg["is_read"] as? Int ?? 0) == 0
                        let existingReply = msg["reply"] as? String
                        
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .top) {
                                Circle().fill(isUnread ? Color.green : Color.gray.opacity(0.3))
                                    .frame(width: 8, height: 8).padding(.top, 6)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(msg["title"] as? String ?? "").font(.subheadline).bold()
                                    Text(msg["body"] as? String ?? "").font(.caption).foregroundColor(.secondary)
                                }
                                Spacer()
                            }
                            
                            if let reply = existingReply, !reply.isEmpty {
                                HStack {
                                    Image(systemName: "arrowshape.turn.up.left.fill").font(.caption2).foregroundColor(.blue)
                                    Text(reply).font(.caption).foregroundColor(.blue)
                                }
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(Color.blue.opacity(0.1)).cornerRadius(6)
                            } else {
                                HStack(spacing: 4) {
                                    TextField("Responder...", text: Binding(
                                        get: { replyText[msgId] ?? "" },
                                        set: { replyText[msgId] = $0 }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                    .font(.caption)
                                    
                                    Button(action: { sendReply(messageId: msgId) }) {
                                        Image(systemName: "paperplane.fill")
                                            .foregroundColor(.white)
                                            .padding(6)
                                            .background(Color.green)
                                            .cornerRadius(6)
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                        Divider()
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(radius: 2)
    }
    
    func sendReply(messageId: Int) {
        guard let text = replyText[messageId], !text.isEmpty else { return }
        api.replyToMessage(messageId: messageId, reply: text) { success in
            if success {
                replyText[messageId] = nil
                api.checkMessages()
            }
        }
    }
}

// MARK: - Trip Section

struct TripSection: View {
    @ObservedObject var api: APIManager
    @State private var concept = "Gasolina"
    @State private var amount = ""
    @State private var note = ""
    
    let costTypes = ["Gasolina", "Caseta", "Comida", "Hospedaje", "Mantenimiento", "Otro"]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("🚛 Viaje activo").font(.headline)
            
            if let trip = api.activeTrip {
                // Route
                HStack {
                    Circle().fill(Color.green).frame(width: 10, height: 10)
                    Text(trip["origin"] as? String ?? "").font(.caption)
                    Rectangle().fill(Color.gray.opacity(0.3)).frame(height: 2)
                    Text(trip["destination"] as? String ?? "").font(.caption)
                    Circle().fill(Color.red).frame(width: 10, height: 10)
                }
                
                if let cargo = trip["cargo"] as? String, !cargo.isEmpty {
                    Text("📦 \(cargo)").font(.caption).foregroundColor(.secondary)
                }
                
                // Entregas
                if !api.tripDeliveries.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        let done = api.tripDeliveries.filter { ($0["status"] as? String) == "delivered" }.count
                        Text("📦 Entregas (\(done)/\(api.tripDeliveries.count))").font(.subheadline).bold()
                        
                        ForEach(api.tripDeliveries.indices, id: \.self) { i in
                            let d = api.tripDeliveries[i]
                            let isDone = (d["status"] as? String) == "delivered"
                            let dId = d["id"] as? Int ?? 0
                            
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(isDone ? "✅" : "⏳") \(d["name"] as? String ?? "")")
                                        .font(.caption).bold()
                                    if let addr = d["address"] as? String, !addr.isEmpty {
                                        Text("📍 \(addr)").font(.caption2).foregroundColor(.secondary)
                                    }
                                }
                                Spacer()
                                if !isDone {
                                    Button("Entregar") {
                                        markDeliveryDone(dId)
                                    }
                                    .font(.caption2).bold()
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(Color.green).foregroundColor(.white)
                                    .cornerRadius(6)
                                }
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 8)
                            .background(isDone ? Color.green.opacity(0.05) : Color.yellow.opacity(0.1))
                            .cornerRadius(8)
                        }
                    }
                }
                
                // Total cost
                let total = api.tripCosts.reduce(0.0) { $0 + (Double("\($1["amount"] ?? 0)") ?? 0) }
                Text("$\(total, specifier: "%.2f")")
                    .font(.title).bold()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(8)
                
                // Costs list
                ForEach(api.tripCosts.indices, id: \.self) { i in
                    let c = api.tripCosts[i]
                    HStack {
                        Text(c["concept"] as? String ?? "").font(.caption)
                        Spacer()
                        Text("$\(Double("\(c["amount"] ?? 0)") ?? 0, specifier: "%.2f")")
                            .font(.caption).bold()
                    }
                    .padding(.vertical, 2)
                    Divider()
                }
                
                // Add cost
                VStack(spacing: 8) {
                    Text("Agregar gasto").font(.subheadline).bold()
                    Picker("Tipo", selection: $concept) {
                        ForEach(costTypes, id: \.self) { Text($0) }
                    }.pickerStyle(.menu)
                    
                    HStack {
                        TextField("Monto $", text: $amount)
                            .keyboardType(.decimalPad)
                            .textFieldStyle(.roundedBorder)
                        TextField("Nota", text: $note)
                            .textFieldStyle(.roundedBorder)
                    }
                    
                    Button(action: addCost) {
                        Text("Agregar")
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(Color.green).foregroundColor(.white)
                            .cornerRadius(8).bold()
                    }
                    
                    // Evidencia (opcional)
                    HStack(spacing: 8) {
                        Button(action: { showCamera = true }) {
                            Label("📷 Foto", systemImage: "camera")
                                .frame(maxWidth: .infinity).padding(.vertical, 8)
                                .background(Color.orange).foregroundColor(.white)
                                .cornerRadius(8).font(.caption).bold()
                        }
                        Button(action: { showSignature = true }) {
                            Label("✍️ Firma", systemImage: "pencil.tip")
                                .frame(maxWidth: .infinity).padding(.vertical, 8)
                                .background(Color.blue).foregroundColor(.white)
                                .cornerRadius(8).font(.caption).bold()
                        }
                    }
                    
                    Button(action: completeTrip) {
                        Text("✅ Terminar viaje")
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(Color.red).foregroundColor(.white)
                            .cornerRadius(8).bold()
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(radius: 2)
        .sheet(isPresented: $showCamera) {
            ImagePicker(image: $capturedImage, onDone: uploadPhoto)
        }
        .sheet(isPresented: $showSignature) {
            SignatureView(onSave: uploadSignature)
        }
    }
    
    @State private var showCamera = false
    @State private var showSignature = false
    @State private var capturedImage: UIImage? = nil
    
    func addCost() {
        guard let tripId = api.activeTrip?["id"] as? Int,
              let amt = Double(amount), amt > 0 else { return }
        let fullConcept = note.isEmpty ? concept : "\(concept) - \(note)"
        api.addTripCost(tripId: tripId, concept: fullConcept, amount: amt) { _ in
            amount = ""
            note = ""
        }
    }
    
    func completeTrip() {
        guard let tripId = api.activeTrip?["id"] as? Int else { return }
        api.completeMyTrip(tripId: tripId) { _ in }
    }
    
    func markDeliveryDone(_ deliveryId: Int) {
        api.markDeliveryComplete(deliveryId: deliveryId) { ok in
            if ok {
                if let tripId = self.api.activeTrip?["id"] as? Int {
                    self.api.loadTripDeliveries(tripId: tripId)
                }
            }
        }
    }
    
    func uploadPhoto() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard let tripId = self.api.activeTrip?["id"] as? Int,
                  let image = self.capturedImage else {
                print("uploadPhoto failed: tripId=\(self.api.activeTrip?["id"] ?? "nil"), image=\(self.capturedImage != nil)")
                return
            }
            // Redimensionar imagen a máximo 800px y comprimir
            let resized = self.resizeImage(image, maxSize: 800)
            guard let data = resized.jpegData(compressionQuality: 0.3) else { return }
            print("uploadPhoto: size=\(data.count) bytes")
            let base64 = "data:image/jpeg;base64," + data.base64EncodedString()
            self.api.uploadEvidence(tripId: tripId, type: "photo", description: "Foto desde iPhone", imageData: base64)
            self.capturedImage = nil
        }
    }
    
    func resizeImage(_ image: UIImage, maxSize: CGFloat) -> UIImage {
        let size = image.size
        let ratio = min(maxSize / size.width, maxSize / size.height)
        if ratio >= 1 { return image }
        let newSize = CGSize(width: size.width * ratio, height: size.height * ratio)
        UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
        image.draw(in: CGRect(origin: .zero, size: newSize))
        let resized = UIGraphicsGetImageFromCurrentImageContext() ?? image
        UIGraphicsEndImageContext()
        return resized
    }
    
    func uploadSignature(_ image: UIImage) {
        guard let tripId = api.activeTrip?["id"] as? Int,
              let data = image.pngData() else { return }
        let base64 = "data:image/png;base64," + data.base64EncodedString()
        api.uploadEvidence(tripId: tripId, type: "signature", description: "Firma de entrega", imageData: base64)
    }
}

// MARK: - Driver Chat Section

struct DriverChatSection: View {
    @ObservedObject var api: APIManager
    @State private var expanded = false
    @State private var selectedContact: Int? = nil
    @State private var messageText = ""
    
    var totalUnread: Int {
        api.chatUnread.values.reduce(0, +)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: {
                expanded.toggle()
                if expanded {
                    api.loadChatContacts()
                    api.loadChatUnread()
                }
            }) {
                HStack {
                    Text("💬 Chat compañeros").font(.headline)
                    if totalUnread > 0 {
                        Text("\(totalUnread)")
                            .font(.caption).bold()
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Color.blue).foregroundColor(.white)
                            .cornerRadius(10)
                    }
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").foregroundColor(.secondary)
                }
            }.foregroundColor(.primary)
            
            if expanded {
                if selectedContact == nil {
                    // Lista de contactos
                    if api.chatContacts.isEmpty {
                        Text("Sin compañeros en tu empresa").font(.caption).foregroundColor(.secondary)
                    } else {
                        ForEach(api.chatContacts.indices, id: \.self) { i in
                            let contact = api.chatContacts[i]
                            let cId = contact["id"] as? Int ?? 0
                            let name = contact["person_name"] as? String ?? contact["device_name"] as? String ?? ""
                            let vehicle = contact["vehicle"] as? String ?? ""
                            let unread = api.chatUnread[cId] ?? 0
                            
                            Button(action: {
                                selectedContact = cId
                                api.loadConversation(otherDeviceId: cId)
                            }) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(name).font(.subheadline).bold()
                                        if !vehicle.isEmpty {
                                            Text("🚗 \(vehicle)").font(.caption2).foregroundColor(.secondary)
                                        }
                                    }
                                    Spacer()
                                    if unread > 0 {
                                        Text("\(unread)")
                                            .font(.caption2).bold()
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Color.blue).foregroundColor(.white)
                                            .cornerRadius(8)
                                    }
                                    Image(systemName: "chevron.right").font(.caption).foregroundColor(.secondary)
                                }
                                .padding(.vertical, 6)
                            }.foregroundColor(.primary)
                            Divider()
                        }
                    }
                } else {
                    // Conversación
                    let contact = api.chatContacts.first { ($0["id"] as? Int) == selectedContact }
                    let contactName = contact?["person_name"] as? String ?? contact?["device_name"] as? String ?? ""
                    
                    HStack {
                        Button(action: { selectedContact = nil }) {
                            Image(systemName: "arrow.left").font(.caption)
                        }
                        Text(contactName).font(.subheadline).bold()
                        Spacer()
                        Button(action: { api.loadConversation(otherDeviceId: selectedContact!) }) {
                            Image(systemName: "arrow.clockwise").font(.caption)
                        }
                    }
                    
                    ScrollView {
                        VStack(spacing: 6) {
                            if api.chatMessages.isEmpty {
                                Text("Sin mensajes aún").font(.caption).foregroundColor(.secondary).padding()
                            }
                            ForEach(api.chatMessages.indices, id: \.self) { i in
                                let msg = api.chatMessages[i]
                                let isMine = "\(msg["from_device_id"] ?? "")" == api.deviceId
                                let body = msg["body"] as? String ?? ""
                                
                                HStack {
                                    if isMine { Spacer() }
                                    Text(body)
                                        .font(.caption)
                                        .padding(.horizontal, 10).padding(.vertical, 6)
                                        .background(isMine ? Color.green.opacity(0.2) : Color.blue.opacity(0.1))
                                        .cornerRadius(12)
                                    if !isMine { Spacer() }
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 400)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    
                    HStack(spacing: 6) {
                        TextField("Escribe...", text: $messageText)
                            .textFieldStyle(.roundedBorder)
                            .font(.caption)
                        Button(action: sendMessage) {
                            Image(systemName: "paperplane.fill")
                                .foregroundColor(.white)
                                .padding(8)
                                .background(Color.green)
                                .cornerRadius(8)
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(radius: 2)
        .onAppear { api.loadChatUnread() }
    }
    
    func sendMessage() {
        guard let cId = selectedContact, !messageText.isEmpty else { return }
        let text = messageText
        messageText = ""
        api.sendChatMessage(otherDeviceId: cId, body: text) { ok in
            if ok { api.loadConversation(otherDeviceId: cId) }
        }
    }
}
