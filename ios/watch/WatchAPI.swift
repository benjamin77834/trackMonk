import Foundation

struct WatchAPI {
    static let base = "https://api-tracker.monkeyfon.com"
    
    static func sendLocation(deviceId: String, lat: Double, lng: Double, acc: Double) {
        post("/api/location", body: ["deviceId": deviceId, "latitude": lat, "longitude": lng, "accuracy": acc])
    }
    
    static func sendAlert(deviceId: String, type: String, lat: Double?, lng: Double?, acc: Double?) {
        var body: [String: Any] = ["deviceId": deviceId, "alert_type": type, "message": "Desde Apple Watch"]
        if let lat = lat { body["latitude"] = lat }
        if let lng = lng { body["longitude"] = lng }
        if let acc = acc { body["accuracy"] = acc }
        post("/api/alerts", body: body)
    }
    
    private static func post(_ path: String, body: [String: Any]) {
        guard let url = URL(string: base + path) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
    }
}
