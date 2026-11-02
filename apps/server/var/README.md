# Datos del servidor local

Al iniciar sin Docker se crean aquí `data/modularai.db` y `artifacts/`. No se mantienen carpetas vacías en Git. El contenido generado está ignorado.

Con Docker se usan los volúmenes `modai-data` y `modai-artifacts`; esta carpeta no se utiliza. `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR` permiten elegir otras ubicaciones.
