import SwiftUI
import UIKit

struct SignatureView: View {
    var onSave: (UIImage) -> Void
    @Environment(\.dismiss) var dismiss
    @State private var lines: [[CGPoint]] = []
    @State private var currentLine: [CGPoint] = []
    
    var body: some View {
        NavigationView {
            VStack {
                Text("✍️ Firma de entrega").font(.headline).padding(.top)
                Text("Firma con el dedo").font(.caption).foregroundColor(.secondary)
                
                Canvas { context, size in
                    for line in lines {
                        var path = Path()
                        guard let first = line.first else { continue }
                        path.move(to: first)
                        for point in line.dropFirst() { path.addLine(to: point) }
                        context.stroke(path, with: .color(.black), lineWidth: 3)
                    }
                    var path = Path()
                    guard let first = currentLine.first else { return }
                    path.move(to: first)
                    for point in currentLine.dropFirst() { path.addLine(to: point) }
                    context.stroke(path, with: .color(.black), lineWidth: 3)
                }
                .frame(height: 200)
                .background(Color.white)
                .border(Color.gray.opacity(0.3))
                .cornerRadius(8)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in currentLine.append(value.location) }
                        .onEnded { _ in lines.append(currentLine); currentLine = [] }
                )
                .padding()
                
                HStack {
                    Button("Borrar") { lines = []; currentLine = [] }
                        .frame(maxWidth: .infinity).padding()
                        .background(Color(.systemGray5)).cornerRadius(8)
                    
                    Button("Guardar") { saveAndDismiss() }
                        .frame(maxWidth: .infinity).padding()
                        .background(Color.green).foregroundColor(.white).cornerRadius(8).bold()
                }
                .padding(.horizontal)
                
                Spacer()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
            }
        }
    }
    
    func saveAndDismiss() {
        // Render canvas to image
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 200))
        let image = renderer.image { ctx in
            ctx.cgContext.setFillColor(UIColor.white.cgColor)
            ctx.cgContext.fill(CGRect(x: 0, y: 0, width: 300, height: 200))
            ctx.cgContext.setStrokeColor(UIColor.black.cgColor)
            ctx.cgContext.setLineWidth(3)
            ctx.cgContext.setLineCap(.round)
            for line in lines {
                guard let first = line.first else { continue }
                ctx.cgContext.move(to: first)
                for point in line.dropFirst() { ctx.cgContext.addLine(to: point) }
                ctx.cgContext.strokePath()
            }
        }
        onSave(image)
        dismiss()
    }
}
