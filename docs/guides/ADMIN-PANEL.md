# Panel web: inicio de sesión, usuarios y roles

El panel de MODAI vive en `/admin`, en el mismo origen que la API (`/api/v1`). Las personas entran con **usuario y contraseña**; la sesión se guarda en una cookie `HttpOnly` que JavaScript no puede leer. Las **API keys** se siguen usando igual que antes para la CLI, el puente MCP y los workers.

| Quién | Cómo se autentica | Dónde se gestiona |
| --- | --- | --- |
| Personas en el navegador | Usuario y contraseña → cookie de sesión | **Administración › Usuarios** |
| CLI, MCP, workers, scripts | `Authorization: Bearer <API key>` | **Administración › Accesos** |
| Instalación inicial y recuperación | `MODAI_API_TOKEN` (token de instalación) | Variables del servidor / `deploy/.env` |

## 1. Primer inicio

Al abrir `/admin` en un servidor sin usuarios aparece la pantalla **Crea la cuenta de administración**. Pide:

1. **Token de instalación**: el valor de `MODAI_API_TOKEN` (o cualquier API key `admin` activa). Así, un servidor recién expuesto no puede reclamarlo quien lo encuentre primero.
2. Usuario (3 a 64 caracteres: letras, números, `.`, `-`, `_`; se guarda en minúsculas), nombre visible y contraseña (mínimo **10 caracteres**).

Al terminar quedas con la sesión iniciada. La pantalla deja de estar disponible en cuanto existe un usuario.

### Crear el administrador desde la configuración

En despliegues automatizados puedes sembrar la primera cuenta al arrancar:

```bash
MODAI_ADMIN_USERNAME=admin
MODAI_ADMIN_PASSWORD='una frase larga y difícil de adivinar'
```

- Solo se usa si **no existe ningún usuario**; después se ignora. Puedes borrar `MODAI_ADMIN_PASSWORD` del entorno tras el primer arranque.
- Si la contraseña no cumple la política, el servidor no arranca y lo indica en el log.
- Con un administrador sembrado el servidor puede arrancar sin `MODAI_API_TOKEN`, aunque recomendamos mantenerlo como credencial de recuperación.

## 2. Inicio y cierre de sesión

- El formulario muestra siempre el mismo error («Usuario o contraseña incorrectos») tanto si el usuario no existe como si la contraseña es incorrecta o la cuenta está desactivada.
- Tras **5 intentos fallidos en 15 minutos** el usuario queda bloqueado 15 minutos. Además, cada IP puede hacer como máximo 10 intentos de inicio de sesión por minuto.
- **Cerrar sesión** (menú del usuario, arriba a la derecha) elimina la sesión en el servidor.
- **Cambiar contraseña** (mismo menú) exige la contraseña actual y cierra las sesiones en otros dispositivos.
- Si la sesión expira mientras usas el panel, vuelves a la pantalla de inicio con un aviso.

## 3. Usuarios y roles

Los usuarios usan los **mismos roles y permisos que las API keys**; todas las comprobaciones del servidor se aplican igual.

| Rol | Puede |
| --- | --- |
| `reader` · Lectura | Consultar catálogo, conocimiento, agentes y la memoria y ejecuciones de sus proyectos. |
| `publisher` · Publicación | Lo anterior y además publicar paquetes en sus namespaces, crear y editar conocimiento, crear proyectos, guardar memoria y enviar o cancelar tareas. |
| `worker` · Worker | Pensado para workers: reclamar y completar ejecuciones y escribir memoria en sus proyectos. |
| `admin` · Administración | Todo: usuarios, API keys, publicadores, auditoría, backups y retención. Accede a todos los proyectos. |

Cada usuario tiene además:

- **Proyectos**: los que puede ver además de los que cree.
- **Organizaciones**: habilitan la memoria de organización.
- **Namespaces publicables** (`@equipo`, o `*` para todos).

Desde **Usuarios** una persona administradora puede crear cuentas (con un generador de contraseñas), editar rol y permisos, restablecer la contraseña, desactivar/activar y eliminar. Los cambios de rol y permisos aplican al instante, incluso en sesiones abiertas. Desactivar o restablecer la contraseña cierra las sesiones de esa persona.

Protecciones:

- Siempre debe quedar **al menos un administrador activo**: no se puede eliminar, desactivar ni degradar al último.
- Nadie puede eliminarse, desactivarse ni cambiar su propio rol.

