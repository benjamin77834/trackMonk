import Foundation
import UIKit

class APIManager: ObservableObject {
    static let shared = APIManager()
    
    private let base = "https://api-tracker.monkeyfon.com"
    @Published var driverName = ""
    @Published var messages: [[String: Any]] = []
    @Published var unreadCount = 0
    @Published var activeTrip: [String: Any]? = nil
    @Published var tripCosts: [[String: Any]] = []
    
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
            }
        }
    }
    
    func sendLocation(lat: Double, lng: Double, acc: Double) {
        guard !deviceId.isEmpty else { return }
        post("/api/location", body: ["deviceId": deviceId, "latitude": lat, "longitude": lng, "accuracy": acc]) { _ in }
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
        pollTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.checkMessages()
            self?.loadActiveTrip()
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
    
    func loadActiveTrip() {
        guard !deviceId.isEmpty else { return }
        guard let url = URL(string: base + "/api/my-trips/\(deviceId)") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
            DispatchQueue.main.async {
                self.activeTrip = arr.first
                if let tripId = self.activeTrip?["id"] as? Int {
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
    
    func logout() {
        driverName = ""
        userId = ""
        pollTimer?.invalidate()
        pollTimer = nil
        UserDefaults.standard.removeObject(forKey: "deviceId")
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
