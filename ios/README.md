# TrackMonk iOS

App nativa para iPhone con tracking GPS en segundo plano.

## Setup rápido (5 minutos)

### 1. Crear proyecto en Xcode

1. Abre **Xcode**
2. **File → New → Project**
3. **iOS → App** → Next
4. Configurar:
   - Product Name: `TrackMonkApp`
   - Team: (tu Apple ID)
   - Organization Identifier: `com.monkeyphone`
   - Interface: **SwiftUI**
   - Language: **Swift**
5. Guardar en: `trackerMonk/ios/`

### 2. Reemplazar archivos

En Finder, ve a `ios/TrackMonkApp/TrackMonkApp/` y reemplaza:
- `TrackMonkApp.swift` → copia de `ios/sources/TrackMonkApp.swift`
- `ContentView.swift` → copia de `ios/sources/ContentView.swift`

Luego arrastra estos archivos al proyecto en Xcode (Add to target):
- `ios/sources/LocationManager.swift`
- `ios/sources/APIManager.swift`

### 3. Configurar Info.plist

En Xcode, abre Info.plist y agrega las keys de `ios/sources/Info.plist`:
- NSLocationAlwaysAndWhenInUseUsageDescription
- NSLocationWhenInUseUsageDescription
- UIBackgroundModes: location, remote-notification

O reemplaza el Info.plist directamente.

### 4. Agregar capabilities

En el target → **Signing & Capabilities** → **+ Capability**:
- ✅ Background Modes → Location updates
- ✅ Push Notifications (opcional por ahora)

### 5. Compilar

1. Conecta tu iPhone por USB
2. Selecciona tu iPhone como destino (arriba)
3. ▶️ Run

La primera vez te pedirá confiar en el desarrollador:
iPhone → Ajustes → General → VPN y gestión de dispositivos → confiar

## Funcionalidades

- ✅ Login con credenciales del conductor
- ✅ Tracking GPS en segundo plano cada 5 minutos
- ✅ Enviar ubicación manual
- ✅ Botón de emergencia (accidente, robo, avería, auxilio)
- ✅ SMS automático al admin cuando hay emergencia
- ✅ Funciona con la app en segundo plano (background location)
- ✅ Se conecta al mismo backend que la web app
