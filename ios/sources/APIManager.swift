import Foundation

class APIManager: ObservableObject {
    static let shared = APIManager()
    
    private let base = "https://api-tracker.monkeyfon.com"
    @Published var driverName = ""
    private var deviceId: String { UserDefaults.standard.string(forKey: "deviceId") ?? "" }
    private var userId = ""
    private var companySlug = ""
    
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
                    // Registrar dispositivo
                    self.registerDevice()
                }
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
    
    func logout() {
        driverName = ""
        userId = ""
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
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(nil); return
            }
            completion(json)
        }.resume()
    }
}
