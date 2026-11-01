# Datos de desarrollo local

El servidor iniciado fuera de Docker guarda SQLite en `data/` y los artefactos en `artifacts/`. Su contenido se ignora en Git. No guardes aquí código fuente ni configuración de despliegue.

Docker conserva esos datos en sus propios volúmenes, no en esta carpeta. Las variables `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR` permiten elegir otras ubicaciones.
