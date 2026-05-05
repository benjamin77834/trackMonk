# TrackMonk iOS

App nativa para iPhone con tracking GPS en segundo plano.

## Requisitos

- Mac con Xcode 15+
- iPhone con iOS 16+
- Cable USB para conectar el iPhone

## Setup

1. Abre Xcode
2. File → New → Project → iOS → App
3. Product Name: **TrackMonk**
4. Organization: **com.monkeyphone**
5. Interface: **SwiftUI**
6. Language: **Swift**
7. Crea el proyecto en una carpeta temporal
8. Reemplaza los archivos generados con los de esta carpeta:
   - `TrackMonkApp.swift`
   - `ContentView.swift`
   - `LocationManager.swift`
   - `APIManager.swift`
9. Agrega `Info.plist` al proyecto
10. En el target → Signing & Capabilities:
    - Agrega **Background Modes**: Location updates, Remote notifications
    - Agrega **Push Notifications**
11. Conecta tu iPhone por USB
12. Selecciona tu iPhone como destino
13. Run (▶️)

## Funcionalidades

- ✅ Login con credenciales del conductor
- ✅ Tracking GPS en segundo plano (cada 5 minutos)
- ✅ Enviar ubicación manual
- ✅ Botón de emergencia (accidente, robo, avería, auxilio)
- ✅ Funciona con la app cerrada (background location)

## Diferencia con la web app

La app nativa puede obtener GPS en segundo plano sin que el usuario interactúe.
La web app en iOS necesita que el usuario toque la notificación.
