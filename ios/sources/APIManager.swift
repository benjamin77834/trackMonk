import Foundation
import UIKit
import WatchConnectivity
import UserNotifications

class APIManager: ObservableObject {
    static let shared = APIManager()
    
    private let base = "https://api-tracker.monkeyfon.com"
    @Published var driverName = ""
    @Published var messages: [[String: Any]] = []
    @Published var unreadCount = 0
    @Published var activeTrip: [String: Any]? = nil
    @Published var tripCosts: [[String: Any]] = []
    @Published var tripDeliveries: [[String: Any]] = []
    
    var deviceId: String { UserDefaults.standard.string(forKey: "deviceId") ?? "" }
    private var userId = ""
    private var companySlug = ""
    private var pollTimer: Timer?
    
    func driverLogin(username: String, password: String, completion: @escaping (Bool, String) -> Void) {
        post("/api/auth/driver-login", body: ["username": username, "password": password]) { json in
            DispatchQueue.main.async {
                guard let json = json, json["success"] as? Bool == true else {
                    completion(false, "Credenciales inválidas"); return
                }
                self.userId = "\(json["userId"] ?? "")"
                self.driverName = json["name"] as? String ?? ""
                self.companySlug = json["companySlug"] as? String ?? ""
                if let did = json["deviceId"] as? Int {
                    UserDefaults.standard.set("\(did)", forKey: "deviceId")
                } else {
                    self.registerDevice()
                }
                self.startPolling()
                completion(true, "")
            }
        }
    }
    
    func registerDevice() {
        let name = UIDevice.current.name
        post("/api/devices/register", body: ["deviceName": name, "companySlug": companySlug, "userId": userId]) { json in
            if let json = json, let did = json["deviceId"] as? Int {
                UserDefaults.standard.set("\(did)", forKey: "deviceId")
                self.syncToWatch()
            }
        }
    }
    
    func syncToWatch() {
        if WCSession.isSupported() && WCSession.default.activationState == .activated {
            try? WCSession.default.updateApplicationContext(["deviceId": deviceId])
        }
    }
    
    func sendLocation(lat: Double, lng: Double, acc: Double) {
        guard !deviceId.isEmpty else { return }
        let payload: [String: Any] = ["deviceId": deviceId, "latitude": lat, "longitude": lng, "accuracy": acc]
        post("/api/location", body: payload) { json in
            if json != nil {
                // Éxito: enviar cola offline
                self.sendOfflineQueue()
            } else {
                // Sin conexión: guardar offline
                self.saveOffline(payload)
            }
        }
    }
    
    private func saveOffline(_ payload: [String: Any]) {
        var queue = UserDefaults.standard.array(forKey: "offlineQueue") as? [[String: Any]] ?? []
        queue.append(payload)
        if queue.count > 100 { queue = Array(queue.suffix(100)) }
        UserDefaults.standard.set(queue, forKey: "offlineQueue")
    }
    
    private func sendOfflineQueue() {
        guard var queue = UserDefaults.standard.array(forKey: "offlineQueue") as? [[String: Any]], !queue.isEmpty else { return }
        let item = queue.removeFirst()
        UserDefaults.standard.set(queue, forKey: "offlineQueue")
        post("/api/location", body: item) { json in
            if json != nil && !queue.isEmpty {
                self.sendOfflineQueue() // enviar siguiente
            }
        }
    }
    
    func sendAlert(type: String, message: String, lat: Double?, lng: Double?, acc: Double?) {
        guard !deviceId.isEmpty else { return }
        var body: [String: Any] = ["deviceId": deviceId, "alert_type": type, "message": message]
        if let lat = lat { body["latitude"] = lat }
        if let lng = lng { body["longitude"] = lng }
        if let acc = acc { body["accuracy"] = acc }
        post("/api/alerts", body: body) { _ in }
    }
    
    // MARK: - Messages Polling
    
