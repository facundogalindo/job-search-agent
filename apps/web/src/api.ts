import type { Session } from "@supabase/supabase-js";

export async function apiRequest<T>(path: string, session: Session, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${response.status}).`);
  }
  return payload as T;
}

export async function downloadCv(cvId: string, fileName: string, session: Session) {
  const response = await fetch(`/api/cvs/${encodeURIComponent(cvId)}/download`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.error === "string" ? payload.error : "No se pudo descargar el PDF.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
