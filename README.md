# EntregaVecina

Gestión y entrega residencial puerta a puerta. Este proyecto se reorganizó en
`backend/` y `frontend/` a partir de una auditoría de seguridad y contractual
del prototipo original (ver `docs/`), que encontró que el control de roles y
el PIN de entrega no tenían ningún respaldo del lado servidor.

## Estructura

```
entrega-vecina/
├── backend/     # API Express + Prisma/PostgreSQL — auth, roles y PIN reales
├── frontend/    # SPA Vite + React — consume la API, sin lógica de negocio propia
└── docs/        # Prototipo original y modelo de datos, como referencia
```

## Arrancar en desarrollo

**Backend**
```
cd backend
cp .env.example .env   # completa DATABASE_URL, JWT_SECRET y OPERATOR_*
npm install
npm run prisma:migrate
npm run seed            # crea la única cuenta de operador, desde OPERATOR_* en .env
npm run dev              # http://localhost:4000
```

**Frontend**
```
cd frontend
npm install
npm run dev              # http://localhost:5173 (proxy a /api -> :4000)
```

Flujo: el operador inicia sesión con la cuenta creada por `npm run seed`.
Los residentes se crean ellos mismos en `/registro` (ese formulario nunca
puede crear una cuenta de operador — el rol lo fuerza el backend).

## Estado actual

- **Backend**: auth JWT, roles decididos server-side, PIN generado con
  `crypto` y comparado en el servidor (nunca expuesto al operador), tarifas
  fijas por categoría, y endpoints con verificación de dueño para
  pre-alerta / listado / programación / check-in / confirmación de entrega.
- **Frontend**: login, registro de residente, y ambas vistas (`ResidentView`,
  `OperatorView`) migradas para consumir la API — ya no usan `localStorage`
  para datos de negocio, solo para el token de sesión.
- Pendientes de la auditoría que no se resuelven con esta reestructuración:
  aviso de privacidad y consentimiento (Ley 1581), términos de servicio
  aceptados por el residente, y mover las fotos de custodia de un campo de
  texto (base64) a un servicio de almacenamiento de objetos con timestamp
  inmutable.
