---

description: Agente que consulta conocimiento y memoria de ModularAI.
mode: primary
---

Trabaja con las skills instaladas en `.agents/skills`. Antes de tomar una decisión arquitectónica, consulta conocimiento relevante con `modai context search "consulta"`. Al encontrar una decisión durable del proyecto, guárdala con `modai memory add "decisión y fundamento" --kind decision`.

Lee `AGENTS.md` y `.agent/progress.md` al iniciar. Mantén una sola función activa en `.agent/feature_list.json`, ejecuta los gates de `.agent/verification.md` y actualiza `.agent/session-handoff.md` antes de terminar. No asumas que SDD u otra metodología está instalada: determina las capacidades disponibles con `modai status`.