    func startPolling() {
        checkMessages()
        loadActiveTrip()
        loadChatContacts()
        loadChatUnread()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.checkMessages()
            self?.loadActiveTrip()
            self?.loadChatUnread()
        }
    }
    
    func checkMessages() {
        guard !deviceId.isEmpty else { return }
        get("/api/my-messages/\(deviceId)/unread") { json in
            DispatchQueue.main.async {
                self.unreadCount = (json?["count"] as? Int) ?? 0
            }
        }
        get("/api/my-messages/\(deviceId)") { json in
            // json is array
        }
        // Fetch messages as array
        guard let url = URL(string: base + "/api/my-messages/\(deviceId)") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async {
                self.messages = arr
            }
        }.resume()
    }
    
    func markRead(messageId: Int) {
        put("/api/my-messages/\(messageId)/read") { _ in }
        DispatchQueue.main.async {
            if self.unreadCount > 0 { self.unreadCount -= 1 }
        }
    }
    
    func replyToMessage(messageId: Int, reply: String, completion: @escaping (Bool) -> Void) {
        post("/api/my-messages/\(messageId)/reply", body: ["reply": reply]) { json in
            let ok = json?["success"] as? Bool ?? false
            DispatchQueue.main.async { completion(ok) }
        }
    }
    
    // MARK: - Trips
    
    @Published var lastKnownTripId: Int? = nil
    
    func loadActiveTrip() {
        guard !deviceId.isEmpty else { return }
        guard let url = URL(string: base + "/api/my-trips/\(deviceId)") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async {
                let newTrip = arr.first
                let newTripId = newTrip?["id"] as? Int
                
                // Detectar viaje nuevo
                if let tid = newTripId, tid != self.lastKnownTripId {
                    self.lastKnownTripId = tid
                    if self.activeTrip == nil {
                        // Es un viaje nuevo, notificar
                        let origin = newTrip?["origin"] as? String ?? ""
                        let destination = newTrip?["destination"] as? String ?? ""
                        self.showTripNotification(origin: origin, destination: destination)
                    }
                }
                
                self.activeTrip = newTrip
                if let tripId = newTripId {
                    self.loadTripCosts(tripId: tripId)
                }
            }
        }.resume()
    }
    
    func loadTripCosts(tripId: Int) {
        guard let url = URL(string: base + "/api/my-trips/\(tripId)/costs") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async { self.tripCosts = arr }
        }.resume()
        loadTripDeliveries(tripId: tripId)
    }
    
    func loadTripDeliveries(tripId: Int) {
        guard let url = URL(string: base + "/api/trips/\(tripId)/deliveries") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async { self.tripDeliveries = arr }
        }.resume()
    }
    
    func markDeliveryComplete(deliveryId: Int, completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: base + "/api/deliveries/\(deliveryId)/complete") else { completion(false); return }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["signature_url": "", "photo_url": ""])
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { completion(false); return }
            let ok = json["success"] as? Bool ?? false
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }
    
    func addTripCost(tripId: Int, concept: String, amount: Double, completion: @escaping (Bool) -> Void) {
        post("/api/my-trips/\(tripId)/costs", body: ["concept": concept, "amount": amount]) { json in
            let ok = json?["success"] as? Bool ?? false
            DispatchQueue.main.async {
                if ok { self.loadTripCosts(tripId: tripId) }
                completion(ok)
            }
        }
    }
    
    func completeMyTrip(tripId: Int, completion: @escaping (Bool) -> Void) {
        put("/api/my-trips/\(tripId)/complete") { json in
            let ok = json?["success"] as? Bool ?? false
            DispatchQueue.main.async {
                if ok { self.activeTrip = nil; self.tripCosts = [] }
                completion(ok)
            }
        }
    }
    
    func uploadEvidence(tripId: Int, type: String, description: String, imageData: String) {
        post("/api/my-trips/\(tripId)/evidence", body: [
            "deviceId": deviceId,
            "type": type,
            "description": description,
            "image_data": imageData
        ]) { _ in }
    }
    
    func logout() {
        driverName = ""
        userId = ""
        pollTimer?.invalidate()
        pollTimer = nil
        UserDefaults.standard.removeObject(forKey: "deviceId")
    }
    
    // MARK: - Driver Chat
    
    @Published var chatContacts: [[String: Any]] = []
    @Published var chatMessages: [[String: Any]] = []
    @Published var chatUnread: [Int: Int] = [:] // deviceId -> count
    
    func loadChatContacts() {
        guard !deviceId.isEmpty else { return }
        guard let url = URL(string: base + "/api/driver-chat/contacts/\(deviceId)") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async { self.chatContacts = arr }
        }.resume()
    }
    
    func loadChatUnread() {
        guard !deviceId.isEmpty else { return }
        guard let url = URL(string: base + "/api/driver-chat/\(deviceId)/unread") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            var map: [Int: Int] = [:]
            for item in arr {
                if let did = item["from_device_id"] as? Int, let count = item["count"] as? Int {
                    map[did] = count
                }
            }
            DispatchQueue.main.async { self.chatUnread = map }
        }.resume()
    }
    
    func loadConversation(otherDeviceId: Int) {
        guard !deviceId.isEmpty else { return }
        guard let url = URL(string: base + "/api/driver-chat/\(deviceId)/\(otherDeviceId)") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async { self.chatMessages = arr }
        }.resume()
    }
    
    func sendChatMessage(otherDeviceId: Int, body: String, completion: @escaping (Bool) -> Void) {
        post("/api/driver-chat/\(deviceId)/\(otherDeviceId)", body: ["body": body]) { json in
            let ok = json?["success"] as? Bool ?? false
            DispatchQueue.main.async { completion(ok) }
        }
    }
    
    private func showTripNotification(origin: String, destination: String) {
        let content = UNMutableNotificationContent()
        content.title = "🚛 Nuevo viaje asignado"
        content.body = "📍 \(origin) → \(destination)"
        content.sound = UNNotificationSound.defaultCritical
        content.interruptionLevel = .timeSensitive
        
        let request = UNNotificationRequest(identifier: "trip-\(Int(Date().timeIntervalSince1970))", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
        
        // Segundo sonido después de 1 segundo
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            let content2 = UNMutableNotificationContent()
            content2.title = "🚛 Revisa tu viaje"
            content2.body = "📍 \(origin) → \(destination)"
            content2.sound = UNNotificationSound.defaultCritical
            
            let request2 = UNNotificationRequest(identifier: "trip2-\(Int(Date().timeIntervalSince1970))", content: content2, trigger: nil)
            UNUserNotificationCenter.current().add(request2)
        }
    }
    
    // MARK: - Network
    
    private func post(_ path: String, body: [String: Any], completion: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: base + path) else { completion(nil); return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { completion(nil); return }
            completion(json)
        }.resume()
    }
    
    private func get(_ path: String, completion: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: base + path) else { completion(nil); return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { completion(nil); return }
            completion(json)
        }.resume()
    }
    
    private func put(_ path: String, completion: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: base + path) else { completion(nil); return }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { completion(nil); return }
            completion(json)
        }.resume()
    }
}
