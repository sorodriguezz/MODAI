import { state } from "../state.js";

export async function api(path, method = "GET", body) {
  const r = await fetch("/api/v1" + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: "Bearer " + state.token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(
      r.status === 401
        ? "Necesitas un token válido. Abre Conexión para identificarte."
        : r.status === 403
          ? "Tu acceso no tiene permisos para esta operación."
          : b.error?.message ||
            "No se pudo completar la solicitud (HTTP " + r.status + ").",
    );
  }
  return r.status === 204 ? null : r.json();
}
