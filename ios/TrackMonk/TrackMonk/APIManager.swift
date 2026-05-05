import Foundation

class APIManager: ObservableObject {
    static let shared = APIManager()
    
    private let baseURL = "https://api-tracker.monkeyfon.com"
    @Published var driverName = ""
    @Published var deviceId: String = UserDefaults.standard.string(forKey: "deviceId") ?? ""
    private var userId: String = ""
    private var companySlug: String = ""
    
    func driverLogin(username: String, password: String, completion: @escaping (Bool, String) -> Void) {
        let url = URL(string: "\(baseURL)/api/auth/driver-login")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        
        URLSession.shared.dataTask(with: request) { data, _, error in
            DispatchQueue.main.async {
                guard let data = data, error == nil,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["success"] as? Bool == true else {
                    completion(false, "Credenciales inválidas")
                    return
                }
                self.userId = "\(json["userId"] ?? "")"
                self.driverName = json["name"] as? String ?? ""
                self.companySlug = json["companySlug"] as? String ?? ""
                if let did = json["deviceId"] as? Int {
                    self.deviceId = "\(did)"
                    UserDefaults.standard.set(self.deviceId, forKey: "deviceId")
                }
                completion(true, "")
            }
        }.resume()
    }
    
    func registerDevice(name: String, personName: String, phone: String, vehicle: String, completion: @escaping (Bool) -> Void) {
        let url = URL(string: "\(baseURL)/api/devices/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["deviceName": name, "companySlug": companySlug, "userId": userId]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { data, _, _ in
            DispatchQueue.main.async {
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["success"] as? Bool == true,
                      let did = json["deviceId"] as? Int else {
                    completion(false)
                    return
                }
                self.deviceId = "\(did)"
                UserDefaults.standard.set(self.deviceId, forKey: "deviceId")
                // Update profile
                self.updateProfile(name: name, personName: personName, phone: phone, vehicle: vehicle)
                completion(true)
            }
        }.resume()
    }
    
    func updateProfile(name: String, personName: String, phone: String, vehicle: String) {
        guard !deviceId.isEmpty else { return }
        let url = URL(string: "\(baseURL)/api/devices/\(deviceId)/profile")!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["device_name": name, "person_name": personName, "phone": phone, "vehicle": vehicle])
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }
    
    func sendLocation(latitude: Double, longitude: Double, accuracy: Double) {
        guard !deviceId.isEmpty else { return }
        let url = URL(string: "\(baseURL)/api/location")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "deviceId": deviceId,
            "latitude": latitude,
            "longitude": longitude,
            "accuracy": accuracy
        ])
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }
    
    func sendAlert(type: String, message: String, latitude: Double?, longitude: Double?, accuracy: Double?) {
        guard !deviceId.isEmpty else { return }
        let url = URL(string: "\(baseURL)/api/alerts")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["deviceId": deviceId, "alert_type": type, "message": message]
        if let lat = latitude { body["latitude"] = lat }
        if let lng = longitude { body["longitude"] = lng }
        if let acc = accuracy { body["accuracy"] = acc }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }
    
    func logout() {
        deviceId = ""
        userId = ""
        driverName = ""
        UserDefaults.standard.removeObject(forKey: "deviceId")
    }
}
