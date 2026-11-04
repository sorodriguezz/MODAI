export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fallback = {
  400: "Revisa los datos del formulario.",
  401: "Tu sesión expiró. Vuelve a iniciar sesión.",
  403: "Tu rol no permite realizar esta operación.",
  404: "El recurso ya no existe.",
  409: "La operación entra en conflicto con el estado actual.",
  429: "Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.",
};

function requestHeaders(method, body) {
  const headers = { accept: "application/json" };
  if (method !== "GET" && method !== "HEAD") headers["x-modai-csrf"] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  return headers;
}

function errorMessage(status, payload) {
  if (status >= 500) return "El servidor tuvo un problema. Inténtalo de nuevo en unos segundos.";
  return payload.error?.message || fallback[status] || `No se pudo completar la solicitud (HTTP ${status}).`;
}

async function failure(response, path) {
  const payload = await response.json().catch(() => ({}));
  const code = payload.error?.code || `HTTP_${response.status}`;
  if (response.status === 401 && !path.startsWith("/auth/"))
    window.dispatchEvent(new CustomEvent("modai:unauthorized"));
  return new ApiError(response.status, code, errorMessage(response.status, payload));
}

export async function api(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: requestHeaders(method, body),
      credentials: "same-origin",
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", "No se pudo conectar con el servidor. Comprueba tu conexión.");
  }
  if (!response.ok) throw await failure(response, path);
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("json") ? response.json() : response.text();
}

export const get = (path, options) => api(path, options);
export const post = (path, body = {}) => api(path, { method: "POST", body });
export const patch = (path, body = {}) => api(path, { method: "PATCH", body });
export const del = (path, body) => api(path, { method: "DELETE", body });

export async function health() {
  const response = await fetch("/health", { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, "HEALTH", "Servidor no disponible");
  return response.json();
}
