# 📍 TrackMonk

Web app para trackear ubicación de dispositivos usando Push Notifications.

## Arquitectura

- **Frontend** (`frontend/`) → Desplegado en AWS Amplify (sitio estático)
- **Backend** (`backend/`) → Desplegado en EC2 (mismo server que monkeyapp)
- **Base de datos**: MariaDB `location_tracker` (mismo servidor, BD independiente)
- **Push Notifications**: VAPID keys propias (independientes de monkeyapp)

## Setup del Backend (EC2)

```bash
# En la EC2, clonar y entrar al backend
git clone https://github.com/benjamin77834/trackMonk.git
cd trackMonk/backend

# Instalar dependencias
npm install

# Crear la base de datos y tablas
node scripts/init-db.js

# Iniciar con nohup (o pm2)
nohup node server.js &
```

## Setup del Frontend (Amplify)

1. Conectar el repo `trackMonk` en AWS Amplify
2. Amplify detecta el `amplify.yml` y despliega `frontend/` como sitio estático
3. Editar `frontend/config.js` con la URL de la API en EC2

## Flujo

1. Dispositivo se registra → permite notificaciones + ubicación
2. Dashboard: click "Trackear" → push notification al dispositivo
3. Dispositivo recibe push → obtiene GPS → envía al servidor
4. Ubicación guardada en MariaDB → visible en dashboard con link a Google Maps