El panel oculta las secciones y acciones que tu rol no permite (por ejemplo, **Usuarios**, **Accesos** y **Auditoría** solo aparecen para `admin`), pero la autorización real siempre la decide el servidor.

## 4. API keys y su relación con los usuarios

- Una cuenta del panel **no sirve** para la CLI ni para MCP. Para conectar un equipo, abre **Conectar un cliente**, elige el proyecto y pulsa **Crear API key para este proyecto**: el panel muestra el token una sola vez y los comandos (`modai connect`, `modai init --project …`).
- Las API keys se crean, ajustan y revocan en **Accesos**. Su rol no cambia; para otro rol, revoca y crea una nueva.
- Si en una petición hay cabecera `Authorization: Bearer`, el servidor la usa y **ignora la cookie**. Un Bearer inválido no recurre a la sesión.
- `MODAI_API_TOKEN` sigue siendo una credencial `admin` completa para la API. Úsala solo para instalación, automatización y recuperación; no la compartas.

## 5. Sesiones y seguridad

- **Contraseñas**: `scrypt` (N=2^15, r=8, p=1) con sal aleatoria por usuario y comparación en tiempo constante. Las cuentas inexistentes cuestan el mismo cálculo, para no revelar qué usuarios existen.
- **Sesiones**: token aleatorio de 256 bits; en la base de datos solo se guarda su hash SHA-256 (tabla `sessions`). Caducan tras **12 horas sin actividad** (ventana deslizante) y, como máximo, a los **7 días** de iniciarse.
- **Cookie** `modai_session`: `HttpOnly; SameSite=Strict; Path=/` y `Secure` cuando la petición llega por HTTPS o `MODAI_PUBLIC_URL` empieza por `https://`. Si usas HTTPS detrás de un proxy, configura `MODAI_PUBLIC_URL` para que la cookie se marque `Secure`.
- **CSRF**: toda escritura autenticada con cookie (y el login, la instalación y el cierre de sesión) exige la cabecera `x-modai-csrf: 1`, que un formulario de otro sitio no puede enviar (CORS está deshabilitado). Si llega una cabecera `Origin`, debe coincidir con el host del servidor o con `MODAI_PUBLIC_URL`.
- **CSP estricta**: el panel no usa scripts en línea y todo dato del servidor se escapa antes de insertarse en la página.
- **Auditoría**: se registran instalación, inicios de sesión correctos y fallidos (con IP), cierres de sesión, cambios de contraseña y toda creación, modificación o eliminación de usuarios. Consulta **Administración › Auditoría**.

### Recuperar el acceso

Si se pierde la contraseña del único administrador, usa el token de instalación contra la API para restablecerla:

```bash
curl -s -H "Authorization: Bearer $MODAI_API_TOKEN" https://TU_SERVIDOR/api/v1/admin/users
curl -s -X PATCH -H "Authorization: Bearer $MODAI_API_TOKEN" -H "content-type: application/json" \
  -d '{"password":"nueva contraseña larga"}' https://TU_SERVIDOR/api/v1/admin/users/ID_DEL_USUARIO
```

## 6. Rutas de la API

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/v1/auth/status` | `setupRequired`, identidad actual y política de contraseña. Sin autenticación. |
| `POST /api/v1/auth/setup` | Crea el primer admin: `{ bootstrapToken, username, displayName?, password }`. |
| `POST /api/v1/auth/login` | `{ username, password }` → cookie de sesión. |
| `POST /api/v1/auth/logout` | Elimina la sesión y borra la cookie. |
| `GET /api/v1/auth/me` | Identidad actual (usuario o API key). |
| `POST /api/v1/auth/password` | `{ currentPassword, newPassword }`, solo para usuarios. |
| `GET /api/v1/admin/users` | Lista de usuarios (admin). |
| `POST /api/v1/admin/users` | `{ username, displayName?, password, role, projectIds?, organizationIds?, packageScopes? }`. |
| `PATCH /api/v1/admin/users/:id` | Cualquier combinación de `displayName`, `role`, permisos, `disabled` y `password`. |
| `DELETE /api/v1/admin/users/:id` | Elimina la cuenta y sus sesiones. |

Las rutas de escritura con cookie requieren `x-modai-csrf: 1`; con Bearer no hace falta.
